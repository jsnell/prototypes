'use strict';
// 10-game harness: does the route genuinely BRANCH?
// Test 1: do several DIFFERENT routes all win? (multiple viable paths exist)
// Test 2: does the winning route change with the per-run BOON? (no single dominant route
//         => routing is a real decision, and the seeded-roguelike idea has legs)

const { simulate, BOONS, has } = require('./engine2');

// ---- shared helpers ---------------------------------------------------------
const aCost = (s) => s.cfg.A.upBase * Math.pow(s.cfg.A.upGrow, s.A.up);
const canBuyA = (s) => s.A.up < s.cfg.A.maxUp && s.res.sparks >= aCost(s);
const bootstrapA = (s) => (s.A.up < 4 && canBuyA(s) ? { type: 'buyA' } : { type: 'click' });
const maintainA = (s) => (canBuyA(s) && s.res.sparks > aCost(s) * 4 ? { type: 'buyA' } : null);
const canPlace = (s, b) => {
  const d = s.cfg.C[b], n = b === 'house' ? s.C.houses : s.C.workshops;
  return d.needs.every((f) => has(s, f)) && n < d.max && s.res.bricks >= d.cost * (has(s, 'MASS_PRODUCTION') ? 0.5 : 1);
};
const buildCity = (s) => canPlace(s, 'workshop') ? { type: 'place', building: 'workshop' }
  : canPlace(s, 'house') ? { type: 'place', building: 'house' } : { type: 'idle' };

// ---- routes -----------------------------------------------------------------
// R1 CONSTRUCTION: A -> M -> K(bricks) -> B(blueprint) -> workshops.  Ignores E/F/R/P.
function rConstruction(s) {
  if (!has(s, 'AUTO_CLICKER')) return bootstrapA(s);
  const up = maintainA(s); if (up) return up;
  if (!has(s, 'ORE_EXPORT')) return { type: 'dig' };
  if (!has(s, 'BLUEPRINT_WORKSHOP')) return s.res.sparks > 300 ? { type: 'deposit' } : { type: 'idle' };
  return buildCity(s);
}

// R2 CONSTRUCTION+ENGINE: like R1 but funnel some Bank gold into Research for MASS_PRODUCTION
// (halves brick cost) before the build-out.
function rConstructionEngine(s) {
  if (!has(s, 'AUTO_CLICKER')) return bootstrapA(s);
  const up = maintainA(s); if (up) return up;
  if (!has(s, 'ORE_EXPORT')) return { type: 'dig' };
  if (!has(s, 'BLUEPRINT_WORKSHOP')) return s.res.sparks > 300 ? { type: 'deposit' } : { type: 'idle' };
  if (!has(s, 'MASS_PRODUCTION') && s.res.gold >= 100) return { type: 'research' }; // spend post-blueprint gold
  return buildCity(s);
}

// R3 AGRICULTURE: A -> E(power) -> sell ore via T -> Research(FERTILIZER) -> F(food) -> City.
// Skips the Bank and the Kiln entirely; gold comes from Trade.
function rAgriculture(s) {
  if (!has(s, 'AUTO_CLICKER')) return bootstrapA(s);
  const up = maintainA(s); if (up) return up;
  // need a little mining depth so we have ore to sell
  if (s.M.depth < 6) return { type: 'dig' };
  if (!has(s, 'GRID_ONLINE')) return { type: 'crank' };
  if (!has(s, 'FERTILIZER')) { // fund research by selling ore
    if (s.res.gold >= 100) return { type: 'research' };
    if (s.res.ore >= 50) return { type: 'sellOre' };
    return { type: 'idle' };
  }
  if (!has(s, 'FOOD_EXPORT')) return { type: 'plant' };           // bootstrap food to HARVESTER
  return { type: 'idle' };                                         // harvester + grid run the city passively
}

// R4 TRADE-ENGINE: earn gold fast via Reef+Trade, rush Research for MASS_PRODUCTION + FERTILIZER,
// then take whichever city path is cheaper. A "currency-first" route that leans on R/T/P.
function rTradeEngine(s) {
  if (!has(s, 'AUTO_CLICKER')) return bootstrapA(s);
  const up = maintainA(s); if (up) return up;
  if (s.M.depth < 8) return { type: 'dig' };
  // build a gold engine: sell pearls (high value) and ore
  if (s.res.pearls >= 5) return { type: 'sellPearls' };
  if (!has(s, 'FERTILIZER') || !has(s, 'MASS_PRODUCTION')) {
    if (s.res.gold >= 100) return { type: 'research' };
    if (s.res.ore >= 50) return { type: 'sellOre' };
    return { type: 'idle' };
  }
  // with FERTILIZER: drive agriculture via crank/plant if grid up, else buy food with surplus gold
  if (!has(s, 'GRID_ONLINE')) return { type: 'crank' };
  if (!has(s, 'FOOD_EXPORT')) return { type: 'plant' };
  if (s.res.gold >= 100) return { type: 'buyFood' };
  return { type: 'idle' };
}

// baseline: spread thin
function rRoundRobin(s) {
  switch (s.tick % 5) {
    case 0: return canBuyA(s) ? { type: 'buyA' } : { type: 'click' };
    case 1: return { type: 'dig' };
    case 2: return { type: 'crank' };
    case 3: return s.res.ore >= 50 ? { type: 'sellOre' } : (s.res.gold >= 100 ? { type: 'research' } : { type: 'idle' });
    default: return s.res.sparks > 300 ? { type: 'deposit' } : buildCity(s);
  }
}

const ROUTES = [
  ['construction', rConstruction],
  ['constr+engine', rConstructionEngine],
  ['agriculture', rAgriculture],
  ['trade-engine', rTradeEngine],
  ['roundRobin', rRoundRobin],
];

const MAX = 120000;
const mmss = (t) => { const s = t / 10; return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`; };
const cell = (r) => (r.won ? mmss(r.ticks) : 'FAIL').padStart(7);

// ---- Test 1: all routes, no boon -------------------------------------------
console.log('=== TEST 1: do multiple DIFFERENT routes win? (boon=NONE) ===\n');
ROUTES.forEach(([name, fn]) => {
  const r = simulate(fn, { maxTicks: MAX });
  console.log(`${name.padEnd(16)} ${cell(r)}   pop=${String(r.population).padStart(4)}  unlocks=${r.flags.length}`);
});

// ---- Test 2: boon sweep — does the WINNING route change with the seed? ------
console.log('\n=== TEST 2: boon sweep — which route wins under each seed? ===\n');
const header = 'boon          ' + ROUTES.map(([n]) => n.padStart(8)).join(' ') + '   | winner';
console.log(header);
console.log('-'.repeat(header.length));
const winnerCount = {};
for (const boon of BOONS) {
  const cells = [];
  let best = null;
  for (const [name, fn] of ROUTES) {
    const r = simulate(fn, { maxTicks: MAX, boon });
    cells.push(cell(r).padStart(8));
    if (r.won && (!best || r.ticks < best.ticks)) best = { name, ticks: r.ticks };
  }
  const w = best ? best.name : '(none)';
  winnerCount[w] = (winnerCount[w] || 0) + 1;
  console.log(boon.padEnd(13), cells.join(' '), '  |', w);
}

console.log('\n=== VERDICT ===');
const distinctWinners = Object.keys(winnerCount).filter((k) => k !== '(none)');
console.log('routes that win at least one seed:', distinctWinners.join(', ') || '(none)');
console.log('winner distribution:', JSON.stringify(winnerCount));
console.log(distinctWinners.length >= 2
  ? `-> BRANCHES: ${distinctWinners.length} different routes are each optimal under some seed.`
  : '-> DOES NOT BRANCH: one route dominates regardless of seed (needs rebalancing).');
