// AI opponents: a swarm commander and a Colossus captain.
import { UNITS, TANK, POWERED, SYSTEMS, WATER_LEVEL } from './config.js';
import { clamp, rand, weighted, wrapAngle, pick } from './util.js';

const QUAD_BEARING = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // front, right, rear, left (local angle)

// ======================================================================= Swarm AI
export class SwarmAI {
  constructor(G, diff) {
    this.G = G; this.diff = diff;
    this.t = 0; this.next = 0;
    this.reserve = new Set();
    this.squads = [];
    this.pickType = null;
    this.lastBearing = null;
  }
  onSpawn(u, f) { this.reserve.add(u); u.squad = null; }
  onUnitLost(u) { this.reserve.delete(u); }

  update(dt) {
    this.t += dt;
    if (this.t < this.next) return;
    this.next = this.t + 0.5 * this.diff.think;
    this.economy();
    this.manage();
  }

  weights() {
    const G = this.G, t = G.tank, S = G.swarm;
    const w = { scout: 1.0, buggy: 3, rocket: 2.4, mortar: 1.4, sapper: 1.6, jammer: 0.8 };
    if (!t || t.dead) return w;
    if (t.power.flak >= 3) { w.mortar *= 1.6; w.buggy *= 1.3; w.sapper *= 0.6; w.rocket *= 0.8; }
    if (!t.sys.flak.online) { w.sapper *= 2; w.rocket *= 1.6; }
    const sh = t.shieldQ.reduce((a, b) => a + b, 0) / (4 * TANK.shieldMax);
    if (sh > 0.55) { w.jammer *= 2; w.scout *= 1.5; }
    if (t.sys.drive.hp > 60) w.sapper *= 1.3;
    const counts = {};
    for (const u of S.units) if (u.alive) counts[u.type] = (counts[u.type] || 0) + 1;
    const alive = S.aliveCount() || 1;
    if ((counts.mortar || 0) / alive > 0.25) w.mortar *= 0.2;
    if ((counts.jammer || 0) > 5) w.jammer *= 0.3;
    if (this.diff.smart === 0) { for (const k in w) w[k] = 1; }
    return w;
  }

  economy() {
    const S = this.G.swarm;
    for (let n = 0; n < 4; n++) {
      if (!this.pickType) this.pickType = weighted(this.weights());
      const fs = S.factories;
      if (!fs.length) return;
      if (S.queuedCount() >= fs.length * 2) return;
      let f = fs[0];
      for (const q of fs) if (q.queue.length < f.queue.length) f = q;
      const r = S.queueUnit(this.pickType, f);
      if (r !== 'ok') return;
      this.pickType = null;
    }
  }

  // bearing (local angle) that looks juiciest right now
  chooseBearing(avoid = []) {
    const t = this.G.tank;
    let best = 2, bs = -1e9;
    for (let q = 0; q < 4; q++) {
      let s = (1 - t.shieldQ[q] / TANK.shieldMax) * 2 + (q === 2 ? 1.0 : 0) + (q === 1 || q === 3 ? 0.4 : 0);
      if (q === 2) s += (1 - t.sys.reactor.hp / 100) * 1.5;
      if (q === 1 || q === 3) s += (1 - t.sys.drive.hp / 100) * 0.8;
      for (const b of avoid) if (Math.abs(wrapAngle(QUAD_BEARING[q] - b)) < 1) s -= 1.2;
      s += rand(0, this.diff.smart ? 0.6 : 3);
      if (s > bs) { bs = s; best = q; }
    }
    return wrapAngle(QUAD_BEARING[best] + rand(-0.35, 0.35));
  }

  manage() {
    const G = this.G, S = G.swarm, t = G.tank;
    if (!t || t.dead) return;
    for (const u of this.reserve) if (!u.alive) this.reserve.delete(u);
    // is a structure under threat?
    let threatened = false;
    for (const st of S.structures) if (st.alive && Math.hypot(st.x - t.x, st.z - t.z) < 42) threatened = true;
    const launch = Math.min(22, 6 + Math.floor(this.t / 25)) * (this.diff.smart === 2 ? 1.1 : 1);
    if (this.reserve.size && (threatened || this.reserve.size >= launch)) {
      const units = [...this.reserve];
      this.reserve.clear();
      const avoid = this.squads.filter((q) => q.units.length > 2).map((q) => q.bearing);
      const sq = { units, bearing: this.chooseBearing(avoid), state: 'stage', stageT: 0, engageT: 0, rethink: 0 };
      for (const u of units) u.squad = sq;
      this.squads.push(sq);
      if (threatened || this.diff.smart === 0) this.engage(sq);
      else this.stage(sq);
    }
    for (const sq of this.squads) {
      sq.units = sq.units.filter((u) => u.alive);
      if (!sq.units.length) continue;
      const dt = 0.5 * this.diff.think;
      if (sq.state === 'stage') {
        sq.stageT += dt;
        const { x, z } = this.stagePoint(sq);
        let near = 0;
        for (const u of sq.units) if (Math.hypot(u.x - x, u.z - z) < 16) near++;
        let close = 0;
        for (const u of sq.units) if (t.distToHull(u.x, u.z) < TANK.cannonRange) close++;
        if (near >= sq.units.length * 0.7 || sq.stageT > 20 || close >= sq.units.length * 0.5) this.engage(sq);
        else if ((sq.stageT % 3) < dt) this.stage(sq); // refresh staging point as the tank moves
      } else {
        sq.engageT += dt;
        // hold sappers until the others are stuck in, then release
        if (sq.sappersHeld && sq.engageT > 4) {
          sq.sappersHeld = false;
          const saps = sq.units.filter((u) => u.type === 'sapper');
          G.swarm.orderEngage(saps, sq.bearing, 0.6);
        }
        sq.rethink += dt;
        if (this.diff.smart && sq.rethink > 6) {
          sq.rethink = 0;
          // swing around toward a weaker facing if ours is well shielded
          const q = t.quadrant(t.x + Math.sin(t.heading + sq.bearing) * 20, t.z + Math.cos(t.heading + sq.bearing) * 20);
          if (t.shieldQ[q] > TANK.shieldMax * 0.6) {
            sq.bearing = this.chooseBearing(this.squads.filter((o) => o !== sq && o.units.length > 2).map((o) => o.bearing));
            this.engage(sq, true);
          }
        }
      }
    }
    this.squads = this.squads.filter((q) => q.units.length > 0);
  }

  stagePoint(sq) {
    const t = this.G.tank;
    const ang = t.heading + sq.bearing;
    const lead = 6 * t.speed;
    return {
      x: clamp(t.x + Math.sin(ang) * 72 + Math.sin(t.heading) * lead, 6, 122),
      z: clamp(t.z + Math.cos(ang) * 72 + Math.cos(t.heading) * lead, 6, 170),
    };
  }
  stage(sq) {
    const { x, z } = this.stagePoint(sq);
    const movers = sq.units.filter((u) => u.type !== 'mortar');
    this.G.swarm.orderMove(movers, x, z);
    const mortars = sq.units.filter((u) => u.type === 'mortar');
    this.G.swarm.orderEngage(mortars, sq.bearing, 1.4);
  }
  engage(sq, keepSappers = false) {
    sq.state = 'engage'; sq.engageT = 0;
    const S = this.G.swarm;
    const others = sq.units.filter((u) => u.type !== 'sapper');
    const saps = sq.units.filter((u) => u.type === 'sapper');
    S.orderEngage(others, sq.bearing, this.diff.smart === 2 ? 1.1 : 0.9);
    if (this.diff.smart && saps.length && others.length > 2 && !keepSappers) {
      sq.sappersHeld = true;
      // loiter at standoff range
      const t = this.G.tank;
      const ang = t.heading + sq.bearing;
      S.orderMove(saps, clamp(t.x + Math.sin(ang) * 26, 4, 124), clamp(t.z + Math.cos(ang) * 26, 4, 172));
    } else if (!keepSappers || !sq.sappersHeld) S.orderEngage(saps, sq.bearing, 0.6);
  }
}

// ======================================================================= Tank AI
export class TankAI {
  constructor(G, diff) {
    this.G = G; this.diff = diff;
    this.t = 0; this.nextPower = 0; this.nextPlan = 0;
    this.goal = null;
    this.hold = false;
  }
  onUnitLost() {}

  update(dt) {
    const G = this.G, t = G.tank;
    if (!t || t.dead) return;
    this.t += dt;
    if (this.t >= this.nextPlan) { this.nextPlan = this.t + 2; this.plan(); }
    if (this.t >= this.nextPower) { this.nextPower = this.t + 1.0 * this.diff.think; this.power(); }
  }

  plan() {
    const G = this.G, t = G.tank, S = G.swarm;
    const alive = S.structures.filter((s) => s.alive);
    if (!alive.length) return;
    // go for the nearest structure, preferring ones in the forward direction (toward the CP)
    let best = null, bs = 1e9;
    for (const s of alive) {
      const d = Math.hypot(s.x - t.x, s.z - t.z) + (s.kind === 'cp' ? -10 : 0) + Math.max(0, t.z - s.z) * 1.5;
      if (d < bs) { bs = d; best = s; }
    }
    const d = Math.hypot(best.x - t.x, best.z - t.z);
    // mortars outrange the main gun: go and squash them when they start landing hits
    if (this.hunting && (!this.hunting.alive || t.mortarDmg < 5)) { this.hunting = null; if (t.cannon.target && !t.cannon.target.height) t.cannon.target = null; this.goal = null; }
    if (this.diff.smart && d > 26 && t.mortarDmg > 25) {
      let m = null, md = 1e9;
      for (const u of S.units) if (u.alive && u.type === 'mortar') { const dd = Math.hypot(u.x - t.x, u.z - t.z); if (dd < 85 && dd < md) { md = dd; m = u; } }
      if (m) {
        this.hunting = m;
        t.cannon.target = m;
        if (md > TANK.cannonRange - 8) {
          const k = (md - (TANK.cannonRange - 14)) / md;
          t.moveTo(t.x + (m.x - t.x) * k, t.z + (m.z - t.z) * k);
        }
        return;
      }
    }
    if (best !== this.goal || (!t.path.length && !t.ram)) {
      this.goal = best;
      t.ramStructure(best);
    }
    // if sappers are swarming close, ease off and let the flak work; otherwise keep rolling
    let sappers = 0;
    S.hash.query(t.x, t.z, 18, (u) => { if (u.type === 'sapper') sappers++; });
    this.hold = sappers >= 3 && this.diff.smart > 0 && d > 20;
    if (!t.cannon.target && d < TANK.cannonRange - 4 && this.diff.smart) {
      // softening fire at the goal when nothing better to shoot
      t.cannon.auto = true;
    }
  }

  power() {
    const G = this.G, t = G.tank, S = G.swarm;
    let near = 0, far = 0, sappers = 0, incoming = 0;
    S.hash.query(t.x, t.z, 30, (u, d) => {
      const w = u.type === 'sapper' ? 2 : u.type === 'rocket' ? 1.3 : 1;
      if (d < 24) near += w; else far += w;
      if (u.type === 'sapper') sappers++;
    });
    for (const p of G.proj.list) if (p.alive && p.interceptable && Math.hypot(p.x - t.x, p.z - t.z) < 30) incoming++;
    const dmg = t.dmgRecent.reduce((a, b) => a + b, 0);
    let worst = 100;
    for (const s of SYSTEMS) worst = Math.min(worst, t.sys[s].hp);
    const moving = t.path.length > 0 || t.ram;
    const want = {
      drive: this.hold ? 0 : moving ? (near > 10 ? 1 : 3) : 0,
      cannon: t.cannon.aim ? 3 : 1,
      flak: clamp(Math.round(near / 4 + incoming * 0.6 + sappers * 0.5), 0, 4),
      shield: clamp(Math.round(1 + dmg / 60), 1, 4),
      repair: worst < 40 ? 3 : worst < 75 ? 2 : (t.hull < t.hullMax * 0.8 ? 1 : 0),
    };
    if (near + far > 0 && want.flak < 1) want.flak = 1;
    // priority when we can't have everything
    const order = sappers >= 2 ? ['flak', 'shield', 'repair', 'cannon', 'drive']
      : dmg > 80 ? ['shield', 'flak', 'repair', 'cannon', 'drive']
        : worst < 30 ? ['repair', 'shield', 'flak', 'cannon', 'drive']
          : ['cannon', 'shield', 'drive', 'flak', 'repair'];
    const cap = t.nominalOutput();
    const alloc = { drive: 0, cannon: 0, flak: 0, shield: 0, repair: 0 };
    let left = cap;
    // round-robin by priority so everyone gets something
    for (let pass = 0; pass < 4 && left > 0; pass++) {
      for (const k of order) {
        if (left <= 0) break;
        if (alloc[k] < want[k] && alloc[k] <= pass) { alloc[k]++; left--; }
      }
    }
    for (const k of order) while (left > 0 && alloc[k] < TANK.maxPower[k] && (k !== 'drive' || moving)) { alloc[k]++; left--; }
    t.want = alloc;
    t.allocate();
    // overdrive
    if (this.diff.smart) {
      if (!t.overdrive && t.heat < 45 && (near >= 8 || dmg > 120) && t.scram <= 0) t.setOverdrive(true);
      else if (t.overdrive && t.heat > (this.diff.smart === 2 ? 82 : 72)) t.setOverdrive(false);
    }
    if (this.hold) t.speed *= 0.9;
  }
}
