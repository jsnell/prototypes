import { Rng } from './rng';

/**
 * Seeded 2D gradient noise (Perlin-style) plus fractal helpers.
 * Output of `noise` is roughly in [-1, 1].
 */
export class Noise2D {
  private readonly perm = new Uint8Array(512);
  private readonly gx = new Float32Array(256);
  private readonly gy = new Float32Array(256);

  constructor(seed: number) {
    const rng = new Rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) {
      const a = rng.next() * Math.PI * 2;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
    }
  }

  noise(x: number, y: number): number {
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const fx = x - xf;
    const fy = y - yf;
    const xi = xf & 255;
    const yi = yf & 255;
    const perm = this.perm;
    const gx = this.gx;
    const gy = this.gy;
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    const n00 = gx[aa] * fx + gy[aa] * fy;
    const n10 = gx[ba] * (fx - 1) + gy[ba] * fy;
    const n01 = gx[ab] * fx + gy[ab] * (fy - 1);
    const n11 = gx[bb] * (fx - 1) + gy[bb] * (fy - 1);
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.41;
  }

  /** Fractal Brownian motion, roughly in [-1, 1]. */
  fbm(x: number, y: number, octaves: number, lacunarity = 2.03, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(x, y);
      norm += amp;
      amp *= gain;
      // Rotate slightly between octaves to hide lattice alignment.
      const nx = x * 0.8 - y * 0.6;
      y = (x * 0.6 + y * 0.8) * lacunarity + 17.3;
      x = nx * lacunarity + 31.7;
    }
    return sum / norm;
  }

  /** Ridged multifractal in [0, 1]; sharp crests where the base noise crosses zero. */
  ridged(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let weight = 1;
    for (let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(this.noise(x, y));
      n *= n;
      n *= weight;
      weight = Math.min(1, n * 1.8);
      sum += n * amp;
      norm += amp;
      amp *= 0.5;
      const nx = x * 0.8 - y * 0.6;
      y = (x * 0.6 + y * 0.8) * 2.07 + 5.1;
      x = nx * 2.07 + 11.9;
    }
    return sum / norm;
  }
}

/**
 * A tileable noise texture for very cheap per-pixel detail lookups.
 * Values are in roughly [-1, 1]; `size` must be a power of two.
 */
export class NoiseTile {
  readonly size: number;
  readonly mask: number;
  readonly data: Float32Array;

  constructor(seed: number, size = 256, baseFreq = 8, octaves = 4) {
    this.size = size;
    this.mask = size - 1;
    this.data = new Float32Array(size * size);
    const n = new Noise2D(seed);
    // Tileable by blending four offset copies (standard periodic trick).
    const period = baseFreq;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        let sum = 0;
        let amp = 1;
        let norm = 0;
        let f = period;
        for (let o = 0; o < octaves; o++) {
          const a = n.noise(u * f, v * f);
          const b = n.noise((u - 1) * f, v * f);
          const c = n.noise(u * f, (v - 1) * f);
          const d = n.noise((u - 1) * f, (v - 1) * f);
          const val = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
          sum += val * amp;
          norm += amp;
          amp *= 0.5;
          f *= 2;
        }
        this.data[y * size + x] = (sum / norm) * 1.6;
      }
    }
  }

  /** Nearest-neighbour lookup at integer-ish coordinates (wraps). */
  at(x: number, y: number): number {
    return this.data[((y | 0) & this.mask) * this.size + ((x | 0) & this.mask)];
  }

  /** Bilinear lookup (wraps). */
  sample(x: number, y: number): number {
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const fx = x - xf;
    const fy = y - yf;
    const m = this.mask;
    const s = this.size;
    const x0 = xf & m;
    const x1 = (xf + 1) & m;
    const y0 = (yf & m) * s;
    const y1 = ((yf + 1) & m) * s;
    const d = this.data;
    const a = d[y0 + x0];
    const b = d[y0 + x1];
    const c = d[y1 + x0];
    const e = d[y1 + x1];
    return a + (b - a) * fx + (c - a + (a - b - c + e) * fx) * fy;
  }
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
