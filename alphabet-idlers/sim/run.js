'use strict';
// Experiment harness: run different play strategies against the engine and measure.
// Question under test: does ORDER matter, and do the structural claims hold?

const { simulate, createState, step } = require('./engine');

// ---- shared action helpers --------------------------------------------------
const aNextCost = (s) => s.cfg.A.upgradeBaseCost * Math.pow(s.cfg.A.upgradeCostGrowth, s.A.upgrades);
const canBuyA = (s) => s.A.upgrades < s.cfg.A.maxUpgrades && s.res.sparks >= aNextCost(s);

function bootstrapA(s) {
  if (s.A.upgrades < 4 && canBuyA(s)) return { type: 'buyA' };
  return { type: 'click' };
}
function maintainA(s) { // opportunistic throughput upgrades once auto-clicking
  if (canBuyA(s) && s.res.sparks > aNextCost(s) * 3) return { type: 'buyA' };
  return null;
}
const canPlace = (s, b) => {
  const def = s.cfg.C[b];
  const built = b === 'house' ? s.C.houses : s.C.workshops;
  return def.needs.every((f) => s.flags.has(f)) && built < def.max && s.res.bricks >= def.cost;
};
function buildCity(s) { // workshops are more brick-efficient (1.5 pop/brick vs 0.5); prefer them
  if (canPlace(s, 'workshop')) return { type: 'place', building: 'workshop' };
  if (canPlace(s, 'house')) return { type: 'place', building: 'house' };
  return { type: 'idle' }; // wait for bricks / unlocks
}

// ---- strategies -------------------------------------------------------------
// Parameterized router: the spark `reserve` kept for the Kiln is the core knob.
function makeRouter({ reserve = 300, mFirst = false } = {}) {
  return function router(s) {
    if (mFirst && !s.flags.has('ORE_EXPORT') && !s.flags.has('AUTO_CLICKER')) return { type: 'dig' };
    if (!s.flags.has('AUTO_CLICKER')) return bootstrapA(s);
    const up = maintainA(s); if (up) return up;
    if (!s.flags.has('ORE_EXPORT')) return { type: 'dig' };
    if (!s.flags.has('BLUEPRINT_WORKSHOP')) {
      if (s.res.sparks > reserve) return { type: 'deposit' }; // grow Bank, keep Kiln fed
      return { type: 'idle' };
    }
    return buildCity(s);
  };
}

function serialNaive(s) { // finish each game before starting the next (ignores parallelism)
  if (!s.flags.has('AUTO_CLICKER')) return bootstrapA(s);
  if (s.A.upgrades < s.cfg.A.maxUpgrades) return canBuyA(s) ? { type: 'buyA' } : { type: 'click' };
  if (!s.flags.has('BLUEPRINT_WORKSHOP')) return s.res.sparks >= 200 ? { type: 'deposit' } : { type: 'idle' };
  if (!s.flags.has('ORE_EXPORT')) return { type: 'dig' };           // M (and thus K) only starts now
  return buildCity(s);
}

function roundRobin(s) { // spread attention thin across all games every 4 ticks
  switch (s.tick % 4) {
    case 0: return canBuyA(s) ? { type: 'buyA' } : { type: 'click' };
    case 1: return { type: 'dig' };
    case 2: return s.res.sparks > 0 ? { type: 'deposit' } : { type: 'idle' };
    default: return buildCity(s);
  }
}

// ---- reporting --------------------------------------------------------------
const MAX = 60000; // ~100 min at 10 ticks/s — generous ceiling
const mmss = (ticks) => {
  const sec = ticks / 10; // 10 ticks/sec
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

function row(name, r) {
  const status = r.won ? mmss(r.ticks).padStart(6) : '  FAIL';
  return `${name.padEnd(22)} ${status}   pop=${String(r.population).padStart(4)}  depth=${String(r.maxDepth).padStart(2)}  unlocks=${r.flags.length}/7`;
}

console.log('=== STRATEGY COMPARISON (does order matter?) ===\n');
const strategies = [
  ['interleaved (reserve 300)', makeRouter({ reserve: 300 })],
  ['bankRush (reserve 0)',      makeRouter({ reserve: 0 })],   // starve the Kiln to rush Bank
  ['kilnGreedy (reserve 800)',  makeRouter({ reserve: 800 })], // hoard sparks for Kiln, Bank late
  ['mFirst (dig before A)',     makeRouter({ reserve: 300, mFirst: true })],
  ['serialNaive',               serialNaive],
  ['roundRobin',                roundRobin],
];
const results = strategies.map(([name, fn]) => [name, simulate(fn, { maxTicks: MAX })]);
results.forEach(([name, r]) => console.log(row(name, r)));

const winners = results.filter(([, r]) => r.won).map(([, r]) => r.ticks);
if (winners.length) {
  const best = Math.min(...winners), worst = Math.max(...winners);
  console.log(`\nspread among winners: ${mmss(best)} .. ${mmss(worst)}  (${(worst / best).toFixed(2)}x)`);
}

// ---- the intended route's unlock timeline -----------------------------------
console.log('\n=== UNLOCK TIMELINE — interleaved (is the route legible?) ===\n');
{
  const r = simulate(makeRouter({ reserve: 300 }), { maxTicks: MAX });
  r.timeline.forEach((e) => console.log(`  ${mmss(e.tick).padStart(6)}  ${e.flag}`));
  console.log(`  ${mmss(r.ticks).padStart(6)}  *** WIN (pop ${r.population}) ***`);
}

// ---- structural experiments (do the claimed dependencies hold?) -------------
console.log('\n=== STRUCTURAL EXPERIMENTS (are the paths load-bearing?) ===\n');
function expect(label, cond) { console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}`); }

const base = makeRouter({ reserve: 300 });
const noBricks = simulate(base, { maxTicks: MAX, disable: ['BRICKS_EXPORT'] });
const noBlueprint = simulate(base, { maxTicks: MAX, disable: ['BLUEPRINT_WORKSHOP'] });
const noCapRaise = simulate(base, { maxTicks: MAX, disable: ['MINE_CAP_RAISE'] });
const full = simulate(base, { maxTicks: MAX });

expect('Kiln path mandatory: no BRICKS_EXPORT -> cannot win', !noBricks.won && noBricks.population === 0);
expect('Diamond holds: no BLUEPRINT -> houses cap pop at 200, cannot win',
       !noBlueprint.won && noBlueprint.population <= 200);
expect('Broken cycle real: no MINE_CAP_RAISE -> Mine stuck at depth 10',
       noCapRaise.maxDepth === 10);
expect('Cap-raise is valuable: it revives Mine to depth 25',
       full.maxDepth === 25);
const capPenalty = noCapRaise.won ? (noCapRaise.ticks / full.ticks) : Infinity;
console.log(`  [info] losing the cap-raise costs ${noCapRaise.won ? capPenalty.toFixed(2) + 'x time' : 'the run (timeout)'}`);

// ---- soft-gate experiment (A -> B): is auto-clicker actually load-bearing? ---
console.log('\n=== SOFT-GATE: time to BLUEPRINT with vs without AUTO_CLICKER ===\n');
function timeToBlueprint(opts) {
  const s = createState(opts);
  const strat = (st) => {
    if (!opts.disable && !st.flags.has('AUTO_CLICKER')) return bootstrapA(st);
    if (canBuyA(st) && st.res.sparks > aNextCost(st) * 3) return { type: 'buyA' };
    // hand-feed: when starved of sparks, click; otherwise deposit into the Bank
    if (st.res.sparks < 200) return { type: 'click' };
    return { type: 'deposit' };
  };
  while (!s.flags.has('BLUEPRINT_WORKSHOP') && s.tick < MAX) step(s, strat(s));
  return s.flags.has('BLUEPRINT_WORKSHOP') ? s.tick : null;
}
const withAuto = timeToBlueprint({ maxTicks: MAX });
const withoutAuto = timeToBlueprint({ maxTicks: MAX, disable: ['AUTO_CLICKER'] });
console.log(`  with AUTO_CLICKER:    ${withAuto != null ? mmss(withAuto) : 'FAIL'}`);
console.log(`  without (manual feed): ${withoutAuto != null ? mmss(withoutAuto) : 'FAIL/timeout'}`);
if (withAuto && withoutAuto) console.log(`  -> soft-gate makes the Bank ${(withoutAuto / withAuto).toFixed(1)}x slower without automation`);
else if (withAuto && !withoutAuto) console.log(`  -> without automation the Bank never reaches threshold within ${mmss(MAX)}`);
