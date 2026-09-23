// The Colossus: one huge tank, six systems, a power budget and a very bad day.
import * as THREE from 'three';
import { TANK, POWERED, SYSTEMS, SYSTEM_INFO, HIT_TABLES, WATER_LEVEL, UNITS } from './config.js';
import { buildTank } from './models.js';
import { clamp, lerp, wrapAngle, rand, weighted, pick } from './util.js';

const CUT = ['repair', 'drive', 'flak', 'cannon', 'shield'];
export const QUAD_NAMES = ['front', 'right', 'rear', 'left'];

const PART_POS = {
  reactor: [[0, 4.4, -5.3]],
  drive: [[3.65, 2.2, -4], [-3.65, 2.2, 3], [3.65, 2.2, 3], [-3.65, 2.2, -4]],
  cannon: [[0, 5.5, 0.8]],
  flak: [[2.9, 4.2, 4.2], [-2.9, 4.2, 4.2], [2.9, 4.2, -4.3], [-2.9, 4.2, -4.3]],
  shield: [[1.7, 6.2, -3.4]],
  repair: [[-1.95, 4.1, -2.9]],
  hull: [[0, 3.6, 0]],
};

const bubbleVert = /* glsl */`
varying vec3 vL; varying vec3 vN; varying vec3 vV;
void main() {
  vL = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const bubbleFrag = /* glsl */`
uniform vec4 uQ; uniform float uTime; uniform vec4 uHits[8]; uniform float uFlicker; uniform float uFar;
varying vec3 vL; varying vec3 vN; varying vec3 vV;
void main() {
  float a = atan(vL.x, vL.z);
  // quadrant centres: front 0, left +pi/2, rear pi, right -pi/2
  float wf = max(0.0, cos(a)), wl = max(0.0, sin(a)), wr = max(0.0, -sin(a)), wb = max(0.0, -cos(a));
  float s = (uQ.x * wf * wf + uQ.w * wl * wl + uQ.y * wr * wr + uQ.z * wb * wb);
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  vec3 g = floor(vL * 3.0 + 0.5);
  float chk = mod(g.x + g.y + g.z, 2.0);
  float scan = step(0.92, fract(vL.y * 1.5 - uTime * 0.6));
  vec3 dir = normalize(vL);
  float hit = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 h = uHits[i];
    if (h.w < 0.0 || h.w > 0.7) continue;
    float d = distance(dir, h.xyz);
    hit += step(abs(d - h.w * 2.2), 0.09) * (1.0 - h.w / 0.7) + smoothstep(0.45, 0.0, d) * max(0.0, 1.0 - h.w * 5.0) * 1.5;
  }
  float alpha = (s * (0.015 + fres * 0.26 + chk * 0.015 + scan * 0.05) * uFlicker + hit * 0.7) * (1.0 - 0.65 * uFar);
  vec3 col = mix(vec3(0.35, 0.85, 1.0), vec3(0.8, 1.0, 1.0), chk * 0.4 + hit);
  gl_FragColor = vec4(col * (1.0 + hit), clamp(alpha, 0.0, 1.0));
}`;

const _v = new THREE.Vector3();

export class Tank {
  constructor(G, x, z, heading, hullMult = 1) {
    this.G = G;
    this.x = x; this.z = z; this.heading = heading;
    this.y = G.terrain.smoothHeightAt(x, z);
    this.speed = 0; this.turnRate = 0; this.pitch = 0; this.roll = 0;
    this.alive = true;
    this.hullMax = Math.round(TANK.hull * hullMult); this.hull = this.hullMax;
    this.sys = {};
    for (const s of SYSTEMS) this.sys[s] = { hp: 100, online: true, jam: 0, flash: 0, fxT: Math.random() };
    this.want = { drive: 2, cannon: 3, flak: 2, shield: 2, repair: 1 };
    this.power = { ...this.want };
    this.heat = 0; this.overdrive = false; this.scram = 0; this.mortarDmg = 0;
    this.shieldQ = [80, 80, 80, 80];
    this.shieldMode = 'auto'; this.shieldFocus = -1;
    this.dmgRecent = [0, 0, 0, 0];
    this.hitFlash = [0, 0, 0, 0];
    this.repairPin = null; this.repairing = null;
    this.cannon = { cool: 2, yaw: heading, pitch: 0.05, recoil: 0, target: null, point: null, pointT: 0, auto: true, autoT: 0, autoAim: null, reloadFrac: 0 };
    this.flak = [
      { lx: 2.9, lz: 4.2, arc: Math.PI / 4 }, { lx: -2.9, lz: 4.2, arc: -Math.PI / 4 },
      { lx: 2.9, lz: -4.3, arc: 3 * Math.PI / 4 }, { lx: -2.9, lz: -4.3, arc: -3 * Math.PI / 4 },
    ].map((f) => ({ ...f, cool: Math.random() * 0.3, yaw: heading, recoil: 0 }));
    this.path = []; this.ram = null; this.moveGoal = null;
    this.odoL = 0; this.odoR = 0;
    this.dead = false; this.deathT = 0;
    this.crushT = 0; this.wearT = 0; this.dustT = 0; this.exhaustT = 0;
    this.stats = { dmgTaken: 0, shots: 0, kills: 0, crushed: 0 };
    this.buildView();
  }

  // ------------------------------------------------------------ geometry helpers
  toWorld(lx, lz) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    return [this.x + lx * c + lz * s, this.z - lx * s + lz * c];
  }
  toLocal(wx, wz) {
    const dx = wx - this.x, dz = wz - this.z, c = Math.cos(this.heading), s = Math.sin(this.heading);
    return [dx * c - dz * s, dx * s + dz * c];
  }
  localAngle(wx, wz) { const [lx, lz] = this.toLocal(wx, wz); return Math.atan2(lx, lz); }
  quadrant(wx, wz) {
    const a = this.localAngle(wx, wz);
    if (Math.abs(a) <= Math.PI / 4) return 0;
    if (a > Math.PI / 4 && a < 3 * Math.PI / 4) return 3;
    if (a < -Math.PI / 4 && a > -3 * Math.PI / 4) return 1;
    return 2;
  }
  distToHull(wx, wz) {
    const [lx, lz] = this.toLocal(wx, wz);
    const dx = Math.max(0, Math.abs(lx) - TANK.halfW), dz = Math.max(0, Math.abs(lz) - TANK.halfL);
    return Math.hypot(dx, dz);
  }
  inHull(wx, wz, m = 0) {
    const [lx, lz] = this.toLocal(wx, wz);
    return Math.abs(lx) <= TANK.halfW + m && Math.abs(lz) <= TANK.halfL + m;
  }
  // extent of the hull along a local bearing
  extent(b) { return Math.min(TANK.halfW / Math.max(0.01, Math.abs(Math.sin(b))), TANK.halfL / Math.max(0.01, Math.abs(Math.cos(b)))); }
  // random aim point on the hull, as local [lx, ly, lz]
  randomHullLocal(fromX, fromZ) {
    const [lx, lz] = this.toLocal(fromX, fromZ);
    const b = Math.atan2(lx, lz);
    const e = this.extent(b) * 0.8;
    return [Math.sin(b) * e + rand(-1.5, 1.5), rand(1.2, 3.8), Math.cos(b) * e + rand(-1.5, 1.5)];
  }
  worldPart(sys) {
    const p = pick(PART_POS[sys]);
    _v.set(p[0], p[1], p[2]);
    this.view.root.localToWorld(_v);
    return _v;
  }

  // ------------------------------------------------------------ power
  nominalOutput() {
    const r = this.sys.reactor;
    let o = r.online ? Math.round(TANK.reactorBase * (0.55 + 0.45 * r.hp / 100)) : TANK.emergency;
    if (r.jam > 0) o -= 2;
    if (this.overdrive) o += TANK.overdrive;
    return Math.max(0, o);
  }
  output() { return this.scram > 0 ? 0 : this.nominalOutput(); }
  wantTotal() { let s = 0; for (const k of POWERED) s += this.want[k]; return s; }
  usedTotal() { let s = 0; for (const k of POWERED) s += this.power[k]; return s; }
  eff(s) {
    const q = this.sys[s];
    if (!q.online) return 0;
    let e = 0.35 + 0.65 * q.hp / 100;
    if (q.jam > 0) e *= 0.5;
    return e;
  }
  allocate() {
    const out = this.output();
    for (const k of POWERED) this.power[k] = this.want[k];
    let used = this.usedTotal();
    while (used > out) {
      let best = null;
      for (const k of CUT) if (this.power[k] > 0 && (!best || this.power[k] > this.power[best])) best = k;
      if (!best) break;
      this.power[best]--; used--;
    }
  }
  addPower(sys) {
    if (this.want[sys] >= TANK.maxPower[sys]) return false;
    const cap = this.nominalOutput();
    if (this.wantTotal() >= cap) {
      let donor = null;
      for (const k of CUT) if (k !== sys && this.want[k] > 0 && (!donor || this.want[k] > this.want[donor])) donor = k;
      if (!donor) return false;
      this.want[donor]--;
    }
    this.want[sys]++;
    this.allocate();
    return true;
  }
  removePower(sys) {
    if (this.want[sys] <= 0) return false;
    this.want[sys]--;
    this.allocate();
    return true;
  }
  setPower(sys, n) {
    n = clamp(n, 0, TANK.maxPower[sys]);
    let guard = 10;
    while (this.want[sys] < n && guard-- > 0) if (!this.addPower(sys)) break;
    while (this.want[sys] > n) this.removePower(sys);
  }
  applyPreset(p) {
    const cap = this.nominalOutput();
    const want = { ...p.want };
    let tot = POWERED.reduce((s, k) => s + want[k], 0);
    for (const k of p.cut) { while (tot > cap && want[k] > 0) { want[k]--; tot--; } }
    this.want = want;
    this.allocate();
  }
  setOverdrive(on) {
    if (this.scram > 0) return false;
    this.overdrive = on;
    this.allocate();
    return true;
  }

  // ------------------------------------------------------------ orders
  moveTo(x, z, append = false) {
    const P = this.G.pathing;
    const from = append && this.path.length ? this.path[this.path.length - 1] : { x: this.x, z: this.z };
    const pth = P.tankPath(from.x, from.z, x, z);
    this.ram = null;
    if (!pth) return false;
    this.path = append ? this.path.concat(pth) : pth;
    return true;
  }
  ramStructure(st) {
    // path to just in front of it, then drive through
    const dx = this.x - st.x, dz = this.z - st.z, d = Math.hypot(dx, dz) || 1;
    const ok = this.moveTo(st.x + dx / d * (st.half + 9), st.z + dz / d * (st.half + 9));
    this.ram = st;
    return ok;
  }
  stop() { this.path = []; this.ram = null; }

  // ------------------------------------------------------------ damage
  takeHit(dmg, px, py, pz, kind, sx, sz) {
    if (this.dead) return 'none';
    const G = this.G;
    const q = this.quadrant(sx ?? px, sz ?? pz);
    this.dmgRecent[q] += dmg;
    G.stats.dmg[kind] = (G.stats.dmg[kind] || 0) + dmg;
    if (kind === 'mortar') this.mortarDmg += dmg;
    if (kind !== 'emp' && this.shieldQ[q] > 0.5) {
      // bombs are delivered under the bubble: shields only soak part of them
      const ab = Math.min(this.shieldQ[q], kind === 'bomb' ? dmg * 0.4 : dmg);
      this.shieldQ[q] -= ab; dmg -= ab;
      this.shieldHit(px, py, pz, ab);
      if (dmg <= 0.01) { G.stats.shieldAbsorbed += ab; return 'shield'; }
      G.stats.shieldAbsorbed += ab;
    }
    dmg = Math.max(0.5, dmg - TANK.armor);
    this.hull -= dmg;
    this.stats.dmgTaken += dmg;
    this.hitFlash[q] = 1;
    const table = kind === 'mortar' ? HIT_TABLES.top : HIT_TABLES[['front', 'side', 'rear', 'side'][q]];
    const t = { ...table };
    if (kind === 'missile') t.hull *= 0.45;
    if (kind === 'bomb' && t.drive) t.drive *= 2.2;
    const s = weighted(t);
    let label = null;
    if (s !== 'hull') {
      const S = this.sys[s];
      const sd = dmg * (kind === 'missile' ? 0.8 : kind === 'bomb' ? 0.6 : 0.55) * TANK.sysArmor[s];
      const before = S.hp;
      S.hp = Math.max(0, S.hp - sd);
      S.flash = 1;
      label = `${SYSTEM_INFO[s].name} −${Math.round(before - S.hp)}`;
      if (S.hp <= 0 && S.online) {
        S.online = false;
        G.ui && G.ui.log(`${SYSTEM_INFO[s].icon} ${G.side === 'swarm' ? 'Its ' : ''}${SYSTEM_INFO[s].name} knocked OUT!`, G.side === 'swarm' ? 'good' : 'bad', true);
        G.audio.play('alarm', { vol: G.side === 'tank' ? 1 : 0.3 });
        const w = this.worldPart(s);
        G.fx.explosion(w.x, w.y, w.z, 0.7);
        this.allocate();
      } else if (before >= 50 && S.hp < 50) {
        G.ui && G.ui.log(`${SYSTEM_INFO[s].icon} ${G.side === 'swarm' ? 'Its ' : ''}${SYSTEM_INFO[s].name} damaged (${Math.round(S.hp)}%)`, G.side === 'swarm' ? 'good' : 'warn');
      }
    } else this.sys.reactor.fxT += 0; // hull only
    this.hullFlash = 1;
    G.fx.sparks(px, py, pz, 6 + Math.min(10, dmg / 5), [1, 0.9, 0.55], 7);
    G.audio.play('clang', { x: px, z: pz });
    if (G.side === 'tank' && (dmg >= 20 || label)) G.fx.floatText(px, py + 1, pz, label || `−${Math.round(dmg)}`, label ? 'sys' : 'hull');
    if (dmg > 30) G.fx.shake(G.side === 'tank' ? 0.18 : 0.1, px, pz);
    if (this.hull <= 0) { this.hull = 0; this.die(); }
    return 'hull';
  }

  shieldHit(px, py, pz, amt) {
    const G = this.G;
    // store hit direction in bubble space for the shader
    _v.set(px, py, pz);
    this.view.root.worldToLocal(_v);
    _v.y -= 2.4;
    _v.x /= TANK.bubble[0]; _v.y /= TANK.bubble[1]; _v.z /= TANK.bubble[2];
    _v.normalize();
    const h = this.hits[this.hitIdx++ % 8];
    h.set(_v.x, _v.y, _v.z, 0);
    G.fx.sparks(px, py, pz, 4, [0.6, 0.95, 1], 5);
    G.audio.play('shield', { x: px, z: pz });
  }

  jamBy(u, dt) {
    const q = this.quadrant(u.x, u.z);
    this.shieldQ[q] = Math.max(0, this.shieldQ[q] - 14 * dt);
    this.dmgRecent[q] += 6 * dt;
    if (!u.jamSys) {
      const t = { ...HIT_TABLES[['front', 'side', 'rear', 'side'][q]] };
      delete t.hull;
      u.jamSys = weighted(t);
    }
    const S = this.sys[u.jamSys];
    if (S.jam <= 0 && this.G.side === 'tank') this.G.ui && this.G.ui.log(`${SYSTEM_INFO[u.jamSys].icon} ${SYSTEM_INFO[u.jamSys].name} jammed!`, 'warn');
    S.jam = 0.35;
  }

  die() {
    if (this.dead) return;
    this.dead = true; this.deathT = 0;
    this.alive = false;
    this.G.onTankDestroyed();
  }

  // ------------------------------------------------------------ simulation
  update(dt) {
    const G = this.G;
    if (this.dead) { this.updateDeath(dt); return; }
    // heat & reactor
    if (this.overdrive) this.heat += (TANK.heatOverdrive - TANK.heatCoolOD) * dt;
    else this.heat -= TANK.heatCool * dt;
    this.heat = Math.max(0, this.heat);
    if (this.heat >= 100 && this.scram <= 0) {
      this.scram = 5; this.overdrive = false; this.heat = 72;
      this.sys.reactor.hp = Math.max(0, this.sys.reactor.hp - 25);
      if (this.sys.reactor.hp <= 0) this.sys.reactor.online = false;
      G.ui && G.ui.log('☢️ REACTOR SCRAM! Overheated — no power for 5s', 'bad', true);
      G.audio.play('scram', {});
      G.fx.shake(0.3, this.x, this.z);
    }
    if (this.scram > 0) {
      this.scram -= dt;
      if (this.scram <= 0) { G.ui && G.ui.log('Reactor back online', 'good'); }
    }
    for (const s of SYSTEMS) {
      const S = this.sys[s];
      if (S.jam > 0) S.jam -= dt;
      S.flash = Math.max(0, S.flash - dt * 3);
    }
    this.allocate();
    for (let q = 0; q < 4; q++) {
      this.dmgRecent[q] *= Math.exp(-dt / 4);
      this.hitFlash[q] = Math.max(0, this.hitFlash[q] - dt * 2.5);
    }
    this.hullFlash = Math.max(0, (this.hullFlash || 0) - dt * 5);
    this.mortarDmg *= Math.exp(-dt / 10);
    this.updateShield(dt);
    this.updateRepair(dt);
    this.updateMove(dt);
    this.syncTransform(dt);
    this.updateCannon(dt);
    this.updateFlak(dt);
  }

  updateShield(dt) {
    const S = this.sys.shield;
    const cap = S.online ? TANK.shieldMax * (0.5 + 0.5 * S.hp / 100) : 0;
    const p = this.power.shield;
    const e = this.eff('shield');
    let regen = p > 0 && e > 0 ? TANK.shieldRegen[p] * e : (S.online ? TANK.shieldRegen[0] : -30);
    const w = [0.25, 0.25, 0.25, 0.25];
    if (this.shieldMode === 'manual' && this.shieldFocus >= 0) {
      w.fill(0.1); w[this.shieldFocus] = 0.7;
    } else {
      const d = this.dmgRecent, tot = d[0] + d[1] + d[2] + d[3];
      if (tot > 2) for (let q = 0; q < 4; q++) w[q] = 0.1 + 0.6 * d[q] / tot;
    }
    if (regen > 0) {
      let spill = 0;
      for (let q = 0; q < 4; q++) {
        const add = regen * w[q] * dt;
        const room = cap - this.shieldQ[q];
        if (add > room) { spill += add - Math.max(0, room); this.shieldQ[q] = Math.max(this.shieldQ[q], cap); }
        else this.shieldQ[q] += add;
      }
      if (spill > 0) {
        const open = [0, 1, 2, 3].filter((q) => this.shieldQ[q] < cap);
        for (const q of open) this.shieldQ[q] = Math.min(cap, this.shieldQ[q] + spill / open.length);
      }
    } else {
      for (let q = 0; q < 4; q++) this.shieldQ[q] = Math.max(0, this.shieldQ[q] + regen * dt * 0.25);
    }
    for (let q = 0; q < 4; q++) this.shieldQ[q] = Math.min(this.shieldQ[q], cap);
  }

  updateRepair(dt) {
    const G = this.G;
    const R = this.sys.repair;
    let rate = TANK.repair[this.power.repair] * this.eff('repair');
    if (!R.online) {
      R.hp = Math.min(100, R.hp + 1.2 * dt);
      if (R.hp >= 35) { R.online = true; G.ui && G.ui.log('🔧 Repair bay back online', 'good'); }
      this.repairing = 'repair';
      return;
    }
    let target = null;
    if (this.repairPin && this.sys[this.repairPin].hp < 100) target = this.repairPin;
    else {
      let low = 100;
      for (const s of SYSTEMS) {
        const h = this.sys[s].hp + (this.sys[s].online ? 0 : -50);
        if (this.sys[s].hp < 100 && h < low) { low = h; target = s; }
      }
    }
    this.repairing = rate > 0 ? (target || (this.hull < this.hullMax ? 'hull' : null)) : null;
    if (rate <= 0) return;
    if (target) {
      const S = this.sys[target];
      S.hp = Math.min(100, S.hp + rate * dt);
      if (!S.online && S.hp >= 35) {
        S.online = true;
        G.ui && G.ui.log(`${SYSTEM_INFO[target].icon} ${SYSTEM_INFO[target].name} back online`, 'good');
        G.audio.play('build', { vol: G.side === 'tank' ? 1 : 0.3 });
      }
    } else if (this.hull < this.hullMax) this.hull = Math.min(this.hullMax, this.hull + rate * 1.4 * dt);
  }

  updateMove(dt) {
    const G = this.G, T = G.terrain, P = G.pathing;
    const eD = this.eff('drive');
    const p = this.power.drive;
    let vmax = TANK.speed[p] * eD;
    const depth = WATER_LEVEL - T.heightAt(this.x, this.z);
    if (depth > 0.3) vmax *= 0.55;
    const turnMax = (eD > 0 ? TANK.turn[p] * (0.5 + 0.5 * eD) : 0.04);
    while (this.path.length) {
      const w = this.path[0];
      const d = Math.hypot(w.x - this.x, w.z - this.z);
      const nxt = this.path[1];
      if (d < 1.2 || (nxt && d < 4 && P.tankLine(this.x, this.z, nxt.x, nxt.z))) this.path.shift(); else break;
    }
    this.repathT = (this.repathT || 0) - dt;
    if (this.ram && !this.ram.alive) this.ram = null;
    let aim = this.path[0] || (this.ram ? { x: this.ram.x, z: this.ram.z } : null);
    let targetSpeed = 0, turn = 0;
    if (aim) {
      const desired = Math.atan2(aim.x - this.x, aim.z - this.z);
      const err = wrapAngle(desired - this.heading);
      turn = clamp(err * 2.2, -1, 1) * turnMax;
      targetSpeed = vmax * clamp(1 - Math.abs(err) / 0.8, 0, 1);
    }
    // gravity: slower uphill
    const ahead = T.smoothHeightAt(this.x + Math.sin(this.heading) * 6, this.z + Math.cos(this.heading) * 6);
    const behind = T.smoothHeightAt(this.x - Math.sin(this.heading) * 6, this.z - Math.cos(this.heading) * 6);
    targetSpeed *= clamp(1 - (ahead - behind) * 0.06, 0.55, 1.15);
    this.speed += clamp(targetSpeed - this.speed, -2.5 * dt, 1.1 * dt);
    this.turnRate = turn;
    this.heading = wrapAngle(this.heading + turn * dt);
    this.ramming = null;
    if (this.speed > 0.001) {
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
      const nx = this.x + fx * this.speed * dt, nz = this.z + fz * this.speed * dt;
      let blocked = null;
      for (const st of G.swarm.structures) {
        if (!st.alive) continue;
        const dx = st.x - nx, dz = st.z - nz;
        const lz = dx * fx + dz * fz;
        if (lz < 0) continue;
        const cx = Math.cos(this.heading), sx = Math.sin(this.heading);
        const lx = dx * cx - dz * sx;
        if (Math.abs(lx) < TANK.halfW + st.half * 0.8 && lz < TANK.halfL + st.half) { blocked = st; break; }
      }
      if (blocked) {
        this.speed = Math.min(this.speed, 0.15);
        this.ramming = blocked;
        G.swarm.damageStructure(blocked, TANK.ramDps * dt * Math.max(0.3, eD));
        if (Math.random() < dt * 12) {
          const [bx, bz] = this.toWorld(rand(-3, 3), TANK.halfL + 0.5);
          G.fx.sparks(bx, this.y + rand(1, 3), bz, 5, [1, 0.8, 0.4], 6);
          G.fx.debrisBurst(bx, this.y + 2, bz, [0.5, 0.84, 0.8, 0.17, 0.23, 0.33], 2, 4, 0.3);
          G.fx.shake(0.05, bx, bz);
          G.audio.play('crush', { x: bx, z: bz, vol: 0.6 });
        }
      } else if (P.tankOk(nx, nz) || !P.tankOk(this.x, this.z)) {
        this.x = nx; this.z = nz;
      } else if (P.tankOk(nx, this.z)) {
        this.x = nx; this.speed *= 0.7;
      } else if (P.tankOk(this.x, nz)) {
        this.z = nz; this.speed *= 0.7;
      } else {
        this.speed = 0;
        if (this.path.length && this.repathT <= 0) {
          this.repathT = 1.5;
          const g = this.path[this.path.length - 1];
          const ram = this.ram;
          this.moveTo(g.x, g.z);
          this.ram = ram;
        }
      }
    }
    const tl = this.speed + this.turnRate * TANK.halfW, tr = this.speed - this.turnRate * TANK.halfW;
    this.odoL += tl * dt; this.odoR += tr * dt;
    const moving = Math.abs(this.speed) > 0.05 || Math.abs(this.turnRate) > 0.02;
    // crush
    this.crushT -= dt;
    if (moving && this.crushT <= 0) {
      this.crushT = 0.08;
      const inside = (x, z) => this.inHull(x, z, 0.3);
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
      G.swarm.hash.query(this.x, this.z, 9, (u) => {
        if (this.inHull(u.x, u.z, 0.15)) { G.swarm.killUnit(u, 'crush'); this.stats.crushed++; }
      });
      G.foliage.crushIn(this.x, this.z, 9, inside, fx, fz);
      G.props.crushIn(this.x, this.z, 9, inside);
    }
    // tread marks & dust
    this.wearT -= dt;
    if (moving && this.wearT <= 0) {
      this.wearT = 0.3;
      for (const s of [-1, 1]) {
        const [wx, wz] = this.toWorld(s * 3.65, -5.6);
        T.addWear(wx, wz, 0.9, 0.5);
      }
    }
    this.dustT -= dt;
    if (moving && this.dustT <= 0) {
      this.dustT = 0.07;
      for (const s of [-1, 1]) {
        const [wx, wz] = this.toWorld(s * 3.65 + rand(-0.8, 0.8), -6.4);
        const gy = T.heightAt(wx, wz);
        if (gy < WATER_LEVEL) {
          G.fx.splash(wx, WATER_LEVEL, wz, 0.35);
        } else {
          const c = T.topColor(Math.floor(wz) * 128 + Math.floor(wx), new THREE.Color());
          G.fx.dust(wx, gy, wz, [c.r * 1.1 + 0.2, c.g * 1.1 + 0.15, c.b * 1.1 + 0.1], 1.1);
        }
      }
      if (depth > 0.3 && Math.random() < 0.3) G.water.ripple(this.x, this.z, 0.6);
    }
  }

  syncTransform(dt) {
    const T = this.G.terrain;
    const h = this.heading;
    const fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
    const sample = (lx, lz) => T.smoothHeightAt(this.x + rx * lx + fx * lz, this.z + rz * lx + fz * lz);
    const hF = (sample(-3.6, 5) + sample(3.6, 5)) / 2, hB = (sample(-3.6, -5) + sample(3.6, -5)) / 2;
    const hL = (sample(3.6, 4) + sample(3.6, -4)) / 2, hR = (sample(-3.6, 4) + sample(-3.6, -4)) / 2;
    const ty = Math.max((hF + hB + hL + hR) / 4, WATER_LEVEL - 2.2);
    const k = Math.min(1, dt * 4);
    this.y += (ty - this.y) * k;
    this.pitch += (Math.atan2(hF - hB, 10) - this.pitch) * k;
    this.roll += (Math.atan2(hL - hR, 7.3) - this.roll) * k;
    const r = this.view.root;
    r.position.set(this.x, this.y, this.z);
    r.rotation.set(-this.pitch, this.heading, this.roll, 'YXZ');
    r.updateMatrixWorld(true);
  }

  turretPivot() { const [x, z] = this.toWorld(0, 0.8); return [x, z]; }

  pickCannonTarget() {
    const G = this.G;
    const VAL = { scout: 0.6, buggy: 1, rocket: 1.4, mortar: 1.7, sapper: 1.5, jammer: 1.5 };
    let best = null, bestScore = 0;
    for (const u of G.swarm.units) {
      if (!u.alive) continue;
      const d = Math.hypot(u.x - this.x, u.z - this.z);
      if (d < TANK.cannonMin + 4 || d > TANK.cannonRange) continue;
      let score = 0;
      G.swarm.hash.query(u.x, u.z, TANK.cannonSplash - 0.5, (v, dd) => { score += VAL[v.type] * (1 - dd / TANK.cannonSplash); });
      score *= 1 + (u.type === 'mortar' ? 0.3 : 0);
      if (score > bestScore) { bestScore = score; best = u; }
    }
    if (best && bestScore >= 1.5) return best;
    let sBest = null, sd = 1e9;
    for (const st of G.swarm.structures) {
      if (!st.alive) continue;
      const d = Math.hypot(st.x - this.x, st.z - this.z);
      if (d < TANK.cannonRange - 2 && d > TANK.cannonMin && d < sd) { sd = d; sBest = st; }
    }
    return sBest || best;
  }

  updateCannon(dt) {
    const G = this.G, c = this.cannon;
    const p = this.power.cannon, e = this.eff('cannon');
    const reload = TANK.reload[p] / Math.max(0.25, e);
    if (p > 0 && e > 0) c.cool -= dt;
    c.reloadFrac = (p > 0 && e > 0) ? clamp(1 - c.cool / reload, 0, 1) : 0;
    c.recoil = Math.max(0, c.recoil - dt * 2.2);
    if (c.target && !c.target.alive) c.target = null;
    let aim = null;
    if (c.target) aim = c.target;
    else if (c.point) { aim = c.point; c.pointT -= dt; if (c.pointT <= 0) c.point = null; }
    else if (c.auto) {
      c.autoT -= dt;
      if (c.autoT <= 0 || (c.autoAim && !c.autoAim.alive)) { c.autoT = 0.5; c.autoAim = this.pickCannonTarget(); }
      if (c.autoAim && c.autoAim.alive) aim = c.autoAim;
    }
    c.aim = aim;
    const [px, pz] = this.turretPivot();
    let desired = this.heading;
    let dist = 0;
    if (aim) { desired = Math.atan2(aim.x - px, aim.z - pz); dist = Math.hypot(aim.x - px, aim.z - pz); }
    const tr = (e > 0 ? 0.9 * (0.4 + 0.6 * e) : 0.15);
    const err = wrapAngle(desired - c.yaw);
    c.yaw = wrapAngle(c.yaw + clamp(err, -tr * dt, tr * dt));
    c.inRange = aim ? dist >= TANK.cannonMin && dist <= TANK.cannonRange : false;
    // barrel elevation from ballistic arc (visual)
    const T0 = 0.35 + dist / 42;
    c.pitchTarget = aim ? clamp(Math.atan2(0.5 * 18 * T0 * T0, Math.max(1, dist)) * 0.9, 0.02, 0.6) : 0.04;
    c.pitch += (c.pitchTarget - c.pitch) * Math.min(1, dt * 3);
    if (aim && p > 0 && e > 0 && c.cool <= 0 && Math.abs(err) < 0.05 && c.inRange) {
      this.fireCannon(aim, e);
      c.cool = reload;
      if (c.point === aim) c.point = null;
    }
  }

  fireCannon(aim, e) {
    const G = this.G, c = this.cannon;
    this.view.parts.barrel.updateMatrixWorld(true);
    const m = this.view.parts.barrel.localToWorld(new THREE.Vector3(0, 0, 6.4));
    const dir = this.view.parts.barrel.localToWorld(new THREE.Vector3(0, 0, 7.4)).sub(m).normalize();
    let ax = aim.x, az = aim.z;
    let ay = aim.y !== undefined ? aim.y : G.terrain.heightAt(ax, az);
    if (aim.vx !== undefined) { const lead = 0.35 + Math.hypot(ax - m.x, az - m.z) / 42; ax += aim.vx * lead * 0.8; az += aim.vz * lead * 0.8; }
    if (aim.height) ay = aim.y + 1.5;
    const spread = 0.5 + (1 - e) * 3.5 + (Math.abs(this.speed) > 0.3 ? 0.7 : 0);
    const a = Math.random() * 6.28, r = Math.random() * spread;
    ax += Math.cos(a) * r; az += Math.sin(a) * r;
    const d = Math.hypot(ax - m.x, az - m.z);
    const T = 0.35 + d / 42;
    const vx = (ax - m.x) / T, vz = (az - m.z) / T, vy = (ay - m.y + 0.5 * 18 * T * T) / T;
    G.proj.shell(m.x, m.y, m.z, vx, vy, vz, TANK.cannonDmg);
    c.recoil = 1;
    this.heat += TANK.heatShot;
    this.stats.shots++;
    G.fx.muzzle(m.x, m.y, m.z, dir.x, dir.y, dir.z, 2);
    G.fx.flash(m.x, m.y, m.z, 0xffc070, 60, 22, 0.15);
    G.fx.ring(this.x, this.y + 0.2, this.z, 12, 0.5, 0xfff4d6, 0.35);
    G.foliage.blast(m.x, m.z, 7, 0.3);
    G.audio.play('cannon', { x: m.x, z: m.z });
    G.fx.shake(G.side === 'tank' ? 0.22 : 0.12, m.x, m.z);
  }

  updateFlak(dt) {
    const G = this.G;
    const p = this.power.flak, e = this.eff('flak');
    const rate = TANK.flakRate * TANK.flakMul[p] * e;
    const R = TANK.flakRange;
    for (const t of this.flak) {
      t.cool -= dt;
      t.recoil = Math.max(0, t.recoil - dt * 8);
      if (rate <= 0 || t.cool > 0) continue;
      const [wx, wz] = this.toWorld(t.lx, t.lz);
      const wy = this.y + 4.2;
      const inArc = (x, z) => Math.abs(wrapAngle(this.localAngle(x, z) - t.arc)) < 2.1;
      let target = null, best = 1e9, isProj = false;
      for (const pr of G.proj.list) {
        if (!pr.alive || !pr.interceptable) continue;
        const d = Math.hypot(pr.x - wx, pr.y - wy, pr.z - wz);
        if (d < R * 0.8 && d < best && inArc(pr.x, pr.z)) { best = d; target = pr; isProj = true; }
      }
      if (!target) {
        G.swarm.hash.query(wx, wz, R, (u, d) => {
          if (!inArc(u.x, u.z)) return;
          const sc = d - (u.type === 'sapper' ? 10 : 0) - (u.type === 'jammer' ? 4 : 0);
          if (sc < best) { best = sc; target = u; }
        });
      }
      if (!target) { t.cool = 0.12; continue; }
      t.yaw = Math.atan2(target.x - wx, target.z - wz);
      G.proj.flak(wx, wy, wz, target, isProj, TANK.flakDmg);
      t.cool = (1 / rate) * rand(0.8, 1.2);
      t.recoil = 1;
      if (Math.random() < 0.5) G.fx.muzzle(wx + Math.sin(t.yaw) * 1.3, wy + 0.3, wz + Math.cos(t.yaw) * 1.3, Math.sin(t.yaw), 0.1, Math.cos(t.yaw), 0.4);
      G.audio.play('flak', { x: wx, z: wz });
    }
  }

  updateDeath(dt) {
    const G = this.G;
    this.deathT += dt;
    const t = this.deathT;
    if (t < 3.2 && Math.random() < dt * 7) {
      const [x, z] = this.toWorld(rand(-4, 4), rand(-6, 6));
      G.fx.explosion(x, this.y + rand(1, 4), z, rand(0.6, 1.2));
      G.audio.play('explode', { x, z, size: 1 });
    }
    if (t >= 3.2 && !this.boomed) {
      this.boomed = true;
      const cols = G.terrain.crater(this.x, this.z, 7, 2.5);
      G.fx.explosion(this.x, this.y + 3, this.z, 4, { debris: cols });
      G.fx.debrisBurst(this.x, this.y + 3, this.z, [0.95, 0.7, 0.24, 0.88, 0.33, 0.24, 0.28, 0.29, 0.34], 60, 16, 0.6);
      for (let k = 0; k < 30; k++) G.fx.puff(this.x + rand(-5, 5), this.y + rand(2, 8), this.z + rand(-5, 5), [0.2, 0.19, 0.18], 3.5, 5, 3);
      G.audio.play('explode', { x: this.x, z: this.z, size: 3 });
      G.fx.shake(1, this.x, this.z);
      for (const m of Object.values(this.view.mats)) m.color.setRGB(0.25, 0.23, 0.22);
      this.view.parts.turret.rotation.z = 0.5;
      this.view.parts.turret.position.y += 0.8;
      this.view.parts.lights.visible = false; this.view.parts.core.visible = false;
      this.bubble.visible = false;
    }
    if (Math.random() < dt * 8) {
      const [x, z] = this.toWorld(rand(-3, 3), rand(-4, 4));
      G.fx.puff(x, this.y + 4, z, [0.18, 0.17, 0.16], 2.5, 4, 2.5);
      if (t < 20) G.fx.ember(x, this.y + 3, z);
    }
  }

  // ------------------------------------------------------------ view
  buildView() {
    const G = this.G;
    const v = buildTank();
    this.view = v;
    G.scene.add(v.root);
    this.hits = []; this.hitIdx = 0;
    for (let n = 0; n < 8; n++) this.hits.push(new THREE.Vector4(0, 0, 0, -1));
    this.bubbleMat = new THREE.ShaderMaterial({
      uniforms: { uQ: { value: new THREE.Vector4() }, uTime: { value: 0 }, uHits: { value: this.hits }, uFlicker: { value: 1 }, uFar: { value: 0 } },
      vertexShader: bubbleVert, fragmentShader: bubbleFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const geo = new THREE.IcosahedronGeometry(1, 2);
    this.bubble = new THREE.Mesh(geo, this.bubbleMat);
    this.bubble.scale.set(TANK.bubble[0], TANK.bubble[1], TANK.bubble[2]);
    this.bubble.position.y = 2.4;
    this.bubble.renderOrder = 5;
    v.root.add(this.bubble);
    this.cleatM = new THREE.Matrix4();
    this.selRing = null;
  }

  render(dt, vt) {
    const G = this.G, P = this.view.parts, c = this.cannon;
    P.turret.rotation.y = wrapAngle(c.yaw - this.heading);
    P.barrel.rotation.x = -c.pitch;
    P.barrel.position.z = 2.1 - c.recoil * c.recoil * 0.9;
    this.flak.forEach((t, i) => {
      const f = P.flak[i];
      const target = wrapAngle(t.yaw - this.heading);
      f.head.rotation.y += wrapAngle(target - f.head.rotation.y) * Math.min(1, dt * 10);
      f.head.position.y = 0.45 - t.recoil * 0.08;
    });
    P.dish.rotation.y += dt * (0.5 + this.power.shield * 0.8) * (this.sys.shield.online ? 1 : 0.1);
    P.flag.rotation.y = Math.sin(vt * 5) * 0.25 + 0.2;
    P.flag.children[0].rotation.x = Math.sin(vt * 7) * 0.05;
    // cleats
    let n = 0;
    const L = 12.4, cnt = 12, sp = L / cnt;
    for (const s of [1, -1]) {
      const odo = s === 1 ? this.odoL : this.odoR;
      for (let k = 0; k < cnt; k++) {
        let z = ((k * sp + odo * 0.5) % L + L) % L - L / 2;
        this.cleatM.makeTranslation(s * 3.65, 2.0, z);
        P.cleats.setMatrixAt(n++, this.cleatM);
      }
    }
    P.cleats.count = n;
    P.cleats.instanceMatrix.needsUpdate = true;
    // reactor glow: cyan -> orange -> red with heat, flicker on scram
    const heat = this.heat / 100;
    const core = P.core.material.color;
    if (this.dead) core.setRGB(0, 0, 0);
    else if (this.scram > 0) core.setRGB(Math.random() < 0.5 ? 0.1 : 0.9, 0.1, 0.05);
    else {
      const pulse = 0.8 + 0.2 * Math.sin(vt * (4 + heat * 10));
      core.setRGB(lerp(0.3, 1.6, heat) * pulse, lerp(1.4, 0.5, heat) * pulse, lerp(1.6, 0.15, heat) * pulse);
      if (!this.sys.reactor.online) core.multiplyScalar(0.3);
    }
    P.orb.material.color.setRGB(0.4, 1.2 * (this.power.shield / 4 + 0.2), 1.6 * (this.power.shield / 4 + 0.2));
    // system tints
    if (!this.dead) {
      for (const s of ['drive', 'cannon', 'flak', 'shield', 'reactor', 'repair']) {
        const m = this.view.mats[s], S = this.sys[s];
        if (!m) continue;
        const base = S.online ? 1 : 0.42;
        const fl = S.flash;
        m.color.setRGB(base + fl * 1.2, base * (1 - fl * 0.3) + (S.jam > 0 ? 0.1 : 0), base * (1 - fl * 0.4) + (S.jam > 0 ? 0.5 * (Math.sin(vt * 30) * 0.5 + 0.5) : 0));
      }
      const hf = this.hullFlash || 0;
      this.view.mats.hull.color.setRGB(1 + hf, 1 - hf * 0.2, 1 - hf * 0.3);
    }
    // damage effects
    if (!this.dead) {
      for (const s of SYSTEMS) {
        const S = this.sys[s];
        if (S.hp >= 65) continue;
        S.fxT -= dt;
        if (S.fxT > 0) continue;
        const w = this.worldPart(s);
        if (!S.online) {
          S.fxT = 0.06;
          G.fx.ember(w.x, w.y, w.z);
          G.fx.puff(w.x, w.y + 0.5, w.z, [0.16, 0.15, 0.15], 1.2, 2.2, 2.4);
          if (Math.random() < 0.1) G.fx.sparks(w.x, w.y, w.z, 6, [1, 0.85, 0.4], 6);
        } else if (S.hp < 35) {
          S.fxT = 0.12;
          G.fx.puff(w.x, w.y + 0.3, w.z, [0.25, 0.24, 0.23], 1.0, 2.0, 2);
          if (Math.random() < 0.3) G.fx.ember(w.x, w.y, w.z);
        } else {
          S.fxT = 0.3;
          G.fx.puff(w.x, w.y + 0.3, w.z, [0.55, 0.55, 0.55], 0.8, 1.6, 1.5);
        }
      }
      // exhaust
      this.exhaustT -= dt;
      if (this.exhaustT <= 0) {
        this.exhaustT = this.overdrive ? 0.05 : 0.16;
        for (const s of [-1, 1]) {
          _v.set(s * 1.9, 5.9, -5.45); this.view.root.localToWorld(_v);
          const dark = this.overdrive ? 0.25 : 0.55;
          if (this.scram > 0) G.fx.puff(_v.x, _v.y, _v.z, [0.95, 0.95, 0.97], 1.4, 1.2, 4);
          else G.fx.puff(_v.x, _v.y, _v.z, [dark, dark, dark * 1.02], 0.5 + this.usedTotal() * 0.03, 1.4, 2);
          if (this.overdrive && Math.random() < 0.4) G.fx.ember(_v.x, _v.y, _v.z);
        }
      }
      // repair drones
      this.view.parts.drones.forEach((d, i) => {
        d.t += dt;
        let tx, ty, tz;
        if (this.repairing && this.repairing !== 'hull' && this.repairing) {
          const pp = PART_POS[this.repairing][i % PART_POS[this.repairing].length];
          tx = pp[0] + Math.sin(d.t * 2 + i) * 0.6; ty = pp[1] + 1.0 + Math.sin(d.t * 3) * 0.2; tz = pp[2] + Math.cos(d.t * 2 + i) * 0.6;
          if (Math.random() < dt * 10) {
            _v.set(pp[0], pp[1], pp[2]); this.view.root.localToWorld(_v);
            G.fx.sparks(_v.x, _v.y, _v.z, 2, [0.7, 1, 0.6], 3);
          }
        } else if (this.repairing === 'hull') {
          tx = Math.sin(d.t * 0.7 + i * 3) * 3; ty = 4.5; tz = Math.cos(d.t * 0.5 + i * 3) * 5;
        } else {
          tx = -1.95 + (i ? 0.3 : -0.3); ty = 4.15; tz = -2.9;
        }
        const o = d.obj.position;
        o.x += (tx - o.x) * Math.min(1, dt * 3); o.y += (ty - o.y) * Math.min(1, dt * 3); o.z += (tz - o.z) * Math.min(1, dt * 3);
        d.obj.rotation.y += dt * 3;
        d.light.material.color.setRGB(0.6, 1.5 * (0.6 + 0.4 * Math.sin(vt * 8 + i)), 0.5);
      });
    }
    // shield bubble
    const u = this.bubbleMat.uniforms;
    u.uTime.value = vt;
    u.uFar.value = clamp((G.cam.dist - 50) / 120, 0, 1);
    const sm = TANK.shieldMax;
    u.uQ.value.set(this.shieldQ[0] / sm, this.shieldQ[1] / sm, this.shieldQ[2] / sm, this.shieldQ[3] / sm);
    u.uFlicker.value = this.sys.shield.online ? (this.sys.shield.hp < 35 ? (Math.random() < 0.2 ? 0.2 : 1) : 1) : 0.3;
    for (const h of this.hits) if (h.w >= 0) { h.w += dt; if (h.w > 0.7) h.w = -1; }
    // engine
    G.audio.engineLevel(this.dead ? 0 : 0.35 + Math.abs(this.speed) * 0.3, this.x, this.z);
  }
}
