/**
 * Flat-top hex grid math.
 *
 * Axial coordinates (q, r). Maps are rectangular in "odd-q" offset
 * coordinates (col, row), where odd columns are shifted down half a hex.
 *
 * World space is the top-down ground plane in pixels: x to the right,
 * y down the screen (towards the viewer).
 */

export const SQRT3 = Math.sqrt(3);

export interface Axial {
  q: number;
  r: number;
}

/** Directions in clockwise order starting from north (screen up). */
export const enum Dir {
  N = 0,
  NE = 1,
  SE = 2,
  S = 3,
  SW = 4,
  NW = 5,
}

export const DIR_NAMES = ['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const;

/** Axial offsets for each direction. */
export const AXIAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

/** Unit vectors (world space) pointing from a hex centre towards each neighbour. */
export const DIR_VECTORS: ReadonlyArray<readonly [number, number]> = AXIAL_DIRS.map(([dq, dr]) => {
  const x = 1.5 * dq;
  const y = SQRT3 * (dr + dq / 2);
  const len = Math.hypot(x, y);
  return [x / len, y / len] as const;
});

export const opposite = (d: number): number => (d + 3) % 6;

export function offsetToAxial(col: number, row: number): Axial {
  return { q: col, r: row - (col - (col & 1)) / 2 };
}

export function axialToOffset(q: number, r: number): { col: number; row: number } {
  return { col: q, row: r + (q - (q & 1)) / 2 };
}

export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Direction index from a to its neighbour b, or -1 if not adjacent. */
export function directionTo(a: Axial, b: Axial): number {
  const dq = b.q - a.q;
  const dr = b.r - a.r;
  for (let d = 0; d < 6; d++) {
    if (AXIAL_DIRS[d][0] === dq && AXIAL_DIRS[d][1] === dr) return d;
  }
  return -1;
}

export function roundAxial(fq: number, fr: number): Axial {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  // "+ 0" turns -0 into 0.
  return { q: q + 0, r: r + 0 };
}

/**
 * Pixel layout for a flat-top hex grid of circumradius `size`.
 * The origin is chosen so that offset hex (0, 0) sits fully inside positive space.
 */
export class HexLayout {
  readonly size: number;
  /** Distance from centre to edge midpoint. */
  readonly apothem: number;
  readonly originX: number;
  readonly originY: number;

  constructor(size: number) {
    this.size = size;
    this.apothem = (SQRT3 / 2) * size;
    this.originX = size;
    this.originY = this.apothem;
  }

  centerX(q: number): number {
    return this.originX + 1.5 * this.size * q;
  }

  centerY(q: number, r: number): number {
    return this.originY + SQRT3 * this.size * (r + q / 2);
  }

  /** Fractional axial coordinate of a world point, rounded to the containing hex. */
  hexAt(x: number, y: number): Axial {
    const px = (x - this.originX) / this.size;
    const py = (y - this.originY) / this.size;
    const fq = (2 / 3) * px;
    const fr = (-1 / 3) * px + (SQRT3 / 3) * py;
    return roundAxial(fq, fr);
  }

  /** World-space size of a rectangular cols x rows map. */
  mapSize(cols: number, rows: number): { width: number; height: number } {
    return {
      width: this.size * (1.5 * (cols - 1) + 2),
      height: SQRT3 * this.size * (rows + (cols > 1 ? 0.5 : 0)),
    };
  }

  /** Corner i (0 = east, going clockwise in screen space). */
  corner(cx: number, cy: number, i: number): [number, number] {
    const a = (Math.PI / 3) * i;
    return [cx + this.size * Math.cos(a), cy + this.size * Math.sin(a)];
  }
}

/**
 * Signed distance from point (px, py), relative to a flat-top hex centre,
 * to the hexagon boundary. Negative inside. `apothem` is centre-to-edge distance.
 */
export function sdHexagon(px: number, py: number, apothem: number): number {
  // Constants from Inigo Quilez's hexagon SDF: flat top/bottom edges at y = +-apothem.
  const kx = -0.8660254037844386;
  const ky = 0.5;
  const kz = 0.5773502691896258;
  px = Math.abs(px);
  py = Math.abs(py);
  const dot = Math.min(kx * px + ky * py, 0);
  px -= 2 * dot * kx;
  py -= 2 * dot * ky;
  const lim = kz * apothem;
  const cx = px < -lim ? -lim : px > lim ? lim : px;
  px -= cx;
  py -= apothem;
  const len = Math.hypot(px, py);
  return py < 0 ? -len : len;
}
