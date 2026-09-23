// Voxel model builder + all the little models.
import * as THREE from 'three';

const FACES = [
  { n: [1, 0, 0], v: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { n: [-1, 0, 0], v: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
  { n: [0, 1, 0], v: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
  { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { n: [0, 0, 1], v: [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]] },
  { n: [0, 0, -1], v: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]] },
];

const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export class VB {
  constructor() { this.p = []; this.n = []; this.c = []; }
  // centre (cx,cy,cz), size (sx,sy,sz), colour, optional rotation {rx,ry,rz} about the centre
  box(cx, cy, cz, sx, sy, sz, color, rot = null, jitter = 0.05) {
    const col = color instanceof THREE.Color ? color : new THREE.Color(color);
    const j = 1 + (Math.random() * 2 - 1) * jitter;
    let mat = null;
    if (rot) {
      _e.set(rot.rx || 0, rot.ry || 0, rot.rz || 0, 'YXZ');
      mat = _m.makeRotationFromEuler(_e);
      _nm.setFromMatrix4(mat);
    }
    for (const f of FACES) {
      const shade = f.n[1] < 0 ? 0.75 : 1;
      const r = col.r * j * shade, g = col.g * j * shade, b = col.b * j * shade;
      const tri = [0, 1, 2, 0, 2, 3];
      _n.set(f.n[0], f.n[1], f.n[2]);
      if (mat) _n.applyMatrix3(_nm);
      for (const t of tri) {
        const q = f.v[t];
        _v.set(q[0] * sx / 2, q[1] * sy / 2, q[2] * sz / 2);
        if (mat) _v.applyMatrix4(mat);
        this.p.push(_v.x + cx, _v.y + cy, _v.z + cz);
        this.n.push(_n.x, _n.y, _n.z);
        this.c.push(r, g, b);
      }
    }
    return this;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export const litMat = () => new THREE.MeshLambertMaterial({ vertexColors: true });
export const glowMat = (color) => new THREE.MeshBasicMaterial({ color, toneMapped: false });

function mesh(vb, mat = litMat(), shadow = true) {
  const m = new THREE.Mesh(vb.geometry(), mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- palette
export const P = {
  yellow: 0xf2b33d, yellow2: 0xe3a02f, yellowDark: 0xc98a2a, red: 0xe0533d, redDark: 0xb83f2e,
  tread: 0x474b58, treadDark: 0x33363f, steel: 0x9aa0ab, steelDark: 0x5d6270, gun: 0x646978,
  white: 0xf5f3ee, teal: 0x2fb3a8, tealLight: 0x7fd6cb, navy: 0x2b3a55, navy2: 0x3d4f70,
  tyre: 0x2b2f38, skin: 0xf1c7a0, olive: 0x6d8a3c,
};

// ---------------------------------------------------------------- the Colossus
// local frame: +z forward, +x = tank's LEFT, y up, origin at ground centre
export function buildTank() {
  const root = new THREE.Group();
  const parts = {};
  const mats = {};
  const mk = (name) => (mats[name] = litMat());

  // treads (static body)
  const tv = new VB();
  for (const s of [-1, 1]) {
    tv.box(s * 3.65, 1.0, 0, 1.9, 1.9, 12.2, P.tread);
    tv.box(s * 3.65, 1.0, 6.3, 1.9, 1.2, 0.5, P.treadDark);
    tv.box(s * 3.65, 1.0, -6.3, 1.9, 1.2, 0.5, P.treadDark);
    for (const z of [-4.5, -2.25, 0, 2.25, 4.5]) {
      tv.box(s * 4.64, 0.95, z, 0.2, 1.15, 1.15, P.steel);
      tv.box(s * 4.78, 0.95, z, 0.1, 0.45, 0.45, P.yellow);
    }
    tv.box(s * 3.65, 2.08, 0, 2.15, 0.3, 12.6, P.yellow);
    tv.box(s * 4.74, 2.08, 0, 0.1, 0.18, 12.6, P.red);
    tv.box(s * 4.74, 2.08, 5.6, 0.12, 0.3, 1.2, P.redDark);
  }
  parts.treads = mesh(tv, mk('drive'));
  root.add(parts.treads);

  // tread cleats (animated)
  const cleatGeo = new VB().box(0, 0, 0, 1.95, 0.14, 0.34, P.treadDark, null, 0).geometry();
  parts.cleats = new THREE.InstancedMesh(cleatGeo, litMat(), 48);
  parts.cleats.castShadow = false;
  parts.cleats.frustumCulled = false;
  root.add(parts.cleats);

  // hull
  const hv = new VB();
  hv.box(0, 1.3, 0, 5.4, 1.4, 12, P.yellowDark);
  hv.box(0, 2.6, -0.3, 7.0, 1.2, 11.2, P.yellow);
  hv.box(0, 2.25, 5.55, 6.6, 0.8, 0.7, P.yellow2);
  hv.box(0, 1.8, 6.05, 6.1, 0.6, 0.5, P.yellowDark);
  for (const s of [-1, 1]) {
    hv.box(s * 1.7, 2.4, 5.93, 1.3, 0.28, 0.06, P.red);
    hv.box(s * 3.52, 2.6, -0.3, 0.08, 0.35, 10.6, P.red);
    hv.box(s * 2.9, 3.28, 1.5, 0.9, 0.16, 2.6, P.steelDark);   // deck plates
  }
  hv.box(0, 3.55, -0.5, 4.4, 0.7, 6.5, P.yellow2);
  hv.box(0, 3.93, -0.5, 3.4, 0.06, 5.5, P.yellowDark);
  // commander hatch + commander
  hv.box(-1.3, 4.0, -2.9, 0.8, 0.25, 0.8, P.steelDark);
  hv.box(-1.3, 4.35, -2.9, 0.36, 0.4, 0.36, P.olive);
  hv.box(-1.3, 4.7, -2.9, 0.34, 0.34, 0.34, P.skin);
  hv.box(-1.3, 4.92, -2.9, 0.44, 0.14, 0.44, P.olive);
  hv.box(-1.3, 4.76, -2.72, 0.3, 0.1, 0.02, 0x333333);
  parts.hull = mesh(hv, mk('hull'));
  root.add(parts.hull);

  // headlights
  const lv = new VB();
  for (const s of [-1, 1]) lv.box(s * 2.5, 2.95, 5.28, 0.55, 0.35, 0.12, 0xffffff, null, 0);
  parts.lights = new THREE.Mesh(lv.geometry(), glowMat(0xfff2b0));
  root.add(parts.lights);

  // turret
  const turret = new THREE.Group();
  turret.position.set(0, 3.9, 0.8);
  const trv = new VB();
  trv.box(0, 0.75, 0, 3.6, 1.5, 3.8, P.yellow);
  trv.box(0, 1.56, -0.2, 3.0, 0.14, 3.0, P.red);
  trv.box(0, 0.75, 2.05, 1.6, 1.0, 0.4, P.yellowDark);
  for (const s of [-1, 1]) trv.box(s * 1.95, 0.6, -0.6, 0.3, 0.8, 2.0, P.olive);
  trv.box(0.9, 1.75, -1.1, 0.12, 0.6, 0.12, P.steelDark);
  turret.add(parts.turretMesh = mesh(trv, mk('cannon')));
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.8, 2.1);
  const bv = new VB();
  bv.box(0, 0, 0.6, 0.8, 0.8, 1.2, P.steelDark);
  bv.box(0, 0, 3.2, 0.55, 0.55, 5.2, P.gun);
  bv.box(0, 0, 5.9, 0.9, 0.7, 0.7, P.tread);
  bv.box(0, 0.36, 4.0, 0.2, 0.1, 0.6, P.red);
  const barrelMesh = mesh(bv, mats.cannon);
  barrel.add(barrelMesh);
  parts.barrelMesh = barrelMesh;
  turret.add(barrel);
  root.add(turret);
  parts.turret = turret; parts.barrel = barrel;

  // flak turrets at the corners
  parts.flak = [];
  mk('flak');
  const flakSpots = [[2.9, 4.2], [-2.9, 4.2], [2.9, -4.3], [-2.9, -4.3]]; // FL, FR, RL, RR (x+ is left)
  for (const [x, z] of flakSpots) {
    const g = new THREE.Group();
    g.position.set(x, 3.2, z);
    const base = new VB().box(0, 0.2, 0, 1.1, 0.4, 1.1, P.steelDark);
    g.add(mesh(base, mats.flak));
    const head = new THREE.Group();
    head.position.y = 0.45;
    const hvb = new VB();
    hvb.box(0, 0.3, 0, 0.9, 0.6, 0.9, P.red);
    hvb.box(0, 0.62, -0.1, 0.5, 0.1, 0.5, P.redDark);
    for (const s of [-1, 1]) hvb.box(s * 0.18, 0.35, 0.8, 0.14, 0.14, 1.1, P.treadDark);
    head.add(mesh(hvb, mats.flak));
    g.add(head);
    root.add(g);
    parts.flak.push({ group: g, head, x, z });
  }

  // shield mast
  const mast = new THREE.Group();
  mast.position.set(1.7, 3.2, -3.4);
  mast.add(mesh(new VB().box(0, 1.3, 0, 0.3, 2.6, 0.3, P.steel).box(0, 0.15, 0, 0.8, 0.3, 0.8, P.steelDark), mk('shield')));
  const dish = new THREE.Group();
  dish.position.y = 2.7;
  const dv = new VB();
  dv.box(0, 0, 0, 1.5, 0.16, 1.5, P.white);
  dv.box(0, 0.12, 0.8, 1.2, 0.2, 0.12, P.white);
  dv.box(0, 0.12, -0.8, 1.2, 0.2, 0.12, P.white);
  dv.box(0.8, 0.12, 0, 0.12, 0.2, 1.2, P.white);
  dv.box(-0.8, 0.12, 0, 0.12, 0.2, 1.2, P.white);
  dv.box(0, 0.25, 0, 0.12, 0.5, 0.12, P.steelDark);
  dish.add(mesh(dv, mats.shield));
  const orb = new THREE.Mesh(new VB().box(0, 0.6, 0, 0.36, 0.36, 0.36, 0xffffff, null, 0).geometry(), glowMat(0x7fe8ff));
  dish.add(orb);
  mast.add(dish);
  root.add(mast);
  parts.dish = dish; parts.orb = orb;

  // pennant
  const pole = new THREE.Group();
  pole.position.set(-2.8, 3.2, -5.4);
  pole.add(mesh(new VB().box(0, 1.7, 0, 0.1, 3.4, 0.1, P.steelDark)));
  const flag = new THREE.Group();
  flag.position.set(0, 3.1, 0);
  const fv = new VB();
  for (let n = 0; n < 4; n++) fv.box(0, -n * 0.03, -0.25 - n * 0.4, 0.06, 0.6 - n * 0.12, 0.4, n % 2 ? P.yellow : P.red, null, 0);
  const flagMesh = mesh(fv, litMat(), false);
  flag.add(flagMesh);
  pole.add(flag);
  root.add(pole);
  parts.flag = flag;

  // reactor
  const rv = new VB();
  rv.box(0, 3.4, -4.9, 3.4, 1.6, 2.2, P.yellowDark);
  rv.box(0, 4.25, -4.9, 2.6, 0.15, 1.8, P.red);
  for (const s of [-1, 1]) {
    rv.box(s * 1.9, 4.3, -5.45, 0.6, 2.6, 0.6, P.steelDark);
    rv.box(s * 1.9, 5.65, -5.45, 0.8, 0.2, 0.8, P.treadDark);
    rv.box(s * 1.9, 3.2, -6.05, 0.5, 0.9, 0.12, P.tread);
  }
  parts.reactor = mesh(rv, mk('reactor'));
  root.add(parts.reactor);
  const core = new VB();
  core.box(0, 3.35, -6.02, 2.0, 0.55, 0.1, 0xffffff, null, 0);
  core.box(0, 4.35, -4.9, 1.2, 0.08, 0.8, 0xffffff, null, 0);
  parts.core = new THREE.Mesh(core.geometry(), glowMat(0x6ff0ff));
  root.add(parts.core);

  // repair bay
  const rb = new VB();
  rb.box(-1.95, 3.55, -2.9, 1.5, 0.8, 1.6, P.steel);
  rb.box(-1.95, 3.98, -2.9, 1.2, 0.08, 1.3, P.steelDark);
  rb.box(-2.72, 3.55, -2.9, 0.06, 0.2, 1.2, 0x79d27f);
  parts.bay = mesh(rb, mk('repair'));
  root.add(parts.bay);

  // repair drones
  parts.drones = [];
  for (let n = 0; n < 2; n++) {
    const d = new THREE.Group();
    const dvb = new VB();
    dvb.box(0, 0, 0, 0.42, 0.16, 0.42, P.white);
    dvb.box(0, -0.1, 0, 0.2, 0.08, 0.2, P.steelDark);
    for (const [x, z] of [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) dvb.box(x, 0.1, z, 0.3, 0.03, 0.08, P.treadDark);
    d.add(mesh(dvb, litMat(), false));
    const light = new THREE.Mesh(new VB().box(0, 0.12, 0, 0.1, 0.06, 0.1, 0xffffff, null, 0).geometry(), glowMat(0x9cff7a));
    d.add(light);
    d.position.set(-1.95, 4.3, -2.9);
    root.add(d);
    parts.drones.push({ obj: d, light, t: Math.random() * 10 });
  }

  // shield bubble
  parts.bubble = null; // created in tank.js (needs shader)

  root.traverse((o) => { if (o.isMesh) o.userData.tank = true; });
  return { root, parts, mats };
}

// ---------------------------------------------------------------- swarm units (face +z)
export function buildUnitGeometry(type) {
  const v = new VB();
  const T = P.teal, W = P.white, N = P.navy;
  const wheels = (w = 0.4, l = 0.42, y = 0.2) => {
    for (const s of [-1, 1]) for (const z of [-l, l]) v.box(s * w, y, z, 0.2, 0.36, 0.36, P.tyre);
  };
  switch (type) {
    case 'scout':
      v.box(0, 0.16, 0, 1.0, 0.26, 1.3, N);
      v.box(0, 0.38, -0.05, 0.84, 0.24, 1.1, T);
      v.box(0, 0.56, 0.18, 0.44, 0.2, 0.44, W);
      v.box(0, 0.6, -0.5, 0.7, 0.44, 0.2, N);
      v.box(0, 0.6, -0.53, 0.5, 0.3, 0.1, P.steel);
      v.box(0, 0.42, 0.72, 0.1, 0.1, 0.35, P.treadDark);
      v.box(0.36, 0.52, -0.15, 0.1, 0.06, 0.5, P.red);
      v.box(-0.36, 0.52, -0.15, 0.1, 0.06, 0.5, P.red);
      break;
    case 'buggy':
      wheels(0.42, 0.4, 0.2);
      v.box(0, 0.42, 0, 0.72, 0.3, 1.2, T);
      v.box(0, 0.66, -0.18, 0.58, 0.2, 0.5, W);
      v.box(0, 0.82, -0.12, 0.34, 0.14, 0.34, N);
      v.box(0, 0.82, 0.3, 0.1, 0.1, 0.62, P.treadDark);
      v.box(0, 0.5, 0.62, 0.6, 0.14, 0.06, P.red);
      break;
    case 'rocket':
      wheels(0.44, 0.45, 0.2);
      v.box(0, 0.42, 0, 0.76, 0.3, 1.3, T);
      v.box(0, 0.64, 0.42, 0.6, 0.2, 0.4, W);
      v.box(0, 0.84, -0.2, 0.7, 0.36, 0.8, W, { rx: -0.35 });
      for (const s of [-1, 1]) for (const y of [0, 1]) v.box(s * 0.17, 0.8 + y * 0.18, 0.2 + y * 0.06, 0.12, 0.12, 0.12, P.red, { rx: -0.35 });
      break;
    case 'mortar':
      for (const s of [-1, 1]) v.box(s * 0.4, 0.18, 0, 0.24, 0.3, 1.1, P.tyre);
      v.box(0, 0.42, 0, 0.66, 0.3, 1.0, T);
      v.box(0, 0.6, -0.25, 0.5, 0.1, 0.4, N);
      v.box(0, 0.86, 0.12, 0.3, 0.3, 0.9, N, { rx: -0.95 });
      v.box(0, 1.2, 0.36, 0.36, 0.1, 0.36, P.treadDark, { rx: -0.95 });
      break;
    case 'sapper':
      wheels(0.4, 0.38, 0.2);
      v.box(0, 0.4, 0, 0.7, 0.26, 1.0, T);
      v.box(0, 0.76, -0.05, 0.6, 0.5, 0.6, P.red);
      v.box(0, 0.76, -0.05, 0.62, 0.12, 0.62, 0xffd166);
      v.box(0, 1.06, -0.05, 0.1, 0.12, 0.1, P.treadDark);
      v.box(0, 1.16, -0.05, 0.14, 0.1, 0.14, 0xfff27a);
      v.box(0, 0.44, 0.52, 0.66, 0.2, 0.08, P.steelDark);
      break;
    case 'jammer':
      wheels(0.42, 0.42, 0.2);
      v.box(0, 0.42, 0, 0.74, 0.3, 1.2, T);
      v.box(0, 0.64, 0.2, 0.56, 0.2, 0.6, W);
      v.box(0, 1.05, -0.3, 0.08, 1.0, 0.08, P.steelDark);
      v.box(0, 1.35, -0.3, 0.6, 0.06, 0.6, W, { rx: 0.4 });
      v.box(0, 1.62, -0.3, 0.18, 0.18, 0.18, 0xc38bff);
      break;
  }
  return v.geometry();
}

// ---------------------------------------------------------------- structures
export function buildFactory() {
  const g = new THREE.Group();
  const v = new VB();
  v.box(0, 0.25, 0, 8.4, 0.5, 8.4, 0xb9c3cc);
  v.box(0, 2.1, 0.5, 6.6, 3.2, 5.6, P.tealLight);
  for (let n = 0; n < 3; n++) {
    const z = -1.6 + n * 2.1;
    v.box(0, 3.95, z + 0.45, 6.8, 0.5, 1.0, P.navy);
    v.box(0, 4.4, z + 0.75, 6.8, 0.4, 0.5, P.navy);
    v.box(0, 4.0, z - 0.2, 6.5, 0.4, 0.2, 0xcff4ff);
  }
  v.box(0, 1.25, -2.35, 2.8, 2.3, 0.2, P.navy);
  v.box(0, 2.55, -2.35, 3.2, 0.3, 0.3, 0xffd166);
  for (let n = 0; n < 5; n++) v.box(0, 0.4 + n * 0.46, -2.47, 2.6, 0.06, 0.05, P.navy2);
  v.box(2.4, 4.4, 2.0, 0.9, 4.4, 0.9, P.steel);
  v.box(2.4, 5.3, 2.0, 1.0, 0.3, 1.0, P.red);
  v.box(2.4, 6.55, 2.0, 1.0, 0.2, 1.0, P.treadDark);
  for (const s of [-1, 1]) {
    v.box(s * 3.9, 1.2, 1.6, 1.0, 1.9, 1.0, P.white);
    v.box(s * 3.9, 2.2, 1.6, 1.1, 0.12, 1.1, P.teal);
  }
  v.box(-2.2, 3.7, -2.5, 1.6, 0.8, 0.12, P.white);
  v.box(-2.2, 3.7, -2.56, 1.2, 0.3, 0.02, P.teal);
  const m = mesh(v);
  g.add(m);
  // spinning roof fan
  const fan = new THREE.Group();
  fan.position.set(-1.8, 4.8, 2.4);
  fan.add(mesh(new VB().box(0, 0, 0, 1.6, 0.12, 0.3, P.steelDark).box(0, 0, 0, 0.3, 0.12, 1.6, P.steelDark)));
  g.add(fan);
  return { group: g, fan, chimney: new THREE.Vector3(2.4, 6.8, 2.0), door: new THREE.Vector3(0, 0, -5.2) };
}

export function buildCP() {
  const g = new THREE.Group();
  const v = new VB();
  v.box(0, 0.25, 0, 7.6, 0.5, 7.6, 0xb9c3cc);
  v.box(0, 1.4, 0, 6.2, 2.4, 6.2, 0xa5bad0);
  v.box(0, 2.9, 0, 4.4, 0.8, 4.4, P.teal);
  v.box(0, 3.4, 0, 3.4, 0.2, 3.4, P.navy);
  for (const s of [-1, 1]) {
    v.box(s * 2.2, 1.6, -3.12, 0.9, 0.4, 0.1, 0x9fe8ff);
    v.box(s * 3.12, 1.6, 0, 0.1, 0.4, 2.2, 0x9fe8ff);
  }
  v.box(0, 1.0, -3.12, 1.2, 1.6, 0.1, P.navy);
  v.box(2.1, 5.5, 2.1, 0.3, 4.4, 0.3, P.steel);
  v.box(2.1, 7.8, 2.1, 0.16, 0.16, 0.16, 0xff5a5a);
  for (let n = 0; n < 4; n++) v.box(2.1, 4.0 + n * 0.9, 2.1, 0.8, 0.06, 0.06, P.steelDark);
  // sandbags
  for (let n = -3; n <= 3; n++) {
    v.box(n * 1.05, 0.7, -4.2, 0.9, 0.4, 0.5, 0xd8c08a);
    v.box(-4.2, 0.7, n * 1.05, 0.5, 0.4, 0.9, 0xd8c08a);
  }
  g.add(mesh(v));
  const radar = new THREE.Group();
  radar.position.set(-1.2, 3.5, -1.2);
  const rv = new VB();
  rv.box(0, 0.4, 0, 0.2, 0.8, 0.2, P.steelDark);
  rv.box(0, 1.0, 0, 2.2, 0.8, 0.14, P.white, { rx: -0.3 });
  rv.box(0, 1.0, 0.25, 0.14, 0.14, 0.6, P.red);
  radar.add(mesh(rv));
  g.add(radar);
  // flag
  const flag = new THREE.Group();
  flag.position.set(-2.4, 3.4, 2.4);
  flag.add(mesh(new VB().box(0, 1.4, 0, 0.1, 2.8, 0.1, P.steelDark)));
  const fl = new THREE.Group();
  fl.position.y = 2.5;
  const fv = new VB();
  for (let n = 0; n < 4; n++) fv.box(0.25 + n * 0.4, 0, 0, 0.4, 0.6 - n * 0.1, 0.06, n % 2 ? P.white : P.teal, null, 0);
  fl.add(mesh(fv, litMat(), false));
  flag.add(fl);
  g.add(flag);
  return { group: g, radar, flag: fl };
}

export function buildHouse(variant = 0) {
  const roofs = [0xe76f51, 0x4f86c6, 0xf4a259, 0x9b6bd3];
  const walls = [0xfff3dc, 0xfde2c4, 0xf2f6ff, 0xfff8e8];
  const v = new VB();
  const rc = roofs[variant % roofs.length], wc = walls[(variant >> 1) % walls.length];
  v.box(0, 1.0, 0, 2.6, 2.0, 2.2, wc);
  v.box(0, 2.2, 0, 3.0, 0.4, 2.6, rc);
  v.box(0, 2.6, 0, 2.4, 0.4, 2.0, rc);
  v.box(0, 3.0, 0, 1.6, 0.4, 1.4, rc);
  v.box(0, 3.35, 0, 0.8, 0.3, 0.9, rc);
  v.box(0.9, 3.0, 0.5, 0.4, 1.0, 0.4, 0xb46b55);
  v.box(0, 0.6, 1.11, 0.6, 1.2, 0.06, 0x8b5a3c);
  v.box(0.8, 1.2, 1.11, 0.5, 0.5, 0.06, 0x9fdcff);
  v.box(-0.8, 1.2, 1.11, 0.5, 0.5, 0.06, 0x9fdcff);
  v.box(1.31, 1.2, 0, 0.06, 0.5, 0.6, 0x9fdcff);
  v.box(-1.31, 1.2, 0, 0.06, 0.5, 0.6, 0x9fdcff);
  v.box(0.8, 0.85, 1.2, 0.6, 0.18, 0.18, 0xf7a8c4);
  v.box(-0.8, 0.85, 1.2, 0.6, 0.18, 0.18, 0xffe07a);
  const m = mesh(v);
  return { group: m, chimney: new THREE.Vector3(0.9, 3.6, 0.5) };
}

export function buildWindmill() {
  const g = new THREE.Group();
  const v = new VB();
  v.box(0, 1.5, 0, 1.8, 3.0, 1.8, 0xfff3dc);
  v.box(0, 3.4, 0, 1.4, 0.8, 1.4, 0xfff3dc);
  v.box(0, 4.0, 0, 1.6, 0.4, 1.6, 0xe76f51);
  v.box(0, 4.35, 0, 1.0, 0.3, 1.0, 0xe76f51);
  v.box(0, 0.6, 0.91, 0.5, 1.0, 0.06, 0x8b5a3c);
  g.add(mesh(v));
  const blades = new THREE.Group();
  blades.position.set(0, 3.5, 1.0);
  const bv = new VB();
  bv.box(0, 0, 0, 0.3, 0.3, 0.3, 0x8b5a3c);
  for (let n = 0; n < 4; n++) {
    const a = n * Math.PI / 2;
    bv.box(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0.1, n % 2 ? 0.4 : 2.2, n % 2 ? 2.2 : 0.4, 0.06, 0xf5f3ee);
  }
  blades.add(mesh(bv));
  g.add(blades);
  return { group: g, blades };
}

export function buildBridgeSegment(len, horizontal) {
  const v = new VB();
  const n = Math.ceil(len);
  for (let k = 0; k < n; k++) {
    const t = k - n / 2 + 0.5;
    const c = k % 2 ? 0xb07a4a : 0xa06c40;
    if (horizontal) v.box(t, 0, 0, 0.96, 0.25, 3.0, c);
    else v.box(0, 0, t, 3.0, 0.25, 0.96, c);
  }
  for (const s of [-1, 1]) {
    if (horizontal) { v.box(0, 0.45, s * 1.45, n, 0.12, 0.12, 0x8b5a3c); for (let k = 0; k <= n; k += 2) v.box(k - n / 2, 0.25, s * 1.45, 0.14, 0.5, 0.14, 0x8b5a3c); }
    else { v.box(s * 1.45, 0.45, 0, 0.12, 0.12, n, 0x8b5a3c); for (let k = 0; k <= n; k += 2) v.box(s * 1.45, 0.25, k - n / 2, 0.14, 0.5, 0.14, 0x8b5a3c); }
  }
  // pilings
  for (let k = 0; k < n; k += 3) {
    const t = k - n / 2 + 0.5;
    for (const s of [-1, 1]) {
      if (horizontal) v.box(t, -1.6, s * 1.2, 0.3, 3.0, 0.3, 0x6d4c33);
      else v.box(s * 1.2, -1.6, t, 0.3, 3.0, 0.3, 0x6d4c33);
    }
  }
  return mesh(v);
}

// ---------------------------------------------------------------- trees & ground cover
export function buildTreeGeometry(kind) {
  const v = new VB();
  if (kind === 0) { // round
    v.box(0, 0.8, 0, 0.5, 1.6, 0.5, 0x9a6a44);
    v.box(0, 2.1, 0, 2.2, 1.5, 2.2, 0x6cc45a);
    v.box(0, 3.0, 0, 1.6, 0.7, 1.6, 0x7fd165);
    v.box(0.7, 2.0, 0.6, 1.0, 1.0, 1.0, 0x5eb453);
    v.box(-0.6, 1.8, -0.5, 1.0, 0.9, 1.0, 0x5eb453);
  } else if (kind === 1) { // pine
    v.box(0, 0.6, 0, 0.45, 1.2, 0.45, 0x8a5c3a);
    v.box(0, 1.5, 0, 2.2, 0.7, 2.2, 0x3f9a5c);
    v.box(0, 2.2, 0, 1.7, 0.7, 1.7, 0x46a863);
    v.box(0, 2.9, 0, 1.2, 0.7, 1.2, 0x4fb56b);
    v.box(0, 3.5, 0, 0.6, 0.6, 0.6, 0x5bc076);
  } else { // blossom
    v.box(0, 0.8, 0, 0.45, 1.6, 0.45, 0x8a5c3a);
    v.box(0, 2.0, 0, 2.0, 1.3, 2.0, 0xf7a8c4);
    v.box(0, 2.8, 0, 1.4, 0.6, 1.4, 0xfbc4d8);
    v.box(0.6, 1.9, -0.5, 0.9, 0.9, 0.9, 0xee8fb5);
    v.box(-0.5, 2.3, 0.6, 0.6, 0.6, 0.6, 0xfff0f6);
  }
  return v.geometry();
}

export function buildTuftGeometry() {
  const v = new VB();
  v.box(0, 0.18, 0, 0.1, 0.36, 0.1, 0xffffff, null, 0);
  v.box(0.15, 0.13, 0.08, 0.1, 0.26, 0.1, 0xffffff, null, 0);
  v.box(-0.12, 0.15, -0.1, 0.1, 0.3, 0.1, 0xffffff, null, 0);
  return v.geometry();
}

export function buildFlowerGeometry() {
  const v = new VB();
  v.box(0, 0.2, 0, 0.06, 0.4, 0.06, 0x5fae4a, null, 0);
  v.box(0, 0.45, 0, 0.22, 0.14, 0.22, 0xffffff, null, 0);
  v.box(0, 0.52, 0, 0.1, 0.06, 0.1, 0xffe066, null, 0);
  return v.geometry();
}

export function buildCloudGeometry(rng) {
  const v = new VB();
  const n = 4 + Math.floor(rng() * 4);
  for (let k = 0; k < n; k++) {
    const sx = 4 + rng() * 6, sz = 3 + rng() * 5, sy = 1.5 + rng() * 2;
    v.box((rng() - 0.5) * 10, rng() * 1.5, (rng() - 0.5) * 6, sx, sy, sz, 0xffffff, null, 0.02);
  }
  return v.geometry();
}

export function buildBirdGeometry() {
  const body = new VB().box(0, 0, 0, 0.16, 0.14, 0.4, 0xffffff, null, 0).box(0, 0.02, 0.24, 0.08, 0.06, 0.1, 0xffb347, null, 0);
  const wing = new VB().box(0.25, 0, 0, 0.5, 0.04, 0.22, 0xf0f0f0, null, 0);
  return { body: body.geometry(), wing: wing.geometry() };
}
