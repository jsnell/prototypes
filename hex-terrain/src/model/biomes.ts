import { hex, type RGB } from '../core/color';

export type BiomeId =
  | 'grassland'
  | 'forest'
  | 'conifer'
  | 'jungle'
  | 'swamp'
  | 'savanna'
  | 'desert'
  | 'badlands'
  | 'tundra'
  | 'snow'
  | 'volcanic'
  | 'ocean'
  | 'lake';

export type Climate = 'cold' | 'temperate' | 'warm' | 'hot';

export type BuildingStyle = 'timber' | 'log' | 'adobe' | 'hut' | 'stilt' | 'stone';

/** Sprite kinds the scatter pass can place. */
export type FloraKind =
  | 'broadleaf'
  | 'pine'
  | 'palm'
  | 'jungleTree'
  | 'acacia'
  | 'swampTree'
  | 'deadTree'
  | 'shrub'
  | 'cactus'
  | 'rock'
  | 'grass'
  | 'reeds';

export interface FloraSpec {
  kind: FloraKind;
  /** Expected count per scatter cell (0..1). */
  density: number;
  /** Size multiplier range. */
  scale?: [number, number];
  /** Maximum slope (dz/dx magnitude) the plant tolerates. */
  maxSlope?: number;
}

export interface Biome {
  id: BiomeId;
  name: string;
  climate: Climate;
  water: boolean;
  /** Swatch colour for UI. */
  swatch: string;
  /** Ground palette: base, light variation, dark variation, accent. */
  ground: [RGB, RGB, RGB, RGB];
  /** Exposed rock colour on steep slopes. */
  rock: RGB;
  /** Beach / shore colour where this biome meets water. */
  shore: RGB;
  /** Relief character. */
  relief: 'rolling' | 'dunes' | 'mesa' | 'glacial' | 'volcanic' | 'marsh' | 'water';
  flora: FloraSpec[];
  /** Density of the trees in the flora list is multiplied by this above the tree line. */
  style: BuildingStyle;
  /** Whether farm fields can grow here. */
  arable: boolean;
}

const B = (b: Biome): Biome => b;

export const BIOMES: Record<BiomeId, Biome> = {
  grassland: B({
    id: 'grassland',
    name: 'Grassland',
    climate: 'temperate',
    water: false,
    swatch: '#7fa344',
    ground: [hex('#6e9a3a'), hex('#97b451'), hex('#4f7c31'), hex('#b0aa55')],
    rock: hex('#827b6c'),
    shore: hex('#d8c793'),
    relief: 'rolling',
    flora: [
      { kind: 'broadleaf', density: 0.018, scale: [0.8, 1.15] },
      { kind: 'shrub', density: 0.04 },
      { kind: 'grass', density: 0.12 },
      { kind: 'rock', density: 0.008 },
    ],
    style: 'timber',
    arable: true,
  }),
  forest: B({
    id: 'forest',
    name: 'Forest',
    climate: 'temperate',
    water: false,
    swatch: '#3f7a34',
    ground: [hex('#4d7330'), hex('#62873a'), hex('#355a26'), hex('#7a6a36')],
    rock: hex('#7c7568'),
    shore: hex('#cdbf8c'),
    relief: 'rolling',
    flora: [
      { kind: 'broadleaf', density: 0.78, scale: [0.85, 1.25] },
      { kind: 'pine', density: 0.06, scale: [0.85, 1.1] },
      { kind: 'shrub', density: 0.08 },
    ],
    style: 'timber',
    arable: true,
  }),
  conifer: B({
    id: 'conifer',
    name: 'Taiga',
    climate: 'cold',
    water: false,
    swatch: '#2f5f4c',
    ground: [hex('#4f5f3a'), hex('#687447'), hex('#39472c'), hex('#7c7456')],
    rock: hex('#6c6c6b'),
    shore: hex('#a9a08a'),
    relief: 'rolling',
    flora: [
      { kind: 'pine', density: 0.7, scale: [0.85, 1.25] },
      { kind: 'rock', density: 0.02 },
      { kind: 'shrub', density: 0.03 },
    ],
    style: 'log',
    arable: false,
  }),
  jungle: B({
    id: 'jungle',
    name: 'Jungle',
    climate: 'hot',
    water: false,
    swatch: '#2e8a3a',
    ground: [hex('#356e2a'), hex('#4a8a36'), hex('#234f20'), hex('#5f6f28')],
    rock: hex('#65644f'),
    shore: hex('#e2d3a0'),
    relief: 'rolling',
    flora: [
      { kind: 'jungleTree', density: 0.85, scale: [0.85, 1.35] },
      { kind: 'palm', density: 0.12, scale: [0.9, 1.2] },
      { kind: 'shrub', density: 0.2 },
    ],
    style: 'stilt',
    arable: true,
  }),
  swamp: B({
    id: 'swamp',
    name: 'Swamp',
    climate: 'warm',
    water: false,
    swatch: '#5d6b3c',
    ground: [hex('#566338'), hex('#6d7443'), hex('#3f4a2c'), hex('#5d5433')],
    rock: hex('#6d6a5c'),
    shore: hex('#7d7556'),
    relief: 'marsh',
    flora: [
      { kind: 'swampTree', density: 0.22, scale: [0.85, 1.2] },
      { kind: 'deadTree', density: 0.04 },
      { kind: 'reeds', density: 0.35 },
      { kind: 'shrub', density: 0.06 },
    ],
    style: 'stilt',
    arable: false,
  }),
  savanna: B({
    id: 'savanna',
    name: 'Savanna',
    climate: 'hot',
    water: false,
    swatch: '#c4a352',
    ground: [hex('#bb9f55'), hex('#d0b56c'), hex('#99803f'), hex('#a8673b')],
    rock: hex('#9c8468'),
    shore: hex('#e0cc98'),
    relief: 'rolling',
    flora: [
      { kind: 'acacia', density: 0.05, scale: [0.9, 1.3] },
      { kind: 'shrub', density: 0.06 },
      { kind: 'grass', density: 0.25 },
      { kind: 'rock', density: 0.01 },
    ],
    style: 'hut',
    arable: true,
  }),
  desert: B({
    id: 'desert',
    name: 'Desert',
    climate: 'hot',
    water: false,
    swatch: '#e1be7d',
    ground: [hex('#dcb878'), hex('#ebd39c'), hex('#be9458'), hex('#d1a364')],
    rock: hex('#b08560'),
    shore: hex('#e6d09c'),
    relief: 'dunes',
    flora: [
      { kind: 'cactus', density: 0.012 },
      { kind: 'shrub', density: 0.012, scale: [0.6, 0.9] },
      { kind: 'rock', density: 0.012 },
    ],
    style: 'adobe',
    arable: false,
  }),
  badlands: B({
    id: 'badlands',
    name: 'Badlands',
    climate: 'warm',
    water: false,
    swatch: '#b5623a',
    ground: [hex('#b86a40'), hex('#cf915f'), hex('#8f4a2c'), hex('#d6b082')],
    rock: hex('#a9573a'),
    shore: hex('#d2a67a'),
    relief: 'mesa',
    flora: [
      { kind: 'shrub', density: 0.04, scale: [0.6, 0.9] },
      { kind: 'rock', density: 0.03 },
      { kind: 'deadTree', density: 0.006 },
    ],
    style: 'adobe',
    arable: false,
  }),
  tundra: B({
    id: 'tundra',
    name: 'Tundra',
    climate: 'cold',
    water: false,
    swatch: '#8b9173',
    ground: [hex('#878d68'), hex('#a2a27a'), hex('#6a7552'), hex('#8e6f55')],
    rock: hex('#75746e'),
    shore: hex('#9c998c'),
    relief: 'rolling',
    flora: [
      { kind: 'shrub', density: 0.06, scale: [0.5, 0.8] },
      { kind: 'rock', density: 0.05 },
      { kind: 'grass', density: 0.1 },
      { kind: 'pine', density: 0.012, scale: [0.6, 0.85] },
    ],
    style: 'log',
    arable: false,
  }),
  snow: B({
    id: 'snow',
    name: 'Snowfield',
    climate: 'cold',
    water: false,
    swatch: '#e8eef3',
    ground: [hex('#e9eef3'), hex('#f7fafc'), hex('#c3d2e2'), hex('#bcd4e3')],
    rock: hex('#666a70'),
    shore: hex('#c9d6df'),
    relief: 'glacial',
    flora: [
      { kind: 'rock', density: 0.025 },
      { kind: 'pine', density: 0.015, scale: [0.6, 0.9] },
    ],
    style: 'stone',
    arable: false,
  }),
  volcanic: B({
    id: 'volcanic',
    name: 'Volcanic',
    climate: 'warm',
    water: false,
    swatch: '#4a4240',
    ground: [hex('#514844'), hex('#6b615a'), hex('#34302e'), hex('#7a4c38')],
    rock: hex('#4a423e'),
    shore: hex('#3a3635'),
    relief: 'volcanic',
    flora: [
      { kind: 'rock', density: 0.05 },
      { kind: 'deadTree', density: 0.02 },
      { kind: 'shrub', density: 0.015, scale: [0.5, 0.7] },
    ],
    style: 'stone',
    arable: false,
  }),
  ocean: B({
    id: 'ocean',
    name: 'Ocean',
    climate: 'temperate',
    water: true,
    swatch: '#2a6a98',
    ground: [hex('#c9b787'), hex('#d9c99b'), hex('#a8986c'), hex('#8e9a7a')],
    rock: hex('#7b7a72'),
    shore: hex('#d8c793'),
    relief: 'water',
    flora: [],
    style: 'timber',
    arable: false,
  }),
  lake: B({
    id: 'lake',
    name: 'Lake',
    climate: 'temperate',
    water: true,
    swatch: '#3d7f86',
    ground: [hex('#8b8466'), hex('#a09a7a'), hex('#6c6650'), hex('#6f7a5a')],
    rock: hex('#7b7a72'),
    shore: hex('#b9ad86'),
    relief: 'water',
    flora: [],
    style: 'timber',
    arable: false,
  }),
};

export const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];

/** Numeric index for compact storage. */
export const BIOME_INDEX: Record<BiomeId, number> = Object.fromEntries(
  BIOME_IDS.map((id, i) => [id, i]),
) as Record<BiomeId, number>;

export const BIOME_LIST: Biome[] = BIOME_IDS.map((id) => BIOMES[id]);

export const MAX_LEVEL = 4;

export const LEVEL_NAMES = ['Lowland', 'Rolling', 'Hills', 'Highlands', 'Mountains'] as const;
