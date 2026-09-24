import { DIR_VECTORS, type HexLayout } from '../core/hex';
import { hashFloat } from '../core/rng';

/**
 * Road and river centre-lines inside one hex.
 *
 * Every connection is a curve that meets the shared edge midpoint at a right
 * angle, so the pieces drawn by two neighbouring hexes join seamlessly.
 */
export interface HexPaths {
  /** Flattened segment list: x0, y0, x1, y1, ... per polyline, separated into polylines. */
  lines: Float32Array[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PathOptions {
  /** Maximum lateral wiggle as a fraction of the apothem. */
  wiggle: number;
  /** Number of serpentine turns (0 = gentle curve). Used for mountain switchbacks. */
  switchbacks: number;
  /** Per-direction lateral offset of the edge endpoint (world units along the edge). */
  endOffset?: (d: number) => number;
  /** Shorten spokes (0..1) - used for river mouths entering a water hex. */
  spokeLength?: number;
  seed: number;
}

const SAMPLES = 16;

function perp(d: number): [number, number] {
  const v = DIR_VECTORS[d];
  return [-v[1], v[0]];
}

/** Canonical along-edge unit vector so both hexes sharing an edge agree on its sign. */
export function edgeTangent(d: number): [number, number] {
  const p = perp(d);
  return d < 3 ? p : [-p[0], -p[1]];
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const it = 1 - t;
  return it * it * it * p0 + 3 * it * it * t * p1 + 3 * it * t * t * p2 + t * t * t * p3;
}

function curve(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number,
  wiggle: number, turns: number, phase: number,
): Float32Array {
  const out = new Float32Array((SAMPLES + 1) * 2);
  const dx = x3 - x0;
  const dy = y3 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    let x = cubic(x0, x1, x2, x3, t);
    let y = cubic(y0, y1, y2, y3, t);
    // Envelope with zero slope at both ends keeps edge joins perpendicular.
    const env = Math.sin(Math.PI * t) ** 2;
    const w = turns > 0
      ? Math.sin(Math.PI * t * turns * 2 + phase) * wiggle
      : Math.sin(Math.PI * t * 1.5 + phase) * wiggle;
    x += nx * w * env;
    y += ny * w * env;
    out[i * 2] = x;
    out[i * 2 + 1] = y;
  }
  return out;
}

/** Build the centre-lines for a hex with the given connection mask. */
export function buildHexPaths(
  layout: HexLayout,
  cx: number,
  cy: number,
  mask: number,
  opts: PathOptions,
): HexPaths | null {
  if (!mask) return null;
  const a = layout.apothem;
  const dirs: number[] = [];
  for (let d = 0; d < 6; d++) if (mask & (1 << d)) dirs.push(d);

  const ends = dirs.map((d) => {
    const v = DIR_VECTORS[d];
    let x = cx + v[0] * a;
    let y = cy + v[1] * a;
    const off = opts.endOffset?.(d) ?? 0;
    if (off) {
      const t = edgeTangent(d);
      x += t[0] * off;
      y += t[1] * off;
    }
    return { d, x, y, vx: v[0], vy: v[1] };
  });

  const lines: Float32Array[] = [];
  const wig = opts.wiggle * a;
  const turns = opts.switchbacks;
  const phase = (h: number) => (hashFloat(h, 7, 3, opts.seed) - 0.5) * 1.2;

  if (dirs.length === 2 && !opts.spokeLength) {
    const [e0, e1] = ends;
    const straight = (e0.d + 3) % 6 === e1.d;
    const k = straight ? a * 0.6 : a * 0.5;
    lines.push(
      curve(
        e0.x, e0.y, e0.x - e0.vx * k, e0.y - e0.vy * k,
        e1.x - e1.vx * k, e1.y - e1.vy * k, e1.x, e1.y,
        wig, turns, phase(0),
      ),
    );
  } else {
    // Junction (or dead end): every spoke runs from its edge to a jittered node.
    const jx = (hashFloat(1, 2, 3, opts.seed) - 0.5) * a * 0.24;
    const jy = (hashFloat(4, 5, 6, opts.seed) - 0.5) * a * 0.24;
    const nx = cx + jx;
    const ny = cy + jy;
    const len = opts.spokeLength ?? 1;
    for (const e of ends) {
      let tx = nx;
      let ty = ny;
      if (len < 1) {
        tx = e.x + (nx - e.x) * len;
        ty = e.y + (ny - e.y) * len;
      }
      const k = a * 0.45 * len;
      lines.push(
        curve(
          e.x, e.y, e.x - e.vx * k, e.y - e.vy * k,
          tx + (e.x - tx) * 0.3, ty + (e.y - ty) * 0.3, tx, ty,
          wig * len, turns, phase(e.d + 1),
        ),
      );
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of lines) {
    for (let i = 0; i < l.length; i += 2) {
      if (l[i] < minX) minX = l[i];
      if (l[i] > maxX) maxX = l[i];
      if (l[i + 1] < minY) minY = l[i + 1];
      if (l[i + 1] > maxY) maxY = l[i + 1];
    }
  }
  return { lines, minX, minY, maxX, maxY };
}

/** Squared distance from (px, py) to the nearest point on any polyline (or `limit2` if farther). */
export function pathDistance2(paths: HexPaths, px: number, py: number, limit2: number): number {
  const lim = Math.sqrt(limit2);
  if (px < paths.minX - lim || px > paths.maxX + lim || py < paths.minY - lim || py > paths.maxY + lim) {
    return limit2;
  }
  let best = limit2;
  for (const l of paths.lines) {
    for (let i = 0; i + 3 < l.length; i += 2) {
      const ax = l[i];
      const ay = l[i + 1];
      const bx = l[i + 2];
      const by = l[i + 3];
      const vx = bx - ax;
      const vy = by - ay;
      const wx = px - ax;
      const wy = py - ay;
      const vv = vx * vx + vy * vy;
      let t = vv > 0 ? (wx * vx + wy * vy) / vv : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = wx - vx * t;
      const dy = wy - vy * t;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
  }
  return best;
}

export interface Crossing {
  x: number;
  y: number;
  /** Unit direction of the first path (the road) at the crossing. */
  dx: number;
  dy: number;
}

/** Intersections between two sets of polylines (e.g. roads and rivers). */
export function findCrossings(a: HexPaths, b: HexPaths, mergeDist: number): Crossing[] {
  const out: Crossing[] = [];
  for (const la of a.lines) {
    for (let i = 0; i + 3 < la.length; i += 2) {
      const p0x = la[i];
      const p0y = la[i + 1];
      const p1x = la[i + 2];
      const p1y = la[i + 3];
      for (const lb of b.lines) {
        for (let j = 0; j + 3 < lb.length; j += 2) {
          const q0x = lb[j];
          const q0y = lb[j + 1];
          const q1x = lb[j + 2];
          const q1y = lb[j + 3];
          const rx = p1x - p0x;
          const ry = p1y - p0y;
          const sx = q1x - q0x;
          const sy = q1y - q0y;
          const den = rx * sy - ry * sx;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((q0x - p0x) * sy - (q0y - p0y) * sx) / den;
          const u = ((q0x - p0x) * ry - (q0y - p0y) * rx) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const x = p0x + rx * t;
          const y = p0y + ry * t;
          if (out.some((c) => Math.hypot(c.x - x, c.y - y) < mergeDist)) continue;
          const len = Math.hypot(rx, ry) || 1;
          out.push({ x, y, dx: rx / len, dy: ry / len });
        }
      }
    }
  }
  return out;
}
