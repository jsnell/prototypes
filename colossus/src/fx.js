// Particles, shockwave rings, light flashes, screen shake, arcs, floating text.
import * as THREE from 'three';
import { WATER_LEVEL } from './config.js';
import { rand, randDir, clamp } from './util.js';

const FLAG_BOUNCE = 1, FLAG_WATER = 2, FLAG_SPIN = 4;

class Pool {
  constructor(scene, max, material, shadow = false) {
    this.max = max; this.n = 0;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.InstancedMesh(geo, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadow;
    this.mesh.count = 0;
    scene.add(this.mesh);
    const F = (n = 1) => new Float32Array(max * n);
    this.p = F(3); this.v = F(3); this.life = F(); this.maxLife = F();
    this.s = F(4); // s0, s1, s2, tp
    this.c = F(6); this.grav = F(); this.drag = F();
    this.axis = F(3); this.rot = F(); this.rotSpeed = F();
    this.flags = new Uint8Array(max);
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, s2, tp, r0, g0, b0, r1, g1, b1, grav = 0, drag = 0, flags = 0) {
    let i;
    if (this.n < this.max) i = this.n++;
    else i = Math.floor(Math.random() * this.max);
    const p = this.p, v = this.v, s = this.s, c = this.c, a = this.axis;
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    v[i * 3] = vx; v[i * 3 + 1] = vy; v[i * 3 + 2] = vz;
    this.life[i] = 0; this.maxLife[i] = life;
    s[i * 4] = s0; s[i * 4 + 1] = s1; s[i * 4 + 2] = s2; s[i * 4 + 3] = tp;
    c[i * 6] = r0; c[i * 6 + 1] = g0; c[i * 6 + 2] = b0; c[i * 6 + 3] = r1; c[i * 6 + 4] = g1; c[i * 6 + 5] = b1;
    this.grav[i] = grav; this.drag[i] = drag; this.flags[i] = flags;
    const d = randDir();
    a[i * 3] = d[0]; a[i * 3 + 1] = d[1]; a[i * 3 + 2] = d[2];
    this.rot[i] = Math.random() * 6.28;
    this.rotSpeed[i] = (flags & FLAG_SPIN) ? rand(-9, 9) : rand(-2, 2);
  }
  copy(from, to) {
    const cp = (arr, n) => { for (let q = 0; q < n; q++) arr[to * n + q] = arr[from * n + q]; };
    cp(this.p, 3); cp(this.v, 3); cp(this.life, 1); cp(this.maxLife, 1); cp(this.s, 4); cp(this.c, 6);
    cp(this.grav, 1); cp(this.drag, 1); cp(this.axis, 3); cp(this.rot, 1); cp(this.rotSpeed, 1);
    this.flags[to] = this.flags[from];
  }
  update(dt, terrain) {
    const p = this.p, v = this.v, s = this.s, c = this.c, a = this.axis;
    const M = this.mesh.instanceMatrix.array, CA = this.mesh.instanceColor.array;
    for (let i = 0; i < this.n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        this.n--;
        if (i !== this.n) { this.copy(this.n, i); i--; }
        continue;
      }
      const f = this.flags[i];
      const i3 = i * 3;
      v[i3 + 1] -= this.grav[i] * dt;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      v[i3] *= dr; v[i3 + 1] *= dr; v[i3 + 2] *= dr;
      p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
      if (f & FLAG_BOUNCE) {
        const gy = terrain.heightAt(p[i3], p[i3 + 2]);
        const floor = Math.max(gy, (f & FLAG_WATER) ? -99 : -99);
        if (p[i3 + 1] < floor + 0.05) {
          if (gy < WATER_LEVEL && p[i3 + 1] < WATER_LEVEL) {
            // sinks in water
            v[i3] *= 0.9; v[i3 + 2] *= 0.9; v[i3 + 1] = Math.max(v[i3 + 1], -1);
            if (p[i3 + 1] < gy + 0.1) { p[i3 + 1] = gy + 0.1; v[i3 + 1] = 0; }
          } else {
            p[i3 + 1] = floor + 0.05;
            if (v[i3 + 1] < 0) v[i3 + 1] *= -0.3;
            v[i3] *= 0.55; v[i3 + 2] *= 0.55;
            this.rotSpeed[i] *= 0.5;
          }
        }
      }
      if ((f & FLAG_WATER) && p[i3 + 1] < WATER_LEVEL - 0.2 && v[i3 + 1] < 0) this.life[i] = this.maxLife[i];
      this.rot[i] += this.rotSpeed[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      const tp = s[i * 4 + 3];
      const sz = t < tp ? s[i * 4] + (s[i * 4 + 1] - s[i * 4]) * (t / tp) : s[i * 4 + 1] + (s[i * 4 + 2] - s[i * 4 + 1]) * ((t - tp) / (1 - tp));
      // quaternion from axis-angle
      const h = this.rot[i] * 0.5, sn = Math.sin(h);
      const qx = a[i3] * sn, qy = a[i3 + 1] * sn, qz = a[i3 + 2] * sn, qw = Math.cos(h);
      const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
      const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2;
      const wx = qw * x2, wy = qw * y2, wz = qw * z2;
      const o = i * 16;
      M[o] = (1 - (yy + zz)) * sz; M[o + 1] = (xy + wz) * sz; M[o + 2] = (xz - wy) * sz; M[o + 3] = 0;
      M[o + 4] = (xy - wz) * sz; M[o + 5] = (1 - (xx + zz)) * sz; M[o + 6] = (yz + wx) * sz; M[o + 7] = 0;
      M[o + 8] = (xz + wy) * sz; M[o + 9] = (yz - wx) * sz; M[o + 10] = (1 - (xx + yy)) * sz; M[o + 11] = 0;
      M[o + 12] = p[i3]; M[o + 13] = p[i3 + 1]; M[o + 14] = p[i3 + 2]; M[o + 15] = 1;
      CA[i3] = c[i * 6] + (c[i * 6 + 3] - c[i * 6]) * t;
      CA[i3 + 1] = c[i * 6 + 1] + (c[i * 6 + 4] - c[i * 6 + 1]) * t;
      CA[i3 + 2] = c[i * 6 + 2] + (c[i * 6 + 5] - c[i * 6 + 2]) * t;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

const RING_N = 20, LIGHT_N = 5, ARC_SEGS = 400;

export class FX {
  constructor(G) {
    this.G = G;
    const scene = G.scene;
    this.fire = new Pool(scene, 2500, new THREE.MeshBasicMaterial({ toneMapped: false }));
    this.smoke = new Pool(scene, 2500, new THREE.MeshLambertMaterial({ color: 0xffffff }));
    this.debris = new Pool(scene, 2500, new THREE.MeshLambertMaterial({ color: 0xffffff }), true);
    this.rings = [];
    const rg = new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2);
    for (let n = 0; n < RING_N; n++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false }));
      m.visible = false; m.renderOrder = 3;
      scene.add(m);
      this.rings.push({ m, t: 0, dur: 1, r: 1 });
    }
    this.lights = [];
    for (let n = 0; n < LIGHT_N; n++) {
      const l = new THREE.PointLight(0xffaa55, 0, 20, 1.6);
      scene.add(l);
      this.lights.push({ l, t: 0, dur: 1, peak: 0 });
    }
    // electric arcs
    this.arcGeo = new THREE.BufferGeometry();
    this.arcPos = new Float32Array(ARC_SEGS * 6);
    this.arcGeo.setAttribute('position', new THREE.BufferAttribute(this.arcPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.arcLines = new THREE.LineSegments(this.arcGeo, new THREE.LineBasicMaterial({ color: 0xd9a8ff, toneMapped: false, transparent: true, opacity: 0.95 }));
    this.arcLines.frustumCulled = false;
    scene.add(this.arcLines);
    this.arcs = [];
    this.trauma = 0;
    this.floatEl = document.getElementById('labels');
    this.floaters = [];
    this.hitstop = 0;
  }

  // ------------------------------------------------------------ primitives
  puff(x, y, z, color, size = 1, life = 1.5, rise = 1.5) {
    this.smoke.spawn(x, y, z, rand(-0.4, 0.4), rise * rand(0.7, 1.2), rand(-0.4, 0.4), life * rand(0.8, 1.2),
      0.2 * size, size * rand(0.8, 1.2), 0, 0.3, color[0], color[1], color[2], color[0] * 1.15, color[1] * 1.15, color[2] * 1.15, -0.3, 1.2);
  }
  sparks(x, y, z, n = 8, color = [1, 0.9, 0.5], speed = 8) {
    for (let k = 0; k < n; k++) {
      const d = randDir();
      const sp = rand(0.4, 1) * speed;
      this.fire.spawn(x, y, z, d[0] * sp, Math.abs(d[1]) * sp + 2, d[2] * sp, rand(0.2, 0.5), 0.14, 0.14, 0, 0.5,
        color[0], color[1], color[2], 1, 0.4, 0.1, 14, 1);
    }
  }
  debrisBurst(x, y, z, colors, n = 10, speed = 7, size = 0.35) {
    if (!colors || colors.length < 3) colors = [0.5, 0.4, 0.3];
    const nc = colors.length / 3;
    for (let k = 0; k < n; k++) {
      const ci = (k % nc) * 3;
      const d = randDir();
      const sp = rand(0.4, 1) * speed;
      const s = size * rand(0.6, 1.4);
      this.debris.spawn(x + d[0] * 0.3, y + 0.3, z + d[2] * 0.3, d[0] * sp, Math.abs(d[1]) * sp + speed * 0.6, d[2] * sp, rand(2.5, 4.5),
        s, s, 0, 0.8, colors[ci], colors[ci + 1], colors[ci + 2], colors[ci] * 0.8, colors[ci + 1] * 0.8, colors[ci + 2] * 0.8, 22, 0.3, FLAG_BOUNCE | FLAG_SPIN);
    }
  }
  ring(x, y, z, radius, dur, color = 0xffffff, opacity = 0.8) {
    let r = this.rings.find((q) => !q.m.visible) || this.rings[Math.floor(Math.random() * RING_N)];
    r.m.visible = true; r.t = 0; r.dur = dur; r.r = radius; r.op = opacity;
    r.m.position.set(x, y, z);
    r.m.material.color.set(color);
    r.m.scale.setScalar(0.1);
  }
  flash(x, y, z, color = 0xffa04a, peak = 40, dist = 18, dur = 0.25) {
    let l = this.lights.reduce((a, b) => (a.l.intensity <= b.l.intensity ? a : b));
    l.l.position.set(x, y, z); l.l.color.set(color); l.l.distance = dist;
    l.t = 0; l.dur = dur; l.peak = peak; l.l.intensity = peak;
  }
  shake(amount, x, z) {
    const G = this.G;
    let f = 1;
    if (x !== undefined) {
      const cam = G.cam;
      const d = Math.hypot(cam.target.x - x, cam.target.z - z);
      f = clamp(1 - d / (40 + cam.dist * 0.6), 0, 1) * clamp(60 / cam.dist, 0.25, 1.5);
    }
    this.trauma = Math.min(1, this.trauma + amount * f);
  }
  arc(ax, ay, az, bx, by, bz) { this.arcs.push([ax, ay, az, bx, by, bz]); }

  // ------------------------------------------------------------ composites
  explosion(x, y, z, scale = 1, opts = {}) {
    const s = scale;
    const water = this.G.terrain.heightAt(x, z) < WATER_LEVEL && y < WATER_LEVEL + 1.2;
    if (water) { this.splash(x, WATER_LEVEL, z, s * 1.3); }
    const nf = Math.round(8 + 8 * s);
    for (let k = 0; k < nf; k++) {
      const d = randDir();
      const sp = rand(1, 4) * s;
      this.fire.spawn(x + d[0] * 0.4 * s, y + Math.abs(d[1]) * 0.4 * s, z + d[2] * 0.4 * s, d[0] * sp, Math.abs(d[1]) * sp + 1.5 * s, d[2] * sp,
        rand(0.3, 0.65) * (0.8 + s * 0.2), 0.3 * s, rand(0.9, 1.7) * s, 0, 0.18, 1, 0.88, 0.35, 1, 0.28, 0.05, -3, 3);
    }
    const ns = Math.round(5 + 6 * s);
    for (let k = 0; k < ns; k++) {
      const d = randDir();
      const g = rand(0.25, 0.4);
      this.smoke.spawn(x + d[0] * s, y + 0.5 * s, z + d[2] * s, d[0] * 2 * s, rand(1.5, 3.5) * Math.sqrt(s), d[2] * 2 * s,
        rand(1.6, 3.2) * (0.7 + s * 0.3), 0.4 * s, rand(1.1, 2.1) * s, 0, 0.3, g, g * 0.95, g * 0.9, 0.75, 0.74, 0.72, -0.4, 1.4);
    }
    this.sparks(x, y + 0.3, z, Math.round(8 + 10 * s), [1, 0.95, 0.6], 9 * Math.sqrt(s));
    if (!water) this.ring(x, y + 0.15, z, 5 * s, 0.45 + 0.1 * s, 0xfff1c9, 0.7);
    this.flash(x, y + 1.5, z, 0xffa04a, 30 * s, 10 + 10 * s, 0.25 + 0.1 * s);
    this.shake(0.12 * s, x, z);
    if (opts.debris) this.debrisBurst(x, y, z, opts.debris, Math.round(6 + 8 * s), 6 + 3 * s, 0.3 + 0.1 * s);
    if (this.G.foliage) this.G.foliage.blast(x, z, 3 + 3 * s, s);
    if (this.G.env) this.G.env.scare(x, z, 20 + 10 * s);
  }
  splash(x, y, z, s = 1) {
    const n = Math.round(10 + 14 * s);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.28, r = rand(0, 0.6) * s;
      const up = rand(4, 10) * Math.sqrt(s);
      const w = rand(0.75, 1);
      this.debris.spawn(x + Math.cos(a) * r, y, z + Math.sin(a) * r, Math.cos(a) * rand(0.5, 2.5) * s, up, Math.sin(a) * rand(0.5, 2.5) * s,
        rand(0.8, 1.5), 0.25 * s, 0.35 * s, 0.1, 0.5, 0.75 * w, 0.92 * w, 1, 0.55, 0.8, 0.95, 18, 0.5, FLAG_WATER);
    }
    this.ring(x, y + 0.05, z, 3.5 * s, 0.8, 0xe8fbff, 0.45);
    if (this.G.water) this.G.water.ripple(x, z, Math.min(1.5, s));
  }
  muzzle(x, y, z, dx, dy, dz, s = 1) {
    for (let k = 0; k < 5 + 4 * s; k++) {
      const sp = rand(2, 8) * s;
      this.fire.spawn(x, y, z, dx * sp + rand(-1, 1), dy * sp + rand(-1, 1), dz * sp + rand(-1, 1), rand(0.08, 0.2),
        0.3 * s, 0.7 * s, 0, 0.3, 1, 1, 0.75, 1, 0.5, 0.15, 0, 4);
    }
    for (let k = 0; k < 3 * s; k++) this.puff(x + dx, y + dy, z + dz, [0.8, 0.8, 0.78], 0.8 * s, 1.2, 1);
  }
  dust(x, y, z, color = [0.82, 0.72, 0.55], s = 1) {
    this.smoke.spawn(x + rand(-0.3, 0.3), y + 0.2, z + rand(-0.3, 0.3), rand(-0.5, 0.5), rand(0.5, 1.2), rand(-0.5, 0.5), rand(0.8, 1.6),
      0.2 * s, rand(0.5, 0.9) * s, 0, 0.35, color[0], color[1], color[2], color[0] * 1.1, color[1] * 1.1, color[2] * 1.1, -0.2, 1.5);
  }
  trail(x, y, z, s = 1, color = [0.92, 0.92, 0.92]) {
    this.smoke.spawn(x, y, z, rand(-0.2, 0.2), rand(0.1, 0.5), rand(-0.2, 0.2), rand(0.6, 1.1),
      0.2 * s, 0.45 * s, 0, 0.25, color[0], color[1], color[2], 0.8, 0.8, 0.8, -0.2, 0.6);
  }
  ember(x, y, z) {
    this.fire.spawn(x + rand(-0.3, 0.3), y, z + rand(-0.3, 0.3), rand(-0.3, 0.3), rand(1.5, 3), rand(-0.3, 0.3), rand(0.3, 0.7),
      0.2, rand(0.35, 0.6), 0, 0.3, 1, 0.8, 0.3, 1, 0.25, 0.05, -1, 1);
  }
  floatText(x, y, z, text, cls = '') {
    if (this.floaters.length > 14) { const o = this.floaters.shift(); o.el.remove(); }
    const el = document.createElement('div');
    el.className = 'floater ' + cls;
    el.textContent = text;
    this.floatEl.appendChild(el);
    this.floaters.push({ el, x, y, z, t: 0 });
  }

  // ------------------------------------------------------------ update
  update(dt, rdt) {
    const T = this.G.terrain;
    this.fire.update(dt, T); this.smoke.update(dt, T); this.debris.update(dt, T);
    for (const r of this.rings) {
      if (!r.m.visible) continue;
      r.t += dt;
      const t = r.t / r.dur;
      if (t >= 1) { r.m.visible = false; continue; }
      const e = 1 - Math.pow(1 - t, 3);
      r.m.scale.setScalar(0.2 + r.r * e);
      r.m.material.opacity = r.op * (1 - t);
    }
    for (const l of this.lights) {
      if (l.l.intensity <= 0) continue;
      l.t += dt;
      const t = l.t / l.dur;
      l.l.intensity = t >= 1 ? 0 : l.peak * (1 - t) * (1 - t);
    }
    // arcs: jagged lines rebuilt every frame
    let s = 0;
    const A = this.arcPos;
    for (const a of this.arcs) {
      const segs = 7;
      let px = a[0], py = a[1], pz = a[2];
      for (let k = 1; k <= segs && s < ARC_SEGS; k++) {
        const t = k / segs;
        const j = k === segs ? 0 : 0.6;
        const nx = a[0] + (a[3] - a[0]) * t + rand(-j, j), ny = a[1] + (a[4] - a[1]) * t + rand(-j, j) + Math.sin(t * Math.PI) * 1.2, nz = a[2] + (a[5] - a[2]) * t + rand(-j, j);
        A[s * 6] = px; A[s * 6 + 1] = py; A[s * 6 + 2] = pz; A[s * 6 + 3] = nx; A[s * 6 + 4] = ny; A[s * 6 + 5] = nz;
        px = nx; py = ny; pz = nz; s++;
      }
    }
    this.arcs.length = 0;
    this.arcGeo.setDrawRange(0, s * 2);
    this.arcGeo.attributes.position.needsUpdate = true;
    this.trauma = Math.max(0, this.trauma - rdt * 1.4);
    // floating text
    const cam = this.G.camera, W = window.innerWidth, H = window.innerHeight;
    const v = new THREE.Vector3();
    for (let n = this.floaters.length - 1; n >= 0; n--) {
      const f = this.floaters[n];
      f.t += rdt;
      if (f.t > 1.4) { f.el.remove(); this.floaters.splice(n, 1); continue; }
      v.set(f.x, f.y + f.t * 2.2, f.z).project(cam);
      if (v.z > 1) { f.el.style.display = 'none'; continue; }
      f.el.style.display = '';
      f.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * W}px, ${(-v.y * 0.5 + 0.5) * H}px) translate(-50%, -50%) scale(${f.t < 0.12 ? 0.6 + f.t * 4 : 1})`;
      f.el.style.opacity = f.t > 1 ? 1 - (f.t - 1) / 0.4 : 1;
    }
  }
}
