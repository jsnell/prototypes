import { HexLayout } from '../core/hex';
import { smoothstep } from '../core/noise';
import type { HexMap } from '../model/map';
import { computeLighting, DEFAULT_ENVIRONMENT, type Environment, type Lighting, type Season } from './environment';
import type { TerrainJobResult, TerrainWorkerPool } from './pool';
import { TerrainField } from './field';
import { Scatter, SpriteCache, type GroundQuery, type SpriteInstance } from './scatter';
import { createCanvas } from './sprites/canvas';
import { SurfaceShader } from './surface';
import {
  F_BLOCKED,
  F_GRID,
  F_INMAP,
  F_STILL,
  F_WATER,
  allocBuffers,
  computeGridEdges,
  computeTerrain,
  packRGB,
  type TerrainBuffers,
} from './terrain';

export interface RendererOptions {
  /** Hex circumradius in pixels. */
  hexSize: number;
  environment?: Environment;
  grid?: boolean;
  /** Optional worker pool for whole-map renders (see updateAsync). */
  pool?: TerrainWorkerPool;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}


// Levels of whole-map work pending (higher includes lower).
const LVL_PROJECT = 1;
const LVL_LIGHT = 2;
const LVL_TERRAIN = 3;
const LVL_ALL = 4;

export interface RenderStats {
  ms: number;
  pixels: number;
  sprites: number;
}

/**
 * Renders a HexMap to a canvas in a top-down oblique view: the ground plane is
 * undistorted, heights lift terrain up the screen, and anything tall
 * (mountains, trees, buildings) overlaps the ranks behind it.
 *
 * Rendering is incremental: edits re-render only the affected region.
 */
export class TerrainRenderer {
  readonly map: HexMap;
  readonly layout: HexLayout;
  readonly field: TerrainField;
  readonly shader: SurfaceShader;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /** World (ground-plane) size in pixels. */
  readonly worldW: number;
  readonly worldH: number;
  /** Screen margin above the map for tall terrain and sprites. */
  readonly top: number;
  /** Output canvas size. */
  readonly width: number;
  readonly height: number;

  env: Environment;
  lighting: Lighting;
  grid: boolean;
  lastStats: RenderStats = { ms: 0, pixels: 0, sprites: 0 };
  /** Debug: duration of height, blur, colour, sprites and projection passes on the last full render. */
  passTimes: number[] = [];

  /** World-space terrain buffers for the whole map. */
  readonly B: TerrainBuffers;
  private readonly blur: Float32Array;
  private readonly color: Uint32Array;
  private readonly image: ImageData;
  private readonly px: Uint32Array;
  private readonly depth: Float32Array;
  private readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private readonly cache = new SpriteCache();
  private readonly scatter: Scatter;
  private sprites: SpriteInstance[][];
  private readonly skirt: number;
  private readonly maxSprite: number;

  private readonly pool: TerrainWorkerPool | null;
  private inFlight = false;
  private dirty = new Set<number>();
  private fullLevel = LVL_ALL;
  private unsub: () => void;

  constructor(map: HexMap, opts: RendererOptions) {
    this.map = map;
    this.layout = new HexLayout(opts.hexSize);
    const s = opts.hexSize;
    this.field = new TerrainField(map, this.layout);
    this.shader = new SurfaceShader(this.field);
    this.env = opts.environment ?? { ...DEFAULT_ENVIRONMENT };
    this.lighting = computeLighting(this.env);
    this.grid = opts.grid ?? false;
    this.pool = opts.pool ?? null;

    const size = this.layout.mapSize(map.cols, map.rows);
    this.worldW = Math.ceil(size.width);
    this.worldH = Math.ceil(size.height);
    this.top = Math.ceil(s * 1.9);
    this.skirt = Math.ceil(s * 0.42);
    this.maxSprite = Math.ceil(s * 1.1);
    this.width = this.worldW;
    this.height = this.worldH + this.top + this.skirt + 2;

    const n = this.worldW * this.worldH;
    this.B = allocBuffers(this.worldW, 0, this.worldH);
    this.blur = new Float32Array(n);
    this.color = new Uint32Array(n);

    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = this.width;
      c.height = this.height;
      this.canvas = c;
    } else this.canvas = createCanvas(this.width, this.height);
    const ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.image = new ImageData(this.width, this.height);
    this.px = new Uint32Array(this.image.data.buffer);
    this.depth = new Float32Array(this.width * this.height);

    this.scatter = new Scatter(this.field, this.cache);
    this.sprites = new Array(map.size).fill(null).map(() => []);
    this.unsub = map.onChange((idx) => this.invalidate(idx));
  }

  dispose(): void {
    this.unsub();
  }

  // ---- public controls ---------------------------------------------------

  invalidate(indices: Iterable<number>): void {
    for (const i of indices) this.dirty.add(i);
  }

  invalidateAll(): void {
    this.fullLevel = LVL_ALL;
  }

  setEnvironment(env: Partial<Environment>): void {
    const prev = this.env;
    this.env = { ...this.env, ...env };
    this.lighting = computeLighting(this.env);
    if (this.env.season !== prev.season) this.fullLevel = Math.max(this.fullLevel, LVL_TERRAIN);
    else if (this.env.hour !== prev.hour) this.fullLevel = Math.max(this.fullLevel, LVL_LIGHT);
  }

  setGrid(on: boolean): void {
    if (this.grid === on) return;
    this.grid = on;
    this.fullLevel = Math.max(this.fullLevel, LVL_PROJECT);
  }

  get needsUpdate(): boolean {
    return this.fullLevel > 0 || this.dirty.size > 0;
  }

  /** True when the pending work includes a whole-map terrain pass (worth doing asynchronously). */
  get needsHeavyUpdate(): boolean {
    return this.fullLevel >= LVL_TERRAIN || this.dirty.size > this.map.size * 0.4;
  }

  /** True while an asynchronous (worker) update is in flight. */
  get busy(): boolean {
    return this.inFlight;
  }

  /** Bring the canvas up to date on the main thread. Returns true if anything was redrawn. */
  update(): boolean {
    if (this.inFlight || !this.needsUpdate) return false;
    const job = this.begin();
    if (job.level >= LVL_TERRAIN) {
      const full = this.fullRect();
      computeTerrain(this.field, this.shader, this.B, full.x0, full.x1, full.y0, full.y1, this.worldH);
    }
    this.finish(job);
    return true;
  }

  /**
   * Like update(), but whole-map terrain work runs on the worker pool when one
   * was supplied. Small incremental edits still run synchronously.
   */
  async updateAsync(): Promise<boolean> {
    if (this.inFlight || !this.needsUpdate) return false;
    const pool = this.pool;
    const bigEdit = this.dirty.size > this.map.size * 0.4;
    if (!pool || pool.failed || (this.fullLevel < LVL_TERRAIN && !bigEdit)) return this.update();
    this.inFlight = true;
    try {
      const job = this.begin();
      const json = this.map.toJSON();
      const W = this.worldW;
      const bands = pool.size * 2;
      const step = Math.ceil(this.worldH / bands);
      const jobs: Promise<TerrainJobResult>[] = [];
      for (let y = 0; y < this.worldH; y += step) {
        jobs.push(
          pool.run({
            map: json,
            hexSize: this.layout.size,
            season: job.season,
            worldW: W,
            worldH: this.worldH,
            y0: y,
            y1: Math.min(this.worldH, y + step),
          }),
        );
      }
      let results: TerrainJobResult[];
      try {
        results = await Promise.all(jobs);
      } catch {
        // Workers failed: compute on the main thread instead.
        const full = this.fullRect();
        computeTerrain(this.field, this.shader, this.B, full.x0, full.x1, full.y0, full.y1, this.worldH);
        this.finish(job);
        return true;
      }
      const B = this.B;
      for (const r of results) {
        const off = r.y0 * W;
        B.hgt.set(r.hgt, off);
        B.surf.set(r.surf, off);
        B.albedo.set(r.albedo, off);
        B.emis.set(r.emis, off);
        B.flags.set(r.flags, off);
        B.hexId.set(r.hexId, off);
        B.owner.set(r.owner, off);
        B.alt.set(r.alt, off);
        B.altW.set(r.altW, off);
      }
      this.finish(job);
    } finally {
      this.inFlight = false;
    }
    return true;
  }

  private fullRect(): Rect {
    return { x0: 0, y0: 0, x1: this.worldW, y1: this.worldH };
  }

  /** Snapshot pending work and prepare the field for it. */
  private begin(): { level: number; t0: number; season: Season; T: number[] } {
    const t0 = performance.now();
    this.shader.season = this.env.season;
    this.scatter.season = this.env.season;
    this.scatter.lighting = this.lighting;
    if (this.dirty.size > this.map.size * 0.4) this.fullLevel = LVL_ALL;
    const level = this.fullLevel;
    this.fullLevel = 0;
    if (level >= LVL_TERRAIN) {
      if (level >= LVL_ALL) this.field.rebuildAll();
      else if (this.dirty.size) this.field.rebuild(this.dirty);
      this.dirty.clear();
    }
    return { level, t0, season: this.env.season, T: [t0] };
  }

  private finish(job: { level: number; t0: number; T: number[] }): void {
    const { level, T } = job;
    const full = this.fullRect();
    const mark = () => T.push(performance.now());
    let pixels = 0;
    if (level >= LVL_TERRAIN) {
      mark();
      computeGridEdges(this.B, full.x0, full.x1, full.y0, full.y1);
      this.blurPass(full);
      mark();
      this.lightPass(full);
      mark();
      this.rebuildSprites(this.allHexes());
      mark();
      this.project(0, this.width, 0, this.height);
      mark();
      this.passTimes = T.slice(1).map((t, k) => Math.round(t - T[k]));
      pixels = this.worldW * this.worldH;
    } else {
      if (this.dirty.size) {
        const touched = this.field.rebuild(this.dirty);
        // Pixels change only near edited hexes, plus lakes whose level follows their shores.
        const changed = [...this.dirty];
        for (const i of touched) if (!this.dirty.has(i) && this.map.isWater(i)) changed.push(i);
        this.dirty.clear();
        const hr = this.hexesRect(changed, this.field.influence);
        const cr = this.lightRect(hr);
        mark();
        this.terrainPass(hr);
        mark();
        this.blurPass(cr);
        this.lightPass(cr);
        mark();
        this.rebuildSprites(this.hexesIn(this.expand(hr, this.layout.size * 0.2)));
        mark();
        if (level < LVL_PROJECT) {
          const pad = Math.ceil(this.layout.size * 0.6);
          this.project(cr.x0 - pad, cr.x1 + pad, Math.max(0, cr.y0 - this.maxSprite), cr.y1 + this.top + this.skirt + 2);
        }
        mark();
        this.passTimes = T.slice(1).map((t, k) => Math.round(t - T[k]));
        pixels = (cr.x1 - cr.x0) * (cr.y1 - cr.y0);
      }
      if (level >= LVL_LIGHT) {
        this.lightPass(full);
        // Sprite shading follows the sun's side; the cache keeps each variant.
        this.rebuildSprites(this.allHexes());
        pixels = this.worldW * this.worldH;
      }
      if (level >= LVL_PROJECT) this.project(0, this.width, 0, this.height);
    }
    if (this.cache.size > 6000) this.cache.clear();
    let count = 0;
    for (const list of this.sprites) count += list.length;
    this.lastStats = { ms: performance.now() - job.t0, pixels, sprites: count };
  }

  /** Hex index under a canvas pixel (accounts for elevation and sprites), or -1. */
  pick(cx: number, cy: number): number {
    const x = Math.floor(cx);
    const y = Math.floor(cy);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    const d = this.depth[y * this.width + x];
    if (!(d > -1)) return -1;
    return this.field.hexIndexAt(x + 0.5, d + 0.5);
  }

  /** Outline of a hex draped over the terrain, in canvas pixels. */
  hexOutline(index: number): [number, number][] {
    const { q, r } = this.map.axialOf(index);
    const cx = this.layout.centerX(q);
    const cy = this.layout.centerY(q, r);
    const pts: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const [ax, ay] = this.layout.corner(cx, cy, i);
      const [bx, by] = this.layout.corner(cx, cy, i + 1);
      for (let k = 0; k < 8; k++) {
        const t = k / 8;
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        // Sample just inside the hex so the outline hugs its own ground.
        const ix = x + (cx - x) * 0.04;
        const iy = y + (cy - y) * 0.04;
        pts.push([x, y + this.top - this.surfAt(ix, iy)]);
      }
    }
    return pts;
  }

  /** Screen position of a hex centre (on the terrain surface). */
  hexCenter(index: number): [number, number] {
    const { q, r } = this.map.axialOf(index);
    const cx = this.layout.centerX(q);
    const cy = this.layout.centerY(q, r);
    return [cx, cy + this.top - this.surfAt(cx, cy)];
  }

  // ---- geometry helpers --------------------------------------------------

  private allHexes(): number[] {
    return Array.from({ length: this.map.size }, (_, i) => i);
  }

  private blurRadius(): number {
    return Math.max(2, Math.round(this.layout.size * 0.2));
  }

  private shadowReach(): number {
    return Math.ceil(this.layout.size * 1.7);
  }

  private hexesRect(indices: Iterable<number>, margin: number): Rect {
    const s = this.layout.size;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const i of indices) {
      const { q, r } = this.map.axialOf(i);
      const cx = this.layout.centerX(q);
      const cy = this.layout.centerY(q, r);
      x0 = Math.min(x0, cx - s);
      x1 = Math.max(x1, cx + s);
      y0 = Math.min(y0, cy - this.layout.apothem);
      y1 = Math.max(y1, cy + this.layout.apothem);
    }
    return this.clampRect({ x0: Math.floor(x0 - margin), y0: Math.floor(y0 - margin), x1: Math.ceil(x1 + margin), y1: Math.ceil(y1 + margin) });
  }

  /** Region whose lighting can change when heights in `r` change: shadows fall away from the sun. */
  private lightRect(r: Rect): Rect {
    const reach = this.shadowReach();
    const m = this.blurRadius() + 2;
    const [sx, sy] = this.lighting.sun;
    const len = Math.hypot(sx, sy) || 1;
    const dx = (-sx / len) * reach;
    const dy = (-sy / len) * reach;
    return this.clampRect({
      x0: r.x0 - m + Math.min(0, dx),
      y0: r.y0 - m + Math.min(0, dy),
      x1: r.x1 + m + Math.max(0, dx),
      y1: r.y1 + m + Math.max(0, dy),
    });
  }

  private expand(r: Rect, m: number): Rect {
    return this.clampRect({ x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m });
  }

  private clampRect(r: Rect): Rect {
    return {
      x0: Math.max(0, Math.floor(r.x0)),
      y0: Math.max(0, Math.floor(r.y0)),
      x1: Math.min(this.worldW, Math.ceil(r.x1)),
      y1: Math.min(this.worldH, Math.ceil(r.y1)),
    };
  }

  private hexesIn(r: Rect): number[] {
    const out: number[] = [];
    const s = this.layout.size;
    for (let i = 0; i < this.map.size; i++) {
      const { q, r: rr } = this.map.axialOf(i);
      const cx = this.layout.centerX(q);
      const cy = this.layout.centerY(q, rr);
      if (cx + s >= r.x0 && cx - s <= r.x1 && cy + s >= r.y0 && cy - s <= r.y1) out.push(i);
    }
    return out;
  }

  private idx(x: number, y: number): number {
    const xi = x < 0 ? 0 : x >= this.worldW ? this.worldW - 1 : x | 0;
    const yi = y < 0 ? 0 : y >= this.worldH ? this.worldH - 1 : y | 0;
    return yi * this.worldW + xi;
  }

  private surfAt(x: number, y: number): number {
    return this.B.surf[this.idx(x, y)];
  }

  // ---- world passes ------------------------------------------------------

  /** Heights and surface colour for a region (main thread). */
  private terrainPass(r: Rect): void {
    computeTerrain(this.field, this.shader, this.B, r.x0, r.x1, r.y0, r.y1, this.worldH);
    computeGridEdges(this.B, r.x0, r.x1, r.y0, r.y1);
  }

  private blurPass(r: Rect): void {
    const W = this.worldW;
    const Hh = this.worldH;
    const rad = this.blurRadius();
    const y0 = Math.max(0, r.y0 - rad);
    const y1 = Math.min(Hh, r.y1 + rad);
    const w = r.x1 - r.x0;
    const tmp = new Float32Array(w * (y1 - y0));
    const src = this.B.surf;
    for (let y = y0; y < y1; y++) {
      const row = y * W;
      for (let x = r.x0; x < r.x1; x++) {
        let sum = 0;
        const a = Math.max(0, x - rad);
        const b = Math.min(W - 1, x + rad);
        for (let k = a; k <= b; k++) sum += src[row + k];
        tmp[(y - y0) * w + (x - r.x0)] = sum / (b - a + 1);
      }
    }
    for (let y = r.y0; y < r.y1; y++) {
      const a = Math.max(y0, y - rad);
      const b = Math.min(y1 - 1, y + rad);
      for (let x = r.x0; x < r.x1; x++) {
        let sum = 0;
        for (let k = a; k <= b; k++) sum += tmp[(k - y0) * w + (x - r.x0)];
        this.blur[y * W + x] = sum / (b - a + 1);
      }
    }
  }

  /** Lighting: sun, cast shadows, ambient occlusion, water glints. */
  private lightPass(r: Rect): void {
    const W = this.worldW;
    const Hh = this.worldH;
    const L = this.lighting;
    const s = this.layout.size;
    const [lx, ly, lz] = L.sun;
    const lxy = Math.hypot(lx, ly) || 1;
    const dirx = lx / lxy;
    const diry = ly / lxy;
    const tanEl = lz / lxy;
    const reach = this.shadowReach();
    const steps: number[] = [];
    for (let d = 1.5; d < reach; d *= 1.32) steps.push(d);
    const aoScale = 1 / (s * 0.12);
    const ex = L.exposure * 0.72;
    const amb = L.ambient;
    const sun = L.sunColor;
    const glowK = 0.45 + 0.55 * L.night;
    const surf = this.B.surf;
    const t2 = this.shader.t2;
    const t3 = this.shader.t3;
    const kS = 32 / s;
    const shadowK = L.shadow * 1.6;
    const desat = L.desat;

    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const i = y * W + x;
        const fl = this.B.flags[i];
        if (!(fl & F_INMAP)) {
          this.color[i] = 0;
          continue;
        }
        const wx = x + 0.5;
        const wy = y + 0.5;
        const xm = x > 0 ? i - 1 : i;
        const xp = x < W - 1 ? i + 1 : i;
        const ym = y > 0 ? i - W : i;
        const yp = y < Hh - 1 ? i + W : i;
        let gx = (surf[xp] - surf[xm]) * 0.5;
        let gy = (surf[yp] - surf[ym]) * 0.5;
        if (fl & F_STILL) {
          // Wave normals for open water.
          const nF = t3.at(wx * kS * 1.1, wy * kS * 1.1);
          const nS = t2.sample(wx * kS * 0.7, wy * kS * 3.2);
          gx = nF * 0.06 + nS * 0.05;
          gy = nS * 0.12;
        }
        const nl = 1 / Math.sqrt(gx * gx + gy * gy + 1);
        const nx = -gx * nl;
        const ny = -gy * nl;
        const nz = nl;
        const diffuse = Math.max(0, nx * lx + ny * ly + nz * lz);

        // Cast shadow: march towards the sun over the height field.
        let occ = 0;
        if (diffuse > 0) {
          const z0 = surf[i] + 0.4;
          for (let k = 0; k < steps.length; k++) {
            const d = steps[k];
            const sx = wx + dirx * d;
            const sy = wy + diry * d;
            if (sx < 0 || sy < 0 || sx >= W || sy >= Hh) break;
            const over = surf[(sy | 0) * W + (sx | 0)] - (z0 + d * tanEl);
            if (over > 0) {
              const o = over >= 2.5 ? 1 : smoothstep(0, 2.5, over);
              if (o > occ) occ = o;
              if (occ >= 1) break;
            }
          }
        }
        const sunK = diffuse * Math.max(0, 1 - occ * shadowK);

        let ao = 1 + (surf[i] - this.blur[i]) * aoScale * 0.55;
        ao = ao < 0.6 ? 0.6 : ao > 1.12 ? 1.12 : ao;

        const al = this.B.albedo[i];
        const ar = (al & 255) / 255;
        const ag = ((al >> 8) & 255) / 255;
        const ab = ((al >> 16) & 255) / 255;
        let cr = ar * (amb[0] * ao + sun[0] * sunK) * ex;
        let cg = ag * (amb[1] * ao + sun[1] * sunK) * ex;
        let cb = ab * (amb[2] * ao + sun[2] * sunK) * ex;

        if (fl & F_WATER) {
          // Sun glint: reflect the light about the normal and compare with the view direction.
          const dot = nx * lx + ny * ly + nz * lz;
          const v = (2 * dot * ny - ly) * 0.7071 + (2 * dot * nz - lz) * 0.7071;
          if (v > 0) {
            const spec = Math.pow(v, 60) * 0.9 * (1 - occ);
            cr += spec * sun[0];
            cg += spec * sun[1];
            cb += spec * sun[2];
          }
        }
        if (desat > 0) {
          const l = cr * 0.3 + cg * 0.59 + cb * 0.11;
          cr += (l - cr) * desat;
          cg += (l - cg) * desat;
          cb += (l - cb) * desat;
        }
        const em = this.B.emis[i];
        if (em) {
          cr += ((em & 255) / 255) * glowK;
          cg += (((em >> 8) & 255) / 255) * glowK;
          cb += (((em >> 16) & 255) / 255) * glowK;
        }
        this.color[i] = packRGB(cr, cg, cb);
      }
    }
  }

  // ---- sprites -----------------------------------------------------------

  private readonly ground: GroundQuery = {
    surface: (x, y) => this.B.surf[this.idx(x, y)],
    ground: (x, y) => this.B.hgt[this.idx(x, y)],
    blocked: (x, y) => {
      const f = this.B.flags[this.idx(x, y)];
      return !(f & F_INMAP) || (f & F_BLOCKED) !== 0;
    },
    water: (x, y) => (this.B.flags[this.idx(x, y)] & F_WATER) !== 0,
    owner: (x, y) => this.B.owner[this.idx(x, y)],
    alt: (x, y) => this.B.alt[this.idx(x, y)],
    altWeight: (x, y) => this.B.altW[this.idx(x, y)] / 255,
    slope: (x, y) => {
      const W = this.worldW;
      const i = this.idx(x, y);
      const hx = (this.B.hgt[Math.min(i + 1, this.B.hgt.length - 1)] - this.B.hgt[Math.max(i - 1, 0)]) * 0.5;
      const hy = (this.B.hgt[Math.min(i + W, this.B.hgt.length - 1)] - this.B.hgt[Math.max(i - W, 0)]) * 0.5;
      return Math.sqrt(hx * hx + hy * hy);
    },
  };

  private rebuildSprites(indices: Iterable<number>): void {
    for (const i of indices) this.sprites[i] = this.scatter.build(i, this.ground);
  }

  // ---- projection --------------------------------------------------------

  private project(sx0: number, sx1: number, sy0: number, sy1: number): void {
    sx0 = Math.max(0, Math.floor(sx0));
    sx1 = Math.min(this.width, Math.ceil(sx1));
    sy0 = Math.max(0, Math.floor(sy0));
    sy1 = Math.min(this.height, Math.ceil(sy1));
    if (sx1 <= sx0 || sy1 <= sy0) return;
    const W = this.worldW;
    const SW = this.width;
    const top = this.top;
    const px = this.px;
    const depth = this.depth;
    const L = this.lighting;
    // The area around the map stays transparent so the host page shows through.
    const back = 0;
    const grid = this.grid;
    const tile = this.shader.t3;
    const skirtLight = (c: number) => {
      const k = (L.ambient[1] + L.sunColor[1] * Math.max(0, L.sun[1]) * 0.9) * L.exposure * 0.72 * c;
      return k;
    };
    const soilTop = [0.33, 0.25, 0.17];
    const soil = [0.42, 0.32, 0.22];
    const rock = [0.4, 0.37, 0.34];
    const waterSide = [0.12, 0.3, 0.44];

    const wy0 = Math.max(0, sy0 - top - 1);
    const wy1 = Math.min(this.worldH, sy1 - top + top);

    for (let x = sx0; x < sx1; x++) {
      for (let y = sy0; y < sy1; y++) {
        px[y * SW + x] = back;
        depth[y * SW + x] = -1e9;
      }
      if (x >= W) continue;
      for (let y = wy0; y < wy1; y++) {
        const i = y * W + x;
        if (!(this.B.flags[i] & F_INMAP)) continue;
        const start = Math.round(y + top - this.B.surf[i]);
        const nextIn = y + 1 < this.worldH && (this.B.flags[i + W] & F_INMAP) !== 0;
        let end: number;
        if (nextIn) end = Math.max(start + 1, Math.round(y + 1 + top - this.B.surf[i + W]));
        else end = start + 1;
        let c = this.color[i];
        if (grid && this.B.flags[i] & F_GRID) c = darken(c, 0.72);
        const a = Math.max(start, sy0);
        const b = Math.min(end, sy1);
        const span = end - start;
        for (let row = a; row < b; row++) {
          const o = row * SW + x;
          if (span > 2) {
            // Vertical texture on steep faces facing the viewer.
            const t = 1 + tile.at(x * 1.7, row * 0.6) * 0.12 - ((row - start) / span) * 0.08;
            px[o] = darken(c, t);
          } else px[o] = c;
          depth[o] = y;
        }
        if (!nextIn) {
          // Diorama edge: a cut-away through soil (or water) down to the base.
          const bottom = y + top + this.skirt;
          const waterDepth = this.B.surf[i] - this.B.hgt[i];
          const isWater = (this.B.flags[i] & F_WATER) !== 0 && waterDepth > 0;
          for (let row = Math.max(end, sy0); row < Math.min(bottom, sy1); row++) {
            const d = row - end;
            let col: number[];
            let k: number;
            if (isWater && d < waterDepth) {
              col = waterSide;
              k = 1 - (d / Math.max(1, waterDepth)) * 0.35;
            } else {
              const dd = isWater ? d - waterDepth : d;
              col = dd < 2 ? soilTop : dd < this.skirt * 0.45 + tile.at(x * 0.5, 3) * 3 ? soil : rock;
              k = 1 + tile.at(x * 1.3, row * 1.3) * 0.1 - (d / this.skirt) * 0.25;
            }
            const lk = skirtLight(k);
            const o = row * SW + x;
            px[o] = packRGB(col[0] * lk, col[1] * lk, col[2] * lk);
            depth[o] = y;
          }
        }
      }
    }
    this.blitSprites(sx0, sx1, sy0, sy1);
    this.ctx.putImageData(this.image, 0, 0, sx0, sy0, sx1 - sx0, sy1 - sy0);
  }

  private blitSprites(sx0: number, sx1: number, sy0: number, sy1: number): void {
    const list: SpriteInstance[] = [];
    const s = this.layout.size;
    const top = this.top;
    for (let i = 0; i < this.map.size; i++) {
      const spr = this.sprites[i];
      if (!spr.length) continue;
      const { q, r } = this.map.axialOf(i);
      const cx = this.layout.centerX(q);
      const cy = this.layout.centerY(q, r);
      if (cx + s * 2 < sx0 || cx - s * 2 > sx1) continue;
      if (cy + top + s * 2 < sy0 || cy - s * 2.5 > sy1) continue;
      for (const sp of spr) {
        const x0 = Math.round(sp.x) - sp.img.ax;
        const y0 = Math.round(sp.y + top - sp.z) - sp.img.ay;
        if (x0 + sp.img.w <= sx0 || x0 >= sx1 || y0 + sp.img.h <= sy0 || y0 >= sy1) continue;
        list.push(sp);
      }
    }
    list.sort((a, b) => a.y - b.y || a.x - b.x);
    const SW = this.width;
    const depth = this.depth;
    const tol = s * 0.15 + 1;
    const [tr0, tg0, tb0] = this.lighting.spriteTint;
    const night = this.lighting.night;
    const desat = this.lighting.desat;
    const bytes = this.image.data;
    for (const sp of list) {
      const img = sp.img;
      const x0 = Math.round(sp.x) - img.ax;
      const y0 = Math.round(sp.y + top - sp.z) - img.ay;
      const ia = Math.max(0, sx0 - x0);
      const ib = Math.min(img.w, sx1 - x0);
      const ja = Math.max(0, sy0 - y0);
      const jb = Math.min(img.h, sy1 - y0);
      const tr = tr0 * sp.tr;
      const tg = tg0 * sp.tg;
      const tb = tb0 * sp.tb;
      const lim = sp.y + tol;
      const data = img.data;
      const glow = night > 0.02 ? img.glow : null;
      for (let j = ja; j < jb; j++) {
        const row = (y0 + j) * SW;
        for (let ii = ia; ii < ib; ii++) {
          const k = (j * img.w + ii) * 4;
          const a = data[k + 3];
          const ga = glow ? glow[k + 3] : 0;
          if (a === 0 && ga === 0) continue;
          const o = row + x0 + ii;
          if (depth[o] > lim) continue;
          const ob = o * 4;
          if (a > 0) {
            const af = a / 255;
            const inv = 1 - af;
            let r = data[k] * tr;
            let g = data[k + 1] * tg;
            let b = data[k + 2] * tb;
            if (desat > 0) {
              const l = r * 0.3 + g * 0.59 + b * 0.11;
              r += (l - r) * desat;
              g += (l - g) * desat;
              b += (l - b) * desat;
            }
            r = r > 255 ? 255 : r;
            g = g > 255 ? 255 : g;
            b = b > 255 ? 255 : b;
            bytes[ob] = r * af + bytes[ob] * inv;
            bytes[ob + 1] = g * af + bytes[ob + 1] * inv;
            bytes[ob + 2] = b * af + bytes[ob + 2] * inv;
            if (a > 140) depth[o] = sp.y;
          }
          if (ga > 0 && glow) {
            const gf = (ga / 255) * night;
            bytes[ob] = Math.min(255, bytes[ob] + glow[k] * gf);
            bytes[ob + 1] = Math.min(255, bytes[ob + 1] + glow[k + 1] * gf);
            bytes[ob + 2] = Math.min(255, bytes[ob + 2] + glow[k + 2] * gf);
          }
        }
      }
    }
  }
}

function darken(c: number, k: number): number {
  const r = Math.min(255, (c & 255) * k);
  const g = Math.min(255, ((c >> 8) & 255) * k);
  const b = Math.min(255, ((c >> 16) & 255) * k);
  return (255 << 24) | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
}
