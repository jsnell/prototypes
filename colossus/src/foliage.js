// Trees and ground cover. Instanced, swaying in the wind, shake/char/topple when things go boom.
import * as THREE from 'three';
import { MAP_W as W, MAP_D as D, WATER_LEVEL } from './config.js';
import { buildTreeGeometry, buildTuftGeometry, buildFlowerGeometry } from './models.js';
import { MAT } from './terrain.js';
import { Noise2, mulberry32, rand } from './util.js';

export function windMaterial(timeUniform, base, amp, lambert = true) {
  const m = lambert ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshBasicMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeUniform;
    sh.vertexShader = 'uniform float uTime;\nattribute float aShake;\nattribute float aPhase;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float sway = max(0.0, position.y - ${base.toFixed(2)}) * ${amp.toFixed(3)};
      float w = sin(uTime * 1.7 + aPhase) + 0.45 * sin(uTime * 4.3 + aPhase * 1.7) + 0.6;
      float s = aShake * sin(uTime * 32.0 + aPhase * 3.0) * 18.0;
      transformed.x += (w + s) * sway;
      transformed.z += (w * 0.4 + s * 0.8) * sway * 0.7;`);
  };
  return m;
}

const CELL = 4;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _ax = new THREE.Vector3();
const CHAR = new THREE.Color(0.22, 0.2, 0.18);

export class Foliage {
  constructor(G) {
    this.G = G;
    this.time = { value: 0 };
    const T = G.terrain, L = G.layout;
    const rng = mulberry32(L.seed * 31 + 5);
    const forest = new Noise2(L.seed + 101), meadow = new Noise2(L.seed + 202);
    const blocked = (x, z, r) => {
      for (const p of [L.tankStart, L.cp, ...L.factories]) if (Math.hypot(p.x - x, p.z - z) < r + 9) return true;
      for (const v of L.villages) if (Math.hypot(v.x - x, v.z - z) < r + 5) return true;
      return false;
    };
    // --- trees
    this.trees = [];
    for (let z = 3; z < D - 3; z += 2.1) {
      for (let x = 3; x < W - 3; x += 2.1) {
        const px = x + (rng() - 0.5) * 1.8, pz = z + (rng() - 0.5) * 1.8;
        const f = forest.fbm(px * 0.035, pz * 0.035, 3);
        const dens = f > 0.12 ? 0.55 : (f > -0.05 ? 0.07 : 0.012);
        if (rng() > dens) continue;
        const i = Math.floor(px), j = Math.floor(pz), k = j * W + i;
        const h = T.H[k], m = T.mat[k];
        if (h < WATER_LEVEL + 0.5 || h > 17 || (m !== MAT.GRASS && m !== MAT.SNOW && !(m === MAT.STONE && rng() < 0.2))) continue;
        if (T.roadCells[k]) continue;
        if (blocked(px, pz, 2)) continue;
        const kind = h >= 13 || m === MAT.STONE ? 1 : (rng() < 0.12 ? 2 : (rng() < 0.3 ? 1 : 0));
        this.trees.push({ x: px, z: pz, y: h, kind, rot: Math.floor(rng() * 4) * Math.PI / 2 + (rng() - 0.5) * 0.3, scale: 0.8 + rng() * 0.45, state: 0, t: 0, dx: 0, dz: 1, charred: false, idx: 0 });
      }
    }
    this.treeMeshes = [];
    for (let kind = 0; kind < 3; kind++) {
      const list = this.trees.filter((t) => t.kind === kind);
      const geo = buildTreeGeometry(kind);
      const n = Math.max(1, list.length);
      geo.setAttribute('aShake', new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
      const ph = new Float32Array(n); for (let q = 0; q < n; q++) ph[q] = rng() * 6.28;
      geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
      const im = new THREE.InstancedMesh(geo, windMaterial(this.time, 1.2, 0.05), n);
      im.castShadow = true; im.receiveShadow = true;
      im.count = list.length;
      list.forEach((t, q) => { t.idx = q; t.mesh = im; this.setTreeMatrix(t); im.setColorAt(q, new THREE.Color(1, 1, 1)); });
      if (im.instanceColor) im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      G.scene.add(im);
      this.treeMeshes.push(im);
    }
    this.grid = new Map();
    for (const t of this.trees) this.gridAdd(this.grid, t.x, t.z, t);
    this.active = new Set();

    // --- ground cover
    this.covers = [];
    const tuftGeo = buildTuftGeometry(), flowerGeo = buildFlowerGeometry();
    const tufts = [], flowers = [];
    for (let n = 0; n < 9000 && (tufts.length < 3200 || flowers.length < 1600); n++) {
      const x = 2 + rng() * (W - 4), z = 2 + rng() * (D - 4);
      const i = Math.floor(x), j = Math.floor(z), k = j * W + i;
      if (T.mat[k] !== MAT.GRASS || T.H[k] < WATER_LEVEL) continue;
      const mv = meadow.fbm(x * 0.06, z * 0.06, 2);
      if (mv > 0.15 && flowers.length < 1600 && rng() < 0.7) flowers.push({ x, z, y: T.H[k], c: rng() });
      else if (tufts.length < 3200) tufts.push({ x, z, y: T.H[k], c: rng() });
    }
    const mk = (geo, list, colorFn, base, amp) => {
      const n = Math.max(1, list.length);
      geo.setAttribute('aShake', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
      const ph = new Float32Array(n); for (let q = 0; q < n; q++) ph[q] = rng() * 6.28;
      geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
      const im = new THREE.InstancedMesh(geo, windMaterial(this.time, base, amp), n);
      im.receiveShadow = true;
      im.count = list.length;
      const c = new THREE.Color();
      list.forEach((o, q) => {
        _q.setFromAxisAngle(_ax.set(0, 1, 0), rng() * 6.28);
        const s = 0.8 + rng() * 0.6;
        _m.compose(_p.set(o.x, o.y, o.z), _q, _s.set(s, s, s));
        im.setMatrixAt(q, _m);
        im.setColorAt(q, colorFn(o, c));
        o.idx = q; o.mesh = im; o.alive = true;
        this.gridAdd(this.coverGrid || (this.coverGrid = new Map()), o.x, o.z, o);
      });
      G.scene.add(im);
      return im;
    };
    const G1 = new THREE.Color(0x5fb84f), G2 = new THREE.Color(0x8fd65a);
    mk(tuftGeo, tufts, (o, c) => c.copy(G1).lerp(G2, o.c), 0.0, 0.15);
    const FL = [0xff8fb8, 0xffe066, 0xffffff, 0xb79cff, 0xff9f5a].map((h) => new THREE.Color(h));
    mk(flowerGeo, flowers, (o, c) => c.copy(FL[Math.floor(o.c * FL.length)]), 0.1, 0.18);
  }

  gridAdd(grid, x, z, o) {
    const key = Math.floor(x / CELL) + Math.floor(z / CELL) * 1000;
    let a = grid.get(key);
    if (!a) grid.set(key, a = []);
    a.push(o);
  }
  query(grid, x, z, r, fn) {
    if (!grid) return;
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const a = grid.get(i + j * 1000);
      if (!a) continue;
      for (const o of a) {
        const d = Math.hypot(o.x - x, o.z - z);
        if (d <= r) fn(o, d);
      }
    }
  }

  setTreeMatrix(t) {
    let ang = 0, sc = t.scale, sink = 0;
    if (t.state === 1) {
      const k = Math.min(1, t.t / 0.8);
      ang = k * k * 1.45;
      if (t.t > 0.8) ang = 1.45 + Math.sin((t.t - 0.8) * 14) * Math.exp(-(t.t - 0.8) * 6) * 0.1;
      if (t.t > 2.4) sc = t.scale * Math.max(0, 1 - (t.t - 2.4) / 0.6);
      sink = 0;
    } else if (t.state === 2) sc = 0;
    _q.setFromAxisAngle(_ax.set(0, 1, 0), t.rot);
    if (ang) {
      const tq = new THREE.Quaternion().setFromAxisAngle(_ax.set(t.dz, 0, -t.dx).normalize(), ang);
      _q.premultiply(tq);
    }
    _m.compose(_p.set(t.x, t.y - sink, t.z), _q, _s.set(sc, sc, sc));
    t.mesh.setMatrixAt(t.idx, _m);
    t.mesh.instanceMatrix.needsUpdate = true;
  }

  shake(t, amt) {
    if (t.state !== 0) return;
    const a = t.mesh.geometry.attributes.aShake;
    a.array[t.idx] = Math.min(0.12, a.array[t.idx] + amt);
    a.needsUpdate = true;
    this.active.add(t);
  }

  topple(t, dx, dz) {
    if (t.state !== 0) return;
    const l = Math.hypot(dx, dz) || 1;
    t.dx = dx / l; t.dz = dz / l;
    t.state = 1; t.t = 0;
    const a = t.mesh.geometry.attributes.aShake;
    a.array[t.idx] = 0; a.needsUpdate = true;
    this.active.add(t);
    const fx = this.G.fx;
    const leaf = t.kind === 2 ? [1, 0.66, 0.77] : t.kind === 1 ? [0.25, 0.6, 0.36] : [0.42, 0.77, 0.35];
    fx.debrisBurst(t.x, t.y + 2, t.z, leaf, 5, 3, 0.25);
    this.G.audio && this.G.audio.play('crack', { x: t.x, z: t.z, vol: 0.5 });
  }

  char(t) {
    if (t.charred || t.state === 2) return;
    t.charred = true;
    t.mesh.setColorAt(t.idx, CHAR);
    t.mesh.instanceColor.needsUpdate = true;
  }

  // explosion at x,z
  blast(x, z, r, s) {
    this.query(this.grid, x, z, r + 2, (t, d) => {
      if (t.state !== 0) return;
      if (d < r * 0.35 * Math.min(1.5, s)) this.topple(t, t.x - x, t.z - z);
      else {
        if (d < r * 0.8) this.char(t);
        this.shake(t, 0.12 * (1 - d / (r + 2)) * s);
      }
    });
    this.query(this.coverGrid, x, z, r * 0.6, (o) => this.killCover(o));
  }

  // tank body sweep: OBB test done by caller via fn(x,z)
  crushIn(x, z, r, inside, dirx, dirz) {
    let n = 0;
    this.query(this.grid, x, z, r, (t) => {
      if (t.state === 0 && inside(t.x, t.z)) { this.topple(t, dirx + (Math.random() - 0.5) * 0.6, dirz + (Math.random() - 0.5) * 0.6); n++; }
      else if (t.state === 0) this.shake(t, 0.02);
    });
    this.query(this.coverGrid, x, z, r, (o) => { if (o.alive && inside(o.x, o.z)) this.killCover(o); });
    return n;
  }

  killCover(o) {
    if (!o.alive) return;
    o.alive = false;
    _m.makeScale(0, 0, 0);
    o.mesh.setMatrixAt(o.idx, _m);
    o.mesh.instanceMatrix.needsUpdate = true;
  }

  // terrain changed under trees
  onTerrain(i0, j0, i1, j1) {
    const T = this.G.terrain;
    this.query(this.grid, (i0 + i1) / 2, (j0 + j1) / 2, Math.max(i1 - i0, j1 - j0) + 2, (t) => {
      if (t.state !== 0) return;
      const h = T.heightAt(t.x, t.z);
      if (h < t.y) this.topple(t, rand(-1, 1), rand(-1, 1));
    });
    this.query(this.coverGrid, (i0 + i1) / 2, (j0 + j1) / 2, Math.max(i1 - i0, j1 - j0) + 1, (o) => {
      if (o.alive && T.heightAt(o.x, o.z) !== o.y) this.killCover(o);
    });
  }

  update(dt, vt) {
    this.time.value = vt;
    for (const t of this.active) {
      if (t.state === 0) {
        const a = t.mesh.geometry.attributes.aShake;
        a.array[t.idx] *= Math.max(0, 1 - dt * 2.5);
        if (a.array[t.idx] < 0.002) { a.array[t.idx] = 0; this.active.delete(t); }
        a.needsUpdate = true;
      } else if (t.state === 1) {
        t.t += dt;
        if (t.t > 2.4 && !t.puffed) {
          t.puffed = true;
          const fx = this.G.fx;
          for (let q = 0; q < 4; q++) fx.puff(t.x + t.dx * 2, t.y + 0.5, t.z + t.dz * 2, [0.85, 0.8, 0.7], 0.8, 1.0, 0.8);
        }
        if (t.t > 3.0) { t.state = 2; this.active.delete(t); }
        this.setTreeMatrix(t);
      }
    }
  }
}
