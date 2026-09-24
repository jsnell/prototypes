import { AXIAL_DIRS, axialToOffset, directionTo, offsetToAxial, opposite, type Axial } from '../core/hex';
import { BIOME_IDS, BIOME_INDEX, BIOMES, MAX_LEVEL, type BiomeId } from './biomes';
import { FEATURE_IDS, type FeatureId } from './features';

export type PathKind = 'road' | 'river';

export interface HexCell {
  q: number;
  r: number;
  col: number;
  row: number;
  index: number;
  biome: BiomeId;
  level: number;
  feature: FeatureId | null;
  /** Bitmask over the six directions (bit d set = road towards neighbour d). */
  roads: number;
  rivers: number;
}

export interface MapJSON {
  version: 1;
  cols: number;
  rows: number;
  seed: number;
  biomes: string[];
  levels: number[];
  features: (string | null)[];
  roads: number[];
  rivers: number[];
}

export type ChangeListener = (indices: number[]) => void;

/**
 * A rectangular (odd-q offset) hex map. Holds only the logical state:
 * biome, elevation level, feature and road / river connections per hex.
 */
export class HexMap {
  readonly cols: number;
  readonly rows: number;
  seed: number;

  readonly biome: Uint8Array;
  readonly level: Uint8Array;
  /** 0 = none, otherwise FEATURE_IDS index + 1. */
  readonly feature: Uint8Array;
  readonly roads: Uint8Array;
  readonly rivers: Uint8Array;

  private listeners = new Set<ChangeListener>();
  private batchDepth = 0;
  private pending = new Set<number>();

  constructor(cols: number, rows: number, seed = 1, fill: BiomeId = 'grassland') {
    this.cols = cols;
    this.rows = rows;
    this.seed = seed;
    const n = cols * rows;
    this.biome = new Uint8Array(n).fill(BIOME_INDEX[fill]);
    this.level = new Uint8Array(n);
    this.feature = new Uint8Array(n);
    this.roads = new Uint8Array(n);
    this.rivers = new Uint8Array(n);
  }

  get size(): number {
    return this.cols * this.rows;
  }

  // ---- coordinates -------------------------------------------------------

  /** Index for axial (q, r) or -1 when outside the map. */
  indexOf(q: number, r: number): number {
    const { col, row } = axialToOffset(q, r);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return -1;
    return row * this.cols + col;
  }

  axialOf(index: number): Axial {
    const col = index % this.cols;
    const row = (index - col) / this.cols;
    return offsetToAxial(col, row);
  }

  /** Neighbour index in direction d, or -1. */
  neighbor(index: number, d: number): number {
    const { q, r } = this.axialOf(index);
    return this.indexOf(q + AXIAL_DIRS[d][0], r + AXIAL_DIRS[d][1]);
  }

  neighbors(index: number): number[] {
    const out: number[] = [];
    for (let d = 0; d < 6; d++) {
      const n = this.neighbor(index, d);
      if (n >= 0) out.push(n);
    }
    return out;
  }

  cell(index: number): HexCell {
    const { q, r } = this.axialOf(index);
    const col = index % this.cols;
    return {
      q,
      r,
      col,
      row: (index - col) / this.cols,
      index,
      biome: this.biomeAt(index),
      level: this.level[index],
      feature: this.featureAt(index),
      roads: this.roads[index],
      rivers: this.rivers[index],
    };
  }

  biomeAt(index: number): BiomeId {
    return BIOME_IDS[this.biome[index]];
  }

  featureAt(index: number): FeatureId | null {
    const f = this.feature[index];
    return f === 0 ? null : FEATURE_IDS[f - 1];
  }

  isWater(index: number): boolean {
    return BIOMES[this.biomeAt(index)].water;
  }

  // ---- change notification ----------------------------------------------

  onChange(fn: ChangeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Group several edits into a single change notification. */
  batch(fn: () => void): void {
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) this.flush();
    }
  }

  private touch(...indices: number[]): void {
    for (const i of indices) if (i >= 0) this.pending.add(i);
    if (this.batchDepth === 0) this.flush();
  }

  private flush(): void {
    if (this.pending.size === 0) return;
    const list = [...this.pending];
    this.pending.clear();
    for (const fn of this.listeners) fn(list);
  }

  /** Mark every hex as changed (e.g. after bulk edits to the raw arrays). */
  touchAll(): void {
    for (let i = 0; i < this.size; i++) this.pending.add(i);
    if (this.batchDepth === 0) this.flush();
  }

  // ---- edits -------------------------------------------------------------

  setBiome(index: number, biome: BiomeId): boolean {
    const b = BIOME_INDEX[biome];
    if (this.biome[index] === b) return false;
    this.biome[index] = b;
    if (BIOMES[biome].water) this.feature[index] = 0;
    this.touch(index);
    return true;
  }

  setLevel(index: number, level: number): boolean {
    const l = Math.max(0, Math.min(MAX_LEVEL, Math.round(level)));
    if (this.level[index] === l) return false;
    this.level[index] = l;
    this.touch(index);
    return true;
  }

  setFeature(index: number, feature: FeatureId | null): boolean {
    if (feature && this.isWater(index)) return false;
    const f = feature ? FEATURE_IDS.indexOf(feature) + 1 : 0;
    if (this.feature[index] === f) return false;
    this.feature[index] = f;
    this.touch(index);
    return true;
  }

  private maskArray(kind: PathKind): Uint8Array {
    return kind === 'road' ? this.roads : this.rivers;
  }

  /** Connect two adjacent hexes with a road or river. Returns false if not adjacent. */
  connect(kind: PathKind, a: number, b: number): boolean {
    const d = directionTo(this.axialOf(a), this.axialOf(b));
    if (d < 0) return false;
    const m = this.maskArray(kind);
    if (m[a] & (1 << d)) return false;
    m[a] |= 1 << d;
    m[b] |= 1 << opposite(d);
    this.touch(a, b);
    return true;
  }

  disconnect(kind: PathKind, a: number, b: number): boolean {
    const d = directionTo(this.axialOf(a), this.axialOf(b));
    if (d < 0) return false;
    const m = this.maskArray(kind);
    if (!(m[a] & (1 << d))) return false;
    m[a] &= ~(1 << d);
    m[b] &= ~(1 << opposite(d));
    this.touch(a, b);
    return true;
  }

  /** Remove all roads / rivers touching a hex. */
  clearPaths(index: number, kind?: PathKind): boolean {
    let changed = false;
    this.batch(() => {
      for (const k of kind ? [kind] : (['road', 'river'] as PathKind[])) {
        const m = this.maskArray(k);
        for (let d = 0; d < 6; d++) {
          if (m[index] & (1 << d)) {
            const n = this.neighbor(index, d);
            if (n >= 0) changed = this.disconnect(k, index, n) || changed;
            else {
              m[index] &= ~(1 << d);
              changed = true;
              this.touch(index);
            }
          }
        }
      }
    });
    return changed;
  }

  /** Reset a hex to plain lowland grassland. */
  resetHex(index: number): void {
    this.batch(() => {
      this.clearPaths(index);
      this.setFeature(index, null);
      this.setBiome(index, 'grassland');
      this.setLevel(index, 0);
    });
  }

  fill(biome: BiomeId, level = 0): void {
    this.biome.fill(BIOME_INDEX[biome]);
    this.level.fill(level);
    this.feature.fill(0);
    this.roads.fill(0);
    this.rivers.fill(0);
    this.touchAll();
  }

  // ---- serialisation -----------------------------------------------------

  toJSON(): MapJSON {
    return {
      version: 1,
      cols: this.cols,
      rows: this.rows,
      seed: this.seed,
      biomes: Array.from(this.biome, (b) => BIOME_IDS[b]),
      levels: Array.from(this.level),
      features: Array.from(this.feature, (f) => (f ? FEATURE_IDS[f - 1] : null)),
      roads: Array.from(this.roads),
      rivers: Array.from(this.rivers),
    };
  }

  static fromJSON(json: MapJSON): HexMap {
    const map = new HexMap(json.cols, json.rows, json.seed);
    const n = map.size;
    for (let i = 0; i < n; i++) {
      const b = json.biomes[i] as BiomeId;
      map.biome[i] = BIOME_INDEX[b] ?? 0;
      map.level[i] = Math.max(0, Math.min(MAX_LEVEL, json.levels[i] | 0));
      const f = json.features[i] as FeatureId | null;
      map.feature[i] = f ? FEATURE_IDS.indexOf(f) + 1 : 0;
      map.roads[i] = json.roads[i] & 63;
      map.rivers[i] = json.rivers[i] & 63;
    }
    return map;
  }
}
