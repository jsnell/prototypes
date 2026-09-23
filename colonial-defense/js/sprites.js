'use strict';
// ---------- procedural pixel-art sprite atlas ----------
// Every sprite is a tiny heightfield: colour + height + specular + emissive per pixel.
// Normals are derived from the heights, so the pixel art reacts properly to lights.
const ATLAS = 1024;
const SPR = {};
const Atlas = {
  alb: new Uint8ClampedArray(ATLAS * ATLAS * 4),
  nrm: new Uint8ClampedArray(ATLAS * ATLAS * 4),
  emi: new Uint8ClampedArray(ATLAS * ATLAS * 4),
  x: 1, y: 1, rowH: 0,
};
const HMAX = 64; // height (px) mapped to 1.0 in the height channel

function atlasAlloc(w, h) {
  if (Atlas.x + w + 1 > ATLAS) { Atlas.x = 1; Atlas.y += Atlas.rowH + 1; Atlas.rowH = 0; }
  const r = { x: Atlas.x, y: Atlas.y, w, h };
  Atlas.x += w + 1; Atlas.rowH = Math.max(Atlas.rowH, h);
  if (Atlas.y + h >= ATLAS) throw new Error('atlas full');
  return r;
}

// shape helpers (u = forward axis, v = sideways)
const ell = (u, v, cx, cy, rx, ry) => { const dx = (u - cx) / rx, dy = (v - cy) / ry; return dx * dx + dy * dy; };
const dome = (d, h) => h * Math.sqrt(Math.max(0, 1 - d));
function segd(u, v, ax, ay, bx, by) {
  const px = u - ax, py = v - ay, dx = bx - ax, dy = by - ay;
  const t = clamp((px * dx + py * dy) / (dx * dx + dy * dy), 0, 1);
  const ex = px - dx * t, ey = py - dy * t; return Math.sqrt(ex * ex + ey * ey);
}
const boxd = (u, v, cx, cy, hw, hh) => Math.max(Math.abs(u - cx) / hw, Math.abs(v - cy) / hh);

// layer accumulator: highest surface wins
function Px() { this.b = null; }
Px.prototype.L = function (h, c, s = 0.2, e = null) { if (!this.b || h > this.b.h) this.b = { h, c, s, e }; };

function makeSprite(name, w, h, fn, opt = {}) {
  const facings = opt.facings || 1, frames = opt.frames || 1;
  const spr = { w, h, facings, frames, r: [] };
  for (let f = 0; f < frames; f++) {
    const row = [];
    for (let k = 0; k < facings; k++) {
      const ang = k / facings * TAU, ca = Math.cos(ang), sa = Math.sin(ang);
      const reg = atlasAlloc(w, h);
      const hh = new Float32Array(w * h), px = new Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const lx = x + 0.5 - w / 2, ly = y + 0.5 - h / 2;
        const u = lx * ca + ly * sa, v = -lx * sa + ly * ca;
        const p = new Px(); fn(p, u, v, f, lx, ly);
        if (p.b) { px[y * w + x] = p.b; hh[y * w + x] = Math.max(0.3, p.b.h); }
      }
      const H = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : hh[y * w + x];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = px[y * w + x]; if (!p) continue;
        const nx = (H(x - 1, y) - H(x + 1, y)) * 0.5, ny = (H(x, y - 1) - H(x, y + 1)) * 0.5;
        const l = Math.hypot(nx, ny, 1);
        const i = ((reg.y + y) * ATLAS + reg.x + x) * 4;
        Atlas.alb[i] = p.c[0] * 255; Atlas.alb[i + 1] = p.c[1] * 255; Atlas.alb[i + 2] = p.c[2] * 255; Atlas.alb[i + 3] = 255;
        Atlas.nrm[i] = (nx / l * 0.5 + 0.5) * 255; Atlas.nrm[i + 1] = (ny / l * 0.5 + 0.5) * 255; Atlas.nrm[i + 2] = (1 / l * 0.5 + 0.5) * 255;
        Atlas.nrm[i + 3] = clamp(p.h / HMAX, 0, 1) * 255;
        if (p.e) { Atlas.emi[i] = clamp(p.e[0], 0, 1) * 255; Atlas.emi[i + 1] = clamp(p.e[1], 0, 1) * 255; Atlas.emi[i + 2] = clamp(p.e[2], 0, 1) * 255; }
        Atlas.emi[i + 3] = p.s * 255;
      }
      row.push(reg);
    }
    spr.r.push(row);
  }
  SPR[name] = spr;
}

// soft alpha-only sprites for emissive/smoke particles
function makeSoft(name, w, h, afn) {
  const reg = atlasAlloc(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = clamp(afn((x + 0.5) / w * 2 - 1, (y + 0.5) / h * 2 - 1), 0, 1);
    const i = ((reg.y + y) * ATLAS + reg.x + x) * 4;
    Atlas.alb[i] = Atlas.alb[i + 1] = Atlas.alb[i + 2] = 255; Atlas.alb[i + 3] = a * 255;
    Atlas.nrm[i] = 128; Atlas.nrm[i + 1] = 128; Atlas.nrm[i + 2] = 255; Atlas.nrm[i + 3] = 0;
  }
  SPR[name] = { w, h, facings: 1, frames: 1, r: [[reg]] };
}

function buildAtlas() {
  const C = hex;
  // ---------- particles ----------
  makeSprite('px', 1, 1, (p) => p.L(1, [1, 1, 1], 0.3));
  makeSprite('px2', 2, 2, (p) => p.L(1, [1, 1, 1], 0.3));
  makeSprite('gib', 3, 3, (p, u, v) => { const d = ell(u, v, 0, 0, 1.5, 1.2); if (d < 1) p.L(dome(d, 1.5), [1, 1, 1], 0.6); });
  makeSoft('soft', 16, 16, (x, y) => Math.exp(-(x * x + y * y) * 4));
  makeSoft('soft32', 32, 32, (x, y) => Math.exp(-(x * x + y * y) * 3.5));
  makeSoft('ring', 32, 32, (x, y) => { const r = Math.hypot(x, y); return Math.exp(-Math.pow((r - 0.85) / 0.08, 2)); });
  makeSoft('line', 8, 4, (x, y) => Math.exp(-y * y * 3) * (1 - Math.pow(Math.abs(x), 6)));
  makeSoft('dot', 3, 3, (x, y) => (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) ? 1 : 0.35);
  makeSoft('solid', 1, 1, () => 1);
  makeSoft('splat', 16, 16, (x, y) => { const a = Math.atan2(y, x); const r = Math.hypot(x, y); const lim = 0.55 + 0.25 * Math.sin(a * 5 + 1) + 0.15 * Math.sin(a * 11); return r < lim ? 1 : 0; });
  makeSoft('splat2', 16, 16, (x, y) => { const a = Math.atan2(y, x); const r = Math.hypot(x, y); const lim = 0.45 + 0.35 * Math.sin(a * 3 + 2) * Math.sin(a * 7); return r < lim ? 1 : 0; });
  makeSoft('scorch', 32, 32, (x, y) => { const r = Math.hypot(x, y); return clamp(1.1 - r, 0, 1) * (0.7 + 0.3 * Math.sin(Math.atan2(y, x) * 9)); });

  // ---------- xeno hive ----------
  const chit = [0.07, 0.08, 0.1], chit2 = [0.11, 0.12, 0.16];
  const xeno = (s, extra) => (p, u, v, f) => {
    u /= s; v /= s;
    const sw = f ? 1 : -1;
    let d = ell(u, v, 0, 0, 1.6, 1.0); if (d < 1) p.L((dome(d, 2.2) + 0.8) * s, chit, 0.95);
    d = ell(u, v, 2.3, 0, 1.5, 0.72); if (d < 1) p.L((dome(d, 2.4) + 1.1) * s, chit2, 1.0);
    const tailEnd = -4.8, tv = sw * 0.7;
    if (u < -1 && segd(u, v, -1.2, 0, tailEnd, tv) < 0.42) p.L(1.2 * s, chit, 0.8);
    for (const lu of [-0.5, 0.6]) for (const side of [-1, 1]) {
      const k = (lu > 0 ? 1 : -1) * sw * side * 0.5;
      if (segd(u, v, lu, side * 0.6, lu + k, side * 2.1) < 0.33) p.L(0.9 * s, chit, 0.7);
    }
    if (extra) extra(p, u, v, f, s);
  };
  makeSprite('drone', 11, 11, xeno(1), { facings: 16, frames: 2 });
  makeSprite('warrior', 15, 15, xeno(1.35, (p, u, v, f, s) => {
    for (const side of [-1, 1]) { const d = ell(u, v, -0.4, side * 1.0, 0.7, 0.35); if (d < 1) p.L((dome(d, 1) + 3) * s, chit2, 1); }
  }), { facings: 16, frames: 2 });
  makeSprite('spitter', 13, 13, xeno(1.1, (p, u, v) => {
    const d = ell(u, v, -1.0, 0, 1.4, 1.15); if (d < 1) p.L(dome(d, 2.5) + 1.2, [0.18, 0.25, 0.08], 0.9, [0.25, 0.55, 0.03]);
  }), { facings: 16, frames: 2 });
  makeSprite('crusher', 19, 19, (p, u, v, f) => {
    const sw = f ? 1 : -1;
    let d = ell(u, v, -0.5, 0, 3.2, 2.2); if (d < 1) p.L(dome(d, 4) + 1.5, chit, 0.9);
    d = ell(u, v, 3.2, 0, 2.4, 3.6); if (d < 1 && u > 1.8) p.L(dome(d, 3) + 3.5, chit2, 1);
    for (const lu of [-2, 0, 1.8]) for (const side of [-1, 1]) {
      const k = sw * side * (lu > 0 ? 1 : -1) * 0.8;
      if (segd(u, v, lu, side * 1.5, lu + k, side * 4.3) < 0.6) p.L(1.6, chit, 0.7);
    }
    if (segd(u, v, -3, 0, -7.5, sw) < 0.7) p.L(1.8, chit, 0.8);
  }, { facings: 16, frames: 2 });
  makeSprite('queen', 29, 29, (p, u, v, f) => {
    const sw = f ? 1 : -1;
    let d = ell(u, v, -1, 0, 4.5, 2.6); if (d < 1) p.L(dome(d, 5) + 2, chit, 0.95);
    d = ell(u, v, 4.2, 0, 2.3, 1.3); if (d < 1) p.L(dome(d, 3) + 4, chit2, 1);
    // crest fan
    d = ell(u, v, 2.2, 0, 3.8, 6); if (d < 1 && u < 3.4 && u > 0.4) p.L(3 + (1 - d) * 3, [0.09, 0.1, 0.14], 1);
    for (const lu of [-3, -1, 1, 2.5]) for (const side of [-1, 1]) {
      const k = sw * side * (lu > 0 ? 1 : -1) * 1.2;
      if (segd(u, v, lu, side * 2, lu + k, side * 7) < 0.6) p.L(2, chit, 0.7);
    }
    if (segd(u, v, -5, 0, -13, sw * 2) < 0.7) p.L(2, chit, 0.8);
    // eyes glint
    if (ell(u, v, 5.2, 0, 0.6, 0.9) < 1) p.L(8, [0.4, 0.05, 0.05], 1, [0.6, 0.05, 0.02]);
  }, { facings: 16, frames: 2 });

  // ---------- husks ----------
  const humanoid = (cloth, skin, armsOut, s = 1, extra) => (p, u, v, f) => {
    u /= s; v /= s;
    const sw = f ? 1 : -1;
    let d = ell(u, v, 0, 0, 0.9, 1.6); if (d < 1) p.L((dome(d, 1.2) + 2.2) * s, cloth, 0.2);
    d = ell(u, v, 0.25, 0, 0.75, 0.75); if (d < 1) p.L((dome(d, 1) + 3.3) * s, skin, 0.35);
    for (const side of [-1, 1]) {
      const ax = armsOut ? 1.9 : -0.4 + sw * side * 0.4, ay = side * (armsOut ? 1.0 + sw * side * 0.15 : 1.9);
      if (segd(u, v, 0.1, side * 1.25, ax, ay) < 0.36) p.L(2.4 * s, skin, 0.3);
    }
    if (extra) extra(p, u, v, f, s);
  };
  makeSprite('shambler', 7, 7, humanoid([0.28, 0.3, 0.33], [0.55, 0.6, 0.47], true), { facings: 16, frames: 2 });
  makeSprite('runner', 7, 7, humanoid([0.4, 0.2, 0.15], [0.62, 0.55, 0.47], false), { facings: 16, frames: 2 });
  makeSprite('bloater', 11, 11, humanoid([0.3, 0.3, 0.25], [0.55, 0.58, 0.3], true, 1, (p, u, v) => {
    const d = ell(u, v, -0.2, 0, 2.3, 2.4);
    if (d < 1) {
      const pust = (Math.sin(u * 4.1) * Math.sin(v * 3.7) > 0.55);
      p.L(dome(d, 2.5) + 1.8, pust ? [0.7, 0.75, 0.2] : [0.5, 0.52, 0.26], 0.7, pust ? [0.45, 0.55, 0.05] : null);
    }
  }), { facings: 16, frames: 2 });
  makeSprite('brute', 15, 15, humanoid([0.25, 0.22, 0.2], [0.6, 0.5, 0.45], false, 2.2, (p, u, v, f, s) => {
    if (segd(u, v, 0, 1.2, 1.9, 1.4) < 0.7) p.L(3 * s, [0.6, 0.4, 0.35], 0.4);
  }), { facings: 16, frames: 2 });
  makeSprite('abom', 25, 25, (p, u, v, f) => {
    const sw = f ? 1 : -1;
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9, cx = Math.cos(a) * 2.5 * (i % 3 ? 1 : 0.4), cy = Math.sin(a) * 2.8;
      const d = ell(u, v, cx, cy, 2.6, 2.3);
      if (d < 1) p.L(dome(d, 4) + 2 + (i % 2), i % 2 ? [0.55, 0.3, 0.3] : [0.45, 0.42, 0.35], 0.6);
    }
    for (const [hx, hy] of [[4, -1.5], [3.4, 2.4], [4.5, 0.8]]) { const d = ell(u, v, hx, hy, 0.9, 0.9); if (d < 1) p.L(dome(d, 1) + 7, [0.6, 0.62, 0.5], 0.4); }
    for (const side of [-1, 1]) if (segd(u, v, 1, side * 3, 6, side * (4 + sw)) < 0.6) p.L(3.5, [0.55, 0.45, 0.4], 0.4);
  }, { facings: 16, frames: 2 });

  // ---------- swarm ----------
  const chitR = [0.26, 0.16, 0.11];
  makeSprite('mite', 5, 5, (p, u, v, f) => {
    const d = ell(u, v, 0, 0, 1.3, 0.85); if (d < 1) p.L(dome(d, 1.2) + 0.8, chitR, 0.8, u < -0.2 ? [0.02, 0.08, 0.25] : null);
    if (segd(u, v, 0, 0, f ? 0.4 : -0.4, 1.7) < 0.3 || segd(u, v, 0, 0, f ? -0.4 : 0.4, -1.7) < 0.3) p.L(0.6, chitR, 0.5);
  }, { facings: 16, frames: 2 });
  makeSprite('leaper', 11, 11, (p, u, v, f) => {
    let d = ell(u, v, 0.3, 0, 1.9, 0.9); if (d < 1) p.L(dome(d, 1.5) + 1, [0.35, 0.3, 0.14], 0.8);
    d = ell(u, v, 2.3, 0, 0.8, 0.6); if (d < 1) p.L(dome(d, 1) + 1.5, [0.3, 0.26, 0.12], 0.9, [0.05, 0.12, 0.3]);
    for (const side of [-1, 1]) {
      const kx = f ? -1.2 : -2.2;
      if (segd(u, v, -0.5, side * 0.6, kx, side * 2.4) < 0.35 || segd(u, v, kx, side * 2.4, -3.4, side * 1.2) < 0.35) p.L(1.8, [0.3, 0.25, 0.12], 0.6);
    }
  }, { facings: 16, frames: 2 });
  makeSprite('burrower', 13, 13, (p, u, v, f) => {
    const sw = f ? 0.3 : -0.3;
    for (let i = 0; i < 4; i++) { const cu = 2.2 - i * 1.5, cv = (i % 2 ? sw : -sw); const d = ell(u, v, cu, cv, 1.2, 1.2 - i * 0.12); if (d < 1) p.L(dome(d, 2) + 1, i ? [0.4, 0.3, 0.25] : [0.5, 0.42, 0.3], 0.7); }
    const d = ell(u, v, 3.4, 0, 0.8, 1.4); if (d < 1) p.L(dome(d, 1.5) + 2, [0.25, 0.22, 0.2], 1);
  }, { facings: 16, frames: 2 });
  makeSprite('spiker', 13, 13, (p, u, v, f) => {
    const d = ell(u, v, 0, 0, 1.8, 1.4); if (d < 1) p.L(dome(d, 2) + 1, [0.2, 0.18, 0.22], 0.8);
    for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + (f ? 0.2 : 0); if (segd(u, v, 0, 0, Math.cos(a) * 3.8, Math.sin(a) * 3.2) < 0.3) p.L(2.5, [0.3, 0.35, 0.5], 1, Math.hypot(u, v) > 2.6 ? [0.05, 0.25, 0.6] : null); }
  }, { facings: 16, frames: 2 });
  makeSprite('brood', 27, 27, (p, u, v, f) => {
    let d = ell(u, v, -2, 0, 6, 4.5);
    if (d < 1) { const egg = Math.sin(u * 2.2) * Math.sin(v * 2.5) > 0.5; p.L(dome(d, 5) + 1.5, egg ? [0.3, 0.45, 0.6] : chitR, 0.8, egg ? [0.05, 0.2, 0.45] : null); }
    d = ell(u, v, 4, 0, 2.2, 1.8); if (d < 1) p.L(dome(d, 2) + 4, [0.3, 0.2, 0.14], 1);
    for (const lu of [-1, 1, 3]) for (const side of [-1, 1]) if (segd(u, v, lu, side * 1.5, lu + (f ? 1 : -1) * side, side * 6.5) < 0.5) p.L(2, chitR, 0.7);
  }, { facings: 16, frames: 2 });

  // ---------- marines ----------
  makeSprite('marine', 7, 7, (p, u, v, f) => {
    const sw = f ? 1 : -1;
    let d = ell(u, v, -0.1, 0, 0.9, 1.35); if (d < 1) p.L(dome(d, 1) + 2.4, [0.3, 0.36, 0.22], 0.3);
    d = ell(u, v, 0.15, 0, 0.72, 0.72); if (d < 1) p.L(dome(d, 1) + 3.6, [0.24, 0.3, 0.18], 0.5);
    if (segd(u, v, 0.4, 0.55, 2.6, 0.45) < 0.38) p.L(3.2, [0.12, 0.12, 0.13], 0.8);
    if (ell(u, v, 0.6, -0.55, 0.35, 0.35) < 1) p.L(4, [1, 0.95, 0.8], 0.5, [1, 0.9, 0.7]);
    for (const side of [-1, 1]) if (ell(u, v, sw * side * 0.6, side * 0.7, 0.5, 0.4) < 1) p.L(1, [0.18, 0.2, 0.15], 0.2);
  }, { facings: 16, frames: 2 });

  // ---------- buildings ----------
  const metal = [0.42, 0.44, 0.42], metalD = [0.28, 0.3, 0.29], hazard = (u, v) => (Math.floor((u + v) / 1.5) % 2 === 0) ? [0.75, 0.6, 0.12] : [0.12, 0.12, 0.12];
  makeSprite('hq', 34, 26, (p, u, v) => {
    // landing pad
    if (Math.abs(u) < 16.5 && Math.abs(v) < 12.5) {
      const edge = Math.abs(u) > 15 || Math.abs(v) > 11;
      p.L(1, edge ? hazard(u, v) : [0.36, 0.36, 0.35], 0.25);
    }
    // wings (swept)
    const wu = u + 3;
    if (wu > -6 && wu < 4 && Math.abs(v) < 11 - (wu + 6) * 0.7 && Math.abs(v) > 2) p.L(5 + (wu + 6) * 0.1, metalD, 0.6);
    // hull
    let d = ell(u, v, 0, 0, 14, 4.2);
    if (d < 1) {
      const panel = Math.abs(((u + 20) % 3.3) - 1.65) < 0.25;
      p.L(dome(d, 7) + 4, panel ? metalD : metal, 0.7);
    }
    // cockpit
    d = ell(u, v, 10.5, 0, 2.2, 1.6); if (d < 1) p.L(dome(d, 1) + 9.8, [0.15, 0.3, 0.35], 1, [0.1, 0.45, 0.55]);
    // engines
    for (const side of [-1, 1]) {
      d = ell(u, v, -12.5, side * 3, 2.4, 1.6); if (d < 1) p.L(dome(d, 2) + 6, metalD, 0.8);
      if (ell(u, v, -14.3, side * 3, 0.7, 1.1) < 1) p.L(7, [0.6, 0.8, 1], 0.5, [0.4, 0.7, 1]);
    }
    // nav lights
    if (ell(u, v, -5.5, -10, 0.6, 0.6) < 1) p.L(7, [1, 0.2, 0.1], 0.5, [1, 0.1, 0.05]);
    if (ell(u, v, -5.5, 10, 0.6, 0.6) < 1) p.L(7, [0.2, 1, 0.3], 0.5, [0.1, 1, 0.2]);
  });
  // walls: 16 autotile variants (N,E,S,W bitmask)
  makeSprite('wall', 8, 8, (p, u, v, f) => {
    const n = f & 1, e = f & 2, s = f & 4, w = f & 8;
    const inCore = Math.abs(u) < 2.6 && Math.abs(v) < 2.6;
    const inArm = (n && Math.abs(u) < 2.6 && v < 0) || (s && Math.abs(u) < 2.6 && v > 0) || (e && Math.abs(v) < 2.6 && u > 0) || (w && Math.abs(v) < 2.6 && u < 0);
    if (inCore || inArm) {
      const rivet = ((Math.floor(u + 4) * 7 + Math.floor(v + 4) * 13) % 11) === 0;
      const edge = Math.max(Math.abs(u), Math.abs(v));
      p.L(6 - (Math.abs(u) > 2 && Math.abs(v) > 2 ? 0.5 : 0), rivet ? [0.55, 0.52, 0.45] : [0.38, 0.36, 0.33], 0.45);
    } else if (Math.abs(u) < 3.6 && Math.abs(v) < 3.6 && !(n || e || s || w)) p.L(1.5, [0.3, 0.28, 0.25], 0.2);
  }, { frames: 16 });
  makeSprite('light', 8, 8, (p, u, v) => {
    if (Math.abs(u) < 2.5 && Math.abs(v) < 2.5) p.L(1.2, hazard(u, v), 0.3);
    if (ell(u, v, 0, 0, 1, 1) < 1) p.L(9, metalD, 0.6);
    const d = ell(u, v, 0, -1.2, 1.8, 1.1); if (d < 1) p.L(14 + dome(d, 1), [1, 0.97, 0.85], 0.4, [1, 0.95, 0.8]);
  });
  makeSprite('extractor', 16, 16, (p, u, v, f) => {
    if (Math.abs(u) < 7.5 && Math.abs(v) < 7.5) p.L(1.5, (Math.abs(u) > 6.2 || Math.abs(v) > 6.2) ? hazard(u, v) : [0.33, 0.32, 0.3], 0.3);
    let d = ell(u, v, 0, 0, 4.2, 4.2); if (d < 1) p.L(dome(d, 2) + 5.5, metal, 0.65);
    const a = f * Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a);
    if (segd(u, v, -ca * 6, -sa * 6, ca * 6, sa * 6) < 0.9) p.L(8.5, [0.6, 0.35, 0.1], 0.6);
    if (ell(u, v, 0, 0, 1.3, 1.3) < 1) p.L(9.5, metalD, 0.8);
    if (ell(u, v, 5.8, -5.8, 0.8, 0.8) < 1) p.L(3, [1, 0.5, 0.1], 0.3, [1, 0.45, 0.05]);
  }, { frames: 4 });
  makeSprite('habitat', 16, 16, (p, u, v) => {
    if (ell(u, v, 0, 0, 7.6, 7.6) < 1) p.L(1.5, [0.35, 0.35, 0.34], 0.3);
    const d = ell(u, v, 0, 0, 6.6, 6.6);
    if (d < 1) {
      const r = Math.sqrt(d), a = Math.atan2(v, u);
      const win = r > 0.62 && r < 0.76 && Math.abs(((a / TAU * 10 + 10) % 1) - 0.5) < 0.2;
      p.L(dome(d, 7) + 1.5, win ? [0.9, 0.7, 0.45] : [0.72, 0.72, 0.69], 0.45, win ? [1, 0.7, 0.35] : null);
    }
    if (ell(u, v, 0, 0, 1.2, 1.2) < 1) p.L(9.2, [0.5, 0.5, 0.5], 0.8, [0.3, 1, 0.4]);
  });
  makeSprite('barracks', 16, 16, (p, u, v) => {
    if (Math.abs(u) < 7.5 && Math.abs(v) < 7.5) p.L(1, [0.32, 0.31, 0.28], 0.2);
    if (Math.abs(u) < 6.8 && Math.abs(v) < 5) {
      const rib = Math.abs(((u + 10) % 2) - 1) < 0.25;
      p.L(1 + 6 * Math.sqrt(Math.max(0, 1 - (v / 5) ** 2)), rib ? [0.24, 0.27, 0.19] : [0.32, 0.37, 0.25], 0.35);
    }
    if (Math.abs(u - 6.9) < 0.8 && Math.abs(v) < 1.5) p.L(4, [0.2, 0.6, 0.3], 0.5, [0.1, 0.9, 0.3]);
  });
  makeSprite('tbase', 8, 8, (p, u, v) => {
    const r = Math.hypot(u, v);
    if (r < 3.8 && r > 2.4) p.L(2.2 + Math.sin(Math.atan2(v, u) * 5) * 0.3, [0.5, 0.45, 0.32], 0.15);
    else if (r <= 2.4) p.L(1.2, [0.3, 0.3, 0.3], 0.4);
  });
  makeSprite('sentry', 9, 9, (p, u, v) => {
    let d = ell(u, v, -0.2, 0, 1.3, 1.1); if (d < 1) p.L(dome(d, 1) + 4, [0.36, 0.38, 0.3], 0.55);
    if (segd(u, v, 0.4, 0, 3.7, 0) < 0.48) p.L(4.6, [0.14, 0.14, 0.15], 0.85);
    d = ell(u, v, -0.4, 1.3, 0.8, 0.55); if (d < 1) p.L(3.8, [0.25, 0.27, 0.22], 0.4);
    if (ell(u, v, 0.6, -0.8, 0.3, 0.3) < 1) p.L(5.2, [1, 0.1, 0.1], 0.3, [1, 0.05, 0.05]);
  }, { facings: 16 });
  makeSprite('flamer', 9, 9, (p, u, v) => {
    let d = ell(u, v, -0.6, 0, 1.2, 1.4); if (d < 1) p.L(dome(d, 1.5) + 3.5, [0.6, 0.22, 0.08], 0.6);
    if (segd(u, v, 0.3, 0, 3.4, 0) < 0.5) p.L(4.4, [0.2, 0.2, 0.2], 0.8);
    if (ell(u, v, 3.5, 0, 0.4, 0.4) < 1) p.L(4.6, [1, 0.6, 0.2], 0.3, [1, 0.5, 0.1]);
  }, { facings: 16 });
  makeSprite('mortarbase', 16, 16, (p, u, v) => {
    const r = Math.hypot(u, v);
    if (r < 7.6 && r > 5) p.L(2.8 + Math.sin(Math.atan2(v, u) * 8) * 0.4, [0.5, 0.45, 0.32], 0.15);
    else if (r <= 5) p.L(0.8, [0.26, 0.25, 0.23], 0.2);
    if (ell(u, v, 0, 0, 1.8, 1.8) < 1) p.L(7, [0.2, 0.22, 0.2], 0.7);
    if (ell(u, v, 0, 0, 1.0, 1.0) < 1) p.L(6, [0.05, 0.05, 0.05], 0.1);
    for (const [a, b] of [[-3, -3], [3, -3], [-3, 3]]) if (Math.abs(u - a) < 0.9 && Math.abs(v - b) < 0.6) p.L(1.8, [0.4, 0.38, 0.2], 0.5);
  });
  makeSprite('railbase', 16, 16, (p, u, v) => {
    const d = Math.max(Math.abs(u) * 0.87 + Math.abs(v) * 0.5, Math.abs(v));
    if (d < 7) p.L(3, d > 6 ? [0.2, 0.3, 0.45] : [0.3, 0.31, 0.33], 0.6, d > 6.2 ? [0.05, 0.25, 0.6] : null);
  });
  makeSprite('rail', 19, 19, (p, u, v) => {
    let d = ell(u, v, -0.5, 0, 2.6, 2.2); if (d < 1) p.L(dome(d, 1.5) + 5, [0.34, 0.36, 0.4], 0.7);
    for (const side of [-1, 1]) if (u > 0 && u < 8.5 && Math.abs(v - side * 0.9) < 0.5) {
      const coil = Math.abs((u % 2) - 1) < 0.35;
      p.L(7, coil ? [0.3, 0.6, 1] : [0.22, 0.23, 0.26], 0.9, coil ? [0.15, 0.45, 1] : null);
    }
  }, { facings: 16 });
  makeSprite('ore', 16, 16, (p, u, v) => {
    const rr = mulberry32(77);
    let best = 0;
    for (let i = 0; i < 9; i++) {
      const cx = (rr() - 0.5) * 9, cy = (rr() - 0.5) * 9, r = 1.6 + rr() * 2.2, hh = 3 + rr() * 6;
      const d = (Math.abs(u - cx) + Math.abs(v - cy) * 0.8) / r;
      if (d < 1) best = Math.max(best, hh * (1 - d));
    }
    if (best > 0.2) p.L(best + 0.5, [0.65 + best * 0.03, 0.7 + best * 0.03, 0.75], 1, [0.05 + best * 0.02, 0.05 + best * 0.02, 0.05 + best * 0.02]);
  });
  makeSprite('rubble', 8, 8, (p, u, v) => {
    const rr = mulberry32(Math.floor((u + 5) * 3) * 31 + Math.floor((v + 5) * 3) * 17);
    if (Math.hypot(u, v) < 3.8 && rr() > 0.35) p.L(rr() * 2.5 + 0.3, rr() > 0.5 ? [0.2, 0.19, 0.18] : [0.32, 0.3, 0.27], 0.3, rr() > 0.93 ? [0.6, 0.2, 0.03] : null);
  });
  makeSprite('rubble2', 16, 16, (p, u, v) => {
    const rr = mulberry32(Math.floor((u + 9) * 2) * 31 + Math.floor((v + 9) * 2) * 17);
    if (Math.hypot(u, v) < 7.5 && rr() > 0.3) p.L(rr() * 3.5 + 0.3, rr() > 0.5 ? [0.2, 0.19, 0.18] : [0.34, 0.32, 0.29], 0.3, rr() > 0.95 ? [0.7, 0.25, 0.03] : null);
  });
  makeSprite('pod', 9, 9, (p, u, v) => {
    const d = Math.max(Math.abs(u), Math.abs(v), (Math.abs(u) + Math.abs(v)) * 0.72);
    if (d < 3.8) p.L(6 - d * 0.6, [0.35, 0.36, 0.33], 0.7);
    if (ell(u, v, 0, 0, 1, 1) < 1) p.L(7, [1, 0.2, 0.1], 0.4, [1, 0.15, 0.05]);
  });
  makeSprite('jet', 21, 21, (p, u, v) => {
    let d = ell(u, v, 0, 0, 8, 1.4); if (d < 1) p.L(dome(d, 2) + 3, [0.3, 0.32, 0.3], 0.8);
    if (u > -5 && u < 1 && Math.abs(v) < 8 - (u + 5) * 1.2) p.L(3, [0.25, 0.27, 0.25], 0.8);
    if (u < -5 && u > -8 && Math.abs(v) < 3) p.L(2.8, [0.25, 0.27, 0.25], 0.8);
    if (ell(u, v, -8.3, 0, 0.6, 0.8) < 1) p.L(4, [1, 0.6, 0.3], 0.3, [1, 0.5, 0.2]);
  }, { facings: 16 });
  makeSprite('canister', 3, 3, (p, u, v) => { if (Math.hypot(u, v) < 1.5) p.L(2, [0.6, 0.6, 0.6], 0.8); });
}
