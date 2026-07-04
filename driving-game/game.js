import * as THREE from 'three';

// bump together with the ?v= suffix in index.html on every change
const BUILD = 3;
document.getElementById('buildTag').textContent =
  `build ${BUILD} · tap here to force-update`;

// ============================================================ config
const Q = new URLSearchParams(location.search);
const AUTOPILOT = Q.get('auto') === '1';
const FAST_START = Q.get('fast') === '1';

const G = 30;                 // gravity
const MAX_SPEED = 52;         // engine-limited speed
const BOOST_SPEED = 66;       // cap while boosting
const ACCEL = 26;
const BRAKE_DECEL = 42;
const RIDE = 0.15;            // ride height above surface

const WORLD_UP = new THREE.Vector3(0, 1, 0);

// ============================================================ track definition
// Control points of a closed circuit. roll in degrees (positive banks into
// left turns), w = track width. Flags apply to the segment starting at that
// point: gap (no road), boost (speed pad), zone (announcement popup).
const CP = [
  { p: [-118, 20, -262], w: 16,  roll: 0 },
  { p: [ -60, 20, -258], w: 16,  roll: 0,   zone: 'FULL THROTTLE' },
  { p: [   0, 20, -252], w: 15,  roll: 0 },
  { p: [  60, 19, -240], w: 13,  roll: 18 },
  { p: [ 105, 18, -205], w: 13,  roll: 30 },
  { p: [ 128, 18, -150], w: 13,  roll: 26 },
  { p: [ 120, 20,  -90], w: 12,  roll: 8 },
  { p: [ 142, 23,  -30], w: 12,  roll: -16 },
  { p: [ 112, 26,   30], w: 12,  roll: 14,  boost: true, zone: 'SEND IT!' },
  { p: [ 118, 30,   80], w: 12,  roll: 0,   boost: true },
  { p: [ 124, 40,  128], w: 12,  roll: 0,   gap: true },   // takeoff
  { p: [ 118, 47,  165], w: 12,  roll: 0,   gap: true },   // mid-air shape point
  { p: [ 124, 26,  215], w: 18,  roll: 0 },                // landing
  { p: [ 120, 25,  275], w: 15,  roll: 10 },
  { p: [  78, 24,  308], w: 12,  roll: 14,  zone: 'PRECISION ZONE' },
  { p: [  18, 24,  286], w: 6.5, roll: 0 },
  { p: [ -24, 24,  312], w: 6,   roll: 0 },
  { p: [ -64, 24,  282], w: 6,   roll: 0 },
  { p: [-104, 24,  312], w: 6,   roll: 0 },
  { p: [-140, 24,  288], w: 8,   roll: 0 },
  { p: [-185, 26,  296], w: 11,  roll: 20,  zone: 'WALL RIDE' },
  { p: [-214, 28,  258], w: 13,  roll: 55 },
  { p: [-224, 30,  196], w: 13,  roll: 88 },
  { p: [-218, 32,  132], w: 13,  roll: 88 },
  { p: [-206, 32,   80], w: 13,  roll: 45 },
  { p: [-198, 30,   30], w: 14,  roll: 0,   boost: true, zone: 'CORKSCREW' },
  { p: [-196, 29,  -20], w: 14,  roll: 120 },
  { p: [-196, 28,  -70], w: 14,  roll: 240 },
  { p: [-196, 28, -118], w: 14,  roll: 360 },
  { p: [-194, 29, -152], w: 13,  roll: 360, zone: 'WHOOPS!' },
  { p: [-192, 24.5, -180], w: 13, roll: 360 },
  { p: [-188, 27, -206], w: 13,  roll: 360 },
  { p: [-184, 22.5, -238], w: 14, roll: 360 },
  { p: [-176, 21, -266], w: 15,  roll: 378 },
  { p: [-150, 20, -280], w: 16,  roll: 372 },
];
const NCP = CP.length;
const N = 1500;               // samples along the loop

// ---- scalar Catmull-Rom (matches THREE.CatmullRomCurve3 'catmullrom' type)
function crScalar(v0, v1, v2, v3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * v1) + (-v0 + v2) * t +
    (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 + (-v0 + 3 * v1 - 3 * v2 + v3) * t3);
}
// nearest angle representative of v relative to base (degrees)
function nearAngle(base, v) {
  while (v - base > 180) v -= 360;
  while (v - base < -180) v += 360;
  return v;
}
function sampleScalar(key, f, angular) {
  const i1 = ((Math.floor(f) % NCP) + NCP) % NCP;
  const t = f - Math.floor(f);
  const i0 = (i1 - 1 + NCP) % NCP, i2 = (i1 + 1) % NCP, i3 = (i1 + 2) % NCP;
  let v0 = CP[i0][key], v1 = CP[i1][key], v2 = CP[i2][key], v3 = CP[i3][key];
  if (angular) { v0 = nearAngle(v1, v0); v2 = nearAngle(v1, v2); v3 = nearAngle(v2, v3); }
  return crScalar(v0, v1, v2, v3, t);
}

const curve = new THREE.CatmullRomCurve3(
  CP.map(c => new THREE.Vector3(...c.p)), true, 'catmullrom', 0.5);

// Per-sample data
const S = []; // {pos, tan, up, left, w, gap, boost, zone, cum}
{
  const tmp = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const f = t * NCP;
    const seg = Math.floor(f) % NCP;
    const pos = curve.getPoint(t, new THREE.Vector3());
    const tan = curve.getTangent(t, new THREE.Vector3()).normalize();
    const roll = THREE.MathUtils.degToRad(sampleScalar('roll', f, true));
    const w = Math.max(3.5, sampleScalar('w', f, false));
    // base up = world up minus tangent component, then roll around tangent
    const up = WORLD_UP.clone().addScaledVector(tan, -WORLD_UP.dot(tan)).normalize();
    up.applyAxisAngle(tan, roll);
    const left = tmp.copy(tan).cross(up).normalize().clone();
    S.push({ pos, tan, up, left, w,
      gap: !!CP[seg].gap, boost: !!CP[seg].boost, zone: CP[seg].zone || null });
  }
  // flag high-twist zones (corkscrew, wall-ride transitions): the surface
  // rotates fast along the direction of travel there
  for (let i = 0; i < N; i++) {
    const a = S[i].up, b = S[(i + 3) % N].up;
    S[i].steep = a.angleTo(b) > THREE.MathUtils.degToRad(6) || a.y < 0.6;
  }
  // samples where it's safe to respawn: near-flat, on solid road, and with
  // enough run-up to rebuild speed before the next gap jump
  for (let i = 0; i < N; i++) {
    let ok = !S[i].gap && !S[i].steep && S[i].up.y > 0.85;
    if (ok) for (let k = 1; k <= 80; k++) {
      if (S[(i + k) % N].gap) { ok = false; break; }
    }
    S[i].cpOk = ok;
  }
}

// ============================================================ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.style.touchAction = 'none';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd0f0);
scene.fog = new THREE.Fog(0x8fd0f0, 220, 700);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.5, 1400);

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x6a8f5a, 0.95));
const sun = new THREE.DirectionalLight(0xfff3d6, 1.35);
sun.position.set(180, 320, 120);
scene.add(sun);

// ============================================================ track mesh
const trackMesh = (() => {
  const kerbW = 1.1;
  const positions = [], colors = [], indices = [];
  const asphalt = new THREE.Color(0x454b58), asphalt2 = new THREE.Color(0x3e434f);
  const kerbR = new THREE.Color(0xe8503c), kerbW_ = new THREE.Color(0xf3f3ef);
  const boostC = new THREE.Color(0x35e0ff), boostC2 = new THREE.Color(0x1fa8f0);
  const narrowC = new THREE.Color(0x6a4fa0), narrowC2 = new THREE.Color(0x5d4590);
  const startC = new THREE.Color(0xffffff);

  // 4 verts per ring: L edge, L inner, R inner, R edge
  const ringIndex = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const s = S[i];
    ringIndex.push(positions.length / 3);
    const kw = Math.min(kerbW, s.w * 0.16);
    const offs = [s.w / 2, s.w / 2 - kw, -(s.w / 2 - kw), -s.w / 2];
    for (const o of offs) {
      v.copy(s.pos).addScaledVector(s.left, o);
      positions.push(v.x, v.y, v.z);
    }
    // colors: kerbs alternate, road varies
    const alt = (i >> 2) & 1;
    const kerb = alt ? kerbR : kerbW_;
    let road = ((i >> 3) & 1) ? asphalt : asphalt2;
    if (s.boost) road = ((i >> 2) & 1) ? boostC : boostC2;
    if (s.w < 8 && !s.boost) road = ((i >> 3) & 1) ? narrowC : narrowC2;
    if (i < 4 || i > N - 3) road = (i & 1) ? startC : asphalt2; // start line
    for (const c of [kerb, road, road, kerb]) colors.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < N; i++) {
    if (S[i].gap) continue;
    const a = ringIndex[i], b = ringIndex[(i + 1) % N];
    for (let k = 0; k < 3; k++) { // 3 strips: L kerb, road, R kerb
      indices.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({
    vertexColors: true, side: THREE.DoubleSide }));
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  scene.add(m);
  return m;
})();

// glowing edge lines
{
  const mk = side => {
    const pts = [];
    for (let i = 0; i < N; i++) {
      if (S[i].gap || S[(i + 1) % N].gap) continue;
      const a = S[i], b = S[(i + 1) % N];
      pts.push(
        a.pos.clone().addScaledVector(a.left, side * a.w / 2).addScaledVector(a.up, 0.06),
        b.pos.clone().addScaledVector(b.left, side * b.w / 2).addScaledVector(b.up, 0.06));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const l = new THREE.LineSegments(g,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    l.matrixAutoUpdate = false; l.updateMatrix();
    scene.add(l);
  };
  mk(1); mk(-1);
}

// ============================================================ scenery
function lambert(color) { return new THREE.MeshLambertMaterial({ color, flatShading: true }); }
let seed = 1337;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

{ // low-poly terrain far below + water
  const g = new THREE.PlaneGeometry(2400, 2400, 56, 56);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const col = [];
  const c1 = new THREE.Color(0x79c457), c2 = new THREE.Color(0x4f9e43),
        c3 = new THREE.Color(0x9b8a66), sand = new THREE.Color(0xe3d097);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let h = Math.sin(x * 0.011) * Math.cos(z * 0.013) * 14 +
            Math.sin(x * 0.031 + 2) * Math.sin(z * 0.027) * 6 +
            Math.cos(x * 0.005 - z * 0.004) * 10 - 4;
    pos.setY(i, h - 42);
    const c = h < -6 ? sand : h > 14 ? c3 : (Math.sin(x * 0.05) * Math.cos(z * 0.06) > 0 ? c1 : c2);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const terr = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  terr.matrixAutoUpdate = false; terr.updateMatrix();
  scene.add(terr);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(3600, 3600),
    new THREE.MeshLambertMaterial({ color: 0x3f9edb }));
  water.rotation.x = -Math.PI / 2; water.position.y = -50;
  water.matrixAutoUpdate = false; water.updateMatrixWorld();
  scene.add(water);
}

{ // floating islands with trees, plus drifting clouds
  const isMat = lambert(0x8a6f52), topMat = lambert(0x6fbf4e);
  const trunkG = new THREE.CylinderGeometry(0.28, 0.4, 2.2, 5);
  const leafG = new THREE.ConeGeometry(1.6, 3.4, 6);
  const trunkM = lambert(0x7a553a), leafM = lambert(0x3f9d4e), leafM2 = lambert(0x63b93e);
  for (let k = 0; k < 14; k++) {
    const i = Math.floor(rnd() * N);
    const s = S[i];
    const side = rnd() > 0.5 ? 1 : -1;
    const base = s.pos.clone().addScaledVector(s.left, side * (s.w / 2 + 12 + rnd() * 26));
    base.y += (rnd() - 0.7) * 14;
    const grp = new THREE.Group();
    const r = 5 + rnd() * 7;
    const rock = new THREE.Mesh(new THREE.ConeGeometry(r, r * 1.5, 6), isMat);
    rock.rotation.x = Math.PI; rock.position.y = -r * 0.75;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, 1.6, 6), topMat);
    top.position.y = 0.8;
    grp.add(rock, top);
    const nTrees = 1 + Math.floor(rnd() * 3);
    for (let t = 0; t < nTrees; t++) {
      const a = rnd() * Math.PI * 2, rr = rnd() * r * 0.55;
      const trunk = new THREE.Mesh(trunkG, trunkM);
      trunk.position.set(Math.cos(a) * rr, 2.6, Math.sin(a) * rr);
      const leaf = new THREE.Mesh(leafG, rnd() > 0.5 ? leafM : leafM2);
      leaf.position.copy(trunk.position); leaf.position.y += 2.6;
      const sc = 0.7 + rnd() * 0.7; trunk.scale.setScalar(sc); leaf.scale.setScalar(sc);
      grp.add(trunk, leaf);
    }
    grp.position.copy(base);
    scene.add(grp);
  }
  // clouds
  const cloudM = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
  window._clouds = [];
  for (let k = 0; k < 12; k++) {
    const grp = new THREE.Group();
    const n = 2 + Math.floor(rnd() * 3);
    for (let j = 0; j < n; j++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(8 + rnd() * 12, 3 + rnd() * 2.5, 6 + rnd() * 6), cloudM);
      b.position.set((rnd() - 0.5) * 14, (rnd() - 0.5) * 2.5, (rnd() - 0.5) * 8);
      grp.add(b);
    }
    grp.position.set((rnd() - 0.5) * 900, 80 + rnd() * 90, (rnd() - 0.5) * 900);
    grp.userData.vx = 1.2 + rnd() * 1.6;
    scene.add(grp);
    window._clouds.push(grp);
  }
}

{ // start/finish arch near spawn
  const s = S[Math.round(N * 1.2 / NCP)]; // around CP1 zone start
  const arch = new THREE.Group();
  const pillM = lambert(0xf3f3ef);
  const ph = 9;
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, ph, 1.2), pillM);
    p.position.copy(s.pos).addScaledVector(s.left, side * (s.w / 2 + 1)).addScaledVector(s.up, ph / 2);
    arch.add(p);
  }
  const cnv = document.createElement('canvas'); cnv.width = 128; cnv.height = 32;
  const ctx = cnv.getContext('2d');
  for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
    ctx.fillStyle = (x + y) & 1 ? '#111' : '#fff';
    ctx.fillRect(x * 8, y * 8, 8, 8);
  }
  const tex = new THREE.CanvasTexture(cnv);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(s.w + 4.4, 1.8, 0.6),
    new THREE.MeshLambertMaterial({ map: tex }));
  banner.position.copy(s.pos).addScaledVector(s.up, ph - 0.9);
  banner.lookAt(banner.position.clone().add(s.tan));
  arch.add(banner);
  scene.add(arch);
}

// ============================================================ car
const car = new THREE.Group();
const carBody = new THREE.Group();
car.add(carBody);
let wheels = [], frontWheels = [], boostFlame;
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 3.7), lambert(0xff8c1a));
  body.position.y = 0.62;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.34, 1.0), lambert(0xff8c1a));
  nose.position.set(0, 0.5, 2.05);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.5, 1.7), lambert(0x2a2d38));
  cabin.position.set(0, 1.08, -0.25);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.55), lambert(0xe86612));
  wing.position.set(0, 1.25, -1.75);
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.4), lambert(0x2a2d38));
  wingL.position.set(-0.8, 1.02, -1.72);
  const wingR = wingL.clone(); wingR.position.x = 0.8;
  const lampM = new THREE.MeshBasicMaterial({ color: 0xfff8d0 });
  for (const sx of [-0.55, 0.55]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.1), lampM);
    lamp.position.set(sx, 0.56, 2.56);
    carBody.add(lamp);
  }
  const tailM = new THREE.MeshBasicMaterial({ color: 0xff2b2b });
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.1), tailM);
  tail.position.set(0, 0.72, -1.93);
  carBody.add(body, nose, cabin, wing, wingL, wingR, tail);

  const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.36, 8);
  wg.rotateZ(Math.PI / 2);
  const wm = lambert(0x20222a);
  for (const [x, z, front] of [[-0.95, 1.25, 1], [0.95, 1.25, 1], [-0.95, -1.25, 0], [0.95, -1.25, 0]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.42, z);
    const w = new THREE.Mesh(wg, wm);
    pivot.add(w);
    carBody.add(pivot);
    wheels.push(w);
    if (front) frontWheels.push(pivot);
  }
  boostFlame = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.6, 6),
    new THREE.MeshBasicMaterial({ color: 0x53e6ff, transparent: true, opacity: 0.9 }));
  boostFlame.rotation.x = -Math.PI / 2;
  boostFlame.position.set(0, 0.55, -2.7);
  boostFlame.visible = false;
  carBody.add(boostFlame);
}
scene.add(car);

const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.7, 14),
  new THREE.MeshBasicMaterial({ color: 0x08101c, transparent: true, opacity: 0.35, depthWrite: false }));
scene.add(shadow);

// drift/boost particles (single Points draw call)
const PARTS = 90;
const partGeo = new THREE.BufferGeometry();
const partPos = new Float32Array(PARTS * 3).fill(9999);
const partCol = new Float32Array(PARTS * 3).fill(1);
partGeo.setAttribute('position', new THREE.BufferAttribute(partPos, 3));
partGeo.setAttribute('color', new THREE.BufferAttribute(partCol, 3));
const partVel = [], partLife = new Float32Array(PARTS);
for (let i = 0; i < PARTS; i++) partVel.push(new THREE.Vector3());
const points = new THREE.Points(partGeo, new THREE.PointsMaterial({
  size: 0.55, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
scene.add(points);
let partHead = 0;
function spawnPart(p, v, r, g, b) {
  const i = partHead = (partHead + 1) % PARTS;
  partPos[i * 3] = p.x; partPos[i * 3 + 1] = p.y; partPos[i * 3 + 2] = p.z;
  partCol[i * 3] = r; partCol[i * 3 + 1] = g; partCol[i * 3 + 2] = b;
  partVel[i].copy(v); partLife[i] = 0.6 + Math.random() * 0.3;
}

// ============================================================ audio
const AudioSys = {
  ctx: null, engine: null, engineGain: null, filt: null, muted: false,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = this.ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 60;
      const sub = this.ctx.createOscillator(); sub.type = 'square'; sub.frequency.value = 30;
      const subG = this.ctx.createGain(); subG.gain.value = 0.4;
      this.filt = this.ctx.createBiquadFilter(); this.filt.type = 'lowpass'; this.filt.frequency.value = 400;
      this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0;
      osc.connect(this.filt); sub.connect(subG); subG.connect(this.filt);
      this.filt.connect(this.engineGain); this.engineGain.connect(this.ctx.destination);
      osc.start(); sub.start();
      this.engine = [osc, sub];
    } catch (e) { /* audio unavailable */ }
  },
  update(speed, grounded) {
    if (!this.ctx || this.muted) return;
    const f = 55 + speed * 2.6 + (grounded ? 0 : 25);
    this.engine[0].frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05);
    this.engine[1].frequency.setTargetAtTime(f / 2, this.ctx.currentTime, 0.05);
    this.filt.frequency.setTargetAtTime(300 + speed * 14, this.ctx.currentTime, 0.08);
    this.engineGain.gain.setTargetAtTime(0.045 + speed * 0.0006, this.ctx.currentTime, 0.1);
  },
  blip(freq, dur, vol) {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + dur);
  },
  setMuted(m) {
    this.muted = m;
    if (this.engineGain) this.engineGain.gain.value = 0;
  }
};

// ============================================================ input
const input = { steer: 0, brake: false, apBrake: false, kb: { l: false, r: false, b: false } };
addEventListener('keydown', e => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.kb.l = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.kb.r = true;
  if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'KeyS') { input.kb.b = true; e.preventDefault(); }
  if (e.code === 'KeyR') respawn();
});
addEventListener('keyup', e => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.kb.l = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.kb.r = false;
  if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'KeyS') input.kb.b = false;
});

const knob = document.getElementById('steerKnob');
const dot = document.getElementById('steerDot');
let steerPointer = null, steerAnchorX = 0, touchSteer = 0;
const brakeBtn = document.getElementById('brakeBtn');
let brakePointers = new Set();

addEventListener('pointerdown', e => {
  if (e.target.closest('button') || e.target.closest('#overlay')) return;
  if (steerPointer === null && e.clientX < innerWidth * 0.58) {
    steerPointer = e.pointerId; steerAnchorX = e.clientX; touchSteer = 0;
    try { e.target.setPointerCapture?.(e.pointerId); } catch { /* ok */ }
    knob.style.display = 'block';
    knob.style.left = (e.clientX - 60) + 'px';
    knob.style.top = (e.clientY - 60) + 'px';
    dot.style.transform = 'translate(-50%,-50%)';
  }
});
addEventListener('pointermove', e => {
  if (e.pointerId === steerPointer) {
    touchSteer = THREE.MathUtils.clamp((e.clientX - steerAnchorX) / 60, -1, 1);
    dot.style.transform = `translate(calc(-50% + ${touchSteer * 34}px),-50%)`;
  }
});
function endPointer(e) {
  if (e.pointerId === steerPointer) { steerPointer = null; touchSteer = 0; knob.style.display = 'none'; }
  brakePointers.delete(e.pointerId);
  brakeBtn.classList.toggle('on', brakePointers.size > 0);
}
addEventListener('pointerup', endPointer);
addEventListener('pointercancel', endPointer);
brakeBtn.addEventListener('pointerdown', e => {
  brakePointers.add(e.pointerId); brakeBtn.classList.add('on'); e.preventDefault();
});
document.getElementById('resetBtn').addEventListener('click', () => respawn());
const muteBtn = document.getElementById('muteBtn');
muteBtn.addEventListener('click', () => {
  AudioSys.setMuted(!AudioSys.muted);
  muteBtn.innerHTML = AudioSys.muted ? '&#128263;' : '&#128266;';
});
addEventListener('touchmove', e => e.preventDefault(), { passive: false });
addEventListener('contextmenu', e => e.preventDefault());

// ============================================================ game state
const state = {
  mode: 'title',            // title | countdown | racing
  pos: new THREE.Vector3(), vel: new THREE.Vector3(),
  fwd: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0),
  grounded: true, idx: 0,
  airTime: 0, stuntRoll: 0, stuntFlips: 0,
  driftTimer: 0, wallTimer: 0,
  lap: 1, lapStart: 0, best: null, gates: [false, false, false],
  score: 0, boostTimer: 0, zoneShown: '', respawns: 0, offTrackTime: 0,
  time: 0, lastPadIdx: -999,
};

const SPAWN_IDX = Math.round(N * 1.05 / NCP) % N;
function placeAt(idx, speed) {
  const s = S[idx];
  state.pos.copy(s.pos).addScaledVector(s.up, RIDE + 0.4);
  state.fwd.copy(s.tan); state.up.copy(s.up);
  state.vel.copy(s.tan).multiplyScalar(speed);
  state.grounded = true; state.idx = idx; state._prevIdx = idx;
  state.airTime = 0; state.stuntRoll = 0; state.boostTimer = 0;
  state.offTrackTime = 0;
  // snap the camera behind the car so respawns aren't disorienting
  camPos.copy(state.pos).addScaledVector(s.tan, -10).addScaledVector(s.up, 4.5);
  camUp.copy(s.up);
  camLook.copy(state.pos).addScaledVector(s.tan, 7);
}
let lastCheckpoint = SPAWN_IDX;
let lastDeathTime = -99, deathStreak = 0;
function respawn() {
  if (state.mode !== 'racing') return;
  // repeated instant deaths mean the checkpoint itself is bad — fall back
  deathStreak = (state.time - lastDeathTime < 4) ? deathStreak + 1 : 1;
  lastDeathTime = state.time;
  if (deathStreak >= 3) { lastCheckpoint = SPAWN_IDX; deathStreak = 0; }
  placeAt(lastCheckpoint, 26);
  state.respawns++;
  AudioSys.blip(180, 0.25, 0.15);
}

// ============================================================ HUD helpers
const $ = id => document.getElementById(id);
const hud = { lapTime: $('lapTime'), bestTime: $('bestTime'), lapNum: $('lapNum'),
  score: $('score'), speed: $('speed'), speedFill: $('speedFill'),
  popups: $('popups'), wrongWay: $('wrongWay'), countdown: $('countdown') };
function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
function popup(text, sub) {
  const d = document.createElement('div');
  d.className = 'popup';
  d.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
  hud.popups.appendChild(d);
  setTimeout(() => d.remove(), 1600);
}
function addScore(n) { state.score += n; hud.score.textContent = state.score; }

// ============================================================ start flow
const overlay = $('overlay');
function startGame() {
  AudioSys.init();
  if (AudioSys.ctx && AudioSys.ctx.state === 'suspended') AudioSys.ctx.resume();
  overlay.style.display = 'none';
  placeAt(SPAWN_IDX, 0);
  lastCheckpoint = SPAWN_IDX;
  if (FAST_START) { state.mode = 'racing'; state.lapStart = state.time; return; }
  state.mode = 'countdown';
  hud.countdown.style.display = 'flex';
  let n = 3;
  hud.countdown.textContent = n;
  AudioSys.blip(440, 0.15, 0.2);
  const iv = setInterval(() => {
    n--;
    if (n > 0) { hud.countdown.textContent = n; AudioSys.blip(440, 0.15, 0.2); }
    else {
      clearInterval(iv);
      hud.countdown.textContent = 'GO!';
      AudioSys.blip(880, 0.4, 0.25);
      state.mode = 'racing';
      state.lapStart = state.time;
      setTimeout(() => hud.countdown.style.display = 'none', 700);
    }
  }, 800);
}
overlay.addEventListener('pointerdown', startGame);
if (AUTOPILOT) setTimeout(startGame, 300);

// ============================================================ physics
const ray = new THREE.Raycaster();
ray.far = 9;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

function nearestSampleIdx(from, windowBack, windowFwd) {
  let best = from, bd = Infinity;
  for (let k = -windowBack; k <= windowFwd; k++) {
    const i = ((from + k) % N + N) % N;
    const d = S[i].pos.distanceToSquared(state.pos);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function autopilotControls(speed) {
  if (!state.grounded) { input.steer = 0; input.apBrake = false; return; }
  const look = Math.round(THREE.MathUtils.clamp(8 + speed * 0.42, 10, 34));
  const target = S[(state.idx + look) % N].pos;
  _v1.copy(target).sub(state.pos);
  _v1.addScaledVector(state.up, -_v1.dot(state.up)).normalize();
  const cross = _v2.copy(state.fwd).cross(_v1).dot(state.up);
  const angle = Math.atan2(cross, state.fwd.dot(_v1));
  input.steer = THREE.MathUtils.clamp(angle * 1.7, -1, 1);
  const noBrake = S[state.idx].boost || S[state.idx].gap;
  input.apBrake = !noBrake && Math.abs(angle) > 0.45 && speed > 22;
}

function step(dt) {
  if (state.mode !== 'racing') return;
  const st = state;

  // -------- controls
  let speed = st.vel.dot(st.fwd);
  if (AUTOPILOT) autopilotControls(speed);
  else {
    const kb = (input.kb.l ? -1 : 0) + (input.kb.r ? 1 : 0);
    input.steer = kb !== 0 ? kb : touchSteer;
    input.brake = input.kb.b || brakePointers.size > 0;
    input.apBrake = false;
  }

  // -------- track index / progress
  st.idx = nearestSampleIdx(st.idx, 40, 90);
  const samp = S[st.idx];

  if (st.grounded) {
    // steering (speed-sensitive) around current up
    const drifting = input.brake && Math.abs(input.steer) > 0.3 && speed > 24;
    let steerRate = 2.6 * (0.48 + 0.52 / (1 + speed / 32));
    if (drifting) steerRate *= 1.4;
    const yaw = input.steer * steerRate * dt * (speed > 2 ? 1 : 0);
    st.fwd.applyAxisAngle(st.up, yaw).normalize();

    // engine / brake / drag
    if (input.apBrake || (input.brake && !drifting)) speed -= BRAKE_DECEL * dt;
    else {
      const cap = st.boostTimer > 0 ? BOOST_SPEED : MAX_SPEED;
      speed += (ACCEL - ACCEL * (speed / cap) * (speed / cap) * Math.sign(speed)) * dt;
      if (drifting) speed -= 16 * dt;   // drifting still sheds real speed
    }
    speed = Math.max(speed, -8);

    // slope gravity along surface
    _v1.set(0, -G, 0);
    _v1.addScaledVector(st.up, -_v1.dot(st.up));
    speed += _v1.dot(st.fwd) * dt;

    // lateral velocity with grip; on steep roll (wall ride / corkscrew) the
    // tires grip "magnetically" so gravity barely drags the car sideways
    _v2.copy(st.vel).addScaledVector(st.fwd, -st.vel.dot(st.fwd));
    _v2.addScaledVector(st.up, -_v2.dot(st.up));         // lateral only
    _v2.addScaledVector(_v1, dt * ((samp.steep || st.up.y < 0.5) ? 0.22 : 1));
    const grip = drifting ? 5.0 : 9;
    _v2.multiplyScalar(Math.exp(-grip * dt));
    st.vel.copy(st.fwd).multiplyScalar(speed).add(_v2);

    // soft edge assist: nudge back toward the road when hanging over the edge
    if (!samp.gap) {
      const steep = samp.steep || st.up.y < 0.5;
      const off = _v1.copy(st.pos).sub(samp.pos).dot(samp.left);
      // the twisting ribbon carries an off-center car outward — groove it back
      if (steep) st.vel.addScaledVector(samp.left, -off * 5.5 * dt);
      if (samp.w >= 8) {
        // invisible guard rails on normal track: bump the edge and slide
        // along it, scrubbing some speed — you can't fall off here
        const maxOff = samp.w / 2 - 1.0;
        if (Math.abs(off) > maxOff) {
          st.pos.addScaledVector(samp.left, Math.sign(off) * maxOff - off);
          const vLat = st.vel.dot(samp.left);
          if (Math.sign(vLat) === Math.sign(off)) st.vel.addScaledVector(samp.left, -vLat);
          st.vel.multiplyScalar(Math.max(0, 1 - 1.4 * dt));
        }
      } else {
        // narrow precision sections: only a gentle nudge — falling is real
        const margin = samp.w / 2 - 1.3;
        if (Math.abs(off) > margin) {
          const inward = -Math.sign(off);
          const over = Math.abs(off) - margin;
          st.vel.addScaledVector(samp.left, inward * Math.min(over * 48, 95) * dt);
          const vLat = st.vel.dot(samp.left);
          if (Math.sign(vLat) === Math.sign(off)) {
            st.vel.addScaledVector(samp.left, -vLat * Math.min(1, 7 * dt));
          }
        }
      }
    }

    st.driftTimer = drifting ? st.driftTimer + dt : 0;
    if (drifting && st.driftTimer > 0.4) addScore(Math.round(90 * dt));

    // boost pads
    if (samp.boost && st.idx !== st.lastPadIdx) {
      if (Math.abs(st.idx - st.lastPadIdx) > 30) {
        popup('&#9889; BOOST', null);
        AudioSys.blip(660, 0.3, 0.2);
      }
      st.lastPadIdx = st.idx;
      st.boostTimer = 1.3;
    }
    if (st.boostTimer > 0) {
      speed = st.vel.dot(st.fwd);
      speed = Math.min(speed + 46 * dt, BOOST_SPEED);
      st.vel.addScaledVector(st.fwd, speed - st.vel.dot(st.fwd));
    }

    // wall ride scoring
    if (st.up.y < 0.45) {
      st.wallTimer += dt;
      addScore(Math.round(160 * dt));
      if (st.wallTimer > 0.5 && st.wallTimer - dt <= 0.5) popup('&#129306; WALL RIDE', '+style');
    } else st.wallTimer = 0;
  } else {
    // -------- airborne
    st.vel.y -= G * dt;
    st.airTime += dt;
    // stunt barrel roll on steer (only on real jumps, not tiny hops)
    if (Math.abs(input.steer) > 0.15 && st.airTime > 0.3) {
      const rollDelta = -input.steer * 3.4 * dt;
      st.up.applyAxisAngle(st.fwd, rollDelta);
      st.stuntRoll += rollDelta;
      if (Math.abs(st.stuntRoll) >= Math.PI * 2) {
        st.stuntFlips++;
        st.stuntRoll = 0;
        addScore(500);
        popup('&#127744; BARREL ROLL!', '+500 &middot; boost on landing');
        AudioSys.blip(990, 0.35, 0.25);
      }
    } else {
      // auto-level toward the road orientation below
      st.up.lerp(samp.up, Math.min(1, 3 * dt)).normalize();
    }
    // nose follows velocity a bit
    if (st.vel.lengthSq() > 25) {
      _v1.copy(st.vel).normalize();
      st.fwd.lerp(_v1, Math.min(1, 1.4 * dt)).normalize();
    }
    st.up.addScaledVector(st.fwd, -st.up.dot(st.fwd)).normalize();
  }

  st.boostTimer = Math.max(0, st.boostTimer - dt);

  // -------- integrate
  st.pos.addScaledVector(st.vel, dt);

  // -------- ground query: along car up when grounded, along the track's up
  // when airborne (so a mid-stunt car still finds the road)
  const qUp = st.grounded ? st.up : samp.up;
  _v1.copy(st.pos).addScaledVector(qUp, 3);
  ray.set(_v1, _v3.copy(qUp).multiplyScalar(-1));
  const hits = ray.intersectObject(trackMesh, false);
  const hit = hits.length ? hits[0] : null;
  const height = hit ? hit.distance - 3 : Infinity;

  if (st.grounded) {
    const glue = samp.steep || st.up.y < 0.9 ? 3.2 : 1.0; // sticky in wall-ride/corkscrew
    const fastEnough = st.vel.length() > 20 || st.up.y > 0.15;
    if (hit && height <= glue && fastEnough) {
      alignToSurface(hit, dt);
    } else {
      window._detach = { idx: st.idx, hadHit: !!hit,
        height: hit ? +height.toFixed(3) : null, glue,
        upy: +st.up.y.toFixed(3), spd: +st.vel.length().toFixed(1),
        vy: +st.vel.dot(st.up).toFixed(2),
        off: +_v2.copy(st.pos).sub(samp.pos).dot(samp.left).toFixed(2),
        halfW: +(samp.w / 2).toFixed(1),
        dh: +_v2.copy(st.pos).sub(samp.pos).dot(samp.up).toFixed(2) };
      st.grounded = false;
      st.airTime = 0; st.stuntRoll = 0;
    }
  } else {
    if (hit && height <= 0.12 && st.vel.dot(qUp) < 2) {
      // landing
      const n = hit.face.normal; // track mesh has identity transform
      const nWorld = _v2.copy(n);
      if (nWorld.dot(qUp) < 0) nWorld.multiplyScalar(-1);
      const vmag = st.vel.length();
      st.up.copy(nWorld);
      st.fwd.addScaledVector(st.up, -st.fwd.dot(st.up)).normalize();
      const fwdSpeed = Math.max(st.vel.dot(st.fwd), vmag * 0.72);
      st.vel.copy(st.fwd).multiplyScalar(fwdSpeed);
      st.grounded = true;
      alignToSurface(hit, dt);
      AudioSys.blip(90, 0.15, 0.18);
      if (st.airTime > 0.8) {
        addScore(Math.round(st.airTime * 220));
        popup('&#128293; BIG AIR', `+${Math.round(st.airTime * 220)} &middot; ${st.airTime.toFixed(1)}s`);
      }
      if (st.stuntFlips > 0) {
        st.boostTimer = 1.4 * st.stuntFlips;
        st.stuntFlips = 0;
      }
      st.airTime = 0; st.stuntRoll = 0;
    }
  }

  // -------- checkpoints / lap / zones
  // only bank a checkpoint while actually driving on safe, flat road —
  // never mid-air, mid-wall-ride, or mid-corkscrew
  if (st.grounded && samp.cpOk) lastCheckpoint = st.idx;
  const third = Math.floor(st.idx / (N / 3));
  st.gates[third] = true;
  const prevIdx = st._prevIdx ?? st.idx;
  if (prevIdx > N - 120 && st.idx < 120 && st.gates[1] && st.gates[2]) {
    const lapT = st.time - st.lapStart;
    if (lapT > 15) {
      if (st.best === null || lapT < st.best) {
        st.best = lapT;
        popup('&#127937; LAP ' + fmtTime(lapT), 'NEW BEST!');
      } else popup('&#127937; LAP ' + fmtTime(lapT), null);
      addScore(1000);
      st.lap++;
      st.lapStart = st.time;
      st.gates = [false, false, false];
      hud.lapNum.textContent = st.lap;
      hud.bestTime.textContent = fmtTime(st.best);
      AudioSys.blip(1320, 0.5, 0.25);
    }
  }
  st._prevIdx = st.idx;

  // zone announcements
  if (samp.zone && samp.zone !== st.zoneShown) {
    st.zoneShown = samp.zone;
    popup(samp.zone, null);
  } else if (!samp.zone && st.zoneShown && !S[(st.idx + 20) % N].zone) {
    // reset once we're well past a zone so it can fire next lap
    st.zoneShown = '';
  }

  // wrong way
  const wrongWay = st.grounded && st.fwd.dot(samp.tan) < -0.3 && st.vel.length() > 6;
  hud.wrongWay.style.display = wrongWay ? 'block' : 'none';

  // -------- death / respawn
  const distToTrack = st.pos.distanceTo(samp.pos);
  st.offTrackTime = (!st.grounded && distToTrack > samp.w) ? st.offTrackTime + dt : 0;
  if (st.pos.y < samp.pos.y - 50 || st.offTrackTime > 2.5) {
    if (window._deaths) window._deaths.push({ t: +st.time.toFixed(1), idx: st.idx,
      y: Math.round(st.pos.y), sampY: Math.round(samp.pos.y),
      offT: +st.offTrackTime.toFixed(1), cause: st.offTrackTime > 4 ? 'offtrack' : 'fell' });
    popup('&#128171; RESPAWN', null);
    respawn();
  }

  // -------- particles
  if (st.grounded && (st.driftTimer > 0.15 || st.boostTimer > 0.05)) {
    for (let k = 0; k < 2; k++) {
      _v1.copy(st.pos)
        .addScaledVector(st.fwd, -1.6)
        .addScaledVector(_v2.copy(st.up).cross(st.fwd), (Math.random() - 0.5) * 1.6)
        .addScaledVector(st.up, 0.2);
      _v2.copy(st.up).multiplyScalar(2 + Math.random() * 2).addScaledVector(st.vel, -0.06);
      if (st.boostTimer > 0.05) spawnPart(_v1, _v2, 0.3, 0.9, 1);
      else spawnPart(_v1, _v2, 0.9, 0.9, 0.92);
    }
  }
}

function alignToSurface(hit, dt) {
  const st = state;
  const n = _v3.copy(hit.face.normal);
  if (n.dot(st.up) < 0) n.multiplyScalar(-1);
  const k = 1 - Math.exp(-14 * dt);
  st.up.lerp(n, k).normalize();
  st.fwd.addScaledVector(st.up, -st.fwd.dot(st.up)).normalize();
  st.pos.copy(hit.point).addScaledVector(st.up, RIDE);
  // keep velocity in surface plane
  st.vel.addScaledVector(st.up, -st.vel.dot(st.up));
}

// ============================================================ camera
const camPos = new THREE.Vector3(0, 30, -100);
const camUp = new THREE.Vector3(0, 1, 0);
const camLook = new THREE.Vector3();
function updateCamera(dt) {
  const st = state;
  const speed = st.vel.length();
  const back = 8.6 + speed * 0.025;
  const desired = _v1.copy(st.pos)
    .addScaledVector(st.fwd, -back)
    .addScaledVector(st.up, 4.1);
  const k = 1 - Math.exp(-(st.mode === 'racing' ? 7 : 2.5) * dt);
  camPos.lerp(desired, k);
  camUp.lerp(st.up, 1 - Math.exp(-4.5 * dt)).normalize();
  camLook.lerp(_v2.copy(st.pos).addScaledVector(st.fwd, 7).addScaledVector(st.up, 1.2), 1 - Math.exp(-10 * dt));
  camera.position.copy(camPos);
  camera.up.copy(camUp);
  camera.lookAt(camLook);
  const targetFov = 68 + (speed / BOOST_SPEED) * 22 + (state.boostTimer > 0 ? 4 : 0);
  camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-6 * dt));
  camera.updateProjectionMatrix();
}

// ============================================================ visuals update
const _m = new THREE.Matrix4();
function updateCarVisual(dt) {
  const st = state;
  car.position.copy(st.pos);
  _v1.copy(st.fwd).cross(st.up).normalize();         // right... actually left/right axis
  _m.makeBasis(_v1, st.up, st.fwd);
  // makeBasis columns are x,y,z axes; car forward is +z
  car.quaternion.setFromRotationMatrix(_m);

  const speed = st.vel.length();
  const spin = (st.vel.dot(st.fwd) / 0.42) * dt;
  for (const w of wheels) w.rotation.x += spin;
  for (const p of frontWheels) p.rotation.y = input.steer * 0.42;
  carBody.rotation.z = THREE.MathUtils.lerp(carBody.rotation.z, input.steer * 0.08 * Math.min(1, speed / 20), 0.2);

  boostFlame.visible = st.boostTimer > 0.02;
  if (boostFlame.visible) boostFlame.scale.set(1, 1, 0.7 + Math.random() * 0.8);

  // blob shadow: reuse ground ray
  _v1.copy(st.pos).addScaledVector(st.up, 3);
  ray.set(_v1, _v2.copy(st.up).multiplyScalar(-1));
  const hits = ray.intersectObject(trackMesh, false);
  if (hits.length) {
    const h = hits[0];
    shadow.visible = true;
    shadow.position.copy(h.point).addScaledVector(st.up, 0.08);
    _v2.copy(h.face.normal); if (_v2.dot(st.up) < 0) _v2.multiplyScalar(-1);
    shadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _v2);
    const d = Math.max(0, h.distance - 3);
    shadow.material.opacity = Math.max(0, 0.38 - d * 0.045);
    shadow.scale.setScalar(1 / (1 + d * 0.09));
  } else shadow.visible = false;

  // particles
  for (let i = 0; i < PARTS; i++) {
    if (partLife[i] <= 0) continue;
    partLife[i] -= dt;
    if (partLife[i] <= 0) { partPos[i * 3 + 1] = 9999; continue; }
    partPos[i * 3] += partVel[i].x * dt;
    partPos[i * 3 + 1] += partVel[i].y * dt;
    partPos[i * 3 + 2] += partVel[i].z * dt;
  }
  partGeo.attributes.position.needsUpdate = true;
  partGeo.attributes.color.needsUpdate = true;

  for (const c of window._clouds) {
    c.position.x += c.userData.vx * dt;
    if (c.position.x > 520) c.position.x = -520;
  }
}

// ============================================================ HUD update
let hudAccum = 0;
function updateHUD(dt) {
  hudAccum += dt;
  if (hudAccum < 0.08) return;
  hudAccum = 0;
  const speed = state.vel.length();
  hud.speed.textContent = Math.round(speed * 3.4);
  hud.speedFill.style.width = Math.min(100, speed / BOOST_SPEED * 100) + '%';
  if (state.mode === 'racing') hud.lapTime.textContent = fmtTime(state.time - state.lapStart);
}

// ============================================================ main loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  state.time += dt;
  step(dt);
  updateCamera(dt);
  updateCarVisual(dt);
  updateHUD(dt);
  AudioSys.update(state.vel.length(), state.grounded);
  renderer.render(scene, camera);
}
placeAt(SPAWN_IDX, 0);
// title-screen camera slowly orbits the start area
requestAnimationFrame(frame);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// debug hook for tests
window.GAME = { state, S, N, respawn, placeAt,
  get speed() { return state.vel.length(); },
  get checkpoint() { return lastCheckpoint; } };
