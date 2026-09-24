import { hex, mix, shade, type RGB } from '../../core/color';
import { Rng } from '../../core/rng';
import type { BuildingStyle } from '../../model/biomes';
import type { Season } from '../environment';
import { captureSprite, type Ctx2D, type SpriteImage } from './canvas';
import {
  Frame,
  Solid,
  boxFaces,
  coneFaces,
  cylinderFaces,
  domeFaces,
  drawFaces,
  gableFaces,
  pyramidFaces,
  wallRect,
  type Faces,
} from './solid';

export type StructureKind =
  | 'house'
  | 'hall'
  | 'barn'
  | 'keep'
  | 'tower'
  | 'wall'
  | 'gate'
  | 'ruin'
  | 'mine'
  | 'quarry'
  | 'haystack'
  | 'well'
  | 'pier'
  | 'bridge'
  | 'boat'
  | 'smoke';

export interface StructureParams {
  kind: StructureKind;
  style: BuildingStyle;
  season: Season;
  u: number;
  variant: number;
  /** Rotation about the vertical axis (radians). */
  rot: number;
  snowy: boolean;
  lightFromEast: boolean;
  shadowDir: [number, number];
  /** Length in design units for walls, piers and bridges. */
  len?: number;
  /** Stone colour for castles / towers / walls. */
  stone?: RGB;
}

const SNOW = hex('#eef3f8');
const GLOW = 'rgba(255,196,110,0.95)';
const WINDOW = hex('#2c241e');

interface Palette {
  wall: RGB;
  wallAlt: RGB;
  roof: RGB;
  roofAlt: RGB;
  trim: RGB;
}

const STYLE_PAL: Record<BuildingStyle, Palette> = {
  timber: { wall: hex('#e4d8bc'), wallAlt: hex('#d9c7a2'), roof: hex('#9a4a2e'), roofAlt: hex('#b59259'), trim: hex('#5a4332') },
  log: { wall: hex('#80603f'), wallAlt: hex('#6f5236'), roof: hex('#4d3d30'), roofAlt: hex('#5d5143'), trim: hex('#3f3024') },
  adobe: { wall: hex('#d8b47e'), wallAlt: hex('#e2c595'), roof: hex('#c9a46f'), roofAlt: hex('#e8d6b0'), trim: hex('#7a5a3a') },
  hut: { wall: hex('#b0835a'), wallAlt: hex('#9c7450'), roof: hex('#c2a063'), roofAlt: hex('#a88a52'), trim: hex('#6a4e32') },
  stilt: { wall: hex('#9a7a4c'), wallAlt: hex('#b09060'), roof: hex('#8f8a4e'), roofAlt: hex('#a39456'), trim: hex('#5a4630') },
  stone: { wall: hex('#8e8a82'), wallAlt: hex('#9d988e'), roof: hex('#4f5660'), roofAlt: hex('#5d5550'), trim: hex('#4a4540') },
};

function roofColor(p: StructureParams, pal: Palette, rng: Rng): RGB {
  const base = rng.next() < 0.5 ? pal.roof : pal.roofAlt;
  return p.snowy ? mix(base, SNOW, 0.85) : shade(base, 0.92 + rng.next() * 0.16);
}

function windows(S: Solid, F: Frame, bx: number, by: number, bz: number, w: number, d: number, h: number, rng: Rng, color: RGB, lit: number): Faces[] {
  const faces: Faces[] = [];
  const glows: { pts: ReturnType<typeof wallRect>['pts'] }[] = [];
  for (const side of [0, 1, 3] as const) {
    const span = side === 0 ? w : d;
    const count = Math.max(1, Math.floor(span / 2.4));
    for (let i = 0; i < count; i++) {
      const c = ((i + 0.5) / count) * span;
      const ww = 0.7;
      const rect = wallRect(F, bx, by, bz, w, d, side, c - ww / 2, c + ww / 2, h * 0.42, h * 0.42 + 0.9);
      faces.push({ pts: rect.pts, n: rect.n, color });
      if (rng.next() < lit && Solid.visible(rect.n)) glows.push({ pts: rect.pts });
    }
  }
  for (const g of glows) S.glowFace(g.pts, GLOW);
  return faces;
}

function house(S: Solid, p: StructureParams, rng: Rng): void {
  const pal = STYLE_PAL[p.style];
  const F = new Frame(0, 0, p.rot);
  const big = p.kind === 'barn';
  const w = (big ? 7.5 : 5.2 + rng.next() * 1.8);
  const d = (big ? 5 : 3.8 + rng.next() * 0.8);
  const wallC = big && p.style === 'timber' ? hex('#8a3b2a') : shade(rng.next() < 0.5 ? pal.wall : pal.wallAlt, 0.95 + rng.next() * 0.1);

  if (p.style === 'hut') {
    const r = 2.2 + rng.next() * 0.5;
    const h = 2.2;
    S.shadow(circle(r * 1.2), h + 3, p.shadowDir);
    drawFaces(S, cylinderFaces(F, 0, 0, 0, r, h, wallC, null));
    const door = wallRect(F, 0, 0, 0, r * 1.2, r * 2, 0, r * 0.45, r * 0.75, 0, 1.5);
    S.face(door.pts, door.n, WINDOW);
    drawFaces(S, coneFaces(F, 0, 0, h - 0.2, r * 1.3, 3 + rng.next() * 0.6, roofColor(p, pal, rng)));
    return;
  }

  const lift = p.style === 'stilt' ? 1.8 : 0;
  const h = (p.style === 'adobe' ? 3 : 2.8) + rng.next() * 0.8 + (big ? 0.6 : 0);
  S.shadow(F.foot(w + 1, d + 1).map(([x, y]) => [x, y]), h + lift + 2.5, p.shadowDir);

  if (lift > 0) {
    const post = shade(pal.trim, 0.9);
    const faces: Faces[] = [];
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      faces.push(...boxFaces(F, (sx * (w - 0.6)) / 2, (sy * (d - 0.6)) / 2, 0, 0.45, 0.45, lift, post, post));
    }
    drawFaces(S, faces);
    drawFaces(S, boxFaces(F, 0, 0, lift - 0.3, w + 0.6, d + 0.6, 0.3, pal.trim, shade(pal.wallAlt, 0.9)));
  }

  const body = boxFaces(F, 0, 0, lift, w, d, h, wallC, wallC);
  drawFaces(S, body.slice(0, 4));
  // Wall details on visible faces.
  const details: Faces[] = [];
  if (p.style === 'timber' && !big) {
    for (const side of [0, 1, 3] as const) {
      const span = side === 0 ? w : d;
      for (const s0 of [0, span / 2 - 0.15, span - 0.3]) {
        const r = wallRect(F, 0, 0, lift, w, d, side, s0, s0 + 0.3, 0, h);
        details.push({ pts: r.pts, n: r.n, color: pal.trim });
      }
      const beam = wallRect(F, 0, 0, lift, w, d, side, 0, span, h * 0.55, h * 0.55 + 0.25);
      details.push({ pts: beam.pts, n: beam.n, color: pal.trim });
    }
  } else if (p.style === 'log') {
    for (const side of [0, 1, 3] as const) {
      const span = side === 0 ? w : d;
      for (let t = 0.7; t < h; t += 0.75) {
        const r = wallRect(F, 0, 0, lift, w, d, side, 0, span, t, t + 0.12);
        details.push({ pts: r.pts, n: r.n, color: shade(wallC, 0.7) });
      }
    }
  }
  details.push(...windows(S, F, 0, 0, lift, w, d, h, rng, WINDOW, 0.55));
  const door = wallRect(F, 0, 0, lift, w, d, 0, w * 0.5 - 0.55, w * 0.5 + 0.55, 0, big ? 2.6 : 1.8);
  details.push({ pts: door.pts, n: door.n, color: big ? shade(pal.trim, 0.8) : hex('#4a3526') });
  for (const f of details) S.face(f.pts, f.n, f.color);

  const roofZ = lift + h;
  if (p.style === 'adobe') {
    const top = shade(pal.roof, 1.05);
    drawFaces(S, [body[4]].map((f) => ({ ...f, color: top })));
    // Parapet lip and roof beams.
    drawFaces(S, boxFaces(F, 0, d / 2 - 0.15, roofZ, w, 0.3, 0.45, shade(wallC, 1.02), shade(wallC, 1.1)));
    if (rng.next() < 0.45) {
      const w2 = w * 0.5;
      const d2 = d * 0.55;
      const ox = (rng.next() - 0.5) * (w - w2);
      drawFaces(S, boxFaces(F, ox, -d * 0.18, roofZ, w2, d2, 2.2, wallC, top));
      const win = wallRect(F, ox, -d * 0.18, roofZ, w2, d2, 0, w2 / 2 - 0.35, w2 / 2 + 0.35, 0.8, 1.6);
      S.face(win.pts, win.n, WINDOW);
      if (rng.next() < 0.5) S.glowFace(win.pts, GLOW);
    }
    return;
  }
  const over = 0.45;
  const steep = p.style === 'log' || p.style === 'stilt' || p.snowy ? 1.25 : 1;
  const rh = (d / 2) * (0.95 + rng.next() * 0.35) * steep;
  const roof = roofColor(p, pal, rng);
  drawFaces(S, gableFaces(F, 0, 0, roofZ - 0.15, w + over * 2, d + over * 2, rh, roof, wallC));
  if (!big && p.style !== 'stilt' && rng.next() < 0.7) {
    const cx = (rng.next() - 0.5) * w * 0.5;
    drawFaces(S, boxFaces(F, cx, -d * 0.12, roofZ + rh * 0.35, 0.7, 0.7, rh * 0.75, shade(pal.trim, 1.1), shade(pal.trim, 0.8)));
  }
}

function hall(S: Solid, p: StructureParams, rng: Rng): void {
  const pal = STYLE_PAL[p.style];
  const F = new Frame(0, 0, p.rot);
  const wallC = p.style === 'timber' ? hex('#c9c1b0') : pal.wall;
  if (p.style === 'adobe') {
    S.shadow(F.foot(9, 9), 12, p.shadowDir);
    drawFaces(S, boxFaces(F, 4.2, -3, 0, 1.8, 1.8, 11, wallC, wallC));
    drawFaces(S, domeFaces(F, 4.2, -3, 11, 1.1, pal.roofAlt, 8, 2));
    drawFaces(S, boxFaces(F, 0, 0, 0, 8, 8, 4.4, wallC, shade(pal.roof, 1.05)));
    for (const f of windows(S, F, 0, 0, 0, 8, 8, 4.4, rng, WINDOW, 0.6)) S.face(f.pts, f.n, f.color);
    const door = wallRect(F, 0, 0, 0, 8, 8, 0, 3.2, 4.8, 0, 2.6);
    S.face(door.pts, door.n, hex('#4a3526'));
    drawFaces(S, cylinderFaces(F, 0, 0, 4.4, 2.8, 0.8, wallC, null, 16));
    drawFaces(S, domeFaces(F, 0, 0, 5.2, 2.8, p.snowy ? SNOW : hex('#e9d9b4'), 16, 4));
    return;
  }
  if (p.style === 'hut') {
    S.shadow(circle(5), 8, p.shadowDir);
    drawFaces(S, cylinderFaces(F, 0, 0, 0, 4, 3, pal.wall, null, 16));
    const door = wallRect(F, 0, 0, 0, 4.8, 8, 0, 1.8, 3, 0, 2);
    S.face(door.pts, door.n, WINDOW);
    drawFaces(S, coneFaces(F, 0, 0, 2.8, 5, 5.5, roofColor(p, pal, rng), 16));
    return;
  }
  // Church / temple / longhouse: nave plus bell tower.
  const nw = 10;
  const nd = 5;
  const nh = 4.8;
  S.shadow(F.foot(nw + 2, nd + 2), 14, p.shadowDir);
  const tower = p.style !== 'stilt';
  const drawTower = () => {
    const tc = p.style === 'log' ? pal.wallAlt : shade(wallC, 0.95);
    drawFaces(S, boxFaces(F, -nw / 2 + 1.4, 0, 0, 3, 3, 10.5, tc, tc));
    const slot = wallRect(F, -nw / 2 + 1.4, 0, 0, 3, 3, 0, 1, 2, 8, 9.6);
    S.face(slot.pts, slot.n, WINDOW);
    const slot2 = wallRect(F, -nw / 2 + 1.4, 0, 0, 3, 3, 1, 1, 2, 8, 9.6);
    S.face(slot2.pts, slot2.n, WINDOW);
    drawFaces(S, pyramidFaces(F, -nw / 2 + 1.4, 0, 10.5, 3.6, 3.6, 5, p.snowy ? mix(pal.roof, SNOW, 0.7) : shade(pal.roof, 0.85)));
  };
  // Tower is at the local -x end; draw it first if it is behind the nave.
  const towerBehind = Math.sin(p.rot) > 0;
  if (tower && towerBehind) drawTower();
  const lift = p.style === 'stilt' ? 1.8 : 0;
  if (lift) {
    const faces: Faces[] = [];
    for (let i = 0; i < 4; i++) for (const sy of [-1, 1]) faces.push(...boxFaces(F, -nw / 2 + 1 + i * ((nw - 2) / 3), (sy * (nd - 0.6)) / 2, 0, 0.5, 0.5, lift, pal.trim, pal.trim));
    drawFaces(S, faces);
  }
  drawFaces(S, boxFaces(F, 0, 0, lift, nw, nd, nh, wallC, wallC).slice(0, 4));
  for (const f of windows(S, F, 0, 0, lift, nw, nd, nh, rng, WINDOW, 0.8)) S.face(f.pts, f.n, f.color);
  drawFaces(S, gableFaces(F, 0, 0, lift + nh - 0.1, nw + 0.8, nd + 0.8, nd * 0.75, roofColor(p, pal, rng), wallC));
  if (tower && !towerBehind) drawTower();
}

function circle(r: number, n = 10): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) pts.push([Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r]);
  return pts;
}

function crenellations(F: Frame, x: number, y: number, z: number, w: number, d: number, c: RGB): Faces[] {
  const faces: Faces[] = [];
  const step = 1.2;
  for (let s = -w / 2 + 0.4; s <= w / 2 - 0.3; s += step) {
    faces.push(...boxFaces(F, x + s, y - d / 2 + 0.3, z, 0.6, 0.6, 0.7, c, c));
    faces.push(...boxFaces(F, x + s, y + d / 2 - 0.3, z, 0.6, 0.6, 0.7, c, c));
  }
  for (let s = -d / 2 + 1.6; s <= d / 2 - 1.5; s += step) {
    faces.push(...boxFaces(F, x - w / 2 + 0.3, y + s, z, 0.6, 0.6, 0.7, c, c));
    faces.push(...boxFaces(F, x + w / 2 - 0.3, y + s, z, 0.6, 0.6, 0.7, c, c));
  }
  return faces;
}

function roundTower(S: Solid, F: Frame, x: number, y: number, r: number, h: number, stone: RGB, roof: RGB | null, rng: Rng): void {
  drawFaces(S, cylinderFaces(F, x, y, 0, r, h, stone, shade(stone, 1.05)));
  const win = wallRect(F, x, y, 0, r * 1.2, r * 2, 0, r * 0.45, r * 0.75, h * 0.6, h * 0.6 + 1.1);
  S.face(win.pts, win.n, WINDOW);
  if (rng.next() < 0.6) S.glowFace(win.pts, GLOW);
  if (roof) {
    drawFaces(S, coneFaces(F, x, y, h, r * 1.2, r * 2.4, roof));
  } else {
    const faces: Faces[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      faces.push(...boxFaces(F, x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85, h, 0.6, 0.6, 0.7, stone, stone));
    }
    drawFaces(S, faces);
  }
}

function keep(S: Solid, p: StructureParams, rng: Rng): void {
  const stone = p.stone ?? hex('#9a948a');
  const F = new Frame(0, 0, 0);
  const R = 7.5;
  const wallH = 5;
  const roof = p.snowy ? mix(hex('#4d5a6e'), SNOW, 0.8) : rng.next() < 0.5 ? hex('#4d5a6e') : hex('#8e3b2c');
  S.shadow(F.foot(R * 2 + 3, R * 2 + 3), 12, p.shadowDir, 0.3);
  const wall = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const W = new Frame((x0 + x1) / 2, (y0 + y1) / 2, Math.atan2(y1 - y0, x1 - x0));
    drawFaces(S, [...boxFaces(W, 0, 0, 0, len, 1.4, wallH, stone, shade(stone, 1.08)), ...crenellations(W, 0, 0, wallH, len, 1.4, stone)]);
  };
  // Back wall and back towers.
  wall(-R, -R, R, -R);
  roundTower(S, F, -R, -R, 2.2, 8, stone, roof, rng);
  roundTower(S, F, R, -R, 2.2, 8, stone, roof, rng);
  wall(-R, -R, -R, R);
  wall(R, -R, R, R);
  // Keep.
  drawFaces(S, boxFaces(F, 0, -0.8, 0, 6.5, 6.5, 11, shade(stone, 0.97), shade(stone, 1.05)));
  for (const f of windows(S, F, 0, -0.8, 0, 6.5, 6.5, 11, rng, WINDOW, 0.7)) S.face(f.pts, f.n, f.color);
  drawFaces(S, crenellations(F, 0, -0.8, 11, 6.5, 6.5, stone));
  // Front wall with a gate, front towers.
  wall(-R, R, -1.6, R);
  wall(1.6, R, R, R);
  drawFaces(S, boxFaces(F, 0, R, wallH - 1.2, 3.4, 1.4, 1.2, stone, shade(stone, 1.08)));
  const gate = wallRect(F, 0, R, 0, 3.2, 1.4, 0, 0, 3.2, 0, wallH - 1.2);
  S.face(gate.pts, gate.n, hex('#3a2c22'));
  roundTower(S, F, -R, R, 2.3, 8.5, stone, roof, rng);
  roundTower(S, F, R, R, 2.3, 8.5, stone, roof, rng);
}

function tower(S: Solid, p: StructureParams, rng: Rng): void {
  const stone = p.stone ?? hex('#9a948a');
  const F = new Frame(0, 0, 0);
  S.shadow(circle(3.2), 16, p.shadowDir);
  const roofed = p.variant % 2 === 0;
  const roof = p.snowy ? mix(hex('#5a4a3e'), SNOW, 0.8) : hex('#6a4a36');
  roundTower(S, F, 0, 0, 2.5, 13, stone, roofed ? roof : null, rng);
}

function wallSegment(S: Solid, p: StructureParams): void {
  const stone = p.stone ?? hex('#9a948a');
  const len = p.len ?? 4;
  const F = new Frame(0, 0, p.rot);
  S.shadow(F.foot(len, 1.4), 5, p.shadowDir, 0.26);
  drawFaces(S, [...boxFaces(F, 0, 0, 0, len, 1.3, 4, stone, shade(stone, 1.08)), ...crenellations(F, 0, 0, 4, len, 1.3, stone)]);
}

function gate(S: Solid, p: StructureParams): void {
  const stone = p.stone ?? hex('#9a948a');
  const F = new Frame(0, 0, p.rot);
  S.shadow(F.foot(4, 7), 7, p.shadowDir, 0.28);
  // Two flanking towers either side of the road (road runs along local x).
  const towers = [-2.6, 2.6].sort((a, b) => F.p(0, a, 0)[1] - F.p(0, b, 0)[1]);
  const lintel = () => drawFaces(S, boxFaces(F, 0, 0, 4.2, 2.2, 3.4, 1.3, stone, shade(stone, 1.06)));
  drawFaces(S, [...boxFaces(F, 0, towers[0], 0, 2.4, 2.2, 6.5, stone, shade(stone, 1.06)), ...crenellations(F, 0, towers[0], 6.5, 2.4, 2.2, stone)]);
  lintel();
  drawFaces(S, [...boxFaces(F, 0, towers[1], 0, 2.4, 2.2, 6.5, stone, shade(stone, 1.06)), ...crenellations(F, 0, towers[1], 6.5, 2.4, 2.2, stone)]);
}

function ruin(S: Solid, p: StructureParams, rng: Rng): void {
  const stone = mix(p.stone ?? hex('#96918a'), hex('#6f7a55'), 0.15);
  const F = new Frame(0, 0, p.rot);
  S.shadow(F.foot(9, 8), 4, p.shadowDir, 0.22);
  const pieces: Faces[][] = [];
  const segs = [
    [-4, -3.5, 3.5, 0],
    [4, -1, 3, Math.PI / 2],
    [-1, 3.2, 2.5, 0],
    [-4.2, 0.5, 2.2, Math.PI / 2],
  ];
  for (const [x, y, len, a] of segs) {
    const W = new Frame(F.p(x, y, 0)[0], F.p(x, y, 0)[1], p.rot + a);
    let s = -len / 2;
    while (s < len / 2) {
      const bl = 0.8 + rng.next() * 0.9;
      const h = 0.6 + rng.next() * 3.6;
      if (rng.next() < 0.8) pieces.push(boxFaces(W, s + bl / 2, 0, 0, bl, 1, h, stone, shade(stone, 1.1)));
      s += bl;
    }
  }
  // Broken tower stump.
  pieces.push(cylinderFaces(new Frame(0, 0, 0), F.p(3.2, -3.2, 0)[0], F.p(3.2, -3.2, 0)[1], 0, 1.8, 3 + rng.next() * 2, stone, shade(stone, 0.9)));
  for (const f of pieces.flat().sort((a, b) => a.pts[0][1] - b.pts[0][1])) S.face(f.pts, f.n, f.color);
  for (let i = 0; i < 6; i++) {
    const x = (rng.next() - 0.5) * 8;
    const y = (rng.next() - 0.5) * 7;
    drawFaces(S, boxFaces(new Frame(x, y, rng.next() * 3), 0, 0, 0, 0.8, 0.6, 0.5, stone, shade(stone, 1.1)));
  }
}

function mine(S: Solid, p: StructureParams, rng: Rng): void {
  const F = new Frame(0, 0, 0);
  const wood = hex('#6a4d32');
  const rockC = p.stone ?? hex('#7d756b');
  S.shadow(F.foot(10, 6), 5, p.shadowDir, 0.24);
  // Rock face the adit cuts into.
  drawFaces(S, domeFaces(new Frame(0, -2.2, 0), 0, 0, 0, 4.2, rockC, 10, 3));
  const mouth = [F.p(-1.3, 0.8, 0), F.p(1.3, 0.8, 0), F.p(1.3, 0.8, 2.6), F.p(-1.3, 0.8, 2.6)];
  S.face(mouth, [0, 1, 0], hex('#14100d'));
  drawFaces(S, [
    ...boxFaces(F, -1.5, 1, 0, 0.45, 0.45, 3, wood, wood),
    ...boxFaces(F, 1.5, 1, 0, 0.45, 0.45, 3, wood, wood),
    ...boxFaces(F, 0, 1, 3, 3.6, 0.5, 0.45, wood, wood),
  ]);
  // Spoil heap and a shed.
  drawFaces(S, coneFaces(new Frame(4.2, 2.2, 0), 0, 0, 0, 2.6, 1.8, hex('#6e675e')));
  drawFaces(S, boxFaces(new Frame(-4.4, 2, 0.3), 0, 0, 0, 3, 2.2, 2, wood, wood));
  drawFaces(S, gableFaces(new Frame(-4.4, 2, 0.3), 0, 0, 2, 3.4, 2.6, 1.2, p.snowy ? SNOW : hex('#5a4d42'), wood));
  // Cart rails.
  const ctx = S.ctx;
  ctx.strokeStyle = 'rgba(40,32,26,0.8)';
  ctx.lineWidth = Math.max(0.4, S.u * 0.25);
  for (const ox of [-0.5, 0.5]) {
    ctx.beginPath();
    ctx.moveTo(ox * S.u, 1 * S.u);
    ctx.lineTo((ox + 1.2) * S.u, 5 * S.u);
    ctx.stroke();
  }
  void rng;
}

function quarry(S: Solid, p: StructureParams, rng: Rng): void {
  const stone = p.stone ?? hex('#a39c90');
  const wood = hex('#6a4d32');
  S.shadow(new Frame(0, 0, 0).foot(10, 7), 4, p.shadowDir, 0.2);
  const faces: Faces[] = [];
  for (let i = 0; i < 7; i++) {
    const x = -3 + (i % 3) * 1.6 + (rng.next() - 0.5) * 0.4;
    const y = 1.5 + Math.floor(i / 3) * 1.3;
    const z = i >= 6 ? 1.1 : 0;
    faces.push(...boxFaces(new Frame(x, y, 0), 0, 0, z, 1.4, 1.1, 1.1, stone, shade(stone, 1.1)));
  }
  drawFaces(S, faces);
  const C = new Frame(3, -1, 0.4);
  drawFaces(S, [...boxFaces(C, 0, 0, 0, 0.5, 0.5, 7, wood, wood), ...boxFaces(C, 1.6, 0, 6.5, 4, 0.4, 0.4, wood, wood)]);
  const ctx = S.ctx;
  ctx.strokeStyle = 'rgba(40,32,26,0.8)';
  ctx.lineWidth = Math.max(0.3, S.u * 0.15);
  const [x0, y0] = S.px(C.p(3.3, 0, 6.5));
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0, y0 + 4 * S.u);
  ctx.stroke();
}

function haystack(S: Solid, p: StructureParams, rng: Rng): void {
  const gold = p.season === 'winter' ? hex('#a08a5a') : hex('#d2ae5a');
  S.shadow(circle(1.6), 3, p.shadowDir, 0.25);
  const F = new Frame(0, 0, 0);
  drawFaces(S, cylinderFaces(F, 0, 0, 0, 1.4, 1.2, gold, null, 10));
  drawFaces(S, coneFaces(F, 0, 0, 1.2, 1.5, 1.6 + rng.next() * 0.4, p.snowy ? SNOW : shade(gold, 1.05), 10));
}

function well(S: Solid, p: StructureParams): void {
  const F = new Frame(0, 0, 0);
  const stone = hex('#948f86');
  const wood = hex('#6a4d32');
  S.shadow(circle(1.2), 3, p.shadowDir, 0.25);
  drawFaces(S, cylinderFaces(F, 0, 0, 0, 1, 1, stone, hex('#2a3a44'), 10));
  drawFaces(S, [...boxFaces(F, -0.9, 0, 0, 0.3, 0.3, 2.6, wood, wood), ...boxFaces(F, 0.9, 0, 0, 0.3, 0.3, 2.6, wood, wood)]);
  drawFaces(S, gableFaces(F, 0, 0, 2.6, 2.6, 1.8, 0.8, p.snowy ? SNOW : hex('#8a4a30'), wood));
}

function pier(S: Solid, p: StructureParams): void {
  const len = p.len ?? 6;
  const F = new Frame(0, 0, p.rot);
  const wood = hex('#7a5a3a');
  const faces: Faces[] = [];
  for (let s = 0.4; s < len; s += 1.8) {
    faces.push(...boxFaces(F, s, -0.8, -1.5, 0.35, 0.35, 2.1, shade(wood, 0.7), wood));
    faces.push(...boxFaces(F, s, 0.8, -1.5, 0.35, 0.35, 2.1, shade(wood, 0.7), wood));
  }
  drawFaces(S, faces);
  drawFaces(S, boxFaces(F, len / 2, 0, 0.4, len, 2, 0.25, shade(wood, 0.8), p.snowy ? mix(wood, SNOW, 0.7) : shade(wood, 1.1)));
}

function boat(S: Solid, p: StructureParams, rng: Rng): void {
  const F = new Frame(0, 0, p.rot);
  const hull = rng.next() < 0.5 ? hex('#6b4a30') : hex('#4f5a64');
  const L = 4;
  const W = 1.5;
  const pts = (z: number, k: number) => [F.p(-L / 2 * k, 0, z), F.p(-L / 4, W / 2 * k, z), F.p(L / 2 * k, 0, z), F.p(-L / 4, -W / 2 * k, z)];
  const top = pts(0.6, 1);
  const bottom = pts(-0.2, 0.8);
  const faces: Faces[] = [];
  for (let i = 0; i < 4; i++) {
    const a = top[i];
    const b = top[(i + 1) % 4];
    const c = bottom[(i + 1) % 4];
    const d = bottom[i];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    faces.push({ pts: [a, b, c, d], n: [mx - F.ox, my - F.oy, 0.2], color: hull });
  }
  faces.push({ pts: top, n: [0, 0, 1], color: shade(hull, 1.3) });
  drawFaces(S, faces);
  if (rng.next() < 0.6) {
    const mast = F.p(-0.2, 0, 0.6);
    const [mx, my] = S.px(mast);
    const ctx = S.ctx;
    ctx.fillStyle = 'rgba(236,230,214,0.95)';
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(mx, my - 4.5 * S.u);
    ctx.lineTo(mx + 2.2 * S.u * (Math.cos(p.rot) >= 0 ? 1 : -1), my - 0.3 * S.u);
    ctx.closePath();
    ctx.fill();
  }
}

function bridge(S: Solid, p: StructureParams): void {
  const len = p.len ?? 7;
  const F = new Frame(0, 0, p.rot);
  const stoneStyle = p.style === 'stone' || p.style === 'adobe';
  const mat = stoneStyle ? hex('#9a948a') : hex('#7a5a3a');
  const deckZ = 0.9;
  S.shadow(F.foot(len, 2.6), 1.5, p.shadowDir, 0.3);
  const faces: Faces[] = [];
  // Abutments / piers.
  for (const s of [-len / 2 + 0.6, len / 2 - 0.6]) faces.push(...boxFaces(F, s, 0, -1, 1.2, 2.6, deckZ + 1, shade(mat, 0.85), mat));
  drawFaces(S, faces);
  drawFaces(S, boxFaces(F, 0, 0, deckZ, len, 2.4, 0.5, shade(mat, 0.9), p.snowy ? mix(mat, SNOW, 0.75) : shade(mat, 1.12)));
  const rail = stoneStyle ? 0.6 : 0.35;
  drawFaces(S, [
    ...boxFaces(F, 0, -1.05, deckZ + 0.5, len, 0.3, rail, mat, shade(mat, 1.1)),
    ...boxFaces(F, 0, 1.05, deckZ + 0.5, len, 0.3, rail, mat, shade(mat, 1.1)),
  ]);
}

function smoke(ctx: Ctx2D, glow: Ctx2D | null, p: StructureParams, rng: Rng): void {
  const u = p.u;
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const x = t * 6 * u + (rng.next() - 0.5) * 2 * u;
    const y = -t * 22 * u;
    const r = (1.6 + t * 4) * u;
    const g = Math.round(90 + t * 60);
    ctx.fillStyle = `rgba(${g},${g - 4},${g - 8},${0.45 * (1 - t * 0.7)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (glow) {
    glow.fillStyle = 'rgba(255,110,40,0.85)';
    glow.beginPath();
    glow.ellipse(0, 0, 3 * u, 1.4 * u, 0, 0, Math.PI * 2);
    glow.fill();
  }
}

export function paintStructure(p: StructureParams): SpriteImage {
  const u = p.u;
  const ext = (p.kind === 'keep' || p.kind === 'hall' ? 22 : p.kind === 'smoke' ? 30 : 16 + (p.len ?? 0) / 2) * u;
  return captureSprite(
    ext,
    ext * 1.3,
    ext,
    ext * 0.7,
    (ctx, glow) => {
      const rng = new Rng(p.variant * 104729 + 7);
      if (p.kind === 'smoke') {
        smoke(ctx, glow, p, rng);
        return;
      }
      const S = new Solid(ctx, glow, u, p.lightFromEast);
      switch (p.kind) {
        case 'house':
        case 'barn':
          house(S, p, rng);
          break;
        case 'hall':
          hall(S, p, rng);
          break;
        case 'keep':
          keep(S, p, rng);
          break;
        case 'tower':
          tower(S, p, rng);
          break;
        case 'wall':
          wallSegment(S, p);
          break;
        case 'gate':
          gate(S, p);
          break;
        case 'ruin':
          ruin(S, p, rng);
          break;
        case 'mine':
          mine(S, p, rng);
          break;
        case 'quarry':
          quarry(S, p, rng);
          break;
        case 'haystack':
          haystack(S, p, rng);
          break;
        case 'well':
          well(S, p);
          break;
        case 'pier':
          pier(S, p);
          break;
        case 'boat':
          boat(S, p, rng);
          break;
        case 'bridge':
          bridge(S, p);
          break;
      }
    },
    true,
  );
}
