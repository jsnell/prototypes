// Voxel heightmap terrain: generation, chunked meshing with voxel AO, deformation, queries.
import * as THREE from 'three';
import { MAP_W as W, MAP_D as D, CHUNK, BASE_Y, WATER_LEVEL } from './config.js';
import { Noise2, hash2i, clamp, lerp, smoothstep, distToSeg } from './util.js';

export const MAT = { GRASS: 0, SAND: 1, STONE: 2, SNOW: 3, ROAD: 4, MUD: 5, DIRT: 6 };

const C = (h) => new THREE.Color(h);
export const PAL = {
  grassA: C(0x93d862), grassB: C(0x6cc257), meadow: C(0xbfe06a), grassSide: C(0x62ad4a),
  dirt: C(0xb77f4c), dirtDeep: C(0x98683e), clay: C(0xcf9559), clayDark: C(0xa86f45),
  stone: C(0xa7acb4), stoneDark: C(0x878d97),
  sand: C(0xf1dea8), sandSide: C(0xdcc48d),
  mud: C(0xc9aa78), snow: C(0xf7f9fc), road: C(0xd9ae72), crater: C(0x9f7049),
  scorch: C(0x3a332d), bedrock: C(0x6d6a72),
};

const tmpC = new THREE.Color();

export class Terrain {
  constructor(layout) {
    this.L = layout;
    const N = W * D;
    this.H = new Int16Array(N);
    this.mat = new Uint8Array(N);
    this.scorch = new Float32Array(N);
    this.wear = new Float32Array(N);
    this.tint = new Float32Array(N);
    this.bridge = new Uint8Array(N);
    this.cx = W / CHUNK; this.cz = D / CHUNK;
    this.meshes = new Array(this.cx * this.cz).fill(null);
    this.dirty = new Set();
    this.version = 0;
    this.listeners = [];
    this.generate();
    this.heightData = new Uint8Array(N);
    this.heightTex = new THREE.DataTexture(this.heightData, W, D, THREE.RedFormat, THREE.UnsignedByteType);
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.minFilter = THREE.LinearFilter;
    this.updateHeightTex();
  }

  idx(i, j) { return j * W + i; }
  inside(i, j) { return i >= 0 && j >= 0 && i < W && j < D; }
  hAt(i, j) { return (i >= 0 && j >= 0 && i < W && j < D) ? this.H[j * W + i] : BASE_Y; }

  // ---------------------------------------------------------------- generation
  generate() {
    const L = this.L, s = L.seed;
    const n1 = new Noise2(s), n2 = new Noise2(s + 7), n3 = new Noise2(s + 13);
    const rz = L.riverZ;
    const raw = (x, z) => {
      let h = 7.2 + n1.fbm(x * 0.02, z * 0.02, 4) * 6;
      const hill = n2.fbm(x * 0.042 + 10, z * 0.042, 3);
      if (hill > 0.08) h += (hill - 0.08) * 17;
      for (const m of L.mesas) {
        const d = Math.hypot(x - m.x, z - m.z);
        const edge = m.r + n3.value(Math.atan2(z - m.z, x - m.x) * 2 + 5, m.x) * 1.6;
        if (d < edge) h = Math.max(h, m.h);
        else if (d < edge + 2.5) h = Math.max(h, m.h - 5);
      }
      const e = Math.min(x, W - x);
      if (e < 14) h += Math.pow(1 - e / 14, 2) * (10 + 5 * n3.value(x * 0.08, z * 0.08));
      const ez = Math.min(z, D - z);
      if (ez < 9) h += Math.pow(1 - ez / 9, 2) * 5;
      return h;
    };
    const zones = [
      { x: L.tankStart.x, z: L.tankStart.z, r: 18 },
      { x: L.cp.x, z: L.cp.z, r: 10 },
      ...L.factories.map((f) => ({ x: f.x, z: f.z, r: 10 })),
    ];
    for (const zn of zones) zn.h = Math.max(6, Math.round(raw(zn.x, zn.z)));
    for (const v of L.villages) zones.push({ x: v.x, z: v.z, r: 9, h: Math.max(6, Math.round(raw(v.x, v.z))), soft: true });

    for (let j = 0; j < D; j++) {
      for (let i = 0; i < W; i++) {
        const x = i + 0.5, z = j + 0.5;
        let h = raw(x, z);
        for (const zn of zones) {
          const d = Math.hypot(x - zn.x, z - zn.z);
          const w = 1 - smoothstep(zn.r * (zn.soft ? 0.4 : 0.65), zn.r, d);
          if (w > 0) h = lerp(h, zn.h, w);
        }
        // lake
        const lk = L.lake;
        const dl = Math.hypot(x - lk.x, z - lk.z) + n3.value(x * 0.2, z * 0.2) * 1.5;
        if (dl < lk.r + 6) {
          const bed = 1.5 + (dl / lk.r) * 2.2;
          h = lerp(Math.min(h, bed), h, smoothstep(lk.r - 1, lk.r + 6, dl));
        }
        // river
        const dz = Math.abs(z - rz(x));
        const rw = 4 + 1.3 * n3.value(x * 0.06, 50);
        if (dz < rw + 7) {
          let bed = 2 + n3.value(x * 0.2, 9) * 0.6;
          for (const fx of L.fords) if (Math.abs(x - fx) < 4.5) bed = 4;
          const t = smoothstep(rw * 0.55, rw + 7, dz);
          h = lerp(Math.min(h, bed), h, t);
        }
        this.H[j * W + i] = clamp(Math.round(h), 1, 26);
      }
    }
    // materials
    for (let j = 0; j < D; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i, h = this.H[k];
        this.tint[k] = n3.value(i * 0.07 + 3, j * 0.07) * 0.5 + 0.5;
        if (h < WATER_LEVEL) { this.mat[k] = MAT.MUD; continue; }
        let nearWater = false, maxDiff = 0;
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
          const hh = this.hAt(i + di, j + dj);
          if (hh > BASE_Y && hh < WATER_LEVEL) nearWater = true;
        }
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const hh = this.hAt(i + di, j + dj);
          if (hh > BASE_Y) maxDiff = Math.max(maxDiff, h - hh);
        }
        let m = MAT.GRASS;
        if (h <= 5 && nearWater) m = MAT.SAND;
        else if (maxDiff >= 3) m = MAT.STONE;
        else if (h >= 19) m = MAT.SNOW;
        else if (h >= 15) m = MAT.STONE;
        this.mat[k] = m;
      }
    }
    // roads & bridges
    this.roadCells = new Uint8Array(W * D);
    for (const road of L.roads) {
      for (let s2 = 0; s2 < road.length - 1; s2++) {
        const a = road[s2], b = road[s2 + 1];
        const i0 = Math.floor(Math.min(a.x, b.x) - 2), i1 = Math.ceil(Math.max(a.x, b.x) + 2);
        const j0 = Math.floor(Math.min(a.z, b.z) - 2), j1 = Math.ceil(Math.max(a.z, b.z) + 2);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          if (!this.inside(i, j)) continue;
          const d = distToSeg(i + 0.5, j + 0.5, a.x, a.z, b.x, b.z);
          if (d > 1.35) continue;
          const k = j * W + i;
          this.roadCells[k] = 1;
          if (this.H[k] < WATER_LEVEL) { this.bridge[k] = 1; continue; }
          if (this.mat[k] === MAT.GRASS || this.mat[k] === MAT.SAND) this.mat[k] = MAT.ROAD;
        }
      }
    }
  }

  // ---------------------------------------------------------------- queries
  heightAt(x, z) { return this.hAt(Math.floor(x), Math.floor(z)); }
  surfaceAt(x, z) { return Math.max(this.heightAt(x, z), WATER_LEVEL); }
  // bilinear over column centres, for smooth vehicle placement
  smoothHeightAt(x, z) {
    const fx = clamp(x - 0.5, 0, W - 1.001), fz = clamp(z - 0.5, 0, D - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const H = this.H;
    const a = H[j * W + i], b = H[j * W + i + 1], c = H[(j + 1) * W + i], d = H[(j + 1) * W + i + 1];
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  isWater(x, z) { return this.heightAt(x, z) < WATER_LEVEL; }
  depthAt(x, z) { return WATER_LEVEL - this.heightAt(x, z); }

  // voxel DDA raycast against the column tops. Returns {x,y,z,i,j} or null.
  raycast(ro, rd, water = true) {
    let tmin = 0, tmax = 4000;
    const bmin = [0, BASE_Y, 0], bmax = [W, 60, D];
    const o = [ro.x, ro.y, ro.z], d = [rd.x, rd.y, rd.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < bmin[a] || o[a] > bmax[a]) return null;
      } else {
        let t1 = (bmin[a] - o[a]) / d[a], t2 = (bmax[a] - o[a]) / d[a];
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    let t = tmin + 1e-4;
    let px = ro.x + rd.x * t, pz = ro.z + rd.z * t;
    let i = clamp(Math.floor(px), 0, W - 1), j = clamp(Math.floor(pz), 0, D - 1);
    const si = rd.x > 0 ? 1 : -1, sj = rd.z > 0 ? 1 : -1;
    const tdx = Math.abs(rd.x) < 1e-9 ? Infinity : Math.abs(1 / rd.x);
    const tdz = Math.abs(rd.z) < 1e-9 ? Infinity : Math.abs(1 / rd.z);
    let tmx = Math.abs(rd.x) < 1e-9 ? Infinity : t + ((rd.x > 0 ? i + 1 - px : px - i) * tdx);
    let tmz = Math.abs(rd.z) < 1e-9 ? Infinity : t + ((rd.z > 0 ? j + 1 - pz : pz - j) * tdz);
    for (let guard = 0; guard < 2000; guard++) {
      const h = this.H[j * W + i];
      const top = water ? Math.max(h, WATER_LEVEL) : h;
      const tExit = Math.min(tmx, tmz, tmax);
      const yEn = ro.y + rd.y * t, yEx = ro.y + rd.y * tExit;
      if (Math.min(yEn, yEx) <= top) {
        const th = yEn <= top ? t : (top - ro.y) / rd.y;
        return { x: ro.x + rd.x * th, y: ro.y + rd.y * th, z: ro.z + rd.z * th, i, j };
      }
      if (tExit >= tmax) break;
      t = tExit;
      if (tmx < tmz) { i += si; tmx += tdx; } else { j += sj; tmz += tdz; }
      if (i < 0 || j < 0 || i >= W || j >= D) break;
    }
    return null;
  }

  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const steps = Math.ceil(len / 0.6);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (this.heightAt(ax + dx * t, az + dz * t) > ay + dy * t) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- colours
  topColor(k, out) {
    const m = this.mat[k], h = this.H[k], i = k % W, j = (k / W) | 0;
    const t = this.tint[k];
    switch (m) {
      case MAT.GRASS: out.copy(PAL.grassB).lerp(PAL.grassA, t); if (t > 0.72) out.lerp(PAL.meadow, (t - 0.72) * 2.5); break;
      case MAT.SAND: out.copy(PAL.sand); break;
      case MAT.STONE: out.copy(PAL.stone).lerp(PAL.stoneDark, hash2i(i, j, 5) * 0.6); break;
      case MAT.SNOW: out.copy(PAL.snow); break;
      case MAT.ROAD: out.copy(PAL.road); break;
      case MAT.MUD: out.copy(PAL.mud).lerp(PAL.dirtDeep, clamp((WATER_LEVEL - h) / 4, 0, 1) * 0.6); break;
      default: out.copy(PAL.crater); break;
    }
    out.multiplyScalar(0.94 + hash2i(i, j, h) * 0.12);
    const w = this.wear[k];
    if (w > 0) out.lerp(tmpC.copy(PAL.dirt).multiplyScalar(0.95), Math.min(1, w) * 0.75);
    const sc = this.scorch[k];
    if (sc > 0) out.lerp(PAL.scorch, Math.min(1, sc) * 0.85);
    return out;
  }

  sideColor(k, level, depth, out) {
    const m = this.mat[k], i = k % W, j = (k / W) | 0;
    if (depth === 0) {
      switch (m) {
        case MAT.GRASS: out.copy(PAL.grassSide); break;
        case MAT.SAND: out.copy(PAL.sandSide); break;
        case MAT.SNOW: out.copy(PAL.snow).multiplyScalar(0.93); break;
        case MAT.ROAD: out.copy(PAL.road).multiplyScalar(0.88); break;
        case MAT.STONE: out.copy(PAL.stone).multiplyScalar(0.92); break;
        case MAT.MUD: out.copy(PAL.mud).multiplyScalar(0.9); break;
        default: out.copy(PAL.crater).multiplyScalar(0.9);
      }
      const sc = this.scorch[k];
      if (sc > 0) out.lerp(PAL.scorch, Math.min(1, sc) * 0.6);
    } else if (depth <= 2 && m !== MAT.STONE && m !== MAT.SNOW) {
      out.copy(m === MAT.SAND ? PAL.sandSide : (depth === 1 ? PAL.dirt : PAL.dirtDeep));
    } else {
      const band = ((level + 64) >> 1) % 4;
      if (level < -2) out.copy(PAL.bedrock).lerp(PAL.stoneDark, band * 0.25);
      else out.copy([PAL.clay, PAL.dirtDeep, PAL.stoneDark, PAL.clayDark][band]);
    }
    out.multiplyScalar(0.93 + hash2i(i * 3 + level, j, 11) * 0.12);
    return out;
  }

  // ---------------------------------------------------------------- meshing
  aoAt(i, j, h, dx, dz) {
    const s1 = this.hAt(i + dx, j) > h ? 1 : 0;
    const s2 = this.hAt(i, j + dz) > h ? 1 : 0;
    const c = this.hAt(i + dx, j + dz) > h ? 1 : 0;
    const v = (s1 && s2) ? 0 : 3 - (s1 + s2 + c);
    return v;
  }

  buildChunk(cx, cz) {
    const pos = [], nor = [], col = [], idx = [];
    let vc = 0;
    const AO = [0.52, 0.68, 0.84, 1.0];
    const c = new THREE.Color();
    const quad = (v, n, cs, flip) => {
      for (let q = 0; q < 4; q++) {
        pos.push(v[q * 3], v[q * 3 + 1], v[q * 3 + 2]);
        nor.push(n[0], n[1], n[2]);
        col.push(cs[q * 3], cs[q * 3 + 1], cs[q * 3 + 2]);
      }
      if (flip) idx.push(vc + 1, vc + 2, vc + 3, vc + 1, vc + 3, vc);
      else idx.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);
      vc += 4;
    };
    const H = this.H;
    const cs = new Array(12);
    for (let j = cz * CHUNK; j < (cz + 1) * CHUNK; j++) {
      for (let i = cx * CHUNK; i < (cx + 1) * CHUNK; i++) {
        const k = j * W + i, h = H[k];
        // top
        this.topColor(k, c);
        const a0 = this.aoAt(i, j, h, -1, -1), a1 = this.aoAt(i, j, h, -1, 1);
        const a2 = this.aoAt(i, j, h, 1, 1), a3 = this.aoAt(i, j, h, 1, -1);
        const aos = [a0, a1, a2, a3];
        for (let q = 0; q < 4; q++) { const f = AO[aos[q]]; cs[q * 3] = c.r * f; cs[q * 3 + 1] = c.g * f; cs[q * 3 + 2] = c.b * f; }
        quad([i, h, j, i, h, j + 1, i + 1, h, j + 1, i + 1, h, j], [0, 1, 0], cs, a0 + a2 < a1 + a3);
        // sides
        for (let dir = 0; dir < 4; dir++) {
          const di = dir === 0 ? 1 : dir === 1 ? -1 : 0;
          const dj = dir === 2 ? 1 : dir === 3 ? -1 : 0;
          const inb = this.inside(i + di, j + dj);
          const nh = inb ? H[(j + dj) * W + i + di] : BASE_Y;
          if (nh >= h) continue;
          for (let y = nh; y < h; y++) {
            this.sideColor(k, y, h - 1 - y, c);
            const bd = (y === nh && inb) ? 0.66 : (y === nh + 1 && inb ? 0.88 : 1);
            const tdk = y === h - 1 ? 1.04 : 1;
            cs[0] = c.r * bd; cs[1] = c.g * bd; cs[2] = c.b * bd;
            cs[3] = c.r * tdk; cs[4] = c.g * tdk; cs[5] = c.b * tdk;
            cs[6] = cs[3]; cs[7] = cs[4]; cs[8] = cs[5];
            cs[9] = cs[0]; cs[10] = cs[1]; cs[11] = cs[2];
            const y0 = y, y1 = y + 1;
            let v;
            if (dir === 0) v = [i + 1, y0, j, i + 1, y1, j, i + 1, y1, j + 1, i + 1, y0, j + 1];
            else if (dir === 1) v = [i, y0, j + 1, i, y1, j + 1, i, y1, j, i, y0, j];
            else if (dir === 2) v = [i + 1, y0, j + 1, i + 1, y1, j + 1, i, y1, j + 1, i, y0, j + 1];
            else v = [i, y0, j, i, y1, j, i + 1, y1, j, i + 1, y0, j];
            quad(v, [di, 0, dj], cs, false);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  buildMeshes(scene) {
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.group = new THREE.Group();
    scene.add(this.group);
    for (let cz = 0; cz < this.cz; cz++) {
      for (let cx = 0; cx < this.cx; cx++) {
        const m = new THREE.Mesh(this.buildChunk(cx, cz), this.material);
        m.castShadow = true; m.receiveShadow = true;
        this.meshes[cz * this.cx + cx] = m;
        this.group.add(m);
      }
    }
    // underside of the diorama block
    const bottom = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2).translate(W / 2, BASE_Y, D / 2),
      new THREE.MeshLambertMaterial({ color: 0x5b5560 }),
    );
    this.group.add(bottom);
  }

  markDirty(i0, j0, i1, j1) {
    const a = Math.max(0, Math.floor(i0 / CHUNK)), b = Math.min(this.cx - 1, Math.floor(i1 / CHUNK));
    const c = Math.max(0, Math.floor(j0 / CHUNK)), d = Math.min(this.cz - 1, Math.floor(j1 / CHUNK));
    for (let z = c; z <= d; z++) for (let x = a; x <= b; x++) this.dirty.add(z * this.cx + x);
  }

  rebuildDirty(max = 3) {
    let n = 0;
    for (const key of this.dirty) {
      if (n++ >= max) break;
      this.dirty.delete(key);
      const m = this.meshes[key];
      if (!m) continue;
      const cx = key % this.cx, cz = Math.floor(key / this.cx);
      m.geometry.dispose();
      m.geometry = this.buildChunk(cx, cz);
    }
  }

  updateHeightTex() {
    const H = this.H, d = this.heightData;
    for (let k = 0; k < H.length; k++) d[k] = clamp(H[k] * 8, 0, 255);
    this.heightTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- deformation
  // Blast a crater. Returns flat array of rgb colours of removed voxels (for debris).
  crater(x, z, r, depth) {
    const removed = [];
    const i0 = Math.floor(x - r), i1 = Math.floor(x + r), j0 = Math.floor(z - r), j1 = Math.floor(z + r);
    let changed = false;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (!this.inside(i, j)) continue;
        const dx = i + 0.5 - x, dz = j + 0.5 - z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > r) continue;
        const f = 1 - (d / r) * (d / r);
        const amt = Math.round(depth * f + (Math.random() - 0.5) * 0.7);
        if (amt <= 0) continue;
        const k = j * W + i, h0 = this.H[k];
        const nh = Math.max(1, h0 - amt);
        if (nh >= h0) continue;
        if (this.bridge[k]) continue;
        this.topColor(k, tmpC); removed.push(tmpC.r, tmpC.g, tmpC.b);
        if (h0 - nh > 1) { this.sideColor(k, h0 - 2, 1, tmpC); removed.push(tmpC.r, tmpC.g, tmpC.b); }
        this.H[k] = nh;
        const m = this.mat[k];
        if (nh < WATER_LEVEL) this.mat[k] = MAT.MUD;
        else if (m !== MAT.STONE) this.mat[k] = MAT.DIRT;
        changed = true;
      }
    }
    this.addScorch(x, z, r * 1.45, 0.65, false);
    this.markDirty(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
    if (changed) {
      this.version++;
      this.updateHeightTex();
      for (const f of this.listeners) f(i0, j0, i1, j1);
    }
    return removed;
  }

  addScorch(x, z, r, amt, mark = true) {
    const i0 = Math.floor(x - r), i1 = Math.floor(x + r), j0 = Math.floor(z - r), j1 = Math.floor(z + r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!this.inside(i, j)) continue;
      const d = Math.hypot(i + 0.5 - x, j + 0.5 - z);
      if (d > r) continue;
      const k = j * W + i;
      if (this.H[k] < WATER_LEVEL) continue;
      this.scorch[k] = Math.min(1, this.scorch[k] + amt * (1 - d / r) * (0.7 + Math.random() * 0.5));
    }
    if (mark) this.markDirty(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
  }

  addWear(x, z, r, amt) {
    const i0 = Math.floor(x - r), i1 = Math.floor(x + r), j0 = Math.floor(z - r), j1 = Math.floor(z + r);
    let any = false;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!this.inside(i, j)) continue;
      const k = j * W + i;
      if (this.wear[k] >= 1 || this.H[k] < WATER_LEVEL) continue;
      this.wear[k] = Math.min(1, this.wear[k] + amt);
      any = true;
    }
    if (any) this.markDirty(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
  }
}
