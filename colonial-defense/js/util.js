'use strict';
// ---------- constants & small helpers ----------
const W = 640, H = 360;          // logical (pixel-art) resolution
const TILE = 8;
const GW = W / TILE, GH = H / TILE; // 80 x 45 tile grid
const TAU = Math.PI * 2;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + (b - a) * Math.random();
const rndi = (a, b) => Math.floor(a + (b - a + 1) * Math.random());
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// value-gradient noise, seeded
function makeNoise(seed) {
  const r = mulberry32(seed);
  const p = new Uint8Array(512), gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { p[i] = i; const a = r() * TAU; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const g = (h, dx, dy) => gx[h] * dx + gy[h] * dy;
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const u = fade(xf), v = fade(yf);
    const x1 = lerp(g(aa, xf, yf), g(ba, xf - 1, yf), u);
    const x2 = lerp(g(ab, xf, yf - 1), g(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 1.4; // ~[-1,1]
  };
}
function fbm(n, x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, t = 0;
  for (let i = 0; i < oct; i++) { s += n(x * f, y * f) * a; t += a; a *= 0.5; f *= 2; }
  return s / t;
}
function hex(h) {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}
function mix3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

// binary min-heap keyed by float priority (for Dijkstra)
class Heap {
  constructor(n) { this.k = new Float32Array(n * 8); this.v = new Int32Array(n * 8); this.n = 0; }
  push(key, val) {
    let i = this.n++; const k = this.k, v = this.v;
    if (i >= k.length) { const nk = new Float32Array(k.length * 2); nk.set(k); this.k = nk; const nv = new Int32Array(v.length * 2); nv.set(v); this.v = nv; return this.push2(i, key, val); }
    return this.push2(i, key, val);
  }
  push2(i, key, val) {
    const k = this.k, v = this.v;
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v; const top = v[0]; this.topKey = k[0];
    const n = --this.n; const lk = k[n], lv = v[n]; let i = 0;
    while (true) {
      let c = i * 2 + 1; if (c >= n) break;
      if (c + 1 < n && k[c + 1] < k[c]) c++;
      if (k[c] >= lk) break;
      k[i] = k[c]; v[i] = v[c]; i = c;
    }
    k[i] = lk; v[i] = lv; return top;
  }
}
