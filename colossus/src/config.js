// Tunables for COLOSSUS. Everything balance-related lives here.

export const MAP_W = 128;          // world units along x (1 unit = 1 voxel)
export const MAP_D = 176;          // world units along z (tank starts south, swarm base north)
export const CHUNK = 16;
export const BASE_Y = -7;          // bottom of the diorama block
export const WATER_LEVEL = 4.45;   // columns with height <= 4 are under water

export const UNIT_TYPES = ['scout', 'buggy', 'rocket', 'mortar', 'sapper', 'jammer'];

// pref = preferred engagement distance from the tank's hull
export const UNITS = {
  scout: {
    name: 'Zipper', role: 'Hover scout', key: 'KeyZ', label: 'Z',
    desc: 'Fast & cheap. Hovers over water. Peppers shields with a peashooter.',
    hp: 22, speed: 7.0, range: 13, pref: 8, dmg: 3, rof: 0.2, cost: 20, build: 1.6,
    weapon: 'mg', hover: true,
  },
  buggy: {
    name: 'Plinker', role: 'Gun buggy', key: 'KeyX', label: 'X',
    desc: 'The workhorse. Steady cannon fire from mid range.',
    hp: 40, speed: 4.6, range: 18, pref: 12, dmg: 14, rof: 1.3, cost: 35, build: 2.4,
    weapon: 'gun',
  },
  rocket: {
    name: 'Whizzer', role: 'Rocket truck', key: 'KeyC', label: 'C',
    desc: 'Long-range missiles that wreck systems. Flak can shoot them down.',
    hp: 26, speed: 4.0, range: 32, pref: 26, dmg: 50, rof: 4.5, cost: 55, build: 3.2,
    weapon: 'missile',
  },
  mortar: {
    name: 'Lobber', role: 'Mortar', key: 'KeyV', label: 'V',
    desc: 'Outranges even the main gun and hits from above. Fragile; misses a moving target.',
    hp: 24, speed: 3.1, range: 66, minRange: 14, pref: 57, dmg: 55, rof: 7.5, cost: 65, build: 3.8,
    weapon: 'mortar',
  },
  sapper: {
    name: 'Boomer', role: 'Sapper', key: 'KeyB', label: 'B',
    desc: 'Kamikaze cart. Slips under shields, rams the Colossus and blows up. Shreds treads.',
    hp: 30, speed: 5.8, range: 1.2, pref: 0, dmg: 170, cost: 45, build: 2.4,
    weapon: 'bomb',
  },
  jammer: {
    name: 'Fuzzer', role: 'EMP jammer', key: 'KeyN', label: 'N',
    desc: 'Drains the facing shield and scrambles a system while in range.',
    hp: 48, speed: 4.0, range: 15, pref: 9, cost: 70, build: 3.8,
    weapon: 'emp',
  },
};

export const SYSTEMS = ['reactor', 'drive', 'cannon', 'flak', 'shield', 'repair'];
export const POWERED = ['drive', 'cannon', 'flak', 'shield', 'repair'];
export const SYSTEM_INFO = {
  reactor: { name: 'Reactor', icon: '⚛️', hint: 'Makes power. Hit from behind.' },
  drive: { name: 'Treads', icon: '⚙️', hint: 'Speed & turning. Hit from the sides.' },
  cannon: { name: 'Main Gun', icon: '💥', hint: 'Big splash, slow reload. Click to aim.' },
  flak: { name: 'Flak', icon: '✴️', hint: 'Auto-guns. Shred swarmers, swat missiles.' },
  shield: { name: 'Shields', icon: '🛡️', hint: 'Four facings. Regen goes where you focus.' },
  repair: { name: 'Repair', icon: '🔧', hint: 'Drones fix the worst system (or the one you pin).' },
};

export const TANK = {
  hull: 2600,
  armor: 2,                    // flat reduction per hull hit
  halfW: 4.7, halfL: 6.6,      // hull OBB (xz)
  bubble: [5.9, 4.3, 7.9],     // shield ellipsoid radii (x, y, z)
  reactorBase: 10, emergency: 4, overdrive: 3,
  sysArmor: { reactor: 0.7, drive: 1, cannon: 0.9, flak: 1.1, shield: 1, repair: 1 }, // system damage multipliers
  maxPower: { drive: 4, cannon: 4, flak: 4, shield: 4, repair: 3 },
  speed: [0, 0.55, 0.9, 1.2, 1.45],
  turn: [0.08, 0.2, 0.26, 0.31, 0.35],
  reload: [Infinity, 8, 6, 4.6, 3.6],
  flakMul: [0, 1, 1.6, 2.1, 2.5],
  flakRate: 2.0, flakRange: 20, flakDmg: 4,
  shieldMax: 120,
  shieldRegen: [-5, 8, 14, 19, 23],
  repair: [0, 5, 9, 12],
  cannonRange: 62, cannonMin: 8, cannonDmg: 110, cannonSplash: 4.0,
  ramDps: 80,
  heatOverdrive: 8, heatShot: 6, heatCool: 5, heatCoolOD: 0,
};

// Hit-location tables: where does damage land, by the side it comes from.
export const HIT_TABLES = {
  front: { cannon: 0.28, drive: 0.2, shield: 0.1, hull: 0.42 },
  side: { drive: 0.4, flak: 0.25, hull: 0.35 },
  rear: { reactor: 0.36, drive: 0.18, repair: 0.18, hull: 0.28 },
  top: { flak: 0.24, shield: 0.24, cannon: 0.14, reactor: 0.14, repair: 0.1, hull: 0.14 },
};

export const PRESETS = {
  KeyZ: { name: 'Assault', want: { cannon: 4, flak: 3, shield: 2, drive: 2, repair: 1 }, cut: ['repair', 'drive', 'flak', 'shield', 'cannon'] },
  KeyX: { name: 'Cruise', want: { drive: 4, shield: 3, flak: 2, cannon: 2, repair: 1 }, cut: ['repair', 'cannon', 'flak', 'shield', 'drive'] },
  KeyC: { name: 'Turtle', want: { shield: 4, flak: 4, repair: 3, cannon: 1, drive: 0 }, cut: ['cannon', 'repair', 'flak', 'shield', 'drive'] },
};

export const STRUCTS = {
  factory: { hp: 1300, half: 4, height: 5.5, name: 'Factory' },
  cp: { hp: 2400, half: 3.6, height: 5, name: 'Command Post' },
};

export const SWARM = { startSupply: 300, baseIncome: 10, perFactory: 4, cap: 160 };

// forward screen the swarm starts the game with
export const START_ARMY = { buggy: 5, scout: 3, rocket: 2, mortar: 1, jammer: 1 };

// Difficulty scales the AI side, whichever that is.
export const DIFF = {
  easy: { aiIncome: 0.72, aiHull: 0.8, think: 2.2, smart: 0 },
  normal: { aiIncome: 1.0, aiHull: 1.0, think: 1.0, smart: 1 },
  hard: { aiIncome: 1.3, aiHull: 1.25, think: 0.5, smart: 2 },
};

export const TEAM_COLORS = {
  tank: 0xf2b33d,
  swarm: 0x2fb3a8,
};
