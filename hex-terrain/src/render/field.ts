import { DIR_VECTORS, HexLayout, SQRT3 } from '../core/hex';
import { Noise2D, NoiseTile, smoothstep } from '../core/noise';
import { hash3 } from '../core/rng';
import { BIOME_LIST, type Biome } from '../model/biomes';
import type { HexMap } from '../model/map';
import { buildHexPaths, findCrossings, pathDistance2, type Crossing, type HexPaths } from './paths';

/** Base ground height per elevation level, in units of hex size. */
export const LEVEL_BASE = [0.04, 0.15, 0.29, 0.44, 0.6];

const MAX_CAND = 7;

/** Scratch record filled by TerrainField.prepare() for one world point. */
export class Sample {
  n = 0;
  readonly idx = new Int32Array(MAX_CAND);
  readonly dist = new Float32Array(MAX_CAND);
  /** Normalised height blend weights. */
  readonly wh = new Float32Array(MAX_CAND);
  /** Normalised colour (biome) blend weights. */
  readonly wc = new Float32Array(MAX_CAND);
  /** Candidate with the largest colour weight. */
  owner = -1;
  /** Unwarped hex under the point (-1 outside the map). */
  hex = -1;
  /** Distance to the nearest road / river centre-line (Infinity if none nearby). */
  road = Infinity;
  river = Infinity;
  /** Water surface height, or -Infinity if no water body is nearby. */
  waterLevel = -Infinity;
  /** Blended base height of the levels (no relief). */
  base = 0;
  /** Swamp pool mask 0..1. */
  pool = 0;
}

export interface FieldHex {
  cx: number;
  cy: number;
  biome: Biome;
  level: number;
  water: boolean;
  surface: number;
  depth: number;
  flatten: number;
  flattenRadius: number;
  roads: HexPaths | null;
  rivers: HexPaths | null;
  bridges: Crossing[];
  seed: number;
}

/**
 * Continuous terrain description derived from a HexMap: for any world point it
 * yields biome blend weights, ground height, water level and path distances.
 */
export class TerrainField {
  readonly map: HexMap;
  readonly layout: HexLayout;
  readonly s: number;
  readonly a: number;
  hexes: FieldHex[] = [];
  /** Neighbour index table: nbr[i * 6 + d], -1 outside the map. */
  readonly nbr: Int32Array;
  // Flat per-hex copies of hot fields for the per-pixel loops.
  private readonly hx: Float32Array;
  private readonly hy: Float32Array;
  private readonly hWater: Uint8Array;
  private readonly hMarsh: Uint8Array;
  private readonly hPaths: Uint8Array;
  private readonly hBase: Float32Array;
  private readonly hSurface: Float32Array;

  readonly warpAmp: number;
  readonly bwHeight: number;
  readonly bwColor: number;
  readonly roadWidth: number;
  readonly riverWidth: number;
  readonly valleyWidth: number;
  /** Maximum distance from a hex at which its data can influence a point. */
  readonly influence: number;

  /** Tileable noise shared with the surface shader: large, mid and fine scale. */
  readonly t1: NoiseTile;
  readonly t2: NoiseTile;
  readonly t3: NoiseTile;
  private readonly nRelief: Noise2D;
  private readonly kWarp: number;
  private readonly kPool: number;
  // Per-pixel memo of relief noise, keyed by relief kind and level.
  private readonly memoKey = new Int32Array(MAX_CAND);
  private readonly memoA = new Float32Array(MAX_CAND);
  private readonly memoB = new Float32Array(MAX_CAND);
  private memoN = 0;

  constructor(map: HexMap, layout: HexLayout) {
    this.map = map;
    this.layout = layout;
    this.s = layout.size;
    this.a = layout.apothem;
    this.warpAmp = this.s * 0.2;
    this.bwHeight = this.a * 0.6;
    this.bwColor = this.a * 0.24;
    this.roadWidth = this.s * 0.06;
    this.riverWidth = this.s * 0.07;
    this.valleyWidth = this.s * 0.34;
    this.influence = this.warpAmp + this.bwHeight + this.valleyWidth + 2;
    this.t1 = tile(map.seed * 3 + 101, 8, 4);
    this.t2 = tile(map.seed * 5 + 202, 16, 3);
    this.t3 = tile(map.seed * 11 + 303, 64, 2);
    this.nRelief = new Noise2D(map.seed * 7 + 5);
    const n = map.size;
    this.hx = new Float32Array(n);
    this.hy = new Float32Array(n);
    this.hWater = new Uint8Array(n);
    this.hMarsh = new Uint8Array(n);
    this.hPaths = new Uint8Array(n);
    this.hBase = new Float32Array(n);
    this.hSurface = new Float32Array(n);
    this.nbr = new Int32Array(map.size * 6);
    for (let i = 0; i < map.size; i++) for (let d = 0; d < 6; d++) this.nbr[i * 6 + d] = map.neighbor(i, d);
    this.kWarp = 32 / (this.s * 0.9);
    this.kPool = 16 / (this.s * 0.28);
    this.rebuildAll();
  }

  // ---- per-hex precomputation ------------------------------------------

  rebuildAll(): void {
    const n = this.map.size;
    this.hexes = new Array(n);
    for (let i = 0; i < n; i++) this.hexes[i] = this.buildHex(i);
    for (let i = 0; i < n; i++) this.finishHex(i);
  }

  /** Recompute changed hexes plus their neighbours (lake levels and path joins depend on them). */
  rebuild(indices: Iterable<number>): Set<number> {
    const touched = new Set<number>();
    for (const i of indices) {
      touched.add(i);
      for (const nb of this.map.neighbors(i)) touched.add(nb);
    }
    for (const i of touched) this.hexes[i] = this.buildHex(i);
    for (const i of touched) this.finishHex(i);
    return touched;
  }

  private buildHex(i: number): FieldHex {
    const map = this.map;
    const { q, r } = map.axialOf(i);
    const biome = BIOME_LIST[map.biome[i]];
    const level = map.level[i];
    const feature = map.featureAt(i);
    let flatten = 0;
    let flattenRadius = 0.6;
    if (feature === 'village' || feature === 'town') {
      flatten = 0.8;
      flattenRadius = feature === 'town' ? 0.95 : 0.65;
    } else if (feature === 'farm') {
      flatten = 0.6;
      flattenRadius = 0.95;
    } else if (feature === 'castle') {
      flatten = 0.35;
      flattenRadius = 0.45;
    }
    return {
      cx: this.layout.centerX(q),
      cy: this.layout.centerY(q, r),
      biome,
      level,
      water: biome.water,
      surface: 0,
      depth: 0,
      flatten,
      flattenRadius,
      roads: null,
      rivers: null,
      bridges: [],
      seed: hash3(q, r, 91, map.seed),
    };
  }

  private finishHex(i: number): void {
    const h = this.hexes[i];
    const map = this.map;
    const s = this.s;
    if (h.water) {
      if (h.biome.id === 'ocean') {
        h.surface = 0;
        // Deeper water further from land.
        const dist = this.landDistance(i, 4);
        h.depth = s * (0.1 + 0.06 * Math.min(dist, 4));
      } else {
        // Lakes sit just below the lowest surrounding land.
        let lvl = h.level;
        for (const nb of map.neighbors(i)) {
          const o = this.hexes[nb];
          if (o && !o.water) lvl = Math.min(lvl, o.level);
        }
        h.surface = LEVEL_BASE[lvl] * s - 0.015 * s;
        h.depth = s * 0.12;
      }
    }

    const roadMask = h.water ? 0 : map.roads[i];
    const riverMask = map.rivers[i];
    const both = roadMask & riverMask;
    const mountainous = h.level >= 3;
    h.roads = buildHexPaths(this.layout, h.cx, h.cy, roadMask, {
      wiggle: mountainous ? 0.2 : 0.07,
      switchbacks: mountainous ? 2 : 0,
      // Where a road and river share an edge, the road runs alongside the bank.
      endOffset: both ? (d) => ((both >> d) & 1 ? this.s * 0.3 : 0) : undefined,
      seed: h.seed,
    });
    h.rivers = buildHexPaths(this.layout, h.cx, h.cy, riverMask, {
      wiggle: h.water ? 0.05 : 0.16,
      switchbacks: 0,
      spokeLength: h.water ? 0.4 : undefined,
      seed: h.seed ^ 0x5bd1e995,
    });
    h.bridges = h.roads && h.rivers ? findCrossings(h.roads, h.rivers, this.s * 0.3) : [];

    this.hx[i] = h.cx;
    this.hy[i] = h.cy;
    this.hWater[i] = h.water ? 1 : 0;
    this.hMarsh[i] = h.biome.relief === 'marsh' ? 1 : 0;
    this.hPaths[i] = h.roads || h.rivers ? 1 : 0;
    this.hBase[i] = LEVEL_BASE[h.level] * s;
    this.hSurface[i] = h.surface;
  }

  /** Hex steps from a water hex to the nearest land (capped). */
  private landDistance(i: number, cap: number): number {
    const map = this.map;
    let frontier = [i];
    const seen = new Set(frontier);
    for (let dist = 1; dist <= cap; dist++) {
      const next: number[] = [];
      for (const f of frontier) {
        for (const nb of map.neighbors(f)) {
          if (seen.has(nb)) continue;
          if (!map.isWater(nb)) return dist;
          seen.add(nb);
          next.push(nb);
        }
      }
      frontier = next;
    }
    return cap + 1;
  }

  // ---- sampling ----------------------------------------------------------

  /** Unwarped hex index at a world point, or -1 (allocation-free). */
  hexIndexAt(x: number, y: number): number {
    const px = (x - this.layout.originX) / this.s;
    const py = (y - this.layout.originY) / this.s;
    const fq = (2 / 3) * px;
    const fr = (-1 / 3) * px + (SQRT3 / 3) * py;
    const fs = -fq - fr;
    let q = Math.round(fq);
    let r = Math.round(fr);
    const rs = Math.round(fs);
    const dq = Math.abs(q - fq);
    const dr = Math.abs(r - fr);
    const ds = Math.abs(rs - fs);
    if (dq > dr && dq > ds) q = -r - rs;
    else if (dr > ds) r = -q - rs;
    const row = r + (q - (q & 1)) / 2;
    if (q < 0 || row < 0 || q >= this.map.cols || row >= this.map.rows) return -1;
    return row * this.map.cols + q;
  }

  /**
   * Fill `S` with blend weights, path distances and water level at (x, y).
   * Returns false if the point is outside the map.
   */
  prepare(x: number, y: number, S: Sample): boolean {
    const hexUnwarped = this.hexIndexAt(x, y);
    S.hex = hexUnwarped;
    if (hexUnwarped < 0) {
      S.n = 0;
      return false;
    }

    // Domain-warp the point so biome borders wander organically.
    const kw = this.kWarp;
    const wx = x + this.warpAmp * this.t1.sample(x * kw, y * kw);
    const wy = y + this.warpAmp * this.t1.sample(x * kw + 97.3, y * kw + 41.7);
    let c = this.hexIndexAt(wx, wy);
    if (c < 0) c = hexUnwarped;

    const nbr = this.nbr;
    const a = this.a;
    const hx = this.hx;
    const hy = this.hy;
    const hWater = this.hWater;
    const vx = wx - hx[c];
    const vy = wy - hy[c];
    const bwH = this.bwHeight;
    const bwC = this.bwColor;
    const grain = this.t3.sample(x * 1.2, y * 1.2) * 0.3;
    S.idx[0] = c;
    S.dist[0] = -1;
    S.wh[0] = 1;
    S.wc[0] = 1;
    let n = 1;
    let sumH = 1;
    let sumC = 1;
    for (let d = 0; d < 6; d++) {
      // Distance to the shared edge (the warped point lies inside hex c).
      const dk = a - (vx * DIR_VECTORS[d][0] + vy * DIR_VECTORS[d][1]);
      if (dk >= bwH) continue;
      const nb = nbr[c * 6 + d];
      if (nb < 0) continue;
      // Water reaches less far into land so coastlines hug hex edges.
      const water = hWater[nb];
      let t = dk / (water ? bwH * 0.6 : bwH);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const rh = 1 - t * t * (3 - 2 * t);
      t = dk / (water ? bwC * 0.6 : bwC) + grain;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const rc = 1 - t * t * (3 - 2 * t);
      S.idx[n] = nb;
      S.dist[n] = dk;
      S.wh[n] = rh;
      S.wc[n] = rc;
      sumH += rh;
      sumC += rc;
      n++;
    }
    S.n = n;

    let base = 0;
    let wl = -Infinity;
    let wlW = 0;
    let best = 0;
    let bestW = -1;
    const invH = 1 / sumH;
    const invC = 1 / sumC;
    for (let k = 0; k < n; k++) {
      const wh = S.wh[k] * invH;
      const wc = S.wc[k] * invC;
      S.wh[k] = wh;
      S.wc[k] = wc;
      if (wc > bestW) {
        bestW = wc;
        best = k;
      }
      const id = S.idx[k];
      base += wh * this.hBase[id];
      if (hWater[id] && wh > wlW) {
        wlW = wh;
        wl = this.hSurface[id];
      }
    }
    S.owner = S.idx[best];
    S.base = base;
    S.waterLevel = wlW > 0.02 ? wl : -Infinity;

    // Distances to roads and rivers (searched around the unwarped hex).
    const lim = this.valleyWidth * 1.5;
    let road2 = lim * lim;
    let river2 = lim * lim;
    const hexes = this.hexes;
    for (let d = -1; d < 6; d++) {
      const idx = d < 0 ? hexUnwarped : nbr[hexUnwarped * 6 + d];
      if (idx < 0 || !this.hPaths[idx]) continue;
      const h = hexes[idx];
      if (h.roads) {
        const d2 = pathDistance2(h.roads, x, y, road2);
        if (d2 < road2) road2 = d2;
      }
      if (h.rivers) {
        const d2 = pathDistance2(h.rivers, x, y, river2);
        if (d2 < river2) river2 = d2;
      }
    }
    S.road = road2 >= lim * lim ? Infinity : Math.sqrt(road2);
    S.river = river2 >= lim * lim ? Infinity : Math.sqrt(river2);

    // Swamp pools.
    let swamp = 0;
    for (let k = 0; k < n; k++) if (this.hMarsh[S.idx[k]]) swamp += S.wc[k];
    if (swamp > 0) {
      const pn = this.t2.sample(x * this.kPool + 55, y * this.kPool + 13) * 0.8;
      S.pool = smoothstep(0.12, 0.2, pn) * smoothstep(0.35, 0.8, swamp);
    } else S.pool = 0;
    return true;
  }

  /** Ground height at (x, y); `S` must have been prepared at the same point. */
  height(x: number, y: number, S: Sample): number {
    const s = this.s;
    const hexes = this.hexes;
    const roadNear = S.road < Infinity ? 1 - smoothstep(this.roadWidth, this.roadWidth * 4, S.road) : 0;
    this.memoN = 0;
    let H = 0;
    for (let k = 0; k < S.n; k++) {
      const w = S.wh[k];
      if (w < 0.002) continue;
      const h = hexes[S.idx[k]];
      H += w * this.hexHeight(h, x, y, roadNear);
    }

    if (S.pool > 0) H -= S.pool * s * 0.015;

    // Rivers carve a valley down to the base level, then a channel.
    if (S.river < Infinity) {
      const valley = 1 - smoothstep(this.riverWidth, this.valleyWidth, S.river);
      const floor = Math.min(H, S.base - s * 0.02);
      H += (floor - H) * valley * valley * (3 - 2 * valley);
      const channel = 1 - smoothstep(0, this.riverWidth * 1.4, S.river);
      H -= channel * s * 0.025;
    }
    return H;
  }

  private hexHeight(h: FieldHex, x: number, y: number, roadNear: number): number {
    const s = this.s;
    if (h.water) {
      const floor = this.t2.sample(x * (16 / s), y * (16 / s));
      if (h.biome.id === 'lake') {
        // Lakes are bowls, so a lone lake hex reads as a rounded pond.
        const dist = Math.hypot(x - h.cx, y - h.cy) / this.a;
        const bowl = 0.25 + 0.75 * (1 - smoothstep(0.35, 1.3, dist + floor * 0.25));
        return h.surface + s * 0.03 - (h.depth + s * 0.03) * bowl;
      }
      return h.surface - h.depth * (0.85 + 0.15 * floor);
    }
    let relief = this.relief(h, x, y);
    // Roads cut through relief; settlements sit on levelled ground.
    let damp = roadNear * 0.7;
    if (h.flatten > 0) {
      const dist = Math.hypot(x - h.cx, y - h.cy) / this.a;
      damp = Math.max(damp, h.flatten * (1 - smoothstep(h.flattenRadius * 0.6, h.flattenRadius, dist)));
    }
    if (damp > 0) relief *= 1 - damp;
    return LEVEL_BASE[h.level] * s + relief * s;
  }

  /**
   * Noise inputs for a relief kind and level. Neighbouring hexes of the same
   * kind and level share the same global noise, so it is computed once per pixel.
   */
  private reliefNoise(kind: number, L: number, X: number, Y: number): number {
    const key = kind * 8 + L;
    for (let i = 0; i < this.memoN; i++) if (this.memoKey[i] === key) return i;
    const nr = this.nRelief;
    let A = 0;
    let B = 0;
    switch (kind) {
      case RK_MESA:
        A = nr.fbm(X * 1.3 + 7, Y * 1.3 - 3, 3);
        B = L >= 3 ? nr.ridged(X * 1.2, Y * 1.2, 3) : 0;
        break;
      case RK_VOLCANIC:
        if (L >= 3) A = nr.ridged(X * 2.6, Y * 2.6, 4);
        else {
          A = rollingNoise(nr, L, X, Y, false);
          B = nr.ridged(X * 4, Y * 4, 2);
        }
        break;
      case RK_DUNES:
        A = rollingNoise(nr, L, X, Y, false);
        B = L < 3 ? nr.fbm(X * 0.9, Y * 0.9, 2) : 0;
        break;
      default:
        A = rollingNoise(nr, L, X, Y, kind === RK_GLACIAL);
        B = L === 1 ? nr.fbm(X * 2.6, Y * 2.6, 2) : 0;
    }
    const i = this.memoN++;
    this.memoKey[i] = key;
    this.memoA[i] = A;
    this.memoB[i] = B;
    return i;
  }

  /** Relief above the level base, in units of hex size. */
  private relief(h: FieldHex, x: number, y: number): number {
    const s = this.s;
    const X = x / s;
    const Y = y / s;
    const dist = Math.hypot(x - h.cx, y - h.cy) / this.a;
    const L = h.level;
    // Mountains use a broad bump so adjacent peaks merge into ranges.
    const bump = 1 - smoothstep(0, L >= 4 ? 1.6 : 1.15, dist);
    const kind = RELIEF_KIND[h.biome.relief];
    const m = this.reliefNoise(kind, L, X, Y);
    const A = this.memoA[m];
    const B = this.memoB[m];

    const rolling = (): number => {
      switch (L) {
        case 0:
          return 0.022 * A;
        case 1:
          return 0.05 * A + 0.02 * B;
        case 2:
          return 0.1 * (A * 0.8 + 0.3) + 0.07 * bump;
        case 3:
          return 0.2 * A + 0.08 * bump;
        default: {
          const k = kind === RK_GLACIAL ? 0.85 : 1;
          return k * (0.6 * A * (0.5 + 0.5 * bump) + 0.32 * bump);
        }
      }
    };

    switch (kind) {
      case RK_DUNES: {
        if (L >= 3) return rolling();
        const u = (X * 0.8 + Y * 0.6) * 4.2 + 2.6 * B;
        const crest = Math.pow(0.5 + 0.5 * Math.sin(u), 2.2);
        return rolling() * 0.5 + (0.035 + 0.015 * L) * crest;
      }
      case RK_MESA: {
        const n = A;
        let v: number;
        if (L === 0) v = 0.14 * smoothstep(0.3, 0.38, n) + 0.015 * n;
        else {
          const mm = smoothstep(-0.04, 0.06, n + (bump - 0.5) * 0.4);
          const amp = MESA_AMP[L];
          v = amp * mm + 0.02 * n;
          if (L >= 3) v += 0.18 * B * bump;
        }
        // Terraces with sharp risers.
        const step = 0.055;
        const t = v / step;
        const fl = Math.floor(t);
        return (fl + smoothstep(0.7, 1, t - fl)) * step;
      }
      case RK_VOLCANIC: {
        if (L < 3) return rolling() * 0.8 + 0.018 * B;
        // A lumpy cone: gullies from ridged noise, a crater at the top.
        const cone = Math.max(0, 1 - dist / 1.3);
        let v = (L === 3 ? 0.5 : 0.9) * Math.pow(cone, 1.5);
        const craterR = 0.26;
        if (dist < craterR) v -= (L === 3 ? 0.08 : 0.15) * Math.pow(1 - dist / craterR, 0.7);
        return v + (0.16 * A - 0.06) * Math.min(1, cone * 1.6);
      }
      case RK_MARSH:
        return rolling() * 0.35;
      default:
        return rolling();
    }
  }
}

// Noise tiles depend only on the seed, so they are shared between fields.
const tileCache = new Map<string, NoiseTile>();
function tile(seed: number, freq: number, octaves: number): NoiseTile {
  const key = `${seed}|${freq}|${octaves}`;
  let t = tileCache.get(key);
  if (!t) {
    if (tileCache.size > 24) tileCache.clear();
    t = new NoiseTile(seed, 256, freq, octaves);
    tileCache.set(key, t);
  }
  return t;
}

const RK_ROLLING = 0;
const RK_DUNES = 1;
const RK_MESA = 2;
const RK_GLACIAL = 3;
const RK_VOLCANIC = 4;
const RK_MARSH = 5;
const RELIEF_KIND: Record<string, number> = {
  rolling: RK_ROLLING,
  dunes: RK_DUNES,
  mesa: RK_MESA,
  glacial: RK_GLACIAL,
  volcanic: RK_VOLCANIC,
  marsh: RK_MARSH,
  water: RK_ROLLING,
};
const MESA_AMP = [0, 0.13, 0.22, 0.3, 0.42];

function rollingNoise(nr: Noise2D, L: number, X: number, Y: number, glacial: boolean): number {
  switch (L) {
    case 0:
      return nr.fbm(X * 0.9, Y * 0.9, 3);
    case 1:
      return nr.fbm(X * 0.8, Y * 0.8, 3);
    case 2:
      return nr.fbm(X * 1.7, Y * 1.7, 3);
    case 3:
      return nr.ridged(X * 1.15, Y * 1.15, glacial ? 3 : 4);
    default:
      return nr.ridged(X * 1.25, Y * 1.25, glacial ? 3 : 5);
  }
}
