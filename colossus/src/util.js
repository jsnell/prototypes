export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2i(x, z, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class Noise2 {
  constructor(seed) { this.s = seed | 0; }
  value(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const s = this.s;
    const a = hash2i(xi, zi, s), b = hash2i(xi + 1, zi, s);
    const c = hash2i(xi, zi + 1, s), d = hash2i(xi + 1, zi + 1, s);
    return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
  }
  fbm(x, z, oct = 4) {
    let f = 1, a = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += this.value(x * f + o * 17.3, z * f - o * 9.1) * a;
      norm += a; f *= 2; a *= 0.5;
    }
    return sum / norm;
  }
}

export function weighted(obj) {
  let tot = 0;
  for (const k in obj) tot += Math.max(0, obj[k]);
  let r = Math.random() * tot;
  let last = null;
  for (const k in obj) {
    last = k;
    r -= Math.max(0, obj[k]);
    if (r <= 0) return k;
  }
  return last;
}

// random direction, returns [x,y,z]
export function randDir(out = [0, 0, 0]) {
  const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  out[0] = s * Math.cos(th); out[1] = u; out[2] = s * Math.sin(th);
  return out;
}

// distance from point to segment (2D)
export function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  const qx = ax + dx * t - px, qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

export function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
