// The swarm: lots of tiny single-purpose vehicles, their factories and command post.
import * as THREE from 'three';
import { UNITS, UNIT_TYPES, STRUCTS, SWARM, WATER_LEVEL, MAP_W as W, MAP_D as D, TANK, START_ARMY } from './config.js';
import { buildUnitGeometry, buildFactory, buildCP, litMat } from './models.js';
import { clamp, rand, wrapAngle, lerp } from './util.js';

const CAP = 400;

class Hash {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  clear() { this.map.clear(); }
  add(u) {
    const k = Math.floor(u.x / this.cell) + Math.floor(u.z / this.cell) * 1000;
    let a = this.map.get(k);
    if (!a) this.map.set(k, a = []);
    a.push(u);
  }
  query(x, z, r, fn) {
    const c = this.cell;
    const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c), j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const a = this.map.get(i + j * 1000);
      if (!a) continue;
      for (let n = 0; n < a.length; n++) {
        const u = a[n];
        if (!u.alive) continue;
        const d = Math.hypot(u.x - x, u.z - z);
        if (d <= r) fn(u, d);
      }
    }
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

export class Swarm {
  constructor(G, incomeMult = 1) {
    this.G = G;
    this.incomeMult = incomeMult;
    this.units = [];
    this.structures = [];
    this.nextId = 1;
    this.supply = SWARM.startSupply;
    this.hash = new Hash(4);
    this.selected = new Set();
    this.groups = {};
    this.activeFactory = null;
    this.chase = [null, null]; this.chaseT = 0; this.chaseAt = null;
    this.stats = { built: 0, lost: 0, spent: 0 };
    this.meshes = {};
    for (const t of UNIT_TYPES) {
      const im = new THREE.InstancedMesh(buildUnitGeometry(t), litMat(), CAP);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
      im.castShadow = true; im.receiveShadow = true;
      im.frustumCulled = false;
      im.count = 0;
      G.scene.add(im);
      this.meshes[t] = im;
    }
    const ring = new THREE.RingGeometry(0.75, 0.95, 20).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false }), CAP);
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 4;
    this.rings.count = 0;
    G.scene.add(this.rings);
  }

  // ------------------------------------------------------------ structures
  addStructure(kind, x, z) {
    const G = this.G, def = STRUCTS[kind];
    const y = G.terrain.heightAt(x, z);
    const b = kind === 'factory' ? buildFactory() : buildCP();
    b.group.position.set(x, y, z);
    G.scene.add(b.group);
    const mats = [];
    b.group.traverse((o) => { if (o.isMesh) mats.push(o.material); });
    const st = {
      kind, x, z, y, hp: def.hp, maxHp: def.hp, half: def.half, height: def.height, alive: true,
      queue: [], progress: 0, rally: { x, z: z - 11 }, view: b, mats, flash: 0, smokeT: 0, dying: 0,
      name: def.name, id: this.structures.length,
    };
    G.pathing.setBlock(x, z, def.half + 0.5, 1, true);
    this.structures.push(st);
    return st;
  }
  get factories() { return this.structures.filter((s) => s.kind === 'factory' && s.alive); }
  get cp() { return this.structures.find((s) => s.kind === 'cp'); }

  income() {
    const f = this.structures.filter((s) => s.kind === 'factory' && s.alive).length;
    const cp = this.cp && this.cp.alive ? 1 : 0;
    return (SWARM.baseIncome * cp + SWARM.perFactory * f) * this.incomeMult;
  }
  aliveCount() { let n = 0; for (const u of this.units) if (u.alive) n++; return n; }
  queuedCount() { let n = 0; for (const f of this.structures) n += f.queue.length; return n; }

  pickFactory() {
    const fs = this.factories;
    if (!fs.length) return null;
    if (this.activeFactory && this.activeFactory.alive) return this.activeFactory;
    let best = fs[0];
    for (const f of fs) if (f.queue.length < best.queue.length) best = f;
    return best;
  }
  queueUnit(type, factory = null) {
    const def = UNITS[type];
    factory = factory || this.pickFactory();
    if (!factory) return 'nofactory';
    if (this.supply < def.cost) return 'supply';
    if (this.aliveCount() + this.queuedCount() >= SWARM.cap) return 'cap';
    this.supply -= def.cost;
    this.stats.spent += def.cost;
    factory.queue.push(type);
    return 'ok';
  }

  damageStructure(st, dmg) {
    if (!st.alive) return;
    st.hp -= dmg;
    st.flash = 1;
    if (st.hp <= 0) this.destroyStructure(st);
  }
  destroyStructure(st) {
    const G = this.G;
    st.alive = false; st.hp = 0; st.dying = 0.001;
    const cols = G.terrain.crater(st.x, st.z, st.half + 2, 2);
    G.fx.explosion(st.x, st.y + 2, st.z, 3, { debris: cols });
    G.fx.debrisBurst(st.x, st.y + 3, st.z, [0.5, 0.84, 0.8, 0.17, 0.23, 0.33, 0.9, 0.9, 0.9], 40, 12, 0.55);
    G.audio.play('explode', { x: st.x, z: st.z, size: 3 });
    G.fx.shake(0.6, st.x, st.z);
    G.pathing.setBlock(st.x, st.z, st.half + 0.5, 0, true);
    // refund queue
    for (const t of st.queue) this.supply += UNITS[t].cost;
    st.queue = [];
    G.ui && G.ui.log(`🏭 ${st.name} destroyed!`, G.side === 'swarm' ? 'bad' : 'good', true);
    G.onStructureDestroyed(st);
  }

  // a forward screen just north of the river, spread across the map
  spawnStartArmy(L) {
    const P = this.G.pathing;
    const list = [];
    for (const [t, n] of Object.entries(START_ARMY)) for (let k = 0; k < n; k++) list.push(t);
    const cx = W / 2, cz = L.riverZ(W / 2) + 16;
    list.forEach((t, k) => {
      let x = 0, z = 0;
      for (let tries = 0; tries < 40; tries++) {
        x = cx + (k - list.length / 2) * 3.2 + (Math.random() - 0.5) * 3;
        z = cz + (t === 'mortar' ? 14 : 0) + (Math.random() - 0.5) * 6;
        const kk = Math.floor(z) * W + Math.floor(x);
        if (P.passable(UNITS[t].hover ? 1 : 0, kk) && this.G.terrain.H[kk] >= WATER_LEVEL) break;
      }
      const u = this.spawn(t, x, z);
      u.order = { kind: 'hold' };
      if (this.G.swarmAI) this.G.swarmAI.onSpawn(u, null);
    });
  }

  // ------------------------------------------------------------ units
  spawn(type, x, z) {
    const def = UNITS[type];
    const u = {
      id: this.nextId++, type, def, x, z, y: this.G.terrain.surfaceAt(x, z), vx: 0, vz: 0, heading: Math.PI,
      hp: def.hp, maxHp: def.hp, alive: true, cool: rand(0.5, 1.5), flash: 0, order: { kind: 'idle' },
      stuckT: 0, lastX: x, lastZ: z, fieldUntil: 0, fallback: null, empT: 0, jamSys: null, squad: null,
      bornT: this.G.time, tankDist: 999, cls: def.hover ? 1 : 0,
    };
    this.units.push(u);
    this.stats.built++;
    return u;
  }

  damageUnit(u, dmg, cause, sx, sz) {
    if (!u.alive) return;
    u.hp -= dmg;
    u.flash = 1;
    if (sx !== undefined) {
      const dx = u.x - sx, dz = u.z - sz, d = Math.hypot(dx, dz) || 1;
      u.vx += dx / d * Math.min(6, dmg * 0.1); u.vz += dz / d * Math.min(6, dmg * 0.1);
    }
    if (u.hp <= 0) this.killUnit(u, cause);
  }

  killUnit(u, cause) {
    if (!u.alive) return;
    const G = this.G;
    u.alive = false;
    this.selected.delete(u);
    this.stats.lost++;
    const ds = G.stats.deaths || (G.stats.deaths = {});
    const key = cause + ':' + u.type;
    ds[key] = (ds[key] || 0) + 1;
    const dd = G.stats.deathDist || (G.stats.deathDist = [0, 0, 0, 0, 0]);
    dd[Math.min(4, Math.floor(u.tankDist / 15))]++;
    G.tank && G.tank.stats && G.tank.stats.kills++;
    const team = [0.18, 0.7, 0.66, 0.95, 0.95, 0.93, 0.17, 0.23, 0.33, 0.17, 0.18, 0.22];
    if (cause === 'crush') {
      G.fx.debrisBurst(u.x, u.y + 0.3, u.z, team, 8, 3, 0.25);
      for (let k = 0; k < 3; k++) G.fx.puff(u.x, u.y + 0.2, u.z, [0.8, 0.75, 0.65], 0.9, 1, 1);
      G.fx.sparks(u.x, u.y + 0.5, u.z, 5);
      G.audio.play('crush', { x: u.x, z: u.z, vol: 0.5 });
    } else if (cause === 'boom') {
      // sapper already exploded
    } else {
      G.fx.explosion(u.x, u.y + 0.4, u.z, 0.42);
      G.fx.debrisBurst(u.x, u.y + 0.4, u.z, team, 7, 6, 0.26);
      G.terrain.addScorch(u.x, u.z, 1.3, 0.5);
      G.audio.play('explode', { x: u.x, z: u.z, size: 0.35, vol: 0.6 });
    }
    // a wreck that lingers for a while
    if (cause !== 'boom') G.fx.debris.spawn(u.x, u.y + 0.3, u.z, rand(-1, 1), 2, rand(-1, 1), 14, 0.55, 0.55, 0.2, 0.9, 0.2, 0.19, 0.18, 0.12, 0.11, 0.1, 20, 0.3, 1);
    if (G.swarmAI) G.swarmAI.onUnitLost(u);
  }

  detonate(u) {
    const G = this.G, t = G.tank;
    const cols = G.terrain.crater(u.x, u.z, 2.2, 1.4);
    G.fx.explosion(u.x, u.y + 1, u.z, 1.4, { debris: cols });
    G.audio.play('explode', { x: u.x, z: u.z, size: 1.4 });
    if (t && !t.dead) t.takeHit(u.def.dmg, u.x, u.y + 1.2, u.z, 'bomb', u.x, u.z);
    this.killUnit(u, 'boom');
  }

  // ------------------------------------------------------------ orders
  formation(n, spacing = 1.7) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const r = spacing * 0.62 * Math.sqrt(k), a = k * 2.39996;
      out.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return out;
  }
  orderMove(units, x, z, kind = 'move') {
    const offs = this.formation(units.length);
    // assign nearest slots in a stable way: sort units by angle around the centroid
    let cx = 0, cz = 0;
    for (const u of units) { cx += u.x; cz += u.z; }
    cx /= units.length || 1; cz /= units.length || 1;
    const sorted = [...units].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    sorted.forEach((u, k) => {
      u.order = { kind, x, z, tx: clamp(x + offs[k][0], 2, W - 2), tz: clamp(z + offs[k][1], 2, D - 2) };
      u.fieldUntil = 0;
    });
  }
  // bearing: local angle around the tank (null = keep each unit's own bearing)
  orderEngage(units, bearing = null, spread = 0.9) {
    const t = this.G.tank;
    if (!t || t.dead) return;
    if (bearing === null) {
      for (const u of units) u.order = { kind: 'engage', bearing: null };
      return;
    }
    const sorted = [...units].sort((a, b) => wrapAngle(t.localAngle(a.x, a.z) - bearing) - wrapAngle(t.localAngle(b.x, b.z) - bearing));
    const n = sorted.length;
    sorted.forEach((u, k) => {
      const off = n > 1 ? (k / (n - 1) - 0.5) * spread : 0;
      u.order = { kind: 'engage', bearing: wrapAngle(bearing + off) };
    });
  }
  orderSurround(units) {
    const t = this.G.tank;
    if (!t || t.dead) return;
    const sorted = [...units].sort((a, b) => t.localAngle(a.x, a.z) - t.localAngle(b.x, b.z));
    const n = sorted.length;
    const base = sorted.length ? t.localAngle(sorted[0].x, sorted[0].z) : 0;
    sorted.forEach((u, k) => { u.order = { kind: 'engage', bearing: wrapAngle(base + (k / n) * Math.PI * 2) }; });
  }
  orderScatter(units) {
    let cx = 0, cz = 0;
    for (const u of units) { cx += u.x; cz += u.z; }
    cx /= units.length || 1; cz /= units.length || 1;
    for (const u of units) {
      let dx = u.x - cx, dz = u.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < 0.5) { const a = Math.random() * 6.28; dx = Math.cos(a); dz = Math.sin(a); } else { dx /= d; dz /= d; }
      const r = rand(5, 9);
      const tx = clamp(u.x + dx * r + rand(-2, 2), 2, W - 2), tz = clamp(u.z + dz * r + rand(-2, 2), 2, D - 2);
      u.order = { kind: 'move', x: tx, z: tz, tx, tz };
      u.fieldUntil = 0;
    }
  }
  orderHold(units) { for (const u of units) { u.order = { kind: 'hold' }; } }
  orderRetreat(units) {
    const fs = this.factories;
    const cp = this.cp;
    for (const u of units) {
      let best = cp && cp.alive ? cp : null, bd = best ? Math.hypot(best.x - u.x, best.z - u.z) : 1e9;
      for (const f of fs) { const d = Math.hypot(f.x - u.x, f.z - u.z); if (d < bd) { bd = d; best = f; } }
      if (!best) continue;
      const tx = best.rally.x + rand(-4, 4), tz = best.rally.z + rand(-3, 3);
      u.order = { kind: 'move', x: best.rally.x, z: best.rally.z, tx, tz };
    }
  }

  // ------------------------------------------------------------ simulation
  update(dt) {
    const G = this.G;
    this.supply += this.income() * dt;
    // production
    for (const f of this.structures) {
      if (!f.alive || f.kind !== 'factory' || !f.queue.length) { if (f.alive) f.progress = 0; continue; }
      f.progress += dt;
      const def = UNITS[f.queue[0]];
      if (f.progress >= def.build) {
        f.progress = 0;
        const type = f.queue.shift();
        const u = this.spawn(type, f.x + rand(-1, 1), f.z - f.half - 1.2);
        u.heading = Math.PI;
        u.vz = -3;
        const tx = f.rally.x + rand(-2.5, 2.5), tz = f.rally.z + rand(-2.5, 2.5);
        u.order = { kind: 'move', x: f.rally.x, z: f.rally.z, tx, tz };
        f.doorFlash = 1;
        G.fx.puff(u.x, u.y + 0.5, u.z, [0.9, 0.95, 0.95], 1, 1, 1);
        G.audio.play('build', { x: f.x, z: f.z, vol: 0.4 });
        if (G.swarmAI) G.swarmAI.onSpawn(u, f);
      }
    }
    // spatial hash
    this.hash.clear();
    for (const u of this.units) if (u.alive) this.hash.add(u);
    // chase fields toward the tank
    const t = G.tank;
    this.chaseT -= dt;
    if (t && !t.dead && (this.chaseT <= 0 || !this.chaseAt || Math.hypot(this.chaseAt.x - t.x, this.chaseAt.z - t.z) > 6)) {
      this.chaseT = 2;
      this.chaseAt = { x: t.x, z: t.z };
      this.chase[0] = null; this.chase[1] = null; // lazily rebuilt
    }
    for (const u of this.units) if (u.alive) this.updateUnit(u, dt);
    if (this.units.length > 60 && this.units.filter((u) => !u.alive).length > 30) this.units = this.units.filter((u) => u.alive);
    // structures
    for (const st of this.structures) {
      st.flash = Math.max(0, st.flash - dt * 4);
      st.doorFlash = Math.max(0, (st.doorFlash || 0) - dt * 2);
    }
  }

  chaseField(cls) {
    const G = this.G;
    if (!this.chase[cls]) this.chase[cls] = G.pathing.field(cls, this.chaseAt.x, this.chaseAt.z, 10);
    return this.chase[cls];
  }

  updateUnit(u, dt) {
    const G = this.G, T = G.terrain, P = G.pathing, t = G.tank, def = u.def;
    u.cool -= dt;
    u.flash = Math.max(0, u.flash - dt * 5);
    const tankOk = t && !t.dead;
    const td = tankOk ? t.distToHull(u.x, u.z) : 999;
    u.tankDist = td;
    let gx = null, gz = null, field = null, faceTank = false, arrive = true;
    const o = u.order;
    if (o.kind === 'move') {
      gx = o.tx; gz = o.tz;
      const d = Math.hypot(gx - u.x, gz - u.z);
      if (d < 0.6) { u.order = { kind: 'idle' }; gx = null; }
      else if (Math.hypot(o.x - u.x, o.z - u.z) > 6) field = P.field(u.cls, o.x, o.z, 2);
    } else if (o.kind === 'engage') {
      if (!tankOk) u.order = { kind: 'idle' };
      else {
        if (o.bearing === null || o.bearing === undefined) o.bearing = t.localAngle(u.x, u.z);
        const b = o.bearing;
        const ang = t.heading + b;
        const R = t.extent(b) + def.pref;
        const sx = t.x + Math.sin(ang) * R, sz = t.z + Math.cos(ang) * R;
        const inRange = td <= def.range - 1 && (!def.minRange || td >= def.minRange);
        if (def.weapon === 'bomb') {
          gx = t.x; gz = t.z; arrive = false;
          if (td > 14) { field = this.chaseField(u.cls); }
        } else if (td > def.pref + 16 && !(def.weapon === 'mortar' && inRange)) {
          field = this.chaseField(u.cls); gx = sx; gz = sz;
        } else if (def.weapon === 'mortar' && inRange) {
          faceTank = true;
        } else {
          const cx = u.x - t.x, cz = u.z - t.z;
          const rNow = Math.hypot(cx, cz);
          const aNow = Math.atan2(cx, cz), aSlot = Math.atan2(sx - t.x, sz - t.z);
          const da = wrapAngle(aSlot - aNow);
          if (Math.abs(da) > 0.35) {
            const step = Math.sign(da) * 0.55;
            const rr = Math.max(rNow, R, 11);
            gx = t.x + Math.sin(aNow + step) * rr; gz = t.z + Math.cos(aNow + step) * rr;
            arrive = false;
          } else { gx = sx; gz = sz; }
          if (Math.hypot(gx - u.x, gz - u.z) < 1.0) { gx = null; faceTank = true; }
          if (gx !== null && inRange && Math.abs(da) <= 0.35) faceTank = true;
        }
      }
    }
    if (o.kind === 'hold' || o.kind === 'idle') faceTank = tankOk && td < def.range + 6;

    // steering
    let dvx = 0, dvz = 0;
    if (gx !== null) {
      let dir = null;
      if (G.time < u.fieldUntil && u.fallback) dir = P.dirAt(u.fallback, u.x, u.z);
      else if (field) dir = P.dirAt(field, u.x, u.z);
      if (!dir) {
        const dx = gx - u.x, dz = gz - u.z, l = Math.hypot(dx, dz) || 1;
        dir = [dx / l, dz / l];
      }
      let spd = def.speed;
      const d = Math.hypot(gx - u.x, gz - u.z);
      if (arrive && d < 2.5) spd *= Math.max(0.25, d / 2.5);
      if (u.cls === 0 && T.heightAt(u.x, u.z) < WATER_LEVEL) spd *= 0.6;
      dvx = dir[0] * spd; dvz = dir[1] * spd;
    }
    // separation
    let px = 0, pz = 0;
    this.hash.query(u.x, u.z, 1.3, (v, d) => {
      if (v === u || d < 1e-4) return;
      const f = (1.3 - d) * 3.5;
      px += (u.x - v.x) / d * f; pz += (u.z - v.z) / d * f;
    });
    // keep clear of the hull (sappers excepted)
    if (tankOk && def.weapon !== 'bomb' && td < 1.6) {
      const [lx, lz] = t.toLocal(u.x, u.z);
      const ex = Math.abs(lx) - TANK.halfW, ez = Math.abs(lz) - TANK.halfL;
      let ox, oz;
      if (ex > ez) { ox = Math.sign(lx); oz = 0; } else { ox = 0; oz = Math.sign(lz); }
      const [wx, wz] = [ox * Math.cos(t.heading) + oz * Math.sin(t.heading), -ox * Math.sin(t.heading) + oz * Math.cos(t.heading)];
      px += wx * 6; pz += wz * 6;
    }
    const k = Math.min(1, dt * 6);
    u.vx += (dvx + px - u.vx) * k;
    u.vz += (dvz + pz - u.vz) * k;
    const nx = u.x + u.vx * dt, nz = u.z + u.vz * dt;
    if (P.canMove(u.cls, u.x, u.z, nx, nz)) { u.x = nx; u.z = nz; }
    else if (P.canMove(u.cls, u.x, u.z, nx, u.z)) { u.x = nx; u.vz *= 0.5; }
    else if (P.canMove(u.cls, u.x, u.z, u.x, nz)) { u.z = nz; u.vx *= 0.5; }
    else { u.vx *= -0.3; u.vz *= -0.3; }
    // stuck? fall back to a proper flow field toward the goal
    u.stuckT += dt;
    if (u.stuckT > 1.2) {
      const moved = Math.hypot(u.x - u.lastX, u.z - u.lastZ);
      if (gx !== null && moved < 0.8 && G.time > u.fieldUntil) {
        u.fallback = P.field(u.cls, gx, gz, 1.5);
        u.fieldUntil = G.time + 4;
      }
      u.stuckT = 0; u.lastX = u.x; u.lastZ = u.z;
    }
    // height: hop onto steps
    const gy = def.hover ? T.surfaceAt(u.x, u.z) : Math.max(T.heightAt(u.x, u.z), P.effH(0, Math.floor(u.z) * W + Math.floor(u.x)));
    u.y += (gy - u.y) * Math.min(1, dt * (gy > u.y ? 14 : 9));
    // facing
    const sp = Math.hypot(u.vx, u.vz);
    let th = null;
    if (faceTank && tankOk) th = Math.atan2(t.x - u.x, t.z - u.z);
    else if (sp > 0.4) th = Math.atan2(u.vx, u.vz);
    if (th !== null) u.heading = wrapAngle(u.heading + clamp(wrapAngle(th - u.heading), -dt * 7, dt * 7));
    u.moving = sp > 0.5;
    if (u.moving && Math.random() < dt * (def.hover ? 3 : 1.5)) {
      if (T.heightAt(u.x, u.z) < WATER_LEVEL) G.fx.splash(u.x, WATER_LEVEL, u.z, 0.15);
      else G.fx.dust(u.x - Math.sin(u.heading) * 0.6, u.y, u.z - Math.cos(u.heading) * 0.6, [0.85, 0.78, 0.62], 0.45);
    }
    if (tankOk) this.unitWeapons(u, dt, td);
  }

  unitWeapons(u, dt, td) {
    const G = this.G, t = G.tank, def = u.def, T = G.terrain;
    if (def.weapon === 'bomb') { if (td < 0.9) this.detonate(u); return; }
    if (def.weapon === 'emp') {
      if (td <= def.range) {
        t.jamBy(u, dt);
        u.empT -= dt;
        if (u.empT <= 0) {
          u.empT = 0.1;
          const aim = t.randomHullLocal(u.x, u.z);
          const [ax, az] = t.toWorld(aim[0], aim[2]);
          G.fx.arc(u.x, u.y + 1.6, u.z, ax, t.y + aim[1], az);
          if (Math.random() < 0.3) G.fx.sparks(ax, t.y + aim[1], az, 2, [0.85, 0.65, 1], 3);
          G.audio.play('emp', { x: u.x, z: u.z, vol: 0.6 });
        }
      }
      return;
    }
    if (u.cool > 0) return;
    if (td > def.range || (def.minRange && td < def.minRange)) return;
    if (u.order.kind === 'move' && def.weapon === 'mortar') return;
    const aim = t.randomHullLocal(u.x, u.z);
    const [ax, az] = t.toWorld(aim[0], aim[2]);
    const ay = t.y + aim[1];
    const mx = u.x + Math.sin(u.heading) * 0.6, mz = u.z + Math.cos(u.heading) * 0.6, my = u.y + 0.8;
    if (def.weapon !== 'mortar' && !T.los(mx, my, mz, ax, ay, az)) { u.cool = 0.4; return; }
    const src = { x: u.x, z: u.z };
    switch (def.weapon) {
      case 'mg':
        G.proj.bullet(mx, my, mz, ax, ay, az, 55, def.dmg, 'mg', 0.03, src);
        G.fx.fire.spawn(mx, my, mz, 0, 0.5, 0, 0.06, 0.15, 0.3, 0, 0.3, 1, 1, 0.7, 1, 0.6, 0.2);
        G.audio.play('mg', { x: u.x, z: u.z, vol: 0.5 });
        break;
      case 'gun':
        G.proj.bullet(mx, my, mz, ax, ay, az, 42, def.dmg, 'gun', 0.02, src);
        G.fx.muzzle(mx, my, mz, ax - mx > 0 ? 0.1 : -0.1, 0.1, 0, 0.35);
        G.audio.play('gun', { x: u.x, z: u.z, vol: 0.7 });
        break;
      case 'missile':
        G.proj.missile(mx, my + 0.3, mz, aim, def.dmg, src);
        for (let k = 0; k < 4; k++) G.fx.puff(u.x, u.y + 0.6, u.z, [0.9, 0.9, 0.9], 0.8, 1.2, 1.5);
        G.audio.play('missile', { x: u.x, z: u.z });
        break;
      case 'mortar': {
        // lead a moving target a bit (not perfectly)
        const lead = 1.6 + td / 26;
        const vx = Math.sin(t.heading) * t.speed, vz = Math.cos(t.heading) * t.speed;
        const sc = 2.2;
        G.proj.mortar(mx, my + 0.5, mz, ax + vx * lead * 0.6 + rand(-sc, sc), ay, az + vz * lead * 0.6 + rand(-sc, sc), def.dmg, src);
        G.fx.muzzle(mx, my + 0.6, mz, 0, 1, 0, 0.6);
        G.audio.play('mortar', { x: u.x, z: u.z });
        break;
      }
    }
    u.cool = def.rof * rand(0.9, 1.1);
  }

  // ------------------------------------------------------------ view
  render(dt, vt) {
    const counts = {};
    for (const t of UNIT_TYPES) counts[t] = 0;
    let r = 0;
    const RA = this.rings.instanceColor.array;
    for (const u of this.units) {
      if (!u.alive) continue;
      const im = this.meshes[u.type];
      const i = counts[u.type]++;
      if (i >= CAP) continue;
      let bob = 0;
      if (u.def.hover) bob = 0.28 + Math.sin(vt * 5 + u.id) * 0.06;
      else if (u.moving) bob = Math.abs(Math.sin(vt * 16 + u.id)) * 0.05;
      const sc = 1.15;
      _q.setFromAxisAngle(_up, u.heading);
      _m.compose(_p.set(u.x, u.y + bob, u.z), _q, _s.set(sc, sc, sc));
      im.setMatrixAt(i, _m);
      const f = u.flash;
      let cr = 1 + f * 1.8, cg = 1 + f * 1.8, cb = 1 + f * 1.8;
      if (u.type === 'sapper' && u.order.kind === 'engage' && u.tankDist < 16 && Math.sin(vt * 20) > 0) { cr = 2.2; cg = 0.6; cb = 0.5; }
      im.instanceColor.setXYZ(i, cr, cg, cb);
      if (this.selected.has(u) && r < CAP) {
        _q.identity();
        _m.compose(_p.set(u.x, u.y + 0.08 + (u.def.hover ? bob - 0.2 : 0), u.z), _q, _s.set(1, 1, 1));
        this.rings.setMatrixAt(r, _m);
        const h = u.hp / u.maxHp;
        _c.setRGB(h > 0.5 ? lerp(1, 0.3, (h - 0.5) * 2) : 1, h > 0.5 ? 1 : lerp(0.3, 1, h * 2), 0.35);
        RA[r * 3] = _c.r; RA[r * 3 + 1] = _c.g; RA[r * 3 + 2] = _c.b;
        r++;
      }
    }
    for (const t of UNIT_TYPES) {
      const im = this.meshes[t];
      im.count = Math.min(CAP, counts[t]);
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
    }
    this.rings.count = r;
    this.rings.instanceMatrix.needsUpdate = true;
    this.rings.instanceColor.needsUpdate = true;
    // structures
    const G = this.G;
    for (const st of this.structures) {
      const v = st.view;
      if (st.alive) {
        if (v.fan) v.fan.rotation.y += dt * 4;
        if (v.radar) v.radar.rotation.y += dt * 1.2;
        if (v.flag) v.flag.rotation.y = Math.sin(vt * 4 + st.id) * 0.3;
        const f = st.flash;
        for (const m of st.mats) m.color.setRGB(1 + f * 1.5, 1 + f * 0.8, 1 + f * 0.6);
        st.smokeT -= dt;
        if (st.smokeT <= 0) {
          const hurt = st.hp / st.maxHp;
          st.smokeT = st.kind === 'factory' ? (st.queue.length ? 0.2 : 0.6) : 0.8;
          if (st.kind === 'factory') G.fx.puff(st.x + v.chimney.x, st.y + v.chimney.y, st.z + v.chimney.z, [0.92, 0.92, 0.95], 1.1, 2.5, 1.5);
          if (hurt < 0.6) G.fx.puff(st.x + rand(-2, 2), st.y + st.height, st.z + rand(-2, 2), [0.25, 0.24, 0.23], 1.5, 2.5, 2);
          if (hurt < 0.3) { G.fx.ember(st.x + rand(-2, 2), st.y + st.height - 0.5, st.z + rand(-2, 2)); st.smokeT *= 0.5; }
        }
      } else if (st.dying > 0) {
        st.dying += dt;
        const t = Math.min(1, st.dying / 1.5);
        v.group.scale.set(1 + t * 0.15, Math.max(0.08, 1 - t * 0.92), 1 + t * 0.15);
        v.group.position.x = st.x + Math.sin(vt * 40) * 0.15 * (1 - t);
        for (const m of st.mats) m.color.setRGB(0.3, 0.28, 0.27);
        if (Math.random() < dt * 12) G.fx.puff(st.x + rand(-3, 3), st.y + 1, st.z + rand(-3, 3), [0.3, 0.28, 0.26], 2.4, 3, 2);
        if (st.dying > 12) st.dying = 0;
      }
    }
  }
}
