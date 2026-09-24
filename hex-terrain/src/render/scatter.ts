import { hex, type RGB } from '../core/color';
import { DIR_VECTORS } from '../core/hex';
import { Rng, hashFloat } from '../core/rng';
import { type Biome, type BuildingStyle, type FloraKind } from '../model/biomes';
import type { FeatureId } from '../model/features';
import type { Lighting, Season } from './environment';
import type { FieldHex, TerrainField } from './field';
import type { SpriteImage } from './sprites/canvas';
import { paintStructure, type StructureKind, type StructureParams } from './sprites/buildings';
import { paintFlora } from './sprites/flora';

export interface SpriteInstance {
  x: number;
  y: number;
  z: number;
  img: SpriteImage;
  /** Per-instance colour multiplier. */
  tr: number;
  tg: number;
  tb: number;
}

/** Ground queries the scatter pass needs from the renderer. */
export interface GroundQuery {
  /** Visible surface height (water surface over water). */
  surface(x: number, y: number): number;
  /** Ground height (sea floor under water). */
  ground(x: number, y: number): number;
  /** True for water, rivers and roads. */
  blocked(x: number, y: number): boolean;
  water(x: number, y: number): boolean;
  slope(x: number, y: number): number;
  /** Dominant hex at a point (after border warping), runner-up hex and its weight 0..1. */
  owner(x: number, y: number): number;
  alt(x: number, y: number): number;
  altWeight(x: number, y: number): number;
}

const SNOWLINE: Record<Season, number> = { spring: 0.92, summer: 1.08, autumn: 0.98, winter: 0.62 };

const TREE_KINDS = new Set<FloraKind>(['broadleaf', 'pine', 'palm', 'jungleTree', 'acacia', 'swampTree', 'deadTree', 'cactus']);

/** How far (in apothems) a feature clears trees from the hex centre. */
const CLEARING: Record<FeatureId, number> = {
  village: 0.66,
  town: 0.86,
  castle: 0.58,
  tower: 0.22,
  farm: 1.05,
  ruins: 0.3,
  mine: 0.4,
};

const STONE: Partial<Record<string, RGB>> = {
  desert: hex('#c9a577'),
  badlands: hex('#b98563'),
  savanna: hex('#b09a78'),
  volcanic: hex('#4d4845'),
  snow: hex('#a9adb3'),
  tundra: hex('#8f8d86'),
  jungle: hex('#8e9280'),
  swamp: hex('#858a78'),
};

export class SpriteCache {
  private readonly map = new Map<string, SpriteImage>();

  get(key: string, make: () => SpriteImage): SpriteImage {
    let img = this.map.get(key);
    if (!img) {
      img = make();
      this.map.set(key, img);
    }
    return img;
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

export class Scatter {
  private readonly field: TerrainField;
  private readonly cache: SpriteCache;
  season: Season = 'summer';
  lighting!: Lighting;

  constructor(field: TerrainField, cache: SpriteCache) {
    this.field = field;
    this.cache = cache;
  }

  private get u(): number {
    return this.field.s / 32;
  }

  /** Buildings are drawn a little larger than plants so they read at map scale. */
  private get bu(): number {
    return this.u * 1.45;
  }

  private get flip(): boolean {
    return this.lighting.sun[0] > 0.15;
  }

  /** Shadow direction snapped to eight buckets so sprite images can be shared. */
  private get shadowBucket(): number {
    const [dx, dy] = this.lighting.shadowDir;
    return (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  }

  private get shadowDir(): [number, number] {
    const a = this.shadowBucket * (Math.PI / 4);
    return [Math.cos(a), Math.sin(a)];
  }

  isSnowy(b: Biome, H: number): boolean {
    if (b.id === 'snow') return true;
    if (H > SNOWLINE[this.season] * this.field.s) return true;
    return this.season === 'winter' && (b.climate === 'cold' || b.climate === 'temperate');
  }

  styleFor(h: FieldHex): BuildingStyle {
    const st = h.biome.style;
    if (st === 'timber' && h.level >= 3) return 'stone';
    return st;
  }

  /** All sprites belonging to one hex, unsorted. */
  build(index: number, g: GroundQuery): SpriteInstance[] {
    const out: SpriteInstance[] = [];
    const h = this.field.hexes[index];
    this.structures(index, h, g, out);
    this.flora(index, h, g, out);
    return out;
  }

  // ---- flora -------------------------------------------------------------

  private flora(index: number, h: FieldHex, g: GroundQuery, out: SpriteInstance[]): void {
    const field = this.field;
    const s = field.s;
    const cell = s * 0.13;
    const seed = field.map.seed;
    const i0 = Math.floor((h.cx - s * 1.2) / cell);
    const i1 = Math.floor((h.cx + s * 1.2) / cell);
    const j0 = Math.floor((h.cy - s * 1.1) / cell);
    const j1 = Math.floor((h.cy + s * 1.1) / cell);
    const feature = field.map.featureAt(index);
    const clearR = feature ? CLEARING[feature] * field.a : 0;

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.1 + hashFloat(i, j, 1, seed) * 0.8) * cell;
        const y = (j + 0.1 + hashFloat(i, j, 2, seed) * 0.8) * cell;
        if (g.owner(x, y) !== index) continue;
        // Near borders, sometimes grow the neighbouring biome's plants instead.
        let biome: Biome = h.biome;
        const alt = g.alt(x, y);
        if (alt >= 0 && hashFloat(i, j, 3, seed) < g.altWeight(x, y)) biome = field.hexes[alt].biome;
        if (biome.water || biome.flora.length === 0) continue;
        let total = 0;
        for (const f of biome.flora) total += f.density;
        const norm = total > 1 ? 1 / total : 1;
        let roll = hashFloat(i, j, 4, seed);
        let spec = null;
        for (const f of biome.flora) {
          roll -= f.density * norm;
          if (roll < 0) {
            spec = f;
            break;
          }
        }
        if (!spec) continue;
        // Keep clear of water, roads and river banks a little beyond their painted width.
        const m = s * 0.06;
        if (g.blocked(x, y) || g.blocked(x + m, y) || g.blocked(x - m, y) || g.blocked(x, y + m) || g.blocked(x, y - m)) continue;
        const isTree = TREE_KINDS.has(spec.kind);
        let kind = spec.kind;
        const z = g.ground(x, y);
        if (isTree) {
          if (feature && Math.hypot(x - h.cx, y - h.cy) < clearR) continue;
          const slope = g.slope(x, y);
          if (slope > (spec.maxSlope ?? 1.05)) continue;
          // Tree line: broadleaf gives way to pine, then to bare rock.
          const treeline = s * (0.98 + 0.12 * hashFloat(i, j, 5, seed));
          if (z > treeline) continue;
          if ((kind === 'broadleaf' || kind === 'jungleTree') && z > s * 0.62) kind = 'pine';
        } else if (feature && kind !== 'rock' && Math.hypot(x - h.cx, y - h.cy) < clearR * 0.8) continue;
        if (biome.id === 'volcanic' && kind === 'rock' && z > s * 0.5) continue;

        const variant = Math.floor(hashFloat(i, j, 6, seed) * 6);
        const [lo, hi] = spec.scale ?? [0.85, 1.15];
        const sb = Math.floor(hashFloat(i, j, 7, seed) * 3);
        const scale = lo + ((hi - lo) * (sb + 0.5)) / 3;
        const snowy = this.isSnowy(biome, z);
        const flip = this.flip;
        const key = `f|${kind}|${biome.id}|${this.season}|${variant}|${sb}|${snowy ? 1 : 0}|${flip ? 1 : 0}|${this.shadowBucket}|${s}`;
        const img = this.cache.get(key, () =>
          paintFlora({
            kind,
            biome,
            season: this.season,
            u: this.u,
            variant,
            scale,
            flip,
            shadowDir: this.shadowDir,
            snowy,
          }),
        );
        const jitter = 0.92 + hashFloat(i, j, 8, seed) * 0.16;
        const warm = (hashFloat(i, j, 9, seed) - 0.5) * 0.08;
        out.push({ x, y, z, img, tr: jitter * (1 + warm), tg: jitter, tb: jitter * (1 - warm) });
      }
    }
  }

  // ---- structures --------------------------------------------------------

  private structure(p: Omit<StructureParams, 'u' | 'season' | 'lightFromEast' | 'shadowDir'>): SpriteImage {
    const rotB = Math.round((((p.rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 12)) % 24;
    const rot = rotB * (Math.PI / 12);
    const stoneKey = p.stone ? p.stone.map((c) => Math.round(c * 255)).join(',') : '';
    const key = `s|${p.kind}|${p.style}|${this.season}|${p.variant}|${rotB}|${p.snowy ? 1 : 0}|${this.flip ? 1 : 0}|${this.shadowBucket}|${p.len ? Math.round(p.len * 2) : 0}|${stoneKey}|${this.field.s}`;
    return this.cache.get(key, () =>
      paintStructure({
        ...p,
        rot,
        u: this.bu,
        season: this.season,
        lightFromEast: this.flip,
        shadowDir: this.shadowDir,
      }),
    );
  }

  private place(out: SpriteInstance[], x: number, y: number, z: number, img: SpriteImage): void {
    out.push({ x, y, z, img, tr: 1, tg: 1, tb: 1 });
  }

  private structures(index: number, h: FieldHex, g: GroundQuery, out: SpriteInstance[]): void {
    const field = this.field;
    const map = field.map;
    const s = field.s;
    const u = this.bu;
    const feature = map.featureAt(index);
    const rng = new Rng(h.seed);
    const style = this.styleFor(h);
    const snowyAt = (x: number, y: number) => this.isSnowy(h.biome, g.ground(x, y));
    const stone = STONE[h.biome.id];

    // Bridges where roads cross rivers.
    for (const c of h.bridges) {
      const span = field.riverWidth * 2.2;
      const z = Math.max(
        g.ground(c.x + c.dx * span, c.y + c.dy * span),
        g.ground(c.x - c.dx * span, c.y - c.dy * span),
        g.surface(c.x, c.y) + s * 0.02,
      );
      const img = this.structure({
        kind: 'bridge',
        style,
        variant: 0,
        rot: Math.atan2(c.dy, c.dx),
        snowy: snowyAt(c.x, c.y),
        len: (span * 2) / u,
      });
      this.place(out, c.x, c.y, z, img);
    }

    // Volcano plume.
    if (h.biome.id === 'volcanic' && h.level >= 3) {
      const img = this.structure({ kind: 'smoke', style, variant: h.seed % 3, rot: 0, snowy: false });
      this.place(out, h.cx, h.cy, g.surface(h.cx, h.cy), img);
    }

    // Ferry landings where a road runs into open water.
    if (!h.water) {
      for (let d = 0; d < 6; d++) {
        if (!(map.roads[index] & (1 << d))) continue;
        const nb = map.neighbor(index, d);
        if (nb >= 0 && map.isWater(nb)) this.pier(h, d, g, out, feature !== null, rng);
      }
    }

    if (!feature) return;
    const stoneCol = stone;
    switch (feature) {
      case 'village':
      case 'town':
        this.settlement(index, h, feature, style, g, out, rng);
        break;
      case 'castle': {
        const img = this.structure({ kind: 'keep', style, variant: h.seed % 4, rot: 0, snowy: snowyAt(h.cx, h.cy), stone: stoneCol });
        this.place(out, h.cx, h.cy, g.ground(h.cx, h.cy), img);
        break;
      }
      case 'tower': {
        const img = this.structure({ kind: 'tower', style, variant: h.seed % 4, rot: 0, snowy: snowyAt(h.cx, h.cy), stone: stoneCol });
        this.place(out, h.cx, h.cy, g.ground(h.cx, h.cy), img);
        break;
      }
      case 'ruins': {
        const img = this.structure({ kind: 'ruin', style, variant: h.seed % 5, rot: rng.next() * Math.PI, snowy: snowyAt(h.cx, h.cy), stone: stoneCol });
        this.place(out, h.cx, h.cy, g.ground(h.cx, h.cy), img);
        break;
      }
      case 'mine': {
        const hilly = h.level >= 2;
        const img = this.structure({
          kind: hilly ? 'mine' : 'quarry',
          style,
          variant: h.seed % 3,
          rot: 0,
          snowy: snowyAt(h.cx, h.cy),
          stone: stoneCol ?? h.biome.rock,
        });
        this.place(out, h.cx, h.cy, g.ground(h.cx, h.cy), img);
        break;
      }
      case 'farm':
        this.farm(h, style, g, out, rng);
        break;
    }
  }

  /** Try to place a building footprint; returns false if the ground is unsuitable. */
  private free(x: number, y: number, r: number, g: GroundQuery, taken: [number, number, number][]): boolean {
    for (const [tx, ty, tr] of taken) if (Math.hypot(x - tx, y - ty) < r + tr) return false;
    const pts = [
      [0, 0],
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ];
    for (const [dx, dy] of pts) {
      if (g.blocked(x + dx, y + dy)) return false;
    }
    if (g.slope(x, y) > 0.7) return false;
    return true;
  }

  private settlement(
    index: number,
    h: FieldHex,
    feature: 'village' | 'town',
    style: BuildingStyle,
    g: GroundQuery,
    out: SpriteInstance[],
    rng: Rng,
  ): void {
    const field = this.field;
    const s = field.s;
    const a = field.a;
    const town = feature === 'town';
    const radius = (town ? 0.6 : 0.5) * a;
    const houseR = s * 0.15;
    const taken: [number, number, number][] = [];
    const snowy = this.isSnowy(h.biome, g.ground(h.cx, h.cy));
    const stone = STONE[h.biome.id] ?? (style === 'log' ? hex('#7d6a55') : undefined);
    const houses: { x: number; y: number; rot: number; kind: StructureKind }[] = [];

    // Town hall / temple near the centre.
    if (town) {
      for (let t = 0; t < 12; t++) {
        const ang = rng.next() * Math.PI * 2;
        const dist = t === 0 ? 0 : (0.1 + rng.next() * 0.2) * a;
        const x = h.cx + Math.cos(ang) * dist;
        const y = h.cy + Math.sin(ang) * dist;
        if (this.free(x, y, s * 0.2, g, taken)) {
          houses.push({ x, y, rot: rng.next() < 0.5 ? 0 : Math.PI / 2, kind: 'hall' });
          taken.push([x, y, s * 0.24]);
          break;
        }
      }
    }

    // Houses line up along roads when there are any.
    const target = town ? 10 + rng.int(0, 5) : 4 + rng.int(0, 4);
    if (h.roads) {
      const slots: { x: number; y: number; rot: number }[] = [];
      for (const line of h.roads.lines) {
        for (let i = 2; i + 3 < line.length; i += 4) {
          const x0 = line[i];
          const y0 = line[i + 1];
          const dx = line[i + 2] - x0;
          const dy = line[i + 3] - y0;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          for (const side of [-1, 1]) {
            const off = field.roadWidth + houseR * 1.25;
            slots.push({ x: x0 + nx * off * side, y: y0 + ny * off * side, rot: Math.atan2(dy, dx) });
          }
        }
      }
      // Shuffle, then prefer slots near the centre.
      for (let i = slots.length - 1; i > 0; i--) {
        const j = rng.int(0, i + 1);
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }
      slots.sort((p, q) => Math.hypot(p.x - h.cx, p.y - h.cy) - Math.hypot(q.x - h.cx, q.y - h.cy));
      for (const sl of slots) {
        if (houses.length >= target) break;
        if (Math.hypot(sl.x - h.cx, sl.y - h.cy) > radius) continue;
        if (!this.free(sl.x, sl.y, houseR, g, taken)) continue;
        houses.push({ ...sl, kind: 'house' });
        taken.push([sl.x, sl.y, houseR]);
      }
    }
    // Fill the rest as a loose cluster around the centre.
    const baseRot = rng.next() * Math.PI;
    for (let t = 0; t < 80 && houses.length < target; t++) {
      const ang = rng.next() * Math.PI * 2;
      const dist = Math.sqrt(rng.next()) * radius;
      const x = h.cx + Math.cos(ang) * dist;
      const y = h.cy + Math.sin(ang) * dist;
      if (!this.free(x, y, houseR, g, taken)) continue;
      const rot = baseRot + (rng.next() < 0.5 ? 0 : Math.PI / 2) + (rng.next() - 0.5) * 0.3;
      houses.push({ x, y, rot, kind: 'house' });
      taken.push([x, y, houseR]);
    }
    if (!town && !h.roads && this.free(h.cx, h.cy, s * 0.05, g, [])) {
      const img = this.structure({ kind: 'well', style, variant: 0, rot: 0, snowy });
      this.place(out, h.cx, h.cy, g.ground(h.cx, h.cy), img);
    }
    for (const hs of houses) {
      const img = this.structure({ kind: hs.kind, style, variant: rng.int(0, 6), rot: hs.rot, snowy, stone });
      this.place(out, hs.x, hs.y, g.ground(hs.x, hs.y), img);
    }

    if (town) this.townWalls(h, style, g, out, snowy, stone);

    // Waterfront villages get a jetty and a boat.
    let best = -1;
    for (let d = 0; d < 6; d++) {
      const nb = field.map.neighbor(index, d);
      if (nb >= 0 && field.map.isWater(nb) && !(field.map.roads[index] & (1 << d))) {
        best = d;
        if (field.hexes[nb].biome.id === 'ocean') break;
      }
    }
    if (best >= 0) this.pier(h, best, g, out, true, rng);
  }

  private townWalls(h: FieldHex, style: BuildingStyle, g: GroundQuery, out: SpriteInstance[], snowy: boolean, stone: RGB | undefined): void {
    const field = this.field;
    const u = this.bu;
    const R = field.a * 0.74;
    const segs = 20;
    // Find where roads cross the wall ring: gates go there.
    const gates: { ang: number; rot: number }[] = [];
    if (h.roads) {
      for (const line of h.roads.lines) {
        for (let i = 0; i + 3 < line.length; i += 2) {
          const d0 = Math.hypot(line[i] - h.cx, line[i + 1] - h.cy) - R;
          const d1 = Math.hypot(line[i + 2] - h.cx, line[i + 3] - h.cy) - R;
          if ((d0 < 0) !== (d1 < 0)) {
            const t = d0 / (d0 - d1);
            const x = line[i] + (line[i + 2] - line[i]) * t;
            const y = line[i + 1] + (line[i + 3] - line[i + 1]) * t;
            gates.push({
              ang: Math.atan2(y - h.cy, x - h.cx),
              rot: Math.atan2(line[i + 3] - line[i + 1], line[i + 2] - line[i]),
            });
          }
        }
      }
    }
    const wallStyle: BuildingStyle = style;
    const wallStone = style === 'hut' || style === 'stilt' ? hex('#7a5a3a') : stone;
    const angDiff = (p: number, q: number) => Math.abs(Math.atan2(Math.sin(p - q), Math.cos(p - q)));
    const chord = 2 * R * Math.sin(Math.PI / segs);
    for (let k = 0; k < segs; k++) {
      const ang = (k / segs) * Math.PI * 2;
      if (gates.some((gt) => angDiff(gt.ang, ang) < 0.2)) continue;
      const x = h.cx + Math.cos(ang) * R;
      const y = h.cy + Math.sin(ang) * R;
      if (g.water(x, y) || g.blocked(x, y)) continue;
      const img = this.structure({
        kind: 'wall',
        style: wallStyle,
        variant: 0,
        rot: ang + Math.PI / 2,
        snowy,
        len: (chord * 1.08) / u,
        stone: wallStone,
      });
      this.place(out, x, y, g.ground(x, y), img);
    }
    for (const gt of gates) {
      const x = h.cx + Math.cos(gt.ang) * R;
      const y = h.cy + Math.sin(gt.ang) * R;
      const img = this.structure({ kind: 'gate', style: wallStyle, variant: 0, rot: gt.rot, snowy, stone: wallStone });
      this.place(out, x, y, g.ground(x, y), img);
    }
  }

  private farm(h: FieldHex, style: BuildingStyle, g: GroundQuery, out: SpriteInstance[], rng: Rng): void {
    const s = this.field.s;
    const snowy = this.isSnowy(h.biome, g.ground(h.cx, h.cy));
    const ang = hashFloat(h.seed, 3, 9) * Math.PI;
    const taken: [number, number, number][] = [];
    const parts: { kind: StructureKind; dx: number; dy: number }[] = [
      { kind: 'house', dx: -0.1, dy: -0.06 },
      { kind: 'barn', dx: 0.14, dy: 0.08 },
    ];
    for (const p of parts) {
      let x = h.cx + (p.dx * Math.cos(ang) - p.dy * Math.sin(ang)) * s;
      let y = h.cy + (p.dx * Math.sin(ang) + p.dy * Math.cos(ang)) * s;
      for (let t = 0; t < 10 && !this.free(x, y, s * 0.1, g, taken); t++) {
        x += (rng.next() - 0.5) * s * 0.15;
        y += (rng.next() - 0.5) * s * 0.15;
      }
      taken.push([x, y, s * 0.12]);
      const img = this.structure({ kind: p.kind, style, variant: rng.int(0, 6), rot: ang, snowy });
      this.place(out, x, y, g.ground(x, y), img);
    }
    if (this.season === 'summer' || this.season === 'autumn') {
      const n = rng.int(2, 5);
      for (let i = 0; i < n; i++) {
        const r = s * (0.35 + rng.next() * 0.35);
        const t = rng.next() * Math.PI * 2;
        const x = h.cx + Math.cos(t) * r;
        const y = h.cy + Math.sin(t) * r;
        if (!this.free(x, y, s * 0.04, g, taken)) continue;
        const img = this.structure({ kind: 'haystack', style, variant: rng.int(0, 3), rot: 0, snowy });
        this.place(out, x, y, g.ground(x, y), img);
      }
    }
  }

  /** A jetty from the shore towards neighbour direction d. */
  private pier(h: FieldHex, d: number, g: GroundQuery, out: SpriteInstance[], withBoat: boolean, rng: Rng): void {
    const s = this.field.s;
    const u = this.bu;
    const [vx, vy] = DIR_VECTORS[d];
    let sx = -1;
    let sy = -1;
    for (let t = 0.2; t < 1.6; t += 0.03) {
      const x = h.cx + vx * t * this.field.a;
      const y = h.cy + vy * t * this.field.a;
      if (g.water(x, y)) {
        sx = x - vx * s * 0.05;
        sy = y - vy * s * 0.05;
        break;
      }
    }
    if (sx < 0) return;
    const len = s * 0.32;
    const rot = Math.atan2(vy, vx);
    const zWater = g.surface(sx + vx * len * 0.5, sy + vy * len * 0.5);
    const img = this.structure({ kind: 'pier', style: 'timber', variant: 0, rot, snowy: this.season === 'winter' && h.biome.climate !== 'hot', len: len / u });
    this.place(out, sx, sy, zWater, img);
    if (withBoat && !(this.season === 'winter' && h.biome.climate === 'cold')) {
      const bx = sx + vx * len * 0.75 - vy * s * 0.1;
      const by = sy + vy * len * 0.75 + vx * s * 0.1;
      if (g.water(bx, by)) {
        const boat = this.structure({ kind: 'boat', style: 'timber', variant: rng.int(0, 4), rot: rot + Math.PI / 2 + (rng.next() - 0.5) * 0.4, snowy: false });
        this.place(out, bx, by, g.surface(bx, by), boat);
      }
    }
  }
}

