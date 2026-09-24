import { hex, type RGB } from '../core/color';
import { NoiseTile, clamp01, smoothstep } from '../core/noise';
import { hashFloat } from '../core/rng';
import type { Biome, BiomeId } from '../model/biomes';
import type { Season } from './environment';
import type { FieldHex, Sample, TerrainField } from './field';

/** Per-pixel inputs shared by all biome shaders. */
export interface PixelCtx {
  x: number;
  y: number;
  H: number;
  slope: number;
  /** Large patches (~2 hexes), mid blotches, fine grain and horizontal streaks; all ~[-1, 1]. */
  nL: number;
  nM: number;
  nF: number;
  nS: number;
}

export interface SurfaceResult {
  /** Albedo. */
  r: number;
  g: number;
  b: number;
  /** Emissive glow added after lighting (lava). */
  er: number;
  eg: number;
  eb: number;
  /** 0 = land, 1 = standing water (sea / lake / pool), 2 = river. */
  water: number;
  /** Water depth below the surface (world units), for specular / colour. */
  depth: number;
  /** 1 on roads, rivers and water: sprites avoid these pixels. */
  blocked: boolean;
}

const C = (h: string): RGB => hex(h);

const PAL = {
  snow: C('#eef3f8'),
  snowShade: C('#cad8e8'),
  ice: C('#cfe1ea'),
  iceDark: C('#a9c7d6'),
  flowerY: C('#e3cf5a'),
  flowerW: C('#eee9df'),
  flowerP: C('#b98ab8'),
  blossom: C('#e7b8c8'),
  autumnGrass: C('#a89a55'),
  leafLitter: C('#94602e'),
  leafLitter2: C('#b0772f'),
  dryGrass: C('#c9b27a'),
  springGreen: C('#7fb043'),
  mud: C('#5c5034'),
  wetSoil: C('#4a4632'),
  dirt: C('#9b815a'),
  dirtDark: C('#7a6446'),
  sandRoad: C('#cfb482'),
  ashRoad: C('#5e5750'),
  slush: C('#8f877c'),
  cobble: C('#8e8a80'),
  cobbleDark: C('#6f6b63'),
  plaza: C('#a39c8c'),
  hedge: C('#3d5a2a'),
  stoneWall: C('#8f8b84'),
  spoil: C('#6e675e'),
  lavaHot: C('#ffb347'),
  lavaDeep: C('#ff4a14'),
  oceanDeep: C('#1b4a73'),
  oceanMid: C('#246a92'),
  oceanShallow: C('#3aa0ad'),
  lagoon: C('#5dc0b3'),
  lakeDeep: C('#244f5c'),
  lakeShallow: C('#44857f'),
  poolWater: C('#3c4e3c'),
  poolAlgae: C('#667b3b'),
  river: C('#3a7d95'),
  riverLight: C('#5da3b1'),
  foam: C('#eef5f2'),
};

/** Crop colours per farming tradition and season. */
const CROPS: Record<string, Record<Season, RGB[]>> = {
  temperate: {
    spring: [C('#7fae45'), C('#6d5236'), C('#8fbb4f'), C('#dccd49'), C('#72563a')],
    summer: [C('#d4b45c'), C('#8aa846'), C('#c9a24e'), C('#6f9a3e'), C('#e0c56a')],
    autumn: [C('#b99d5e'), C('#6e5134'), C('#a8904f'), C('#7b5c3b'), C('#c2a865')],
    winter: [C('#7a6a4e'), C('#6b5a42'), C('#857a5c'), C('#6e5e46'), C('#7d6f55')],
  },
  dry: {
    spring: [C('#8fa24a'), C('#9d5a35'), C('#b4a256'), C('#7f9a44'), C('#a86a3e')],
    summer: [C('#cbae62'), C('#9d5a35'), C('#b89a50'), C('#88963f'), C('#d4b870')],
    autumn: [C('#c5a563'), C('#9a5634'), C('#b19350'), C('#a57443'), C('#cfb273')],
    winter: [C('#b99d63'), C('#955535'), C('#a88e57'), C('#9b6a45'), C('#c2a86f')],
  },
  paddy: {
    spring: [C('#5f9a78'), C('#78ae5a'), C('#4f8f80'), C('#86b55c'), C('#5d9b72')],
    summer: [C('#6fae48'), C('#82b84e'), C('#5f9e45'), C('#94bf55'), C('#6aa84a')],
    autumn: [C('#c2b25a'), C('#a9a24c'), C('#b8a955'), C('#8da446'), C('#c9b963')],
    winter: [C('#5f8f82'), C('#6d7d5a'), C('#557f7a'), C('#77815b'), C('#5a8a80')],
  },
  oasis: {
    spring: [C('#7c9c3c'), C('#8faa45'), C('#d8bd82'), C('#6f9038'), C('#9aae4c')],
    summer: [C('#7a9a3a'), C('#a4a24a'), C('#d8bd82'), C('#6c8d36'), C('#b5a753')],
    autumn: [C('#9c9c45'), C('#b6a255'), C('#d8bd82'), C('#7f8e3c'), C('#c2ad5e')],
    winter: [C('#86983f'), C('#98a04a'), C('#d8bd82'), C('#77903a'), C('#a9a655')],
  },
  cold: {
    spring: [C('#7d8a4f'), C('#5f5037'), C('#8d9660'), C('#6e7a45'), C('#665640')],
    summer: [C('#a4a063'), C('#7f9150'), C('#b1a56c'), C('#6f7f46'), C('#978f58')],
    autumn: [C('#9f8f5c'), C('#6a5a40'), C('#a89668'), C('#7b6c4a'), C('#8e7f55')],
    winter: [C('#7a6f5c'), C('#6a5f4d'), C('#827867'), C('#6d6352'), C('#776d5b')],
  },
};

function tradition(b: Biome): keyof typeof CROPS {
  switch (b.id) {
    case 'jungle':
    case 'swamp':
      return 'paddy';
    case 'desert':
    case 'badlands':
    case 'volcanic':
      return 'oasis';
    case 'savanna':
      return 'dry';
    case 'tundra':
    case 'conifer':
    case 'snow':
      return 'cold';
    default:
      return 'temperate';
  }
}

/** Snow cover amount (0..1) a biome gets in a season, before height effects. */
function seasonalSnow(b: Biome, season: Season): number {
  if (season === 'winter') {
    switch (b.climate) {
      case 'cold':
        return 1;
      case 'temperate':
        return 0.85;
      case 'warm':
        return b.id === 'volcanic' ? 0.35 : b.id === 'swamp' ? 0.25 : 0.1;
      default:
        return 0;
    }
  }
  if (b.climate === 'cold' && season !== 'summer') return b.id === 'tundra' ? 0.35 : 0.2;
  return b.id === 'snow' ? 1 : 0;
}

/** Snow line (in units of hex size) per season. */
const SNOWLINE: Record<Season, number> = { spring: 0.92, summer: 1.08, autumn: 0.98, winter: 0.62 };

export class SurfaceShader {
  readonly t1: NoiseTile;
  readonly t2: NoiseTile;
  readonly t3: NoiseTile;
  season: Season = 'summer';
  private readonly field: TerrainField;
  private readonly kS: number;
  private readonly tmp: RGB = [0, 0, 0];
  private readonly acc: RGB = [0, 0, 0];

  constructor(field: TerrainField) {
    this.field = field;
    this.t1 = field.t1;
    this.t2 = field.t2;
    this.t3 = field.t3;
    this.kS = 32 / field.s;
  }

  /** Fill the shared noise values for a pixel. */
  noiseCtx(x: number, y: number, H: number, slope: number, ctx: PixelCtx): void {
    const k = this.kS;
    ctx.x = x;
    ctx.y = y;
    ctx.H = H;
    ctx.slope = slope;
    ctx.nL = this.t1.sample(x * k * 0.55, y * k * 0.55);
    ctx.nM = this.t2.sample(x * k * 1.3, y * k * 1.3);
    ctx.nF = this.t3.at(x * k * 1.1, y * k * 1.1);
    ctx.nS = this.t2.sample(x * k * 0.7, y * k * 3.2);
  }

  /**
   * Compute albedo (and water / emissive info) at one pixel.
   * `S` must be prepared at (x, y); `H` is the carved ground height.
   */
  shade(S: Sample, ctx: PixelCtx, out: SurfaceResult): void {
    const field = this.field;
    const s = field.s;
    const season = this.season;
    out.er = out.eg = out.eb = 0;
    out.water = 0;
    out.depth = 0;
    out.blocked = false;

    // ---- blended biome ground ----
    const acc = this.acc;
    acc[0] = acc[1] = acc[2] = 0;
    let snow = 0;
    let rockStart = 0;
    let glow = 0;
    const tmp = this.tmp;
    for (let k = 0; k < S.n; k++) {
      const w = S.wc[k];
      if (w < 0.003) continue;
      const h = field.hexes[S.idx[k]];
      this.ground(h.biome, ctx, tmp);
      acc[0] += tmp[0] * w;
      acc[1] += tmp[1] * w;
      acc[2] += tmp[2] * w;
      snow += seasonalSnow(h.biome, season) * w;
      rockStart += (h.biome.relief === 'dunes' ? 1.1 : h.biome.id === 'snow' ? 1.25 : 0.75) * w;
      if (h.biome.id === 'volcanic') glow += w * (h.level >= 3 ? 1 : 0.45);
    }
    let r = acc[0];
    let g = acc[1];
    let b = acc[2];

    const owner = field.hexes[S.owner];
    const ob = owner.biome;

    // ---- exposed rock on steep slopes ----
    const rockMix = smoothstep(rockStart, rockStart + 0.55, ctx.slope + ctx.nM * 0.18);
    if (rockMix > 0) {
      const rk = ob.rock;
      let v = 0.92 + ctx.nF * 0.1 + ctx.nM * 0.08;
      if (ob.relief === 'mesa') {
        // Coloured strata on badland cliffs.
        const band = Math.sin((ctx.H / (s * 0.035)) * Math.PI + ctx.nL * 1.5);
        v *= 0.9 + band * 0.12;
      }
      r += (rk[0] * v - r) * rockMix;
      g += (rk[1] * v - g) * rockMix;
      b += (rk[2] * v - b) * rockMix;
    }

    // ---- farm fields and settlement ground ----
    const feat = field.map.featureAt(S.owner);
    if (feat) {
      const d = Math.hypot(ctx.x - owner.cx, ctx.y - owner.cy) / field.a;
      const wOwn = maxOwnerWeight(S);
      const steep = 1 - smoothstep(0.55, 0.9, ctx.slope);
      if (feat === 'farm' || (feat === 'village' && ob.arable)) {
        const inner = feat === 'farm' ? 0.28 : 0.62;
        const fieldMask = smoothstep(inner, inner + 0.08, d + ctx.nM * 0.06) * smoothstep(0.35, 0.7, wOwn) * steep;
        if (fieldMask > 0) {
          this.fieldColor(owner, ob, ctx, tmp);
          r += (tmp[0] - r) * fieldMask;
          g += (tmp[1] - g) * fieldMask;
          b += (tmp[2] - b) * fieldMask;
        }
      }
      if (feat === 'village' || feat === 'town' || feat === 'farm' || feat === 'castle') {
        const rad = feat === 'town' ? 0.66 : feat === 'village' ? 0.5 : feat === 'castle' ? 0.34 : 0.24;
        const tr = (1 - smoothstep(rad * 0.7, rad, d + ctx.nM * 0.12)) * (feat === 'town' || feat === 'castle' ? 0.75 : 0.45);
        const cobble = feat === 'town' || feat === 'castle';
        const base = cobble ? PAL.plaza : PAL.dirt;
        const v = 0.9 + ctx.nF * 0.12;
        r += (base[0] * v - r) * tr;
        g += (base[1] * v - g) * tr;
        b += (base[2] * v - b) * tr;
      } else if (feat === 'mine' || feat === 'ruins') {
        const tr = (1 - smoothstep(0.2, 0.45, d + ctx.nM * 0.2)) * 0.6;
        const base = feat === 'mine' ? PAL.spoil : PAL.dirtDark;
        r += (base[0] - r) * tr;
        g += (base[1] - g) * tr;
        b += (base[2] - b) * tr;
      }
    }

    // ---- snow ----
    const snowline = SNOWLINE[season] * s;
    // Volcanoes are too warm near the top to hold summer snow.
    const snowlineHere = snowline + glow * 0.35 * s;
    const heightSnow = smoothstep(snowlineHere - 0.1 * s, snowlineHere + 0.06 * s, ctx.H + ctx.nM * 0.09 * s);
    let snowCover = Math.max(heightSnow, snow);
    if (snow > 0 && snow < 1) {
      // Patchy seasonal snow.
      snowCover = Math.max(heightSnow, smoothstep(0.35, 0.65, snow + ctx.nL * 0.35 + ctx.nM * 0.1) * snow);
    }
    snowCover *= 1 - smoothstep(0.95, 1.6, ctx.slope);
    if (snowCover > 0) {
      const sv = 0.96 + ctx.nF * 0.04;
      const blue = smoothstep(-0.2, 0.6, ctx.nM) * 0.35;
      const sr = (PAL.snow[0] + (PAL.snowShade[0] - PAL.snow[0]) * blue) * sv;
      const sg = (PAL.snow[1] + (PAL.snowShade[1] - PAL.snow[1]) * blue) * sv;
      const sb = (PAL.snow[2] + (PAL.snowShade[2] - PAL.snow[2]) * blue) * sv;
      r += (sr - r) * snowCover;
      g += (sg - g) * snowCover;
      b += (sb - b) * snowCover;
    }

    // ---- roads ----
    const rw = field.roadWidth;
    if (S.road < rw * 2.2) {
      const edge = S.road + ctx.nF * rw * 0.25;
      const worn = (1 - smoothstep(rw, rw * 2.2, S.road)) * 0.25;
      r *= 1 - worn * 0.35;
      g *= 1 - worn * 0.3;
      b *= 1 - worn * 0.4;
      const m = 1 - smoothstep(rw * 0.75, rw * 1.1, edge);
      if (m > 0) {
        let base = PAL.dirt;
        if (feat === 'town' || feat === 'castle') base = PAL.cobble;
        else if (ob.relief === 'dunes') base = PAL.sandRoad;
        else if (ob.id === 'volcanic') base = PAL.ashRoad;
        else if (snowCover > 0.5) base = PAL.slush;
        // Two faint ruts along the centre-line.
        const rut = Math.abs(S.road / rw - 0.45) < 0.14 ? 0.86 : 1;
        const v = (0.93 + ctx.nF * 0.08) * rut;
        r += (base[0] * v - r) * m;
        g += (base[1] * v - g) * m;
        b += (base[2] * v - b) * m;
        if (m > 0.5) out.blocked = true;
      }
    }

    // ---- lava cracks ----
    if (glow > 0.2 && snowCover < 0.5) {
      const crack = Math.abs(ctx.nM + ctx.nL * 0.4);
      const hot = (1 - smoothstep(0.0, 0.035, crack)) * glow * (1 - smoothstep(0.7, 1.2, ctx.slope));
      if (hot > 0) {
        const hc = ctx.nF > 0 ? PAL.lavaHot : PAL.lavaDeep;
        r += (0.12 - r) * hot;
        g += (0.07 - g) * hot;
        b += (0.05 - b) * hot;
        out.er = hc[0] * hot * 0.9;
        out.eg = hc[1] * hot * 0.9;
        out.eb = hc[2] * hot * 0.9;
      }
    }

    // ---- rivers ----
    const rv = field.riverWidth;
    if (S.river < rv * 2) {
      const edge = S.river + ctx.nF * rv * 0.18;
      const bank = (1 - smoothstep(rv, rv * 2, S.river)) * 0.45;
      r += (PAL.wetSoil[0] - r) * bank * (1 - snowCover * 0.7);
      g += (PAL.wetSoil[1] - g) * bank * (1 - snowCover * 0.7);
      b += (PAL.wetSoil[2] - b) * bank * (1 - snowCover * 0.7);
      const m = 1 - smoothstep(rv * 0.8, rv * 1.05, edge);
      if (m > 0) {
        const frozen = season === 'winter' && snow > 0.7;
        const rapids = smoothstep(0.35, 0.9, ctx.slope);
        let cr: number;
        let cg: number;
        let cb: number;
        if (frozen) {
          [cr, cg, cb] = PAL.ice;
        } else {
          const lt = smoothstep(-0.2, 0.8, ctx.nS) * 0.35 + rapids * 0.6 * smoothstep(-0.3, 0.5, ctx.nF);
          cr = PAL.river[0] + (PAL.riverLight[0] - PAL.river[0]) * lt;
          cg = PAL.river[1] + (PAL.riverLight[1] - PAL.river[1]) * lt;
          cb = PAL.river[2] + (PAL.riverLight[2] - PAL.river[2]) * lt;
          if (rapids > 0.3 && ctx.nF > 0.2) {
            cr = PAL.foam[0];
            cg = PAL.foam[1];
            cb = PAL.foam[2];
          }
        }
        r += (cr - r) * m;
        g += (cg - g) * m;
        b += (cb - b) * m;
        if (m > 0.3) {
          out.water = frozen ? 0 : 2;
          out.blocked = true;
        }
      }
    }

    // ---- swamp pools ----
    if (S.pool > 0.3 && S.river >= rv) {
      const m = smoothstep(0.3, 0.6, S.pool);
      const algae = smoothstep(0.1, 0.7, ctx.nF * 0.5 + ctx.nM);
      const frozen = season === 'winter' && snow > 0.5;
      const pr = frozen ? PAL.ice[0] : PAL.poolWater[0] + (PAL.poolAlgae[0] - PAL.poolWater[0]) * algae;
      const pg = frozen ? PAL.ice[1] : PAL.poolWater[1] + (PAL.poolAlgae[1] - PAL.poolWater[1]) * algae;
      const pb = frozen ? PAL.ice[2] : PAL.poolWater[2] + (PAL.poolAlgae[2] - PAL.poolWater[2]) * algae;
      r += (pr - r) * m;
      g += (pg - g) * m;
      b += (pb - b) * m;
      if (m > 0.5) {
        out.water = frozen ? 0 : 1;
        out.depth = s * 0.02;
        out.blocked = true;
      }
    }

    // ---- standing water (sea, lakes) ----
    const depth = S.waterLevel - ctx.H;
    if (depth > -0.012 * s && S.waterLevel > -Infinity) {
      let isLake = false;
      let lakeW = 0;
      let waterW = 0;
      let frozenW = 0;
      for (let k = 0; k < S.n; k++) {
        const h = field.hexes[S.idx[k]];
        if (!h.water) continue;
        waterW += S.wh[k];
        if (h.biome.id === 'lake') lakeW += S.wh[k];
      }
      isLake = lakeW > waterW * 0.5;
      // Nearby cold land freezes lakes in winter.
      if (isLake && season === 'winter') {
        for (let k = 0; k < S.n; k++) {
          const h = field.hexes[S.idx[k]];
          if (!h.water) frozenW += S.wc[k] * seasonalSnow(h.biome, season);
        }
        frozenW = frozenW > 0.05 || snow > 0.3 ? 1 : 0;
      }
      if (depth <= 0) {
        // Wet sand / shingle just above the waterline.
        const beach = 1 - smoothstep(0.35, 0.8, ctx.slope);
        const sh = ob.shore;
        const wet = 0.8 + 0.2 * smoothstep(-0.012 * s, 0, depth);
        const m = beach * (1 - snowCover * 0.6);
        r += (sh[0] * wet - r) * m;
        g += (sh[1] * wet - g) * m;
        b += (sh[2] * wet - b) * m;
      } else if (frozenW > 0) {
        const cr = ctx.nS > 0.4 ? PAL.iceDark : PAL.ice;
        r = cr[0] * (0.96 + ctx.nF * 0.04);
        g = cr[1] * (0.96 + ctx.nF * 0.04);
        b = cr[2] * (0.96 + ctx.nF * 0.04);
        out.blocked = true;
      } else {
        const dn = depth / (s * (isLake ? 0.12 : 0.26));
        const deep = isLake ? PAL.lakeDeep : PAL.oceanDeep;
        const mid = isLake ? PAL.lakeShallow : PAL.oceanMid;
        const shallow = isLake ? PAL.lakeShallow : ob.climate === 'hot' ? PAL.lagoon : PAL.oceanShallow;
        let wr: number;
        let wg: number;
        let wb: number;
        if (dn < 0.35) {
          const t = dn / 0.35;
          wr = shallow[0] + (mid[0] - shallow[0]) * t;
          wg = shallow[1] + (mid[1] - shallow[1]) * t;
          wb = shallow[2] + (mid[2] - shallow[2]) * t;
        } else {
          const t = smoothstep(0.35, 1, dn);
          wr = mid[0] + (deep[0] - mid[0]) * t;
          wg = mid[1] + (deep[1] - mid[1]) * t;
          wb = mid[2] + (deep[2] - mid[2]) * t;
        }
        // The sea floor shows through very shallow water.
        const clear = (1 - smoothstep(0, 0.22, dn)) * 0.55;
        wr += (r - wr) * clear;
        wg += (g - wg) * clear;
        wb += (b - wb) * clear;
        // Wave streaks.
        const wave = ctx.nS * 0.05 + ctx.nF * 0.015;
        wr *= 1 + wave;
        wg *= 1 + wave;
        wb *= 1 + wave;
        // Surf line.
        const foam = (1 - smoothstep(0.0, 0.055 + ctx.nM * 0.03, dn)) * (0.55 + 0.45 * smoothstep(-0.3, 0.4, ctx.nF));
        r = wr + (PAL.foam[0] - wr) * foam * 0.85;
        g = wg + (PAL.foam[1] - wg) * foam * 0.85;
        b = wb + (PAL.foam[2] - wb) * foam * 0.85;
        out.water = 1;
        out.depth = depth;
        out.blocked = true;
      }
    }

    // Painterly wash: very low-frequency brightness drift.
    const wash = 1 + ctx.nL * 0.035;
    out.r = r * wash;
    out.g = g * wash;
    out.b = b * wash;
  }

  /** Base ground colour of a biome (no rock / snow / water), with seasonal variation. */
  ground(b: Biome, c: PixelCtx, out: RGB): void {
    const [base, light, dark, accent] = b.ground;
    const season = this.season;
    // Patchy mix of base, light and dark tones.
    const tL = smoothstep(-0.25, 0.55, c.nL);
    let r = base[0] + (light[0] - base[0]) * tL;
    let g = base[1] + (light[1] - base[1]) * tL;
    let bb = base[2] + (light[2] - base[2]) * tL;
    const tD = smoothstep(0.05, 0.6, -c.nM) * 0.7;
    r += (dark[0] - r) * tD;
    g += (dark[1] - g) * tD;
    bb += (dark[2] - bb) * tD;
    const tA = smoothstep(0.25, 0.65, c.nM * 0.7 + c.nL * 0.5) * 0.5;
    r += (accent[0] - r) * tA;
    g += (accent[1] - g) * tA;
    bb += (accent[2] - bb) * tA;

    const id: BiomeId = b.id;
    switch (id) {
      case 'grassland':
      case 'forest': {
        if (season === 'spring') {
          const t = 0.35;
          r += (PAL.springGreen[0] - r) * t;
          g += (PAL.springGreen[1] - g) * t;
          bb += (PAL.springGreen[2] - bb) * t;
          if (id === 'grassland' && c.nF > 0.62) {
            const f = c.nM > 0.2 ? PAL.flowerY : c.nM < -0.2 ? PAL.flowerP : PAL.flowerW;
            r = f[0];
            g = f[1];
            bb = f[2];
          }
        } else if (season === 'autumn') {
          const t = id === 'forest' ? 0.55 : 0.4;
          const tgt = id === 'forest' ? (c.nM > 0 ? PAL.leafLitter : PAL.leafLitter2) : PAL.autumnGrass;
          r += (tgt[0] - r) * t;
          g += (tgt[1] - g) * t;
          bb += (tgt[2] - bb) * t;
        } else if (season === 'summer' && id === 'grassland' && c.nF > 0.72 && c.nM > 0.1) {
          r = PAL.flowerY[0];
          g = PAL.flowerY[1];
          bb = PAL.flowerY[2];
        }
        break;
      }
      case 'savanna': {
        if (season === 'spring' || season === 'summer') {
          const t = season === 'spring' ? 0.35 : 0.12;
          r += (0.5 - r) * t;
          g += (0.62 - g) * t;
          bb += (0.28 - bb) * t;
        } else if (season === 'winter') {
          r += (PAL.dryGrass[0] - r) * 0.3;
          g += (PAL.dryGrass[1] - g) * 0.3;
          bb += (PAL.dryGrass[2] - bb) * 0.3;
        }
        break;
      }
      case 'desert': {
        // Wind ripples.
        const rip = Math.sin((c.x * 0.8 + c.y * 0.6) * 1.1 * (32 / this.field.s) + c.nM * 6) * 0.025;
        r *= 1 + rip;
        g *= 1 + rip;
        bb *= 1 + rip;
        break;
      }
      case 'badlands': {
        const band = Math.sin((c.H / (this.field.s * 0.03)) * Math.PI + c.nL * 2);
        const t = 0.5 + band * 0.5;
        r += (light[0] - r) * t * 0.35;
        g += (light[1] - g) * t * 0.35;
        bb += (light[2] - bb) * t * 0.35;
        break;
      }
      case 'tundra': {
        if (c.nF > 0.5) {
          // Lichen speckles.
          r += (0.72 - r) * 0.4;
          g += (0.7 - g) * 0.4;
          bb += (0.55 - bb) * 0.4;
        }
        if (season === 'autumn') {
          r += (0.6 - r) * 0.3;
          g += (0.38 - g) * 0.3;
          bb += (0.22 - bb) * 0.3;
        }
        break;
      }
      case 'jungle':
      case 'conifer':
      case 'swamp':
      case 'snow':
      case 'volcanic':
      case 'ocean':
      case 'lake':
        break;
    }

    // Fine grain.
    const grain = 1 + c.nF * 0.06 + c.nS * 0.025;
    out[0] = r * grain;
    out[1] = g * grain;
    out[2] = bb * grain;
  }

  /** Patchwork field colour for a farming hex. */
  private fieldColor(h: FieldHex, b: Biome, c: PixelCtx, out: RGB): void {
    const s = this.field.s;
    const ang = hashFloat(h.seed, 3, 9) * Math.PI;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const dx = c.x - h.cx;
    const dy = c.y - h.cy;
    const u = (dx * ca + dy * sa) / (s * 0.21);
    const v0 = (-dx * sa + dy * ca) / (s * 0.42);
    const iu = Math.floor(u);
    const v = v0 + hashFloat(iu, h.seed, 5) * 0.7;
    const iv = Math.floor(v);
    const trad = tradition(b);
    const pal = CROPS[trad][this.season];
    const pick = Math.floor(hashFloat(iu, iv, h.seed) * pal.length);
    const col = pal[pick];
    // Furrows along the long axis.
    const fu = u - iu;
    const fv = v - iv;
    const furrow = 0.94 + 0.06 * Math.sin(fu * Math.PI * 2 * 5);
    const grain = 1 + c.nF * 0.05;
    let r = col[0] * furrow * grain;
    let g = col[1] * furrow * grain;
    let bb = col[2] * furrow * grain;
    // Borders: hedgerows, stone walls, earth banks or paddy dikes.
    const border = Math.min(fu, 1 - fu) * s * 0.21 < 0.9 || Math.min(fv, 1 - fv) * s * 0.42 < 0.9;
    if (border) {
      const bc = trad === 'temperate' ? PAL.hedge : trad === 'cold' ? PAL.stoneWall : trad === 'paddy' ? C('#6f7d45') : PAL.dirtDark;
      r = bc[0] * (0.9 + c.nF * 0.1);
      g = bc[1] * (0.9 + c.nF * 0.1);
      bb = bc[2] * (0.9 + c.nF * 0.1);
    } else if (trad === 'paddy' && pick % 2 === 0 && this.season !== 'autumn') {
      // Flooded paddies catch the sky.
      r = r * 0.7 + 0.12;
      g = g * 0.8 + 0.14;
      bb = bb * 0.8 + 0.2;
    }
    out[0] = clamp01(r);
    out[1] = clamp01(g);
    out[2] = clamp01(bb);
  }
}

function maxOwnerWeight(S: Sample): number {
  let best = 0;
  for (let k = 0; k < S.n; k++) if (S.idx[k] === S.owner && S.wc[k] > best) best = S.wc[k];
  return best;
}
