import { hex, mix, shade, toCss, type RGB } from '../../core/color';
import { Rng } from '../../core/rng';
import type { Biome, FloraKind } from '../../model/biomes';
import type { Season } from '../environment';
import { captureSprite, type Ctx2D, type SpriteImage } from './canvas';

export interface FloraParams {
  kind: FloraKind;
  biome: Biome;
  season: Season;
  /** Pixels per design unit (hex size / 32). */
  u: number;
  variant: number;
  scale: number;
  /** Mirror horizontally (sun in the east). */
  flip: boolean;
  /** Screen-space direction shadows fall. */
  shadowDir: [number, number];
  /** Snow on branches. */
  snowy: boolean;
}

const SNOW = hex('#f1f5f9');
const SNOW_SHADE = hex('#c5d4e4');

function dab(ctx: Ctx2D, x: number, y: number, r: number, c: RGB, a = 1): void {
  ctx.fillStyle = toCss(c, a);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.35, r), 0, Math.PI * 2);
  ctx.fill();
}

function ellipse(ctx: Ctx2D, x: number, y: number, rx: number, ry: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.3, rx), Math.max(0.3, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

function groundShadow(ctx: Ctx2D, p: FloraParams, rx: number, height: number, alpha = 0.3): void {
  const [dx, dy] = p.shadowDir;
  const len = height * 0.45;
  ellipse(ctx, dx * len, dy * len * 0.5, rx + Math.abs(dx) * len * 0.5, rx * 0.45 + Math.abs(dy) * len * 0.2, `rgba(18,24,14,${alpha})`);
}

/**
 * Leafy canopy made of many small dabs, lit from the upper left:
 * a dark base mass, mid-tones, then highlights.
 */
function canopy(
  ctx: Ctx2D,
  rng: Rng,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  dark: RGB,
  midC: RGB,
  light: RGB,
  hi: RGB,
  u: number,
  density = 1,
): void {
  ellipse(ctx, cx + rx * 0.06, cy + ry * 0.1, rx, ry, toCss(dark));
  const n = Math.round((rx * ry) / (u * u) * 1.6 * density) + 6;
  for (let i = 0; i < n; i++) {
    const a = rng.next() * Math.PI * 2;
    const rr = Math.sqrt(rng.next()) * 0.9;
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr;
    // Light from the upper left.
    const lit = (-px * 0.65 - py * 0.75 + 0.35) * 0.9 + (rng.next() - 0.5) * 0.35;
    const c = lit > 0.55 ? light : lit > -0.1 ? mix(midC, light, Math.max(0, lit) * 0.6) : mix(dark, midC, 0.55);
    dab(ctx, cx + px * rx, cy + py * ry, u * (0.9 + rng.next() * 0.8), c);
  }
  const nh = Math.round(n * 0.18) + 2;
  for (let i = 0; i < nh; i++) {
    const a = Math.PI * (1.05 + rng.next() * 0.65);
    const rr = 0.35 + rng.next() * 0.5;
    dab(ctx, cx + Math.cos(a) * rr * rx, cy + Math.sin(a) * rr * ry, u * (0.5 + rng.next() * 0.45), hi, 0.9);
  }
}

function trunk(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, w: number, c: RGB): void {
  ctx.strokeStyle = toCss(c);
  ctx.lineCap = 'round';
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  // Lit left edge.
  ctx.strokeStyle = toCss(shade(c, 1.35));
  ctx.lineWidth = Math.max(0.4, w * 0.35);
  ctx.beginPath();
  ctx.moveTo(x0 - w * 0.25, y0);
  ctx.lineTo(x1 - w * 0.25, y1);
  ctx.stroke();
}

function bareBranches(ctx: Ctx2D, rng: Rng, x: number, y: number, len: number, ang: number, w: number, depth: number, c: string): void {
  const x1 = x + Math.cos(ang) * len;
  const y1 = y + Math.sin(ang) * len;
  ctx.strokeStyle = c;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  if (depth <= 0) return;
  const k = 2 + (rng.next() < 0.4 ? 1 : 0);
  for (let i = 0; i < k; i++) {
    const na = ang + (rng.next() - 0.5) * 1.3;
    bareBranches(ctx, rng, x1, y1, len * (0.55 + rng.next() * 0.2), na, w * 0.65, depth - 1, c);
  }
}

// Seasonal broadleaf palettes: [dark, mid, light, highlight].
const LEAF: Record<Season, RGB[][]> = {
  spring: [
    [hex('#35652a'), hex('#5a9a35'), hex('#8cc450'), hex('#c2e27c')],
    [hex('#2f5c26'), hex('#4f8a32'), hex('#7cb449'), hex('#b0d673')],
  ],
  summer: [
    [hex('#284d1e'), hex('#41712a'), hex('#66943a'), hex('#95bb55')],
    [hex('#2c5423'), hex('#4a7a30'), hex('#72a042'), hex('#a0c35e')],
    [hex('#2e4a1f'), hex('#4f6f2c'), hex('#7a8f3e'), hex('#a8b55e')],
    [hex('#22472a'), hex('#386a38'), hex('#5a8f4a'), hex('#8ab86a')],
  ],
  autumn: [
    [hex('#7a3417'), hex('#b5561d'), hex('#e08a2e'), hex('#f3bf5a')],
    [hex('#6e1f18'), hex('#a8352a'), hex('#d0613a'), hex('#eb9658')],
    [hex('#7a6118'), hex('#b8912a'), hex('#e0bd44'), hex('#f2dc7a')],
    [hex('#4d5a22'), hex('#77792f'), hex('#a8943e'), hex('#d0b862')],
  ],
  winter: [[hex('#4a4038'), hex('#5e5249'), hex('#74675c'), hex('#8e8175')]],
};

function paintBroadleaf(ctx: Ctx2D, p: FloraParams, rng: Rng): void {
  const u = p.u * p.scale;
  const th = 3.4 * u;
  const R = 4.3 * u * (0.9 + rng.next() * 0.2);
  groundShadow(ctx, p, R * 0.9, th + R * 2);
  if (p.flip) ctx.scale(-1, 1);
  const bark = hex('#5a4533');
  if (p.season === 'winter') {
    // A faint twiggy crown so bare trees still read as trees.
    ellipse(ctx, 0, -th - R * 0.7, R * 0.95, R * 0.85, 'rgba(128,112,104,0.42)');
    ellipse(ctx, -R * 0.2, -th - R * 0.85, R * 0.6, R * 0.55, 'rgba(160,146,136,0.3)');
    trunk(ctx, 0, 0, 0, -th, 1.3 * u, bark);
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      bareBranches(ctx, rng, 0, -th * 0.9, R * 0.75, -Math.PI / 2 + (i - 2) * 0.42 + (rng.next() - 0.5) * 0.3, 0.8 * u, 2, 'rgba(84,70,60,0.95)');
    }
    if (p.snowy) {
      for (let i = 0; i < 16; i++) {
        const a = Math.PI * (1.05 + rng.next() * 0.9);
        const rr = 0.4 + rng.next() * 0.55;
        dab(ctx, Math.cos(a) * R * rr, -th - R * 0.75 + Math.sin(a) * R * 0.8 * rr, u * (0.45 + rng.next() * 0.3), SNOW);
      }
    }
    return;
  }
  trunk(ctx, 0, 0, 0, -th - R * 0.3, 1.3 * u, bark);
  const pals = LEAF[p.season];
  const [dk, md, lt, hi] = pals[p.variant % pals.length];
  // Some spring trees blossom.
  const blossom = p.season === 'spring' && p.variant % 3 === 0;
  canopy(ctx, rng, 0, -th - R * 0.75, R, R * 0.88, dk, md, lt, hi, u);
  if (blossom) {
    const bc = p.variant % 2 ? hex('#f2d2dc') : hex('#f5f0e6');
    for (let i = 0; i < 14; i++) {
      const a = rng.next() * Math.PI * 2;
      const rr = Math.sqrt(rng.next()) * 0.85;
      dab(ctx, Math.cos(a) * rr * R, -th - R * 0.75 + Math.sin(a) * rr * R * 0.85, u * 0.5, bc);
    }
  }
  if (p.snowy) snowCap(ctx, rng, 0, -th - R * 0.75, R, R * 0.88, u);
}

function snowCap(ctx: Ctx2D, rng: Rng, cx: number, cy: number, rx: number, ry: number, u: number): void {
  for (let i = 0; i < 12; i++) {
    const a = Math.PI * (1.15 + rng.next() * 0.7);
    const rr = 0.55 + rng.next() * 0.4;
    dab(ctx, cx + Math.cos(a) * rr * rx, cy + Math.sin(a) * rr * ry, u * (0.6 + rng.next() * 0.4), rng.next() < 0.3 ? SNOW_SHADE : SNOW);
  }
}

function paintPine(ctx: Ctx2D, p: FloraParams, rng: Rng): void {
  const u = p.u * p.scale;
  const H = (9 + rng.next() * 2.5) * u;
  const W = (3.4 + rng.next() * 0.7) * u;
  groundShadow(ctx, p, W, H);
  if (p.flip) ctx.scale(-1, 1);
  trunk(ctx, 0, 0, 0, -H * 0.3, 1.1 * u, hex('#4f3c2c'));
  const cold = p.biome.climate === 'cold';
  const tone = p.variant % 3;
  let lit = cold ? [hex('#46705a'), hex('#3f6a4c'), hex('#50785c')][tone] : [hex('#4d7a3e'), hex('#44703a'), hex('#587f44')][tone];
  let dark = cold ? [hex('#1f3d33'), hex('#1c3a2c'), hex('#26443a')][tone] : [hex('#244226'), hex('#203d22'), hex('#2b4a2a')][tone];
  if (p.season === 'autumn' && !cold && p.variant % 4 === 1) {
    // Larch turning gold.
    lit = hex('#c9a13f');
    dark = hex('#7d5d24');
  }
  const tiers = 4;
  for (let t = 0; t < tiers; t++) {
    const y0 = -H * (0.16 + (t / tiers) * 0.72);
    const tipY = t === tiers - 1 ? -H : -H * (0.16 + ((t + 1.35) / tiers) * 0.72);
    const w = W * (1 - t * 0.2);
    const jag = (side: number) => {
      ctx.beginPath();
      ctx.moveTo(0, tipY);
      const steps = 4;
      for (let i = 1; i <= steps; i++) {
        const f = i / steps;
        const x = side * w * f;
        const y = tipY + (y0 - tipY) * f;
        ctx.lineTo(x + side * u * 0.5 * (i % 2), y + u * 0.4 * (i % 2));
      }
      ctx.lineTo(0, y0 + u * 0.8);
      ctx.closePath();
      ctx.fill();
    };
    ctx.fillStyle = toCss(shade(lit, 0.92 + rng.next() * 0.16));
    jag(-1);
    ctx.fillStyle = toCss(shade(dark, 0.92 + rng.next() * 0.16));
    jag(1);
    if (p.snowy) {
      ctx.fillStyle = toCss(SNOW);
      ctx.beginPath();
      ctx.moveTo(0, tipY + u * 0.2);
      ctx.lineTo(-w * 0.8, y0 - u * 0.1);
      ctx.lineTo(-w * 0.3, y0 - u * 0.9);
      ctx.lineTo(w * 0.25, y0 - u * 0.4);
      ctx.lineTo(w * 0.5, y0 - u * 0.2);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function paintPalm(ctx: Ctx2D, p: FloraParams, rng: Rng): void {
  const u = p.u * p.scale;
  const H = (9 + rng.next() * 3) * u;
  const lean = (rng.next() - 0.5) * 4 * u;
  groundShadow(ctx, p, 3 * u, H, 0.22);
  if (p.flip) ctx.scale(-1, 1);
  ctx.lineCap = 'round';
  ctx.strokeStyle = toCss(hex('#7a6448'));
  ctx.lineWidth = 1.1 * u;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(lean * 0.2, -H * 0.5, lean, -H);
  ctx.stroke();
  const tx = lean;
  const ty = -H;
  const fronds = 7;
  const green = p.season === 'winter' ? hex('#5f7f35') : hex('#4c8a2c');
  for (let i = 0; i < fronds; i++) {
    const a = -Math.PI / 2 + ((i / (fronds - 1)) - 0.5) * Math.PI * 1.6 + (rng.next() - 0.5) * 0.3;
    const len = (4.5 + rng.next() * 1.8) * u;
    const ex = tx + Math.cos(a) * len;
    const ey = ty + Math.sin(a) * len * 0.55 + len * 0.35;
    const cx = tx + Math.cos(a) * len * 0.55;
    const cy = ty + Math.sin(a) * len * 0.6 - u * 0.8;
    const lit = Math.cos(a) < 0 ? 1.25 : 0.85;
    ctx.strokeStyle = toCss(shade(green, lit));
    ctx.lineWidth = 1.3 * u;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
  }
  dab(ctx, tx, ty + u * 0.3, u * 0.9, hex('#5a4a2c'));
}

function paintJungle(ctx: Ctx2D, p: FloraParams, rng: Rng): void {
  const u = p.u * p.scale;
  const th = 4.5 * u;
  const R = 5 * u * (0.9 + rng.next() * 0.25);
  groundShadow(ctx, p, R, th + R * 2, 0.34);
  if (p.flip) ctx.scale(-1, 1);
  trunk(ctx, 0, 0, u * 0.5, -th - R * 0.2, 1.4 * u, hex('#6b5a45'));
  const dk = hex('#153d1c');
  const md = p.variant % 2 ? hex('#1f6530') : hex('#246a2a');
  const lt = p.variant % 3 ? hex('#3a8c3c') : hex('#4a9436');
  const hi = hex('#7dbd52');
  canopy(ctx, rng, -R * 0.35, -th - R * 0.55, R * 0.7, R * 0.6, dk, md, lt, hi, u);
  canopy(ctx, rng, R * 0.35, -th - R * 0.6, R * 0.7, R * 0.62, dk, md, lt, hi, u);
  canopy(ctx, rng, 0, -th - R * 0.95, R * 0.72, R * 0.6, dk, md, lt, hi, u);
  if (p.variant % 5 === 0) {
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * (1.1 + rng.next() * 0.8);
      dab(ctx, Math.cos(a) * R * 0.6, -th - R * 0.8 + Math.sin(a) * R * 0.5, u * 0.55, hex('#e0663a'));
    }
  }
}

function paintAcacia(ctx: Ctx2D, p: FloraParams, rng: Rng): void {
  const u = p.u * p.scale;
  const H = (7 + rng.next() * 1.5) * u;
  const R = (6 + rng.next() * 1.5) * u;
  groundShadow(ctx, p, R * 0.8, H, 0.28);
  if (p.flip) ctx.scale(-1, 1);
  const bark = hex('#5d4a3a');
  trunk(ctx, 0, 0, 0, -H * 0.5, 1.1 * u, bark);
  trunk(ctx, 0, -H * 0.5, -R * 0.45, -H, 0.8 * u, bark);
  trunk(ctx, 0, -H * 0.5, R * 0.4, -H * 0.95, 0.8 * u, bark);
  const dry = p.season === 'winter' || p.season === 'autumn';
  const dk = dry ? hex('#5a5a2a') : hex('#4a5d24');
  const md = dry ? hex('#8a8a3e') : hex('#6f8430');
  const lt = dry ? hex('#aaa453') : hex('#94a844');
  const hi = hex('#bcc56a');
  canopy(ctx, rng, 0, -H - u * 0.6, R, R * 0.28, dk, md, lt, hi, u, 1.2);
}

function paintSwampTree(ctx: Ctx2D, p: FloraParams, rng: Rng): void {
  const u = p.u * p.scale;
  const H = (8 + rng.next() * 2) * u;
  const R = 3.6 * u;
  groundShadow(ctx, p, R, H, 0.26);
  if (p.flip) ctx.scale(-1, 1);
  // Buttressed trunk.
  ctx.fillStyle = toCss(hex('#5b5040'));
  ctx.beginPath();
  ctx.moveTo(-1.6 * u, 0);
  ctx.quadraticCurveTo(-0.4 * u, -1.5 * u, -0.5 * u, -H * 0.6);
  ctx.lineTo(0.5 * u, -H * 0.6);
  ctx.quadraticCurveTo(0.4 * u, -1.5 * u, 1.6 * u, 0);
  ctx.closePath();
  ctx.fill();
  const bare = p.season === 'winter';
  const dk = bare ? hex('#4d4a38') : hex('#3b4a26');
  const md = bare ? hex('#6b6548') : hex('#5d6c35');
  const lt = bare ? hex('#857d5c') : hex('#7f8c45');
  canopy(ctx, rng, 0, -H * 0.85, R, R * 0.75, dk, md, lt, hex('#a3a864'), u, 0.8);
  // Hanging moss.
  ctx.strokeStyle = 'rgba(150,150,120,0.75)';
  ctx.lineWidth = 0.45 * u;
  for (let i = 0; i < 7; i++) {
    const x = (rng.next() - 0.5) * R * 1.6;
    const y = -H * 0.85 + R * 0.3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng.next() - 0.5) * u, y + (1.5 + rng.next() * 2.5) * u);
    ctx.stroke();
  }
}

function paintDeadTree(ctx: Ctx2D, p: FloraParams, rng: Rng): void {
  const u = p.u * p.scale;
  const H = (6 + rng.next() * 2.5) * u;
  groundShadow(ctx, p, 1.5 * u, H, 0.2);
  if (p.flip) ctx.scale(-1, 1);
  const c = p.biome.id === 'volcanic' ? 'rgba(40,34,32,1)' : 'rgba(110,100,86,1)';
  ctx.lineCap = 'round';
  bareBranches(ctx, rng, 0, 0, H * 0.55, -Math.PI / 2 + (rng.next() - 0.5) * 0.2, 1.1 * u, 2, c);
}

function paintShrub(ctx: Ctx2D, p: FloraParams, rng: Rng): void {
  const u = p.u * p.scale;
  const R = (1.8 + rng.next() * 0.8) * u;
  groundShadow(ctx, p, R, R * 2, 0.22);
  if (p.flip) ctx.scale(-1, 1);
  const g = p.biome.ground;
  let md = mix(g[2], hex('#3f6a2a'), 0.55);
  let lt = mix(g[1], hex('#7aa545'), 0.4);
  if (p.biome.climate === 'hot' || p.biome.relief === 'dunes' || p.biome.relief === 'mesa') {
    md = hex('#6d6a3a');
    lt = hex('#9a9550');
  }
  if (p.season === 'autumn' && p.biome.climate !== 'hot') {
    md = hex('#8a4a22');
    lt = hex('#c47a35');
  }
  if (p.season === 'winter' && p.biome.climate !== 'hot') {
    md = hex('#5d5145');
    lt = hex('#7a6c5c');
  }
  canopy(ctx, rng, 0, -R * 0.7, R, R * 0.75, shade(md, 0.7), md, lt, shade(lt, 1.2), u * 0.7, 0.9);
  if (p.snowy) snowCap(ctx, rng, 0, -R * 0.7, R, R * 0.7, u * 0.7);
}

function paintCactus(ctx: Ctx2D, p: FloraParams, rng: Rng): void {
  const u = p.u * p.scale;
  const H = (5 + rng.next() * 2.5) * u;
  const w = 1.5 * u;
  groundShadow(ctx, p, w, H, 0.25);
  if (p.flip) ctx.scale(-1, 1);
  const lit = hex('#6f9a4a');
  const dk = hex('#3f6630');
  const column = (x: number, y0: number, y1: number, cw: number) => {
    ctx.fillStyle = toCss(dk);
    ctx.beginPath();
    ctx.roundRect(x - cw / 2, y1, cw, y0 - y1, cw / 2);
    ctx.fill();
    ctx.fillStyle = toCss(lit);
    ctx.beginPath();
    ctx.roundRect(x - cw / 2, y1, cw * 0.5, y0 - y1, cw / 2);
    ctx.fill();
  };
  column(0, 0, -H, w);
  if (rng.next() < 0.8) {
    const ay = -H * (0.35 + rng.next() * 0.2);
    column(-w * 1.3, ay, ay - H * 0.35, w * 0.75);
    ctx.fillStyle = toCss(dk);
    ctx.fillRect(-w * 1.3, ay - w * 0.4, w * 1.3, w * 0.7);
  }
  if (rng.next() < 0.6) {
    const ay = -H * (0.45 + rng.next() * 0.2);
    column(w * 1.3, ay, ay - H * 0.3, w * 0.75);
    ctx.fillStyle = toCss(dk);
    ctx.fillRect(0, ay - w * 0.4, w * 1.3, w * 0.7);
  }
}

function paintRock(ctx: Ctx2D, p: FloraParams, rng: Rng): void {
  const u = p.u * p.scale;
  const W = (1.8 + rng.next() * 1.6) * u;
  const Hh = W * (0.55 + rng.next() * 0.35);
  groundShadow(ctx, p, W, Hh * 1.5, 0.3);
  if (p.flip) ctx.scale(-1, 1);
  const base = p.biome.rock;
  const n = 7;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i / (n - 1)) * Math.PI;
    const rr = 0.75 + rng.next() * 0.3;
    pts.push([Math.cos(a) * W * rr, Math.sin(a) * Hh * rr * 1.6]);
  }
  ctx.fillStyle = toCss(shade(base, 0.62));
  ctx.beginPath();
  ctx.moveTo(-W, 0);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.lineTo(W, 0);
  ctx.quadraticCurveTo(0, Hh * 0.35, -W, 0);
  ctx.fill();
  // Lit upper-left facet.
  ctx.fillStyle = toCss(shade(base, 1.18));
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.lineTo(W * 0.1, -Hh * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = toCss(shade(base, 0.92));
  ctx.beginPath();
  ctx.moveTo(pts[3][0], pts[3][1]);
  for (let i = 4; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.lineTo(W * 0.1, -Hh * 0.35);
  ctx.closePath();
  ctx.fill();
  if (p.snowy) {
    ctx.fillStyle = toCss(SNOW);
    ctx.beginPath();
    ctx.moveTo(pts[1][0], pts[1][1]);
    for (let i = 2; i < n - 1; i++) ctx.lineTo(pts[i][0], pts[i][1] + u * 0.1);
    ctx.lineTo(pts[n - 2][0] * 0.6, pts[n - 2][1] * 0.5);
    ctx.closePath();
    ctx.fill();
  }
}

function paintGrass(ctx: Ctx2D, p: FloraParams, rng: Rng): void {
  const u = p.u * p.scale;
  if (p.flip) ctx.scale(-1, 1);
  const g = p.biome.ground;
  let c1 = shade(g[2], 0.85);
  let c2 = shade(g[1], 1.1);
  if (p.season === 'autumn' || p.biome.id === 'savanna') {
    c1 = hex('#8f7a3e');
    c2 = hex('#c9ad62');
  }
  if (p.season === 'winter') {
    c1 = hex('#7a6d55');
    c2 = hex('#9a8c70');
  }
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.45 * u;
  const n = 5 + Math.floor(rng.next() * 4);
  for (let i = 0; i < n; i++) {
    const x = (rng.next() - 0.5) * 2.2 * u;
    const h = (1.4 + rng.next() * 1.6) * u;
    ctx.strokeStyle = toCss(rng.next() < 0.5 ? c1 : c2, 0.9);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.quadraticCurveTo(x + (rng.next() - 0.5) * u, -h * 0.6, x + (rng.next() - 0.5) * 1.6 * u, -h);
    ctx.stroke();
  }
}

function paintReeds(ctx: Ctx2D, p: FloraParams, rng: Rng): void {
  const u = p.u * p.scale;
  if (p.flip) ctx.scale(-1, 1);
  const green = p.season === 'winter' || p.season === 'autumn' ? hex('#9a8a5a') : hex('#6d7d3a');
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.5 * u;
  const n = 5 + Math.floor(rng.next() * 5);
  for (let i = 0; i < n; i++) {
    const x = (rng.next() - 0.5) * 2.6 * u;
    const h = (2.5 + rng.next() * 2.5) * u;
    const tip = x + (rng.next() - 0.5) * 0.9 * u;
    ctx.strokeStyle = toCss(shade(green, 0.8 + rng.next() * 0.4));
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(tip, -h);
    ctx.stroke();
    if (rng.next() < 0.35) {
      ctx.strokeStyle = toCss(hex('#5a3a22'));
      ctx.lineWidth = 0.9 * u;
      ctx.beginPath();
      ctx.moveTo(tip, -h + 0.2 * u);
      ctx.lineTo(tip, -h + 1.2 * u);
      ctx.stroke();
      ctx.lineWidth = 0.5 * u;
    }
  }
}

const PAINTERS: Record<FloraKind, (ctx: Ctx2D, p: FloraParams, rng: Rng) => void> = {
  broadleaf: paintBroadleaf,
  pine: paintPine,
  palm: paintPalm,
  jungleTree: paintJungle,
  acacia: paintAcacia,
  swampTree: paintSwampTree,
  deadTree: paintDeadTree,
  shrub: paintShrub,
  cactus: paintCactus,
  rock: paintRock,
  grass: paintGrass,
  reeds: paintReeds,
};

export function paintFlora(p: FloraParams): SpriteImage {
  const u = p.u * p.scale;
  const ext = 16 * u;
  return captureSprite(ext, ext * 1.4, ext, ext * 0.6, (ctx) => {
    const rng = new Rng(p.variant * 7919 + p.kind.length * 131 + 17);
    PAINTERS[p.kind](ctx, p, rng);
  });
}
