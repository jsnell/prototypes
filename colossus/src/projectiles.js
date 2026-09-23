// Everything that flies: tank shells, flak tracers, bullets, missiles, mortar bombs.
import * as THREE from 'three';
import { WATER_LEVEL, TANK } from './config.js';
import { VB, P } from './models.js';
import { rand, clamp } from './util.js';

const GRAV_SHELL = 18, GRAV_MORTAR = 20;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);

export class Projectiles {
  constructor(G) {
    this.G = G;
    this.list = [];
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.glow = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ toneMapped: false }), 800);
    this.glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(800 * 3), 3);
    this.glow.frustumCulled = false;
    const mv = new VB();
    mv.box(0, 0, 0, 0.16, 0.16, 0.7, P.white).box(0, 0, 0.4, 0.12, 0.12, 0.14, P.red).box(0, 0, -0.3, 0.3, 0.05, 0.14, P.steelDark).box(0, 0, -0.3, 0.05, 0.3, 0.14, P.steelDark);
    this.missiles = new THREE.InstancedMesh(mv.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), 200);
    this.missiles.frustumCulled = false;
    const sv = new VB().box(0, 0, 0, 0.35, 0.35, 0.6, 0x3d404a).box(0, 0, 0.3, 0.26, 0.26, 0.1, 0xf2b33d);
    this.shells = new THREE.InstancedMesh(sv.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), 200);
    this.shells.frustumCulled = false;
    G.scene.add(this.glow); G.scene.add(this.missiles); G.scene.add(this.shells);
  }

  add(o) {
    o.alive = true; o.life = 0; o.trailT = 0;
    this.list.push(o);
    return o;
  }

  // Colossus main gun
  shell(x, y, z, vx, vy, vz, dmg) {
    return this.add({ type: 'shell', x, y, z, vx, vy, vz, dmg });
  }
  flak(x, y, z, target, isProj, dmg) {
    const tx = target.x, ty = (target.y || 0) + (isProj ? 0 : 0.5), tz = target.z;
    const d = Math.hypot(tx - x, ty - y, tz - z) || 1;
    const sp = 90;
    return this.add({ type: 'flak', x, y, z, vx: (tx - x) / d * sp, vy: (ty - y) / d * sp, vz: (tz - z) / d * sp, target, isProj, dmg, dist: d, travelled: 0 });
  }
  // unit weapons: aim is a world point on the tank
  bullet(x, y, z, ax, ay, az, speed, dmg, kind, spread, src) {
    let dx = ax - x, dy = ay - y, dz = az - z;
    const d = Math.hypot(dx, dy, dz) || 1;
    dx = dx / d + rand(-spread, spread); dy = dy / d + rand(-spread, spread); dz = dz / d + rand(-spread, spread);
    const l = Math.hypot(dx, dy, dz);
    return this.add({ type: 'bullet', kind, x, y, z, vx: dx / l * speed, vy: dy / l * speed, vz: dz / l * speed, dmg, sx: src.x, sz: src.z });
  }
  missile(x, y, z, localAim, dmg, src) {
    const G = this.G, t = G.tank;
    const dx = t.x - x, dz = t.z - z, d = Math.hypot(dx, dz) || 1;
    return this.add({ type: 'missile', x, y, z, vx: dx / d * 6, vy: 5, vz: dz / d * 6, aim: localAim, dmg, sx: src.x, sz: src.z, hp: 1, interceptable: true });
  }
  mortar(x, y, z, tx, ty, tz, dmg, src) {
    const d = Math.hypot(tx - x, tz - z);
    const T = 1.6 + d / 26;
    const vx = (tx - x) / T, vz = (tz - z) / T;
    const vy = (ty - y + 0.5 * GRAV_MORTAR * T * T) / T;
    return this.add({ type: 'mortar', x, y, z, vx, vy, vz, dmg, sx: src.x, sz: src.z, hp: 1, interceptable: true });
  }

  update(dt) {
    const G = this.G;
    for (const p of this.list) {
      if (!p.alive) continue;
      p.life += dt;
      switch (p.type) {
        case 'shell': this.updShell(p, dt); break;
        case 'flak': this.updFlak(p, dt); break;
        case 'bullet': this.updBullet(p, dt); break;
        case 'missile': this.updMissile(p, dt); break;
        case 'mortar': this.updMortar(p, dt); break;
      }
    }
    if (this.list.length > 50 && this.list.some((p) => !p.alive)) this.list = this.list.filter((p) => p.alive);
    else if (this.list.length && !this.list[0].alive) this.list = this.list.filter((p) => p.alive);
  }

  updShell(p, dt) {
    const G = this.G, T = G.terrain;
    const steps = Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy, p.vz) * dt / 0.8));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      p.vy -= GRAV_SHELL * h;
      p.x += p.vx * h; p.y += p.vy * h; p.z += p.vz * h;
      const gy = T.heightAt(p.x, p.z);
      if (p.y <= Math.max(gy, WATER_LEVEL - 0.2) || p.life > 6) { this.shellImpact(p); return; }
      // direct hits
      let hit = null;
      G.swarm.hash.query(p.x, p.z, 1.1, (u) => { if (!hit && Math.abs(u.y + 0.4 - p.y) < 1.2) hit = u; });
      if (!hit) for (const st of G.swarm.structures) if (st.alive && Math.abs(p.x - st.x) < st.half && Math.abs(p.z - st.z) < st.half && p.y < st.y + st.height) hit = st;
      if (!hit) for (const hs of G.props.houses) if (hs.alive && Math.abs(p.x - hs.x) < 1.5 && Math.abs(p.z - hs.z) < 1.4 && p.y < hs.y + 3) hit = hs;
      if (hit) { this.shellImpact(p); return; }
    }
    p.trailT -= dt;
    if (p.trailT <= 0) { p.trailT = 0.025; G.fx.trail(p.x, p.y, p.z, 0.9, [0.55, 0.55, 0.55]); }
  }

  shellImpact(p) {
    p.alive = false;
    const G = this.G, T = G.terrain;
    const gy = T.heightAt(p.x, p.z);
    const y = Math.max(p.y, gy);
    const water = gy < WATER_LEVEL && y < WATER_LEVEL + 0.6;
    const R = TANK.cannonSplash;
    G.swarm.hash.query(p.x, p.z, R, (u, d) => {
      G.swarm.damageUnit(u, p.dmg * (1 - 0.7 * d / R), 'shell', p.x, p.z);
    });
    for (const st of G.swarm.structures) {
      if (!st.alive) continue;
      const dx = Math.max(0, Math.abs(p.x - st.x) - st.half), dz = Math.max(0, Math.abs(p.z - st.z) - st.half);
      const d = Math.hypot(dx, dz);
      if (d < R) G.swarm.damageStructure(st, p.dmg * 1.25 * (1 - 0.6 * d / R));
    }
    G.props.blast(p.x, p.z, R * 0.8);
    const cols = T.crater(p.x, p.z, 3.1, water ? 1.3 : 2.2);
    G.fx.explosion(p.x, y + 0.2, p.z, 1.55, { debris: cols });
    G.audio.play('explode', { x: p.x, z: p.z, size: 1.6 });
  }

  updFlak(p, dt) {
    const G = this.G;
    const t = p.target;
    const step = 90 * dt;
    // home onto the live target position so tracers look right
    if (t.alive) {
      const ty = (t.y || 0) + (p.isProj ? 0 : 0.5);
      const dx = t.x - p.x, dy = ty - p.y, dz = t.z - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d <= step) {
        p.alive = false;
        const e = G.tank.eff('flak');
        if (p.isProj) {
          if (Math.random() < 0.5 + 0.2 * e) {
            t.alive = false;
            G.fx.explosion(t.x, t.y, t.z, 0.35);
            G.fx.sparks(t.x, t.y, t.z, 10, [1, 0.8, 0.4], 6);
            G.audio.play('pop', { x: t.x, z: t.z, vol: 0.8 });
            G.stats.intercepts++;
          } else G.fx.sparks(p.x + dx, p.y + dy, p.z + dz, 3, [1, 0.9, 0.5], 3);
        } else {
          if (Math.random() < 0.82) G.swarm.damageUnit(t, p.dmg, 'flak', G.tank.x, G.tank.z);
          else G.fx.dust(t.x + rand(-1, 1), G.terrain.heightAt(t.x, t.z), t.z + rand(-1, 1), [0.8, 0.7, 0.5], 0.6);
          G.fx.sparks(t.x, t.y + 0.5, t.z, 2, [1, 0.9, 0.5], 3);
        }
        return;
      }
      p.vx = dx / d * 90; p.vy = dy / d * 90; p.vz = dz / d * 90;
    }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.life > 0.6 || p.y < G.terrain.heightAt(p.x, p.z)) p.alive = false;
  }

  // shared: did something at (x,y,z) hit the tank? returns true when consumed
  tankContact(p) {
    const G = this.G, t = G.tank;
    if (!t || t.dead) return false;
    const [lx, lz] = t.toLocal(p.x, p.z);
    const ly = p.y - (t.y + 2.4);
    const B = TANK.bubble;
    const e = (lx / B[0]) ** 2 + (ly / B[1]) ** 2 + (lz / B[2]) ** 2;
    if (e > 1) return false;
    const q = t.quadrant(p.sx, p.sz);
    if (t.shieldQ[q] > 0.5) {
      t.takeHit(p.dmg, p.x, p.y, p.z, p.type === 'mortar' ? 'mortar' : (p.kind || p.type), p.sx, p.sz);
      return true;
    }
    if (Math.abs(lx) <= TANK.halfW && Math.abs(lz) <= TANK.halfL && p.y <= t.y + 4.6 && p.y >= t.y - 0.5) {
      t.takeHit(p.dmg, p.x, p.y, p.z, p.type === 'mortar' ? 'mortar' : (p.kind || p.type), p.sx, p.sz);
      return true;
    }
    return false;
  }

  updBullet(p, dt) {
    const G = this.G, T = G.terrain;
    const sp = Math.hypot(p.vx, p.vy, p.vz);
    const steps = Math.max(1, Math.ceil(sp * dt / 0.6));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      p.x += p.vx * h; p.y += p.vy * h; p.z += p.vz * h;
      if (this.tankContact(p)) { p.alive = false; return; }
      const gy = T.heightAt(p.x, p.z);
      if (p.y < gy) {
        p.alive = false;
        G.fx.dust(p.x, gy, p.z, [0.8, 0.7, 0.55], 0.5);
        if (p.kind === 'gun') { G.fx.sparks(p.x, gy + 0.2, p.z, 3); T.addScorch(p.x, p.z, 0.8, 0.3); }
        return;
      }
      if (p.y < WATER_LEVEL && gy < WATER_LEVEL) { p.alive = false; G.fx.splash(p.x, WATER_LEVEL, p.z, 0.3); return; }
    }
    if (p.life > 1.5) p.alive = false;
  }

  updMissile(p, dt) {
    const G = this.G, t = G.tank, T = G.terrain;
    if (p.hp <= 0) { p.alive = false; return; }
    let tx = p.x + p.vx, ty = p.y, tz = p.z + p.vz;
    if (t && !t.dead) {
      const w = t.toWorld(p.aim[0], p.aim[2]);
      tx = w[0]; ty = t.y + p.aim[1]; tz = w[1];
    }
    const dx = tx - p.x, dy = ty - p.y, dz = tz - p.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const sp = Math.min(17, 7 + p.life * 14);
    const turn = Math.min(1, dt * (p.life < 0.35 ? 0.8 : 4.5));
    let vx = p.vx + (dx / d * sp - p.vx) * turn, vy = p.vy + (dy / d * sp - p.vy) * turn, vz = p.vz + (dz / d * sp - p.vz) * turn;
    if (p.life < 0.35) vy += 8 * dt;
    const l = Math.hypot(vx, vy, vz) || 1;
    p.vx = vx / l * sp; p.vy = vy / l * sp; p.vz = vz / l * sp;
    const steps = Math.max(1, Math.ceil(sp * dt / 0.6));
    for (let s = 0; s < steps; s++) {
      p.x += p.vx * dt / steps; p.y += p.vy * dt / steps; p.z += p.vz * dt / steps;
      if (this.tankContact(p)) {
        p.alive = false;
        G.fx.explosion(p.x, p.y, p.z, 0.55);
        G.audio.play('explode', { x: p.x, z: p.z, size: 0.6, vol: 0.7 });
        return;
      }
      if (p.y < T.heightAt(p.x, p.z) || p.life > 7) {
        p.alive = false;
        const cols = T.crater(p.x, p.z, 1.3, 0.8);
        G.fx.explosion(p.x, Math.max(p.y, T.heightAt(p.x, p.z)), p.z, 0.6, { debris: cols });
        G.audio.play('explode', { x: p.x, z: p.z, size: 0.6, vol: 0.7 });
        return;
      }
    }
    p.trailT -= dt;
    if (p.trailT <= 0) { p.trailT = 0.02; G.fx.trail(p.x - p.vx * 0.03, p.y - p.vy * 0.03, p.z - p.vz * 0.03, 0.8); }
  }

  updMortar(p, dt) {
    const G = this.G, T = G.terrain;
    if (p.hp <= 0) { p.alive = false; return; }
    p.vy -= GRAV_MORTAR * dt;
    const steps = Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy, p.vz) * dt / 0.7));
    for (let s = 0; s < steps; s++) {
      p.x += p.vx * dt / steps; p.y += p.vy * dt / steps; p.z += p.vz * dt / steps;
      if (p.vy < 0 && this.tankContact(p)) {
        p.alive = false;
        G.fx.explosion(p.x, p.y, p.z, 0.8);
        G.audio.play('explode', { x: p.x, z: p.z, size: 0.8 });
        return;
      }
      const gy = T.heightAt(p.x, p.z);
      if (p.y < Math.max(gy, WATER_LEVEL - 0.3) || p.life > 9) {
        p.alive = false;
        const t = G.tank;
        if (t && !t.dead && t.distToHull(p.x, p.z) < 2.2) t.takeHit(p.dmg * 0.55, p.x, p.y, p.z, 'mortar', p.sx, p.sz);
        const water = gy < WATER_LEVEL;
        const cols = T.crater(p.x, p.z, 1.9, water ? 0.8 : 1.4);
        G.fx.explosion(p.x, Math.max(gy, p.y), p.z, 0.9, { debris: cols });
        G.props.blast(p.x, p.z, 1.5);
        G.audio.play('explode', { x: p.x, z: p.z, size: 0.9 });
        return;
      }
    }
    p.trailT -= dt;
    if (p.trailT <= 0) { p.trailT = 0.05; G.fx.trail(p.x, p.y, p.z, 0.55, [0.8, 0.8, 0.8]); }
  }

  render() {
    let g = 0, mi = 0, si = 0;
    const GA = this.glow.instanceColor.array;
    for (const p of this.list) {
      if (!p.alive) continue;
      _d.set(p.vx, p.vy, p.vz);
      const sp = _d.length();
      if (sp < 1e-4) continue;
      _d.divideScalar(sp);
      _q.setFromUnitVectors(_z, _d);
      _p.set(p.x, p.y, p.z);
      if (p.type === 'missile') {
        _m.compose(_p, _q, _s.set(1.2, 1.2, 1.2)); this.missiles.setMatrixAt(mi++, _m);
        // exhaust glow
        _p.set(p.x - _d.x * 0.55, p.y - _d.y * 0.55, p.z - _d.z * 0.55);
        _m.compose(_p, _q, _s.set(0.22, 0.22, 0.4 + Math.random() * 0.3)); this.glow.setMatrixAt(g, _m);
        GA[g * 3] = 1; GA[g * 3 + 1] = 0.7; GA[g * 3 + 2] = 0.25; g++;
      } else if (p.type === 'shell' || p.type === 'mortar') {
        _m.compose(_p, _q, _s.set(p.type === 'shell' ? 1.2 : 0.9, p.type === 'shell' ? 1.2 : 0.9, 1.1)); this.shells.setMatrixAt(si++, _m);
      } else {
        const flak = p.type === 'flak';
        const len = flak ? 1.6 : (p.kind === 'mg' ? 0.8 : 1.1);
        const w = flak ? 0.13 : (p.kind === 'mg' ? 0.08 : 0.14);
        _m.compose(_p, _q, _s.set(w, w, len)); this.glow.setMatrixAt(g, _m);
        if (flak) { GA[g * 3] = 1; GA[g * 3 + 1] = 0.78; GA[g * 3 + 2] = 0.3; }
        else { GA[g * 3] = 0.5; GA[g * 3 + 1] = 1; GA[g * 3 + 2] = 0.95; }
        g++;
      }
      if (g >= 799 || mi >= 199 || si >= 199) break;
    }
    this.glow.count = g; this.missiles.count = mi; this.shells.count = si;
    this.glow.instanceMatrix.needsUpdate = true; this.glow.instanceColor.needsUpdate = true;
    this.missiles.instanceMatrix.needsUpdate = true; this.shells.instanceMatrix.needsUpdate = true;
  }
}
