'use strict';
// ---------- particles, specials (stratagems), world drawing ----------
const P_BLOOD = 0, P_GIB = 1, P_SPARK = 2, P_FIRE = 3, P_SMOKE = 4, P_CASING = 5, P_EMBER = 6, P_FLASH = 7,
  P_DIRT = 8, P_TRACER = 9, P_RING = 10, P_WEATHER = 11, P_GLOW = 12, P_ACID = 13;
const P_LIFE = [2, 3, 0.35, 0.7, 2.2, 3, 1.5, 0.07, 2, 0.2, 0.4, 999, 0.12, 2];

class Particles {
  constructor(n) {
    this.max = n; this.n = 0;
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'maxl', 'size', 'r', 'g', 'b', 'a']) this[k] = new Float32Array(n);
    this.kind = new Uint8Array(n); this.bounce = new Uint8Array(n);
  }
  spawn(kind, x, y, z, vx, vy, vz, size, r, g, b, a, life) {
    let i;
    if (this.n < this.max) i = this.n++;
    else { i = (Math.random() * this.max) | 0; if (this.kind[i] === P_WEATHER) return; }
    this.kind[i] = kind; this.x[i] = x; this.y[i] = y; this.z[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.size[i] = size; this.r[i] = r; this.g[i] = g; this.b[i] = b; this.a[i] = a; this.bounce[i] = 0;
    const L = life !== undefined ? life : P_LIFE[kind] * rnd(0.7, 1.3);
    this.life[i] = L; this.maxl[i] = L;
  }
  kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'maxl', 'size', 'r', 'g', 'b', 'a', 'kind', 'bounce']) this[k][i] = this[k][j];
  }
  update(dt) {
    const bl = BLOOD[G.fac.blood];
    for (let i = this.n - 1; i >= 0; i--) {
      const k = this.kind[i];
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        if (k === P_CASING) stamp('solid', this.x[i], this.y[i], 1, 0.55, 0.42, 0.15, 0.8, 0);
        this.kill(i); continue;
      }
      if (k === P_WEATHER) {
        this.x[i] += this.vx[i] * dt + Math.sin(G.t * 0.7 + i) * dt * 3; this.y[i] += this.vy[i] * dt;
        if (this.x[i] < 0) this.x[i] += W; if (this.x[i] > W) this.x[i] -= W; if (this.y[i] > H) this.y[i] -= H; if (this.y[i] < 0) this.y[i] += H;
        continue;
      }
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt;
      if (k <= P_SPARK || k === P_CASING || k === P_DIRT || k === P_ACID) {
        this.vz[i] -= 240 * dt; this.z[i] += this.vz[i] * dt;
        const dr = 1 - dt * 1.2; this.vx[i] *= dr; this.vy[i] *= dr;
        if (this.z[i] <= 0) {
          this.z[i] = 0;
          if (k === P_BLOOD || k === P_ACID) {
            const s = this.size[i] > 1.2 ? 2 : 1;
            stamp(s > 1 ? 'dot' : 'solid', this.x[i], this.y[i], s * rnd(1, 1.6), this.r[i] * 0.6, this.g[i] * 0.6, this.b[i] * 0.6, 0.9, 0);
            if (k === P_ACID && bl.emis) stampE('solid', this.x[i], this.y[i], s, bl.emis[0], bl.emis[1], bl.emis[2], 0.1, 0);
            this.kill(i); continue;
          }
          if ((k === P_GIB || k === P_CASING) && this.bounce[i] < 2 && this.vz[i] < -20) { this.vz[i] *= -0.35; this.vx[i] *= 0.5; this.vy[i] *= 0.5; this.bounce[i]++; if (k === P_CASING && Math.random() < 0.02) SFX.play('tink', this.x[i], 0.15); continue; }
          if (k === P_GIB) { stamp('dot', this.x[i], this.y[i], 2, this.r[i] * 0.7, this.g[i] * 0.7, this.b[i] * 0.7, 0.9, 0); this.kill(i); continue; }
          if (k === P_SPARK || k === P_DIRT) { this.kill(i); continue; }
          this.vx[i] = 0; this.vy[i] = 0; this.vz[i] = 0;
        }
      } else if (k === P_FIRE) {
        const dr = 1 - dt * 3.5; this.vx[i] *= dr; this.vy[i] *= dr; this.z[i] += (8 + this.vz[i] * 0.3) * dt; this.size[i] += dt * 2.5;
        if (this.life[i] < 0.12 && Math.random() < 0.08) this.spawn(P_SMOKE, this.x[i], this.y[i], this.z[i], this.vx[i] * 0.3, this.vy[i] * 0.3, 8, this.size[i], 0.1, 0.1, 0.1, 0.4);
      } else if (k === P_SMOKE) {
        const dr = 1 - dt * 1.5; this.vx[i] *= dr; this.vy[i] *= dr; this.z[i] += this.vz[i] * dt; this.size[i] += dt * 3; this.x[i] += dt * 2;
      } else if (k === P_RING) { this.size[i] += dt * (this.vz[i] || 90); }
      else if (k === P_EMBER) { this.z[i] += dt * 10; this.vx[i] += rnd(-20, 20) * dt; }
    }
  }
  draw(env) {
    const bG = GFX.bG, bE = GFX.bE, bS = GFX.bS;
    const px = SPR.px.r[0][0], soft = SPR.soft.r[0][0], soft32 = SPR.soft32.r[0][0], line = SPR.line.r[0][0], ring = SPR.ring.r[0][0], gib = SPR.gib.r[0][0];
    const amb = env.amb, lg = G.lightGrid;
    for (let i = 0; i < this.n; i++) {
      const k = this.kind[i], x = this.x[i], y = this.y[i], z = this.z[i], s = this.size[i];
      const f = this.life[i] / this.maxl[i];
      switch (k) {
        case P_BLOOD: case P_ACID: case P_DIRT:
          bG.add(Math.round(x) + 0.5, Math.round(y - z) + 0.5, s > 1.2 ? 2 : 1, s > 1.2 ? 2 : 1, px, this.r[i], this.g[i], this.b[i], 1, 0, y + 1, z + 1, 0); break;
        case P_GIB: bG.add(Math.round(x) + 0.5, Math.round(y - z) + 0.5, 3, 3, gib, this.r[i], this.g[i], this.b[i], 1, 0, y + 1, z + 1, 0); break;
        case P_CASING: bG.add(Math.round(x) + 0.5, Math.round(y - z) + 0.5, 1, 1, px, 0.9, 0.7, 0.25, 1, 0, y + 1, z + 1, 0); break;
        case P_SPARK: bE.add(Math.round(x) + 0.5, Math.round(y - z) + 0.5, 1, 1, px, this.r[i], this.g[i], this.b[i], f, 0, 0, 0, 4); break;
        case P_EMBER: bE.add(Math.round(x) + 0.5, Math.round(y - z) + 0.5, 1, 1, px, 1, 0.4, 0.1, f * (0.5 + 0.5 * Math.sin(G.t * 20 + i)), 0, 0, 0, 3); break;
        case P_FIRE: {
          const hot = f;  // 1 = fresh
          const r = 1, g = 0.25 + hot * 0.6, b = 0.05 + hot * hot * 0.5;
          bE.add(x, y - z, s * 2.4, s * 2.4, soft, r, g, b, f * this.a[i], 0, 0, 0, 2.5 + hot * 2);
          if (hot > 0.4) bE.add(Math.round(x) + 0.5, Math.round(y - z) + 0.5, 1, 1, px, 1, 0.9, 0.6, 1, 0, 0, 0, 3);
          break;
        }
        case P_FLASH: bE.add(x, y - z, s * 2, s * 2, s > 20 ? soft32 : soft, this.r[i], this.g[i], this.b[i], f, 0, 0, 0, 5); break;
        case P_GLOW: bE.add(x, y - z, s * 3, s * 3, soft, this.r[i], this.g[i], this.b[i], f, 0, 0, 0, 3); bE.add(Math.round(x) + 0.5, Math.round(y - z) + 0.5, 1, 1, px, this.r[i], this.g[i], this.b[i], 1, 0, 0, 0, 3); break;
        case P_RING: bE.add(x, y, s * 2, s * 2 * 0.8, ring, this.r[i], this.g[i], this.b[i], f * this.a[i], 0, 0, 0, 3); break;
        case P_TRACER: {
          const a = Math.atan2(this.vy[i], this.vx[i]);
          bE.add(x, y - z, 7 * s + 3, s, line, this.r[i], this.g[i], this.b[i], 1, a, 0, 0, 4);
          break;
        }
        case P_SMOKE: case P_WEATHER: {
          const tx = clamp((x / TILE) | 0, 0, GW - 1), ty = clamp((y / TILE) | 0, 0, GH - 1), li = (ty * GW + tx) * 3;
          const lr = amb[0] * 3 + lg[li] * 0.6 + env.sunCol[0] * 0.5, lgg = amb[1] * 3 + lg[li + 1] * 0.6 + env.sunCol[1] * 0.5, lb = amb[2] * 3 + lg[li + 2] * 0.6 + env.sunCol[2] * 0.5;
          if (k === P_SMOKE) bS.add(x, y - z, s * 2, s * 2, soft, this.r[i] * lr, this.g[i] * lgg, this.b[i] * lb, this.a[i] * Math.min(1, f * 2) * Math.min(1, (1 - f) * 6), 0, 0, 0, 1);
          else {
            const wk = G.biome.weather;
            if (wk === 'spores') bE.add(Math.round(x) + 0.5, Math.round(y) + 0.5, 1, 1, px, 0.2, 0.8, 0.5, 0.3 + 0.3 * Math.sin(G.t * 2 + i), 0, 0, 0, 2);
            else if (wk === 'ash' && (i % 5 === 0)) bE.add(Math.round(x) + 0.5, Math.round(y) + 0.5, 1, 1, px, 1, 0.35, 0.05, 0.5 + 0.5 * Math.sin(G.t * 3 + i), 0, 0, 0, 2);
            else bS.add(Math.round(x) + 0.5, Math.round(y) + 0.5, 1, 1, px, this.r[i] * lr, this.g[i] * lgg, this.b[i] * lb, this.a[i], 0, 0, 0, 1);
          }
          break;
        }
      }
    }
  }
}
function initWeather() {
  const wk = G.biome.weather;
  for (let i = 0; i < 260; i++) {
    const c = wk === 'snow' ? [1, 1, 1] : wk === 'ash' ? [0.3, 0.3, 0.3] : [0.7, 0.6, 0.5];
    const vx = wk === 'snow' ? rnd(4, 10) : wk === 'dust' ? rnd(12, 25) : rnd(-3, 3);
    const vy = wk === 'snow' ? rnd(8, 16) : wk === 'ash' ? rnd(3, 8) : rnd(-2, 2);
    G.parts.spawn(P_WEATHER, Math.random() * W, Math.random() * H, 0, vx, vy, 0, 1, c[0], c[1], c[2], wk === 'snow' ? 0.7 : 0.35, 1e9);
  }
}

// decal stamps
function stamp(spr, x, y, size, r, g, b, a, ang) { GFX.bDC.add(x, y, size, size, SPR[spr].r[0][0], r, g, b, a, ang, 0, 0, 1); }
function stampE(spr, x, y, size, r, g, b, em, ang) { GFX.bDE.add(x, y, size, size, SPR[spr].r[0][0], r, g, b, 1, ang, 0, 0, em); }

// ---------------- stratagems ----------------
function specialReady(id) { const s = G.spec[id]; return s && !s.locked && s.charges > 0 && !G.over; }
function useSpecial(id, x, y) {
  if (!specialReady(id)) return false;
  const s = G.spec[id];
  s.base = SPECIALS[id].cd * G.cdMult;
  if (s.charges === s.max) s.cd = s.base;
  s.charges--;
  G.specialsUsed++;
  const hq = G.buildings.find(b => b.type === 'hq');
  const P = G.parts;
  SPECIAL_FX[id](x, y, hq, P);
  return true;
}
const SPECIAL_FX = {
  flare(x, y, hq) {
    const sx = hq.x, sy = hq.y - 6, T = Math.hypot(x - sx, y - sy) / 220 + 0.5;
    SFX.play('flare', sx, 0.6);
    G.fx.push({ kind: 'flare', x: sx, y: sy, z: 0, t: 0, T, burnT: 0, update(f, dt) {
      if (f.t < f.T) {
        const k = f.t / f.T; f.x = lerp(sx, x, k); f.y = lerp(sy, y, k); f.z = Math.sin(k * Math.PI) * 60;
        G.parts.spawn(P_SPARK, f.x, f.y, f.z, rnd(-10, 10), rnd(-10, 10), 0, 1, 1, 0.3, 0.2, 1);
        G.parts.spawn(P_SMOKE, f.x, f.y, f.z, 0, 0, 0, 2, 0.5, 0.4, 0.4, 0.3);
        return true;
      }
      f.x = x; f.y = y; f.z = 0; f.burnT += dt;
      if (Math.random() < 0.7) G.parts.spawn(P_SPARK, x, y, 2, rnd(-30, 30), rnd(-30, 30), rnd(20, 60), 1, 1, 0.35, 0.25, 1);
      if (Math.random() < 0.25) G.parts.spawn(P_SMOKE, x, y, 3, rnd(-3, 3), rnd(-3, 3), rnd(6, 12), rnd(3, 5), 0.6, 0.4, 0.4, 0.35);
      return f.burnT < 25;
    }, light(f) {
      if (f.t < f.T) { addLight(f.x, f.y, f.z + 4, 40, 1.5, 0.4, 0.3); return; }
      const fl = 0.85 + Math.random() * 0.3, fade = Math.min(1, (25 - f.burnT) / 3);
      addLight(f.x + rnd(-1, 1), f.y + rnd(-1, 1), 7, 120 * (0.7 + 0.3 * fade), 2.4 * fl * fade, 0.55 * fl * fade, 0.4 * fl * fade);
    }, draw(f) { GFX.bE.add(Math.round(f.x) + 0.5, Math.round(f.y - f.z) + 0.5, 2, 2, SPR.px.r[0][0], 1, 0.5, 0.4, 1, 0, 0, 0, 6); GFX.bE.add(f.x, f.y - f.z, 14, 14, SPR.soft.r[0][0], 1, 0.3, 0.2, 0.7, 0, 0, 0, 3); } });
  },
  tracker(x, y, hq) {
    G.tagT = 9;
    for (const e of G.enemies) e.tagged = 9;
    G.parts.spawn(P_RING, hq.x, hq.y, 0, 0, 0, 420, 4, 0.2, 1, 0.5, 0.8, 1.6);
    SFX.play('ping', hq.x, 1);
    G.trackerPing = { t: 0, n: G.enemies.length };
  },
  orbital(x, y) {
    SFX.play('charge', x, 0.8);
    G.fx.push({ kind: 'orbital', x, y, t: 0, fired: false, update(f, dt) {
      if (f.t > 1.6 && !f.fired) {
        f.fired = true;
        explosion(x, y, 38, 420, true);
        G.flash = Math.max(G.flash, 0.4); G.shake = 7;
        for (let i = 0; i < 30; i++) G.parts.spawn(P_FIRE, x + rnd(-4, 4), y + rnd(-4, 4), rnd(0, 60), rnd(-8, 8), rnd(-8, 8), rnd(10, 40), rnd(3, 6), 1, 0.9, 0.8, 1, rnd(0.3, 0.8));
      }
      return f.t < 2.2;
    }, light(f) {
      if (!f.fired) { const p = 0.5 + 0.5 * Math.sin(f.t * 30); addLight(f.x, f.y, 3, 26 + f.t * 10, 1.8 * p, 0.1, 0.1); }
      else { const k = 1 - (f.t - 1.6) / 0.6; addLight(f.x, f.y, 30, 200, 3 * k, 3.5 * k, 5 * k); }
    }, draw(f) {
      const l = SPR.line.r[0][0];
      if (!f.fired) {
        GFX.bE.add(f.x, f.y / 2 - 2, f.y + 4, 1, l, 1, 0.1, 0.05, 0.35 + 0.3 * Math.sin(f.t * 40), Math.PI / 2, 0, 0, 3);
        GFX.bE.add(Math.round(f.x) + 0.5, Math.round(f.y) + 0.5, 3, 3, SPR.dot.r[0][0], 1, 0.1, 0.1, 1, 0, 0, 0, 5);
      } else {
        const k = 1 - (f.t - 1.6) / 0.6;
        GFX.bE.add(f.x, f.y / 2, f.y + 10, 14 * k + 2, l, 0.7, 0.85, 1, k, Math.PI / 2, 0, 0, 6);
      }
    } });
  },
  napalm(x, y, hq) {
    let dx = x - hq.x, dy = y - hq.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const len = 140, x0 = x - dx * len / 2, y0 = y - dy * len / 2;
    const jx0 = x0 - dx * 300, jy0 = y0 - dy * 300, speed = 320;
    SFX.play('jet', x, 1);
    let dropped = 0;
    G.fx.push({ kind: 'jet', t: 0, x: jx0, y: jy0, ang: Math.atan2(dy, dx), update(f, dt) {
      f.x += dx * speed * dt; f.y += dy * speed * dt;
      const along = (f.x - x0) * dx + (f.y - y0) * dy;
      while (dropped * 7 < Math.min(along, len) && along >= 0) {
        const px = x0 + dx * dropped * 7, py = y0 + dy * dropped * 7; dropped++;
        napalmPatch(px + rnd(-3, 3), py + rnd(-3, 3), dropped % 3 === 0);
        if (dropped % 4 === 0) SFX.play('boom', px, 0.4);
      }
      return f.t < 3;
    }, draw(f) { drawJet(f); } });
  },
  drop(x, y) {
    SFX.play('whistle', x, 0.8);
    G.fx.push({ kind: 'pod', x, y, z: 260, t: 0, update(f, dt) {
      f.z = Math.max(0, 260 * (1 - f.t / 1.1));
      G.parts.spawn(P_FIRE, x + rnd(-1, 1), y - f.z + rnd(-1, 1), 0, 0, 0, 0, 2.5, 1, 0.6, 0.3, 1, 0.25);
      if (f.t >= 1.1) {
        explosion(x, y, 14, 120, false);
        let tx = clamp((x / TILE) | 0, 0, GW - 1), ty = clamp((y / TILE) | 0, 0, GH - 1);
        for (let r = 0; r < 5; r++) {
          let found = false;
          for (let yy = ty - r; yy <= ty + r && !found; yy++) for (let xx = tx - r; xx <= tx + r && !found; xx++) if (canPlace('dropsentry', xx, yy) || (G.phase !== 'lull' && xx >= 0 && yy >= 0 && xx < GW && yy < GH && !G.occ[yy * GW + xx] && G.map.tiles[yy * GW + xx] !== T_ROCK)) { tx = xx; ty = yy; found = true; }
          if (found) break;
        }
        if (!G.occ[ty * GW + tx] && G.map.tiles[ty * GW + tx] !== T_ROCK) placeBuilding('dropsentry', tx, ty, true);
        return false;
      }
      return true;
    }, light(f) { addLight(f.x, f.y - f.z, 4, 30, 1.5, 0.7, 0.3); },
    draw(f) { GFX.bG.add(Math.round(f.x) + 0.5, Math.round(f.y - f.z) + 0.5, 9, 9, SPR.pod.r[0][0], 1, 1, 1, 1, 0, f.y + 20, f.z, 1); } });
  },
  gunship(x, y, hq) {
    let dx = x - hq.x, dy = y - hq.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const len = 110, x0 = x - dx * len / 2, y0 = y - dy * len / 2;
    SFX.play('jet', x, 0.8);
    let n = 0;
    G.fx.push({ kind: 'jet', t: 0, x: x0 - dx * 200, y: y0 - dy * 200, ang: Math.atan2(dy, dx), update(f, dt) {
      f.x += dx * 180 * dt; f.y += dy * 180 * dt;
      if (f.t > 0.6) while (n < 32 && n < (f.t - 0.6) * 22) {
        const px = x0 + dx * n / 32 * len + rnd(-7, 7), py = y0 + dy * n / 32 * len + rnd(-7, 7); n++;
        tracer(px - 60, py - 90, px, py, 1, 0.8, 0.4, 2);
        setTimeoutG(0.15, () => explosion(px, py, 8, 55, false, { quiet: n % 3 !== 0 }));
      }
      return f.t < 3.2;
    }, draw(f) { drawJet(f); } });
  },
  nuke(x, y) {
    SFX.play('siren', x, 1);
    msg('DUST OFF — TAKE COVER', '#f44');
    G.fx.push({ kind: 'nuke', x, y, t: 0, fired: false, ringR: 0, update(f, dt) {
      if (!f.fired && f.t > 3) {
        f.fired = true; G.flash = 3; G.shake = 12;
        SFX.play('nuke', x, 1);
        stamp('scorch', x, y, 260, 0.02, 0.015, 0.01, 0.95, 0);
        stampE('soft32', x, y, 120, 1, 0.3, 0.05, 1, 0);
        for (let i = 0; i < 400; i++) { const a = Math.random() * TAU, s = rnd(20, 260); G.parts.spawn(P_FIRE, x, y, rnd(0, 10), Math.cos(a) * s, Math.sin(a) * s * 0.8, rnd(0, 60), rnd(3, 8), 1, 0.9, 0.7, 1, rnd(0.6, 1.6)); }
        for (let i = 0; i < 200; i++) G.parts.spawn(P_SMOKE, x + rnd(-30, 30), y + rnd(-20, 20), rnd(0, 40), rnd(-20, 20), rnd(-20, 20), rnd(15, 40), rnd(8, 16), 0.2, 0.15, 0.12, 0.8, rnd(3, 6));
        G.parts.spawn(P_RING, x, y, 1, 0, 0, 170, 6, 1, 0.8, 0.6, 1, 1.2);
      }
      if (f.fired) {
        const prev = f.ringR; f.ringR = Math.min(170, (f.t - 3) * 170);
        // damage everything the shockwave passes this frame
        const R0 = prev, R1 = f.ringR;
        for (const e of G.enemies) { const d = Math.hypot(e.x - x, e.y - y); if (d >= R0 && d < R1) hurtEnemy(e, d < 120 ? 99999 : 150, (e.x - x) / (d || 1), (e.y - y) / (d || 1)); }
        for (const m of G.marines) { const d = Math.hypot(m.x - x, m.y - y); if (d >= R0 && d < R1 && d < 130) hurtMarine(m, 999); }
        for (const b of [...G.buildings]) { const d = Math.hypot(b.x - x, b.y - y); if (d >= R0 && d < R1) hurtBuilding(b, d < 90 ? 5000 : d < 130 ? 400 : 60); }
        if (Math.random() < 0.6) G.parts.spawn(P_FIRE, x + rnd(-20, 20), y + rnd(-10, 10), rnd(20, 60), 0, 0, 30, rnd(6, 10), 1, 0.7, 0.3, 1, 1);
      }
      return f.t < 9;
    }, light(f) {
      if (!f.fired) { const p = (Math.sin(f.t * 12) > 0) ? 1 : 0; addLight(f.x, f.y, 3, 60, 2 * p, 0, 0); return; }
      const k = Math.max(0, 1 - (f.t - 3) / 6);
      addLight(f.x, f.y, 60, 520, 6 * k * k + 0.3 * k, 4 * k * k + 0.1 * k, 2.5 * k * k);
    }, draw(f) {
      if (!f.fired) GFX.bE.add(f.x, f.y, 240, 192, SPR.ring.r[0][0], 1, 0.1, 0.1, 0.5 + 0.5 * Math.sin(f.t * 12), 0, 0, 0, 2);
    } });
  },
};
function napalmPatch(x, y, withLight) {
  G.fx.push({ kind: 'fire', x, y, t: 0, life: rnd(10, 13), update(f, dt) {
    if (Math.random() < 0.45) G.parts.spawn(P_FIRE, x + rnd(-4, 4), y + rnd(-3, 3), 1, rnd(-4, 4), rnd(-4, 4), rnd(8, 20), rnd(2, 3.5), 1, 0.6, 0.2, 1);
    if (Math.random() < 0.08) G.parts.spawn(P_SMOKE, x, y, 6, rnd(-4, 4), rnd(-4, 4), rnd(10, 20), rnd(4, 7), 0.1, 0.08, 0.07, 0.6);
    if (Math.random() < 0.05) G.parts.spawn(P_EMBER, x, y, 4, rnd(-10, 10), rnd(-10, 10), 0, 1, 1, 0.5, 0.1, 1);
    f.dmgT = (f.dmgT || 0) - dt;
    if (f.dmgT <= 0) { f.dmgT = 0.25; forNear(x, y, 8, e => { hurtEnemy(e, 3, 0, 0); e.burn = 4; }); }
    return f.t < f.life;
  }, light(f) { if (withLight) { const k = Math.min(1, (f.life - f.t) / 2); addLight(x, y, 4, 55, 1.6 * k * (0.8 + Math.random() * 0.3), 0.7 * k, 0.15 * k); } } });
  stamp('scorch', x, y, 14, 0.03, 0.02, 0.02, 0.5, Math.random() * TAU);
}
function setTimeoutG(delay, fn) { G.fx.push({ kind: 'timer', t: 0, update(f) { if (f.t >= delay) { fn(); return false; } return true; } }); }
function drawJet(f) {
  const fi = ((Math.round(f.ang / TAU * 16) % 16) + 16) % 16;
  const z = 24;
  // shadow on the ground (dark smoke-style sprite), then the plane itself
  GFX.bS.add(f.x + 10, f.y + 14, 18, 8, SPR.soft.r[0][0], 0, 0, 0, 0.5, f.ang, 0, 0, 1);
  GFX.bG.add(Math.round(f.x) + 0.5, Math.round(f.y - z) + 0.5, 21, 21, SPR.jet.r[0][fi], 1, 1, 1, 1, 0, H + 100, z, 1);
  addLight(f.x - Math.cos(f.ang) * 9, f.y - z - Math.sin(f.ang) * 9, z, 30, 1.5, 0.8, 0.4);
}

// ---------------- demo / autoplayer ----------------
function autoFortify(free) {
  const S = G.map.sectors;
  const spend = (type, tx, ty) => free ? (canPlaceIgnorePhase(type, tx, ty) && placeBuilding(type, tx, ty, true)) : placeBuilding(type, tx, ty);
  for (const g of frontierGaps()) {
    const side = S[g.a].claimed ? g.a : g.b;
    for (const t of g.tiles) if (G.map.sectorOf[t] === side) spend('wall', t % GW, (t / GW) | 0);
    const p = g.post[side]; const px = (p.x / TILE) | 0, py = (p.y / TILE) | 0;
    let placed = 0;
    for (let r = 1; r < 4 && placed < 2; r++) for (let dy = -r; dy <= r && placed < 2; dy++) for (let dx = -r; dx <= r && placed < 2; dx++) {
      if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
      if (spend('sentry', px + dx, py + dy)) placed++;
    }
  }
}
function canPlaceIgnorePhase(type, tx, ty) { const ph = G.phase; G.phase = 'lull'; const r = canPlace(type, tx, ty); G.phase = ph; return r; }
function demoTick(dt) {
  G.demoT = (G.demoT || 0) - dt;
  if (G.phase === 'lull') {
    if (G.demoT > 0) return;
    G.demoT = 1.2;
    autoBuildStep();
    if (G.phaseT > 12 && G.res < 40) G.phaseT = Math.min(G.phaseT, 12);
  } else {
    // fire stratagems at the thickest crowds
    if (G.demoT <= 0) {
      G.demoT = rnd(1.5, 4);
      const e = G.enemies.length ? G.enemies[(Math.random() * G.enemies.length) | 0] : null;
      if (!e) return;
      const ids = ['flare', 'flare', 'orbital', 'napalm', 'gunship', 'tracker', 'drop'].filter(id => { const s = G.spec[id]; return s.charges > 0; });
      if (ids.length) { const id = pick(ids); G.spec[id].locked = false; useSpecial(id, e.x, e.y); }
    }
  }
}
function autoBuildStep() {
  const S = G.map.sectors;
  // claim a sector when rich enough
  const cand = S.filter(s => canClaim(s)).sort((a, b) => (b.richness - a.richness) || (a.col - b.col));
  if (cand.length && G.res > claimCost(cand[0]) + 80 && S.filter(s => s.claimed).length < 3 + G.wave * 0.7) { tryClaim(cand[0]); return; }
  // extractors
  for (const s of S) if (s.claimed) for (const o of s.ore) if (!G.occ[o.y * GW + o.x] && G.res >= 60) { placeBuilding('extractor', o.x, o.y); return; }
  // walls + sentries at frontier
  if (G.res > 60) {
    for (const g of frontierGaps()) {
      const side = S[g.a].claimed ? g.a : g.b;
      for (const t of g.tiles) if (G.map.sectorOf[t] === side && !G.occ[t]) { placeBuilding('wall', t % GW, (t / GW) | 0); }
    }
  }
  const nb = G.buildings.filter(b => b.type === 'barracks').length;
  const hq = G.buildings.find(b => b.type === 'hq');
  const tryNear = (type, x, y, r0 = 1, r1 = 6) => {
    for (let r = r0; r < r1; r++) for (let k = 0; k < 16; k++) {
      const a = Math.random() * TAU; const tx = Math.round(x / TILE + Math.cos(a) * r), ty = Math.round(y / TILE + Math.sin(a) * r);
      if (canPlace(type, tx, ty) && G.res >= BUILDINGS[type].cost) { placeBuilding(type, tx, ty); return true; }
    }
    return false;
  };
  if (nb < 1 + Math.floor(G.wave / 3) && G.res > 150) { tryNear('barracks', hq.x, hq.y, 4, 10); return; }
  const fg = frontierGaps();
  if (!fg.length) return;
  const g = pick(fg); const side = S[g.a].claimed ? g.a : g.b; const p = g.post[side];
  const turrets = ['sentry', 'sentry', 'sentry', 'light'];
  if (G.opts.unlocked?.b_flamer) turrets.push('flamer');
  if (G.opts.unlocked?.b_mortar && Math.random() < 0.2) { tryNear('mortar', p.x + p.nx * -30, p.y + p.ny * -30, 1, 6); return; }
  tryNear(pick(turrets), p.x, p.y, 1, 4);
  if (G.res > 45 && Math.random() < 0.3) tryNear('habitat', hq.x, hq.y, 4, 12);
}

// ---------------- world drawing ----------------
function drawWorld(env) {
  const bG = GFX.bG;
  const night = 1 - G.dayness;
  const ore = G.biome.ore;
  // ore deposits
  for (const s of G.map.sectors) for (const o of s.ore) {
    if (G.occ[o.y * GW + o.x]) continue;
    const x = (o.x + 1) * TILE, y = (o.y + 1) * TILE;
    bG.add(x, y, 16, 16, SPR.ore.r[0][0], ore[0], ore[1], ore[2], 1, 0, y + 4, 0, 1.2);
    addLight(x, y - 2, 8, 26, ore[0] * 0.25 * night, ore[1] * 0.25 * night, ore[2] * 0.25 * night);
  }
  for (const r of G.ruins) {
    const d = BUILDINGS[r.type]; if (G.occ[r.ty * GW + r.tx]) continue;
    const big = d.w > 1; const x = (r.tx + d.w / 2) * TILE, y = (r.ty + d.h / 2) * TILE;
    bG.add(x, y, big ? 16 : 8, big ? 16 : 8, SPR[big ? 'rubble2' : 'rubble'].r[0][0], 1, 1, 1, 1, 0, y - 4, 0, 0.6);
  }
  for (const b of G.buildings) {
    const hit = b.hitT > 0 ? 2.2 : 1;
    const fi = ((Math.round(b.ang / TAU * 16) % 16) + 16) % 16;
    const dy = b.y + b.h * 4 - 2;
    switch (b.type) {
      case 'hq': {
        bG.add(b.x, b.y, 34, 26, SPR.hq.r[0][0], hit, hit, hit, 1, 0, b.y - 6, 0, 1);
        addLight(b.x + 14, b.y, 10, 120, 1.6, 1.55, 1.4, 1, 0, 0.8, 0.15);
        addLight(b.x, b.y + 4, 16, 60, 0.5, 0.55, 0.6);
        const bl = Math.sin(G.t * 4) > 0.6 ? 1 : 0;
        addLight(b.x - 6, b.y - 11, 8, 18, 1.2 * bl, 0.1 * bl, 0.05 * bl); addLight(b.x - 6, b.y + 11, 8, 18, 0.1 * bl, 1.2 * bl, 0.2 * bl);
        addLight(b.x - 16, b.y, 7, 24, 0.3, 0.55, 1);
        break;
      }
      case 'wall': bG.add(b.x, b.y, 8, 8, SPR.wall.r[wallMask(b)][0], hit, hit, hit, 1, 0, b.y + 3, 0, 1); break;
      case 'light':
        bG.add(b.x, b.y, 8, 8, SPR.light.r[0][0], hit, hit, hit, 1, 0, b.y + 3, 0, 1);
        addLight(b.x, b.y - 2, 22, b.d.lightR, 1.15, 1.1, 0.95);
        break;
      case 'sentry': case 'flamer': case 'dropsentry':
        bG.add(b.x, b.y, b.type === 'dropsentry' ? 9 : 8, b.type === 'dropsentry' ? 9 : 8, SPR[b.type === 'dropsentry' ? 'pod' : 'tbase'].r[0][0], hit, hit, hit, 1, 0, b.y + 2, 0, 1);
        bG.add(b.x + 0.5, b.y - 1 + 0.5, 9, 9, SPR[b.type === 'flamer' ? 'flamer' : 'sentry'].r[0][fi], hit, hit, hit, 1, 0, b.y + 3, b.type === 'dropsentry' ? 3 : 0, 1);
        if (night > 0.3 && b.type !== 'flamer') addLight(b.x + Math.cos(b.ang) * 3, b.y + Math.sin(b.ang) * 3, 5, 45, 0.35, 0.05, 0.03, Math.cos(b.ang), Math.sin(b.ang), 0.93, 0.06);
        if (b.type === 'flamer') addLight(b.x + Math.cos(b.ang) * 4, b.y + Math.sin(b.ang) * 4, 5, 10, 0.6, 0.3, 0.05);
        break;
      case 'mortar': bG.add(b.x, b.y, 16, 16, SPR.mortarbase.r[0][0], hit, hit, hit, 1, 0, dy, 0, 1); break;
      case 'railgun':
        bG.add(b.x, b.y, 16, 16, SPR.railbase.r[0][0], hit, hit, hit, 1, 0, b.y + 4, 0, 1);
        bG.add(b.x + 0.5, b.y - 1 + 0.5, 19, 19, SPR.rail.r[0][fi], hit, hit, hit, 1, 0, b.y + 5, 0, 1);
        addLight(b.x, b.y, 8, 28, 0.15, 0.35, 0.9);
        break;
      case 'extractor':
        bG.add(b.x, b.y, 16, 16, SPR.extractor.r[Math.floor(b.anim * 5) % 4][0], hit, hit, hit, 1, 0, dy, 0, 1);
        addLight(b.x + 5.8, b.y - 5.8, 5, 22, 0.9 * (Math.sin(b.anim * 6) > 0 ? 1 : 0.2), 0.4, 0.05);
        break;
      case 'habitat':
        bG.add(b.x, b.y, 16, 16, SPR.habitat.r[0][0], hit, hit, hit, 1, 0, dy, 0, 1);
        addLight(b.x, b.y, 10, 34, 0.7 * night, 0.45 * night, 0.2 * night);
        break;
      case 'barracks':
        bG.add(b.x, b.y, 16, 16, SPR.barracks.r[0][0], hit, hit, hit, 1, 0, dy, 0, 1);
        addLight(b.x + 8, b.y, 6, 22, 0.1, 0.7, 0.2);
        break;
    }
  }
  // enemies
  for (const e of G.enemies) {
    if (e.burrowT > 0) continue;
    const spr = SPR[e.td.sprite];
    const fi = ((Math.round(e.ang / TAU * 16) % 16) + 16) % 16;
    const fr = Math.floor(e.walk) & 1;
    const sx = spr.w, sy = spr.h;
    const x = Math.round(e.x - sx / 2) + sx / 2, y = Math.round(e.y - e.z - sy / 2) + sy / 2;
    const tr = e.elite ? 1.5 : 1, tg = e.elite ? 0.55 : 1, tb = e.elite ? 0.5 : 1;
    const burnGlow = e.burn > 0 ? 1.4 : 1;
    bG.add(x, y, sx, sy, spr.r[fr][fi], tr * burnGlow, tg, tb, 1, 0, e.y, e.z, e.elite ? 3 : 1.5);
  }
  // marines
  for (const m of G.marines) {
    const fi = ((Math.round(m.ang / TAU * 16) % 16) + 16) % 16;
    bG.add(Math.round(m.x) + 0.5, Math.round(m.y) + 0.5, 7, 7, SPR.marine.r[Math.floor(m.walk) & 1][fi], 1, 1, 1, 1, 0, m.y, 0, 1);
    if (night > 0.25) { const ca = Math.cos(m.ang), sa = Math.sin(m.ang); addLight(m.x + ca * 2, m.y + sa * 2, 5, 70, 1.1 * night, 1.05 * night, 0.9 * night, ca, sa, 0.9, 0.12); }
  }
  // projectiles
  for (const p of G.projs) if (p.kind === 'shell') bG.add(Math.round(p.x) + 0.5, Math.round(p.y - p.z) + 0.5, 3, 3, SPR.canister.r[0][0], 0.5, 0.5, 0.45, 1, 0, p.y, p.z, 0);
  for (const f of G.fx) if (f.draw) f.draw(f);
  G.parts.draw(env);
}
