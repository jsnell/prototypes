import { shade, toCss, type RGB } from '../../core/color';
import type { Ctx2D } from './canvas';

/**
 * A tiny oblique 3D painter for buildings.
 *
 * Local space: x right, y towards the viewer, z up, in design units.
 * Projection matches the terrain: screen = (x, y - z) * u.
 * Faces are flat-shaded with a fixed light and culled when they face away
 * from the view direction (0, 1, 1).
 */
export type V3 = [number, number, number];

export class Solid {
  readonly ctx: Ctx2D;
  readonly glow: Ctx2D | null;
  readonly u: number;
  /** Unit vector towards the light. */
  light: V3;
  /** Edge darkening (0 disables outlines). */
  edge = 0.8;

  constructor(ctx: Ctx2D, glow: Ctx2D | null, u: number, lightFromEast: boolean) {
    this.ctx = ctx;
    this.glow = glow;
    this.u = u;
    const lx = lightFromEast ? 0.55 : -0.55;
    const l: V3 = [lx, 0.4, 0.74];
    const n = Math.hypot(l[0], l[1], l[2]);
    this.light = [l[0] / n, l[1] / n, l[2] / n];
  }

  px(p: V3): [number, number] {
    return [p[0] * this.u, (p[1] - p[2]) * this.u];
  }

  brightness(n: V3): number {
    const d = n[0] * this.light[0] + n[1] * this.light[1] + n[2] * this.light[2];
    return 0.58 + 0.55 * Math.max(0, d);
  }

  static visible(n: V3): boolean {
    return n[1] + n[2] > 1e-4;
  }

  /** Fill a planar polygon with outward normal n. */
  face(pts: V3[], n: V3, color: RGB, alpha = 1): void {
    if (!Solid.visible(n)) return;
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    const nn: V3 = [n[0] / len, n[1] / len, n[2] / len];
    const c = shade(color, this.brightness(nn));
    const ctx = this.ctx;
    ctx.beginPath();
    const [x0, y0] = this.px(pts[0]);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < pts.length; i++) {
      const [x, y] = this.px(pts[i]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = toCss(c, alpha);
    ctx.fill();
    if (this.edge > 0) {
      ctx.strokeStyle = toCss(shade(c, this.edge), 0.55 * alpha);
      ctx.lineWidth = Math.max(0.35, this.u * 0.22);
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  /** Emissive polygon on the glow layer (window lights). */
  glowFace(pts: V3[], color: string): void {
    const g = this.glow;
    if (!g) return;
    g.beginPath();
    const [x0, y0] = this.px(pts[0]);
    g.moveTo(x0, y0);
    for (let i = 1; i < pts.length; i++) {
      const [x, y] = this.px(pts[i]);
      g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = color;
    g.fill();
    // Soft halo so lit windows read at map scale.
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      const [x, y] = this.px(p);
      cx += x / pts.length;
      cy += y / pts.length;
    }
    const r = this.u * 2.2;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,190,100,0.45)');
    grad.addColorStop(1, 'rgba(255,170,80,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  }

  /** Soft ground shadow of a footprint polygon extruded to height h. */
  shadow(foot: [number, number][], h: number, dir: [number, number], alpha = 0.32): void {
    const pts: [number, number][] = [];
    const len = h * 0.9;
    for (const [x, y] of foot) {
      pts.push([x, y]);
      pts.push([x + dir[0] * len, y + dir[1] * len * 0.6]);
    }
    const hull = convexHull(pts);
    const ctx = this.ctx;
    ctx.beginPath();
    hull.forEach(([x, y], i) => (i ? ctx.lineTo(x * this.u, y * this.u) : ctx.moveTo(x * this.u, y * this.u)));
    ctx.closePath();
    ctx.fillStyle = `rgba(16,20,14,${alpha})`;
    ctx.fill();
  }
}

export function convexHull(points: [number, number][]): [number, number][] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** A local frame: position + rotation about z. */
export class Frame {
  constructor(
    readonly ox: number,
    readonly oy: number,
    readonly rot: number,
  ) {}

  p(x: number, y: number, z: number): V3 {
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    return [this.ox + x * c - y * s, this.oy + x * s + y * c, z];
  }

  n(x: number, y: number, z: number): V3 {
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    return [x * c - y * s, x * s + y * c, z];
  }

  foot(w: number, d: number): [number, number][] {
    return [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ].map(([x, y]) => {
      const p = this.p(x, y, 0);
      return [p[0], p[1]] as [number, number];
    });
  }
}

export interface Faces {
  pts: V3[];
  n: V3;
  color: RGB;
}

/** Sort faces back to front along the view direction and draw them. */
export function drawFaces(S: Solid, faces: Faces[]): void {
  const depth = (f: Faces) => {
    let d = 0;
    for (const p of f.pts) d += p[1] + p[2];
    return d / f.pts.length;
  };
  faces
    .filter((f) => Solid.visible(f.n))
    .sort((a, b) => depth(a) - depth(b))
    .forEach((f) => S.face(f.pts, f.n, f.color));
}

/** Box faces (sides + top). */
export function boxFaces(F: Frame, x: number, y: number, z: number, w: number, d: number, h: number, side: RGB, top: RGB): Faces[] {
  const x0 = x - w / 2;
  const x1 = x + w / 2;
  const y0 = y - d / 2;
  const y1 = y + d / 2;
  const z1 = z + h;
  return [
    { pts: [F.p(x0, y1, z), F.p(x1, y1, z), F.p(x1, y1, z1), F.p(x0, y1, z1)], n: F.n(0, 1, 0), color: side },
    { pts: [F.p(x1, y0, z), F.p(x1, y1, z), F.p(x1, y1, z1), F.p(x1, y0, z1)], n: F.n(1, 0, 0), color: side },
    { pts: [F.p(x0, y0, z), F.p(x0, y1, z), F.p(x0, y1, z1), F.p(x0, y0, z1)], n: F.n(-1, 0, 0), color: side },
    { pts: [F.p(x0, y0, z), F.p(x1, y0, z), F.p(x1, y0, z1), F.p(x0, y0, z1)], n: F.n(0, -1, 0), color: side },
    { pts: [F.p(x0, y0, z1), F.p(x1, y0, z1), F.p(x1, y1, z1), F.p(x0, y1, z1)], n: [0, 0, 1], color: top },
  ];
}

/** Gable roof with ridge along local x. */
export function gableFaces(F: Frame, x: number, y: number, z: number, w: number, d: number, rh: number, roof: RGB, gable: RGB): Faces[] {
  const x0 = x - w / 2;
  const x1 = x + w / 2;
  const y0 = y - d / 2;
  const y1 = y + d / 2;
  const zr = z + rh;
  return [
    { pts: [F.p(x0, y1, z), F.p(x1, y1, z), F.p(x1, y, zr), F.p(x0, y, zr)], n: F.n(0, rh, d / 2), color: roof },
    { pts: [F.p(x0, y0, z), F.p(x1, y0, z), F.p(x1, y, zr), F.p(x0, y, zr)], n: F.n(0, -rh, d / 2), color: roof },
    { pts: [F.p(x1, y0, z), F.p(x1, y1, z), F.p(x1, y, zr)], n: F.n(1, 0, 0), color: gable },
    { pts: [F.p(x0, y0, z), F.p(x0, y1, z), F.p(x0, y, zr)], n: F.n(-1, 0, 0), color: gable },
  ];
}

/** Pyramid / hip roof. */
export function pyramidFaces(F: Frame, x: number, y: number, z: number, w: number, d: number, h: number, color: RGB): Faces[] {
  const x0 = x - w / 2;
  const x1 = x + w / 2;
  const y0 = y - d / 2;
  const y1 = y + d / 2;
  const apex = F.p(x, y, z + h);
  return [
    { pts: [F.p(x0, y1, z), F.p(x1, y1, z), apex], n: F.n(0, h, d / 2), color },
    { pts: [F.p(x1, y0, z), F.p(x1, y1, z), apex], n: F.n(h, 0, w / 2), color },
    { pts: [F.p(x0, y0, z), F.p(x0, y1, z), apex], n: F.n(-h, 0, w / 2), color },
    { pts: [F.p(x0, y0, z), F.p(x1, y0, z), apex], n: F.n(0, -h, d / 2), color },
  ];
}

export function cylinderFaces(F: Frame, x: number, y: number, z: number, r: number, h: number, side: RGB, top: RGB | null, n = 12): Faces[] {
  const faces: Faces[] = [];
  const ring: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    faces.push({
      pts: [
        F.p(x + Math.cos(a0) * r, y + Math.sin(a0) * r, z),
        F.p(x + Math.cos(a1) * r, y + Math.sin(a1) * r, z),
        F.p(x + Math.cos(a1) * r, y + Math.sin(a1) * r, z + h),
        F.p(x + Math.cos(a0) * r, y + Math.sin(a0) * r, z + h),
      ],
      n: F.n(Math.cos(am), Math.sin(am), 0),
      color: side,
    });
    ring.push(F.p(x + Math.cos(a0) * r, y + Math.sin(a0) * r, z + h));
  }
  if (top) faces.push({ pts: ring, n: [0, 0, 1], color: top });
  return faces;
}

export function coneFaces(F: Frame, x: number, y: number, z: number, r: number, h: number, color: RGB, n = 12): Faces[] {
  const faces: Faces[] = [];
  const apex = F.p(x, y, z + h);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    faces.push({
      pts: [F.p(x + Math.cos(a0) * r, y + Math.sin(a0) * r, z), F.p(x + Math.cos(a1) * r, y + Math.sin(a1) * r, z), apex],
      n: F.n(Math.cos(am) * h, Math.sin(am) * h, r),
      color,
    });
  }
  return faces;
}

export function domeFaces(F: Frame, x: number, y: number, z: number, r: number, color: RGB, n = 12, bands = 4): Faces[] {
  const faces: Faces[] = [];
  for (let b = 0; b < bands; b++) {
    const p0 = (b / bands) * (Math.PI / 2);
    const p1 = ((b + 1) / bands) * (Math.PI / 2);
    const pm = (p0 + p1) / 2;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const pt = (a: number, p: number): V3 => F.p(x + Math.cos(a) * Math.cos(p) * r, y + Math.sin(a) * Math.cos(p) * r, z + Math.sin(p) * r);
      faces.push({
        pts: [pt(a0, p0), pt(a1, p0), pt(a1, p1), pt(a0, p1)],
        n: F.n(Math.cos(am) * Math.cos(pm), Math.sin(am) * Math.cos(pm), Math.sin(pm)),
        color,
      });
    }
  }
  return faces;
}

/** A rectangle on the front (+y) wall of a box: along-wall s0..s1, height t0..t1. */
export function wallRect(F: Frame, bx: number, by: number, bz: number, w: number, d: number, side: 0 | 1 | 2 | 3, s0: number, s1: number, t0: number, t1: number): { pts: V3[]; n: V3 } {
  // side: 0 = +y, 1 = +x, 2 = -y, 3 = -x
  const hw = w / 2;
  const hd = d / 2;
  const off = 0.02;
  let pts: V3[];
  let n: V3;
  switch (side) {
    case 0:
      pts = [F.p(bx - hw + s0, by + hd + off, bz + t0), F.p(bx - hw + s1, by + hd + off, bz + t0), F.p(bx - hw + s1, by + hd + off, bz + t1), F.p(bx - hw + s0, by + hd + off, bz + t1)];
      n = F.n(0, 1, 0);
      break;
    case 1:
      pts = [F.p(bx + hw + off, by - hd + s0, bz + t0), F.p(bx + hw + off, by - hd + s1, bz + t0), F.p(bx + hw + off, by - hd + s1, bz + t1), F.p(bx + hw + off, by - hd + s0, bz + t1)];
      n = F.n(1, 0, 0);
      break;
    case 2:
      pts = [F.p(bx - hw + s0, by - hd - off, bz + t0), F.p(bx - hw + s1, by - hd - off, bz + t0), F.p(bx - hw + s1, by - hd - off, bz + t1), F.p(bx - hw + s0, by - hd - off, bz + t1)];
      n = F.n(0, -1, 0);
      break;
    default:
      pts = [F.p(bx - hw - off, by - hd + s0, bz + t0), F.p(bx - hw - off, by - hd + s1, bz + t0), F.p(bx - hw - off, by - hd + s1, bz + t1), F.p(bx - hw - off, by - hd + s0, bz + t1)];
      n = F.n(-1, 0, 0);
  }
  return { pts, n };
}
