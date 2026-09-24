import { Sample, type TerrainField } from './field';
import type { PixelCtx, SurfaceResult, SurfaceShader } from './surface';

/** Per-pixel flags. */
export const F_INMAP = 1;
export const F_BLOCKED = 2;
export const F_WATER = 4;
export const F_GRID = 8;
export const F_STILL = 16;

/**
 * World-space pixel buffers for a band of rows. Index = (y - y0) * W + x.
 * The renderer holds one band covering the whole map; workers fill strips.
 */
export interface TerrainBuffers {
  W: number;
  /** First row held in the buffers. */
  y0: number;
  /** Number of rows held. */
  rows: number;
  hgt: Float32Array;
  surf: Float32Array;
  albedo: Uint32Array;
  emis: Uint32Array;
  flags: Uint8Array;
  hexId: Int32Array;
  /** Dominant (warped) hex and the runner-up with its blend weight (0..255), for scattering. */
  owner: Int32Array;
  alt: Int32Array;
  altW: Uint8Array;
}

export function allocBuffers(W: number, y0: number, rows: number): TerrainBuffers {
  const n = W * rows;
  return {
    W,
    y0,
    rows,
    hgt: new Float32Array(n),
    surf: new Float32Array(n),
    albedo: new Uint32Array(n),
    emis: new Uint32Array(n),
    flags: new Uint8Array(n),
    hexId: new Int32Array(n),
    owner: new Int32Array(n),
    alt: new Int32Array(n),
    altW: new Uint8Array(n),
  };
}

export function packRGB(r: number, g: number, b: number): number {
  const R = r >= 1 ? 255 : r <= 0 ? 0 : (r * 255) | 0;
  const G = g >= 1 ? 255 : g <= 0 ? 0 : (g * 255) | 0;
  const B = b >= 1 ? 255 : b <= 0 ? 0 : (b * 255) | 0;
  return (255 << 24) | (B << 16) | (G << 8) | R;
}

/** Heights (and ownership) for one row segment; returns nothing but fills B. */
function heightsRow(field: TerrainField, B: TerrainBuffers, x0: number, x1: number, y: number, row: Sample[]): void {
  const W = B.W;
  const base = (y - B.y0) * W;
  for (let x = x0; x < x1; x++) {
    const i = base + x;
    const S = row[x - x0];
    const wx = x + 0.5;
    const wy = y + 0.5;
    if (!field.prepare(wx, wy, S)) {
      B.flags[i] = 0;
      B.hexId[i] = -1;
      B.owner[i] = -1;
      B.alt[i] = -1;
      B.altW[i] = 0;
      B.hgt[i] = 0;
      B.surf[i] = 0;
      continue;
    }
    const H = field.height(wx, wy, S);
    B.hgt[i] = H;
    B.surf[i] = S.waterLevel > H ? S.waterLevel : H;
    B.hexId[i] = S.hex;
    B.flags[i] = F_INMAP;
    // Runner-up biome for scattering plants across blended borders.
    let alt = -1;
    let altW = 0;
    for (let k = 0; k < S.n; k++) {
      const id = S.idx[k];
      if (id !== S.owner && S.wc[k] > altW) {
        altW = S.wc[k];
        alt = id;
      }
    }
    B.owner[i] = S.owner;
    B.alt[i] = alt;
    B.altW[i] = Math.round(altW * 255);
  }
}

const rowCache: Sample[][] = [[], []];
function sampleRow(k: number, w: number): Sample[] {
  const row = rowCache[k];
  while (row.length < w) row.push(new Sample());
  return row;
}

/** Heights only, for rows that border a band (so slopes at its edges are right). */
export function computeHeights(field: TerrainField, B: TerrainBuffers, x0: number, x1: number, y0: number, y1: number): void {
  const row = sampleRow(0, x1 - x0);
  for (let y = y0; y < y1; y++) heightsRow(field, B, x0, x1, y, row);
}

/**
 * Heights and surface colour for a rectangle. Rows are streamed so the next
 * row's heights exist when a row's slope is needed; each point is prepared once.
 * Rows y0 - 1 and y1 must already hold valid heights if they are inside the map.
 */
export function computeTerrain(
  field: TerrainField,
  shader: SurfaceShader,
  B: TerrainBuffers,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  worldH: number,
): void {
  const W = B.W;
  const w = x1 - x0;
  if (w <= 0 || y1 <= y0) return;
  let cur = sampleRow(0, w);
  let next = sampleRow(1, w);
  const ctx: PixelCtx = { x: 0, y: 0, H: 0, slope: 0, nL: 0, nM: 0, nF: 0, nS: 0 };
  const res: SurfaceResult = { r: 0, g: 0, b: 0, er: 0, eg: 0, eb: 0, water: 0, depth: 0, blocked: false };
  const hgt = B.hgt;
  const yMin = B.y0;
  const yMax = B.y0 + B.rows - 1;

  heightsRow(field, B, x0, x1, y0, cur);
  for (let y = y0; y < y1; y++) {
    if (y + 1 < y1) heightsRow(field, B, x0, x1, y + 1, next);
    const base = (y - B.y0) * W;
    const up = y > 0 && y - 1 >= yMin ? -W : 0;
    const down = y < worldH - 1 && y + 1 <= yMax ? W : 0;
    for (let x = x0; x < x1; x++) {
      const i = base + x;
      if (!(B.flags[i] & F_INMAP)) {
        B.albedo[i] = 0;
        B.emis[i] = 0;
        continue;
      }
      const S = cur[x - x0];
      const H = hgt[i];
      const xm = x > 0 ? i - 1 : i;
      const xp = x < W - 1 ? i + 1 : i;
      const hx = (hgt[xp] - hgt[xm]) * 0.5;
      const hy = (hgt[i + down] - hgt[i + up]) * (up && down ? 0.5 : 1);
      const slope = Math.sqrt(hx * hx + hy * hy);
      shader.noiseCtx(x + 0.5, y + 0.5, H, slope, ctx);
      shader.shade(S, ctx, res);
      B.albedo[i] = packRGB(res.r, res.g, res.b);
      B.emis[i] = res.er > 0 || res.eg > 0 || res.eb > 0 ? packRGB(res.er, res.eg, res.eb) : 0;
      let f = F_INMAP;
      if (res.blocked) f |= F_BLOCKED;
      if (res.water) f |= F_WATER;
      if (res.water === 1) f |= F_STILL;
      B.flags[i] = f;
    }
    const t = cur;
    cur = next;
    next = t;
  }
}

/** Mark unwarped hex boundaries (for the optional grid overlay). */
export function computeGridEdges(B: TerrainBuffers, x0: number, x1: number, y0: number, y1: number): void {
  const W = B.W;
  for (let y = Math.max(B.y0 + 1, y0); y < y1; y++) {
    const base = (y - B.y0) * W;
    for (let x = Math.max(1, x0); x < x1; x++) {
      const i = base + x;
      const h = B.hexId[i];
      if (h >= 0 && (h !== B.hexId[i - 1] || h !== B.hexId[i - W])) B.flags[i] |= F_GRID;
    }
  }
}
