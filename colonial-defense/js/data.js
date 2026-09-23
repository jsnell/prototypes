'use strict';
// ---------- game data: buildings, factions, biomes, specials, meta ----------

const BUILDINGS = {
  hq:        { name: 'Command Dropship', w: 4, h: 3, hp: 4000, cost: 0, hidden: true,
               weapon: 'cannon', range: 84, rate: 1.4, dmg: 30, splash: 8, lightR: 70,
               desc: 'Lose this and the colony is lost.' },
  wall:      { name: 'Barricade', key: '1', w: 1, h: 1, hp: 520, cost: 4, drag: true,
               desc: 'Drag to lay a line. Hostiles have to chew through it.' },
  sentry:    { name: 'Sentry Gun', key: '2', w: 1, h: 1, hp: 240, cost: 35, turret: true,
               weapon: 'mg', range: 66, rate: 11, dmg: 3.2,
               desc: 'Automated gun. Accurate in the light, sprays blind in the dark.' },
  light:     { name: 'Floodlight', key: '3', w: 1, h: 1, hp: 120, cost: 14, lightR: 96,
               desc: 'Lights the dark. Turrets hit what they can see.' },
  extractor: { name: 'Ore Extractor', key: '4', w: 2, h: 2, hp: 420, cost: 60, income: 1.3, needsOre: true,
               desc: '+1.3/s materiel. Must sit on an ore deposit.' },
  habitat:   { name: 'Hab Dome', key: '5', w: 2, h: 2, hp: 300, cost: 50, income: 0.45, perSector: 2,
               desc: '+0.45/s materiel. Max 2 per sector — expand to grow.' },
  barracks:  { name: 'Marine Barracks', key: '6', w: 2, h: 2, hp: 650, cost: 110, marines: 5,
               desc: 'Keeps 5 marines posted at the frontier gaps. Free reinforcements.' },
  flamer:    { name: 'Incinerator', key: '7', w: 1, h: 1, hp: 380, cost: 60, turret: true,
               weapon: 'flame', range: 30, rate: 20, dmg: 1.1,
               desc: 'Short-range fire cone. Sets hostiles alight.' },
  mortar:    { name: 'Mortar Pit', key: '8', w: 2, h: 2, hp: 400, cost: 140, turret: true,
               weapon: 'mortar', range: 230, minRange: 36, rate: 0.55, dmg: 34, splash: 16,
               desc: 'Long-range indirect fire. Can\'t hit what\'s close.' },
  railgun:   { name: 'Rail Battery', key: '9', w: 2, h: 2, hp: 460, cost: 190, turret: true,
               weapon: 'rail', range: 250, rate: 0.35, dmg: 140,
               desc: 'Punches a line through everything in its path.' },
  dropsentry:{ name: 'Drop Sentry', w: 1, h: 1, hp: 500, cost: 0, hidden: true, turret: true,
               weapon: 'mg', range: 70, rate: 16, dmg: 3.2, life: 40 },
};
const BUILD_ORDER = ['wall', 'sentry', 'light', 'extractor', 'habitat', 'barracks', 'flamer', 'mortar', 'railgun'];

// ---- enemy factions -------------------------------------------------------
// behaviours: 'melee' | 'spit' | 'explode' | 'leap' | 'burrow' | 'boss'
const FACTIONS = {
  hive: {
    name: 'Xeno Hive', blood: 'acid', mult: 1.0,
    desc: 'Glossy black killers with acid for blood. Their corpses eat your walls.',
    types: {
      drone:   { sprite: 'drone',   hp: 14,  speed: 31, dmg: 5,  rate: 1.5, cost: 1,   w: 55, from: 1 },
      warrior: { sprite: 'warrior', hp: 55,  speed: 23, dmg: 12, rate: 1.2, cost: 4,   w: 10, from: 2 },
      spitter: { sprite: 'spitter', hp: 26,  speed: 19, dmg: 9,  rate: 0.7, cost: 3,   w: 7,  from: 3, beh: 'spit', range: 58 },
      crusher: { sprite: 'crusher', hp: 520, speed: 13, dmg: 70, rate: 0.8, cost: 30,  w: 2,  from: 5, bldMult: 2.5, big: true },
      queen:   { name: 'HIVE QUEEN', sprite: 'queen',   hp: 9000,speed: 8,  dmg: 160,rate: 0.7, cost: 0,   w: 0,  boss: true, beh: 'boss', minion: 'drone', big: true },
    },
  },
  husk: {
    name: 'Husk Plague', blood: 'red', mult: 1.25,
    desc: 'The previous colony, still walking. Endless, slow, and some of them burst.',
    types: {
      shambler:{ sprite: 'shambler', hp: 20,  speed: 13, dmg: 6,  rate: 1.0, cost: 0.7, w: 60, from: 1 },
      runner:  { sprite: 'runner',   hp: 10,  speed: 42, dmg: 4,  rate: 1.6, cost: 1,   w: 14, from: 1 },
      bloater: { sprite: 'bloater',  hp: 40,  speed: 11, dmg: 90, rate: 1.0, cost: 5,   w: 5,  from: 3, beh: 'explode', radius: 20 },
      brute:   { sprite: 'brute',    hp: 650, speed: 12, dmg: 60, rate: 0.7, cost: 30,  w: 2,  from: 5, bldMult: 2, big: true },
      abom:    { name: 'ABOMINATION', sprite: 'abom',     hp: 11000,speed: 7, dmg: 200,rate: 0.6, cost: 0,   w: 0,  boss: true, beh: 'boss', minion: 'shambler', big: true },
    },
  },
  swarm: {
    name: 'Chitin Swarm', blood: 'ichor', mult: 1.5,
    desc: 'A tide of skittering mites. Leapers vault walls, burrowers come up from below.',
    types: {
      mite:    { sprite: 'mite',    hp: 6,   speed: 40, dmg: 2,  rate: 2.0, cost: 0.45,w: 65, from: 1 },
      leaper:  { sprite: 'leaper',  hp: 24,  speed: 28, dmg: 8,  rate: 1.2, cost: 3,   w: 8,  from: 2, beh: 'leap' },
      burrower:{ sprite: 'burrower',hp: 60,  speed: 16, dmg: 14, rate: 1.0, cost: 6,   w: 4,  from: 4, beh: 'burrow' },
      spiker:  { sprite: 'spiker',  hp: 30,  speed: 18, dmg: 8,  rate: 0.8, cost: 3,   w: 6,  from: 3, beh: 'spit', range: 64 },
      brood:   { name: 'BROODMOTHER', sprite: 'brood',   hp: 8000,speed: 8,  dmg: 120,rate: 0.8, cost: 0,   w: 0,  boss: true, beh: 'boss', minion: 'mite', big: true },
    },
  },
};
const BLOOD = {
  acid:  { col: [0.32, 0.42, 0.04], decal: [0.16, 0.22, 0.02], emis: [0.12, 0.26, 0.01], glow: 1 },
  red:   { col: [0.45, 0.02, 0.02], decal: [0.28, 0.02, 0.02], emis: null, glow: 0 },
  ichor: { col: [0.15, 0.35, 0.75], decal: [0.08, 0.16, 0.35], emis: [0.02, 0.1, 0.3], glow: 0.5 },
  human: { col: [0.5, 0.03, 0.03], decal: [0.3, 0.02, 0.02], emis: null, glow: 0 },
};

// ---- biomes ---------------------------------------------------------------
const BIOMES = {
  barren:   { name: 'Barren Moon', desc: 'Grit, craters and a sky that never clears.',
              g1: '#6a5a49', g2: '#4a3f35', g3: '#7d6c58', r1: '#3b342e', r2: '#5b4f44', spec: 0.12,
              ore: [0.35, 0.85, 1.0], sun: [1.0, 0.86, 0.7], day: [0.36, 0.34, 0.36], night: [0.010, 0.013, 0.024],
              moon: [0.045, 0.065, 0.12], weather: 'dust', feature: 'craters' },
  ice:      { name: 'Ice Shelf', desc: 'Blinding by day. By night, the snow catches every flash.',
              g1: '#c9d3dc', g2: '#9fb0c0', g3: '#e6edf2', r1: '#5d6f80', r2: '#8699aa', spec: 0.5,
              ore: [1.0, 0.45, 0.3], sun: [0.95, 0.97, 1.0], day: [0.34, 0.38, 0.45], night: [0.008, 0.012, 0.03],
              moon: [0.045, 0.065, 0.13], weather: 'snow', feature: 'drifts' },
  jungle:   { name: 'Fungal Jungle', desc: 'Wet, rotten, and faintly glowing at night.',
              g1: '#3d5230', g2: '#2a3a22', g3: '#566b38', r1: '#2d3327', r2: '#46503a', spec: 0.3,
              ore: [0.95, 0.8, 0.25], sun: [1.0, 0.95, 0.8], day: [0.3, 0.36, 0.3], night: [0.006, 0.012, 0.012],
              moon: [0.025, 0.05, 0.05], weather: 'spores', feature: 'glowflora' },
  volcanic: { name: 'Ash Volcano', desc: 'Black glass and lava seams. It is never quite dark.',
              g1: '#302b2b', g2: '#1f1b1c', g3: '#443c38', r1: '#171415', r2: '#2c2626', spec: 0.35,
              ore: [0.6, 1.0, 0.4], sun: [1.0, 0.75, 0.6], day: [0.32, 0.27, 0.26], night: [0.02, 0.008, 0.006],
              moon: [0.07, 0.035, 0.025], weather: 'ash', feature: 'lava' },
};

const DIFFICULTIES = [
  { name: 'Recruit',        count: 1.0,  hp: 1.0,  elite: 0.0,  mult: 1.0 },
  { name: 'Veteran',        count: 1.3,  hp: 1.2,  elite: 0.06, mult: 1.6 },
  { name: 'Hardened',       count: 1.65, hp: 1.45, elite: 0.14, mult: 2.3 },
  { name: 'Nightmare',      count: 2.1,  hp: 1.75, elite: 0.25, mult: 3.2 },
  { name: 'Game Over, Man', count: 2.7,  hp: 2.1,  elite: 0.4,  mult: 4.5 },
];

// ---- specials (stratagems) --------------------------------------------------
const SPECIALS = {
  flare:   { name: 'Flare',           key: 'Q', cd: 7,   charges: 3, desc: 'Lights up an area for 25s. Turrets can see.' },
  tracker: { name: 'Tracker Pulse',   key: 'W', cd: 18,  desc: 'Pings every hostile on the map. Tagged targets are easy to hit.', noTarget: true },
  orbital: { name: 'Orbital Lance',   key: 'E', cd: 40,  desc: 'Precision strike from orbit after a short delay.' },
  napalm:  { name: 'Napalm Run',      key: 'R', cd: 55, desc: 'A burning line, laid from your base outward through the target.' },
  drop:    { name: 'Sentry Drop',     key: 'T', cd: 45, desc: 'Drops an armored sentry pod anywhere. Crushes what it lands on.' },
  gunship: { name: 'Gunship Strafe',  key: 'Y', cd: 35, desc: 'A walking line of cannon fire across the target.' },
  nuke:    { name: 'Dust Off',        key: 'U', cd: 9999, charges: 1, desc: 'Nuke it from orbit. Once per scenario. Mind your own buildings.' },
};
const SPECIAL_ORDER = ['flare', 'tracker', 'orbital', 'napalm', 'drop', 'gunship', 'nuke'];

// ---- Mk II upgrades (bought with scrip; everything above is available from the start) ----
const UPGRADES = {
  wall:      { name: 'Plasteel Barricade', cost: 60,  desc: 'Double HP, and acid blood no longer eats it.', b: d => { d.hp = 1100; d.acidProof = true; } },
  sentry:    { name: 'Twin-Link Sentry',   cost: 110, desc: '+55% fire rate and a gun-mounted spotlight: never fires blind, and lights what it shoots.', b: d => { d.rate = 17; d.spot = true; } },
  light:     { name: 'Arc Floodlight',     cost: 70,  desc: '+45% radius. Hostiles caught in the glare are dazzled and slowed 30%.', b: d => { d.lightR = 140; d.dazzle = true; } },
  extractor: { name: 'Deep-Core Extractor',cost: 90,  desc: '+60% materiel per extractor.', b: d => { d.income = 2.1; } },
  habitat:   { name: 'Arcology Dome',      cost: 80,  desc: '+55% income and 3 domes per sector.', b: d => { d.income = 0.7; d.perSector = 3; } },
  barracks:  { name: 'Smartgun Squad',     cost: 140, desc: '8 marines per barracks with target-tracking smartguns (hit in the dark) and heavier armour.', b: d => { d.marines = 8; d.smart = true; } },
  flamer:    { name: 'Napalm Projector',   cost: 120, desc: '+40% range, and it leaves the ground burning behind its targets.', b: d => { d.range = 42; d.napalm = true; } },
  mortar:    { name: 'Cluster Mortar',     cost: 150, desc: 'Every shell scatters four bomblets on impact.', b: d => { d.cluster = true; } },
  railgun:   { name: 'Overcharged Rail',   cost: 200, desc: '+60% fire rate, and every target it pierces detonates.', b: d => { d.rate = 0.56; d.detonate = true; } },
  flare:     { special: true, name: 'Starshell',         cost: 70,  desc: '5 charges; brighter, wider and burns 40% longer.', s: d => { d.charges = 5; } },
  tracker:   { special: true, name: 'Target Designator', cost: 100, desc: 'Tags last 14s and tagged hostiles take +50% damage from everything.', s: d => { } },
  orbital:   { special: true, name: 'Orbital Barrage',   cost: 160, desc: 'Three lances walk across the target instead of one.', s: d => { } },
  napalm:    { special: true, name: 'Double Napalm Run', cost: 130, desc: 'Two jets, two parallel burning lines, and it burns longer.', s: d => { } },
  drop:      { special: true, name: 'Sentry Drop Trio',  cost: 150, desc: 'Three pods instead of one.', s: d => { } },
  gunship:   { special: true, name: 'AC-130 Strafe',     cost: 140, desc: 'Nearly twice the shells, heavier rounds.', s: d => { } },
  nuke:      { special: true, name: 'Second Warhead',    cost: 400, desc: 'Dust Off can be called twice per scenario.', s: d => { d.charges = 2; } },
};
const UPGRADE_UNLOCKS = Object.entries(UPGRADES).map(([k, u]) => ({
  id: 'u_' + k, cat: u.special ? 'Stratagem upgrades' : 'Building upgrades',
  name: u.name + ' <span style="color:var(--dim)">(' + (u.special ? SPECIALS[k] : BUILDINGS[k]).name + ' Mk II)</span>', cost: u.cost, desc: u.desc,
}));
// scrip refunds for unlocks that no longer exist (everything they unlocked is now free)
const LEGACY_REFUND = { b_flamer: 50, b_mortar: 100, b_railgun: 180, s_napalm: 70, s_drop: 90, s_gunship: 120, s_nuke: 350 };

// ---- meta progression ------------------------------------------------------
const UNLOCKS = [
  { id: 'fac_husk',   cat: 'Factions',     name: 'Husk Plague',      cost: 120, desc: FACTIONS.husk.desc + ' (x1.25 scrip)' },
  { id: 'fac_swarm',  cat: 'Factions',     name: 'Chitin Swarm',     cost: 260, desc: FACTIONS.swarm.desc + ' (x1.5 scrip)' },
  { id: 'bio_ice',    cat: 'Biomes',       name: 'Ice Shelf',        cost: 60,  desc: BIOMES.ice.desc },
  { id: 'bio_jungle', cat: 'Biomes',       name: 'Fungal Jungle',    cost: 110, desc: BIOMES.jungle.desc },
  { id: 'bio_volcanic',cat: 'Biomes',      name: 'Ash Volcano',      cost: 170, desc: BIOMES.volcanic.desc },
  { id: 'dif_1',      cat: 'Difficulty',   name: 'Veteran',          cost: 50,  desc: 'More of them, tougher, a few elites. x1.6 scrip.' },
  { id: 'dif_2',      cat: 'Difficulty',   name: 'Hardened',         cost: 140, desc: 'x2.3 scrip.', req: 'dif_1' },
  { id: 'dif_3',      cat: 'Difficulty',   name: 'Nightmare',        cost: 280, desc: 'x3.2 scrip.', req: 'dif_2' },
  { id: 'dif_4',      cat: 'Difficulty',   name: 'Game Over, Man',   cost: 480, desc: 'x4.5 scrip. Good luck.', req: 'dif_3' },
  ...UPGRADE_UNLOCKS,
  { id: 'x_cache1',   cat: 'Boosters',     name: 'Supply Cache I',   cost: 40,  desc: '+100 starting materiel.' },
  { id: 'x_cache2',   cat: 'Boosters',     name: 'Supply Cache II',  cost: 90,  desc: '+100 more starting materiel.', req: 'x_cache1' },
  { id: 'x_cache3',   cat: 'Boosters',     name: 'Supply Cache III', cost: 160, desc: '+150 more starting materiel.', req: 'x_cache2' },
  { id: 'x_survey',   cat: 'Boosters',     name: 'Forward Survey',   cost: 130, desc: 'Start with the richest neighbouring sector already claimed.' },
  { id: 'x_prefab',   cat: 'Boosters',     name: 'Prefab Defenses',  cost: 110, desc: 'Start with the home sector\'s gaps walled and guarded.' },
  { id: 'x_relay',    cat: 'Boosters',     name: 'Orbital Relay',    cost: 150, desc: 'Stratagem cooldowns -25%.' },
];

const WAVES = 10;
const FIRST_LULL = 105, LULL = 70;
