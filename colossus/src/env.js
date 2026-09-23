// Lights, clouds drifting overhead, little birds that scatter when things explode.
import * as THREE from 'three';
import { MAP_W as W, MAP_D as D } from './config.js';
import { buildCloudGeometry, buildBirdGeometry } from './models.js';
import { mulberry32, clamp } from './util.js';

export class Env {
  constructor(G) {
    this.G = G;
    const scene = G.scene;
    scene.fog = new THREE.Fog(0xcdeaf7, 300, 700);
    const hemi = new THREE.HemisphereLight(0xdff3ff, 0xa08a66, 1.35);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    const sc = sun.shadow.camera;
    sc.near = 1; sc.far = 400;
    scene.add(sun); scene.add(sun.target);
    this.sun = sun;
    this.sunDir = G.sunDir;
    this.shadowSize = 120;

    // clouds
    const rng = mulberry32(G.layout.seed + 999);
    this.clouds = [];
    const cmat = this.cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x9fb4c8, emissiveIntensity: 0.35, transparent: true, opacity: 0.9 });
    for (let n = 0; n < 9; n++) {
      const m = new THREE.Mesh(buildCloudGeometry(rng), cmat);
      m.castShadow = true;
      m.position.set(rng() * (W + 60) - 30, 50 + rng() * 12, rng() * D);
      const s = 0.8 + rng() * 0.8;
      m.scale.set(s, s * 0.8, s);
      scene.add(m);
      this.clouds.push({ m, speed: 1.2 + rng() * 1.2 });
    }

    // birds
    const bg = buildBirdGeometry();
    const bmat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.flocks = [];
    for (let f = 0; f < 4; f++) {
      const fl = { cx: 20 + rng() * (W - 40), cz: 20 + rng() * (D - 40), r: 10 + rng() * 14, a: rng() * 6.28, sp: 0.25 + rng() * 0.2, y: 18 + rng() * 8, panic: 0, birds: [] };
      for (let b = 0; b < 5 + Math.floor(rng() * 4); b++) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(bg.body, bmat));
        const wl = new THREE.Mesh(bg.wing, bmat), wr = new THREE.Mesh(bg.wing, bmat);
        wr.scale.x = -1;
        g.add(wl); g.add(wr);
        scene.add(g);
        fl.birds.push({ g, wl, wr, ox: (rng() - 0.5) * 6, oy: (rng() - 0.5) * 3, oz: (rng() - 0.5) * 6, ph: rng() * 6.28 });
      }
      this.flocks.push(fl);
    }
  }

  scare(x, z, r) {
    for (const f of this.flocks) {
      const bx = f.cx + Math.cos(f.a) * f.r, bz = f.cz + Math.sin(f.a) * f.r;
      if (Math.hypot(bx - x, bz - z) < r + 10) f.panic = Math.min(4, f.panic + 3);
    }
  }

  update(dt, vt) {
    const G = this.G, cam = G.cam;
    // tight shadow frustum around what we're looking at
    const size = clamp(cam.dist * 0.75, 28, 120);
    this.shadowSize += (size - this.shadowSize) * Math.min(1, dt * 3);
    const s = this.shadowSize;
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - s) > 0.5) {
      sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s;
      sc.updateProjectionMatrix();
    }
    const tx = clamp(cam.target.x, 0, W), tz = clamp(cam.target.z, 0, D);
    const texel = (2 * s) / 4096;
    const qx = Math.round(tx / texel) * texel, qz = Math.round(tz / texel) * texel;
    this.sun.target.position.set(qx, 0, qz);
    this.sun.position.set(qx + this.sunDir.x * 150, this.sunDir.y * 150, qz + this.sunDir.z * 150);

    // clouds get out of the way as you zoom in (their shadows stay)
    const op = clamp((cam.dist - 110) / 90, 0, 0.9);
    this.cloudMat.opacity = op;
    this.cloudMat.depthWrite = op > 0.85;
    this.cloudMat.colorWrite = op > 0.01;
    for (const c of this.clouds) {
      c.m.position.x += c.speed * dt;
      if (c.m.position.x > W + 40) c.m.position.x = -40;
    }
    for (const f of this.flocks) {
      f.panic = Math.max(0, f.panic - dt * 0.6);
      f.a += f.sp * dt * (1 + f.panic * 1.2);
      const bx = f.cx + Math.cos(f.a) * f.r, bz = f.cz + Math.sin(f.a) * f.r;
      const by = f.y + f.panic * 3;
      const hx = -Math.sin(f.a), hz = Math.cos(f.a);
      for (const b of f.birds) {
        const flap = Math.sin(vt * (10 + f.panic * 8) + b.ph);
        b.g.position.set(bx + b.ox + Math.sin(vt + b.ph) * 0.6, by + b.oy + Math.sin(vt * 1.3 + b.ph) * 0.4, bz + b.oz);
        b.g.rotation.y = Math.atan2(hx, hz);
        b.wl.rotation.z = flap * 0.7; b.wr.rotation.z = -flap * 0.7;
      }
    }
  }
}
