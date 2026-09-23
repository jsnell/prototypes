// Minimap: north (+z) up, +x to the left so it matches the default camera view.
import * as THREE from 'three';
import { MAP_W as W, MAP_D as D, WATER_LEVEL, TANK } from './config.js';

const S = 1.25; // px per world unit

export class Minimap {
  constructor(G) {
    this.G = G;
    const wrap = document.createElement('div');
    wrap.className = 'minimap';
    this.cv = document.createElement('canvas');
    this.cv.width = Math.round(W * S); this.cv.height = Math.round(D * S);
    wrap.appendChild(this.cv);
    document.getElementById('hud').appendChild(wrap);
    this.wrap = wrap;
    this.ctx = this.cv.getContext('2d');
    this.bg = document.createElement('canvas');
    this.bg.width = W; this.bg.height = D;
    this.bgVersion = -1; this.bgT = 0;
    this.t = 0;
    this.pings = [];
    let dragging = false;
    const go = (e) => {
      const r = this.cv.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * W, pz = (e.clientY - r.top) / r.height * D;
      return { x: W - px, z: D - pz };
    };
    const o = { signal: G.signal };
    this.cv.addEventListener('contextmenu', (e) => e.preventDefault());
    this.cv.addEventListener('pointerdown', (e) => {
      const p = go(e);
      if (e.button === 0) { dragging = true; G.cam.focus(p.x, p.z); G.cam.follow = null; }
      else if (e.button === 2) this.order(p, e.shiftKey);
    });
    window.addEventListener('pointermove', (e) => { if (dragging) { const p = go(e); G.cam.focus(p.x, p.z); } }, o);
    window.addEventListener('pointerup', () => { dragging = false; }, o);
  }

  order(p, shift) {
    const G = this.G;
    if (G.side === 'tank' && !G.tank.dead) { G.tank.moveTo(p.x, p.z, shift); G.audio.play('click', {}); }
    else if (G.side === 'swarm') {
      const sel = [...G.swarm.selected].filter((u) => u.alive);
      if (sel.length) { G.swarm.orderMove(sel, p.x, p.z); G.audio.play('click', {}); }
    }
  }
  ping(x, z, color) { this.pings.push({ x, z, color, t: 0 }); }

  drawBg() {
    const T = this.G.terrain;
    const ctx = this.bg.getContext('2d');
    const img = ctx.createImageData(W, D);
    const c = new THREE.Color();
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      T.topColor(k, c);
      c.convertLinearToSRGB();
      const shade = 0.75 + Math.min(20, T.H[k]) * 0.018;
      let r = c.r * shade, g = c.g * shade, b = c.b * shade;
      if (T.H[k] < WATER_LEVEL) { const d = WATER_LEVEL - T.H[k]; r = 0.35 - d * 0.05; g = 0.75 - d * 0.06; b = 0.9; }
      if (T.bridge[k]) { r = 0.65; g = 0.45; b = 0.28; }
      const px = ((D - 1 - j) * W + (W - 1 - i)) * 4;
      img.data[px] = r * 255; img.data[px + 1] = g * 255; img.data[px + 2] = b * 255; img.data[px + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // trees
    ctx.fillStyle = 'rgba(40,110,50,0.55)';
    for (const t of this.G.foliage.trees) if (t.state === 0) ctx.fillRect(W - 1 - Math.floor(t.x), D - 1 - Math.floor(t.z), 1, 1);
  }

  update(dt) {
    const G = this.G;
    this.wrap.style.display = G.side === 'none' && !document.getElementById('title').classList.contains('hidden') ? 'none' : '';
    this.t += dt;
    this.bgT -= dt;
    if (this.bgVersion < 0 || (this.bgT <= 0 && this.bgVersion !== G.terrain.version) || this.bgT < -8) { this.bgT = 1.5; this.bgVersion = G.terrain.version; this.drawBg(); }
    if (this.t < 0.066) return;
    this.t = 0;
    const ctx = this.ctx;
    const X = (x) => (W - x) * S, Z = (z) => (D - z) * S;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bg, 0, 0, W * S, D * S);
    // structures
    for (const st of G.swarm.structures) {
      if (!st.alive) continue;
      ctx.fillStyle = st.kind === 'cp' ? '#1f6f69' : '#2fb3a8';
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      const s = st.half * 2 * S;
      ctx.fillRect(X(st.x) - s / 2, Z(st.z) - s / 2, s, s);
      ctx.strokeRect(X(st.x) - s / 2, Z(st.z) - s / 2, s, s);
      if (st.kind === 'cp') { ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('CP', X(st.x), Z(st.z) + 3); }
    }
    // units
    const sel = G.swarm.selected;
    for (const u of G.swarm.units) {
      if (!u.alive) continue;
      ctx.fillStyle = sel.has(u) ? '#ffffff' : '#1aa89c';
      ctx.fillRect(X(u.x) - 1.5, Z(u.z) - 1.5, 3, 3);
    }
    // tank
    const t = G.tank;
    if (t) {
      ctx.save();
      ctx.translate(X(t.x), Z(t.z));
      ctx.rotate(-t.heading);
      ctx.fillStyle = t.dead ? '#444' : '#f2b33d';
      ctx.strokeStyle = '#7a4b00'; ctx.lineWidth = 1.5;
      ctx.fillRect(-TANK.halfW * S, -TANK.halfL * S, TANK.halfW * 2 * S, TANK.halfL * 2 * S);
      ctx.strokeRect(-TANK.halfW * S, -TANK.halfL * S, TANK.halfW * 2 * S, TANK.halfL * 2 * S);
      ctx.fillStyle = '#e0533d';
      ctx.fillRect(-1.5, -TANK.halfL * S - 3, 3, 5);
      ctx.restore();
      if (!t.dead && G.side === 'tank') {
        ctx.strokeStyle = 'rgba(255,90,74,0.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(X(t.x), Z(t.z), TANK.cannonRange * S, 0, Math.PI * 2); ctx.stroke();
        if (t.path.length) {
          ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(X(t.x), Z(t.z));
          for (const p of t.path) ctx.lineTo(X(p.x), Z(p.z));
          ctx.stroke(); ctx.setLineDash([]);
        }
      }
    }
    // camera footprint
    const cs = G.cam.groundCorners();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    cs.forEach((p, i) => { const x = X(Math.max(-60, Math.min(W + 60, p.x))), z = Z(Math.max(-60, Math.min(D + 60, p.z))); if (i) ctx.lineTo(x, z); else ctx.moveTo(x, z); });
    ctx.closePath(); ctx.stroke();
    // pings
    for (let n = this.pings.length - 1; n >= 0; n--) {
      const p = this.pings[n];
      p.t += 0.066;
      if (p.t > 1.5) { this.pings.splice(n, 1); continue; }
      ctx.strokeStyle = p.color; ctx.globalAlpha = 1 - p.t / 1.5; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(p.x), Z(p.z), 4 + p.t * 14, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
