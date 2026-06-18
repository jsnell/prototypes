'use strict';
// Alphabet Idlers — headless simulation engine (5-game vertical slice: A/M/B/K/C).
// Deterministic. No UI. One manual action per tick + passive production every tick.
// The point: let scripted strategies play it so we can measure whether ROUTING matters.

const CONFIG = {
  // A — Automaton (clicker)
  A: {
    startClickPower: 1,
    upgradeBaseCost: 10,      // cost = base * 2^level
    upgradeCostGrowth: 2,
    powerPerUpgrade: 2,       // clickPower *= 2
    maxUpgrades: 8,           // saturates here (clickPower up to 256)
    autoClickThreshold: 200,  // cumulative sparks -> emit AUTO_CLICKER
  },
  // M — Mine (depth idler)
  M: {
    digPower: 1,
    depthCost: 8,             // progress needed per depth level
    baseCap: 10,              // manual cap until MINE_CAP_RAISE
    raisedCap: 25,
    oreYieldPerDepth: 0.2,    // ore/tick = depth * this
    drillDepth: 5,            // reaching this depth -> emit DRILL (auto-dig)
    exportDepth: 10,          // reaching this depth -> emit ORE_EXPORT
  },
  // B — Bank (compounding)
  B: {
    depositSize: 200,         // sparks moved per manual deposit
    baseRate: 0.002,          // gold/tick per unit principal
    boostedRate: 0.006,       // after RATE_BOOST
    blueprintThreshold: 10000,// cumulative gold -> emit BLUEPRINT_WORKSHOP + RATE_BOOST
  },
  // K — Kiln (production chain) — gated by ORE_EXPORT
  K: {
    orePerBrick: 2,
    sparksPerBrick: 1,
    buildRate: 2,             // max bricks/tick
    exportThreshold: 200,     // cumulative bricks -> emit BRICKS_EXPORT + MINE_CAP_RAISE
  },
  // C — City (terminal sink). BRICKS_EXPORT gates ALL construction (bricks are the
  // construction material); the Workshop additionally needs the Bank's BLUEPRINT.
  C: {
    house:    { cost: 10, pop: 5,  max: 40, needs: ['BRICKS_EXPORT'] },
    workshop: { cost: 40, pop: 60, max: 20, needs: ['BRICKS_EXPORT', 'BLUEPRINT_WORKSHOP'] },
    winPopulation: 1000,
  },
};

function createState(opts = {}) {
  return {
    tick: 0,
    cfg: opts.cfg || CONFIG,
    res: { sparks: 0, gold: 0, ore: 0, bricks: 0, population: 0 },
    cum: { sparks: 0, gold: 0, bricks: 0 },           // cumulative (threshold tracking)
    flags: new Set(),                                  // unlock flags
    log: [],                                           // [{tick, flag}]
    A: { clickPower: opts.cfg ? opts.cfg.A.startClickPower : CONFIG.A.startClickPower, upgrades: 0 },
    M: { depth: 0, progress: 0 },
    B: { principal: 0 },
    K: {},
    C: { houses: 0, workshops: 0 },
    done: false,
    // experiment knobs: disable a path to prove it's load-bearing
    disabled: new Set(opts.disable || []),
  };
}

function emit(s, flag) {
  if (!s.flags.has(flag) && !s.disabled.has(flag)) {
    s.flags.add(flag);
    s.log.push({ tick: s.tick, flag });
  }
}

// ---- manual actions (one per tick) -----------------------------------------
function applyAction(s, action) {
  if (!action || action.type === 'idle') return;
  const C = s.cfg;
  switch (action.type) {
    case 'click': { // A
      s.res.sparks += s.A.clickPower;
      s.cum.sparks += s.A.clickPower;
      break;
    }
    case 'buyA': { // upgrade A click power
      if (s.A.upgrades >= C.A.maxUpgrades) break;
      const cost = C.A.upgradeBaseCost * Math.pow(C.A.upgradeCostGrowth, s.A.upgrades);
      if (s.res.sparks >= cost) {
        s.res.sparks -= cost;
        s.A.upgrades += 1;
        s.A.clickPower *= C.A.powerPerUpgrade;
      }
      break;
    }
    case 'dig': { // M
      const cap = s.flags.has('MINE_CAP_RAISE') ? C.M.raisedCap : C.M.baseCap;
      if (s.M.depth < cap) {
        s.M.progress += C.M.digPower;
        if (s.M.progress >= C.M.depthCost) { s.M.progress = 0; s.M.depth += 1; }
      }
      break;
    }
    case 'deposit': { // B  (needs spare sparks; soft-gated behind AUTO_CLICKER)
      const amt = Math.min(C.B.depositSize, s.res.sparks);
      s.res.sparks -= amt;
      s.B.principal += amt;
      break;
    }
    case 'place': { // C
      const def = C.C[action.building];
      if (!def) break;
      if (def.needs && !def.needs.every((f) => s.flags.has(f))) break;
      const built = action.building === 'house' ? s.C.houses : s.C.workshops;
      if (built >= def.max) break;
      if (s.res.bricks >= def.cost) {
        s.res.bricks -= def.cost;
        if (action.building === 'house') s.C.houses += 1; else s.C.workshops += 1;
        s.res.population += def.pop;
      }
      break;
    }
  }
}

// ---- passive production (every tick) ---------------------------------------
function applyPassive(s) {
  const C = s.cfg;

  // A: auto-clicker
  if (s.flags.has('AUTO_CLICKER')) {
    s.res.sparks += s.A.clickPower;
    s.cum.sparks += s.A.clickPower;
  }

  // M: drill auto-dig + ore production from depth
  if (s.flags.has('DRILL')) {
    const cap = s.flags.has('MINE_CAP_RAISE') ? C.M.raisedCap : C.M.baseCap;
    if (s.M.depth < cap) {
      s.M.progress += C.M.digPower;
      if (s.M.progress >= C.M.depthCost) { s.M.progress = 0; s.M.depth += 1; }
    }
  }
  s.res.ore += s.M.depth * C.M.oreYieldPerDepth;

  // B: compounding interest
  const r = s.flags.has('RATE_BOOST') ? C.B.boostedRate : C.B.baseRate;
  const g = s.B.principal * r;
  s.res.gold += g;
  s.cum.gold += g;

  // K: kiln consumes ore + sparks -> bricks (gated by ORE_EXPORT)
  if (s.flags.has('ORE_EXPORT')) {
    const byOre = s.res.ore / C.K.orePerBrick;
    const bySparks = s.res.sparks / C.K.sparksPerBrick;
    const made = Math.min(C.K.buildRate, byOre, bySparks);
    if (made > 0) {
      s.res.ore -= made * C.K.orePerBrick;
      s.res.sparks -= made * C.K.sparksPerBrick;
      s.res.bricks += made;
      s.cum.bricks += made;
    }
  }
}

// ---- thresholds / emits -----------------------------------------------------
function checkThresholds(s) {
  const C = s.cfg;
  if (s.cum.sparks >= C.A.autoClickThreshold) emit(s, 'AUTO_CLICKER');
  if (s.M.depth >= C.M.drillDepth)  emit(s, 'DRILL');
  if (s.M.depth >= C.M.exportDepth) emit(s, 'ORE_EXPORT');
  if (s.cum.gold >= C.B.blueprintThreshold) { emit(s, 'BLUEPRINT_WORKSHOP'); emit(s, 'RATE_BOOST'); }
  if (s.cum.bricks >= C.K.exportThreshold) { emit(s, 'BRICKS_EXPORT'); emit(s, 'MINE_CAP_RAISE'); }
  if (s.res.population >= C.C.winPopulation) s.done = true;
}

function step(s, action) {
  applyAction(s, action);
  applyPassive(s);
  checkThresholds(s);
  s.tick += 1;
  return s;
}

// Run a strategy (fn(state)->action) until win or maxTicks. Returns a result record.
function simulate(strategyFn, opts = {}) {
  const s = createState(opts);
  const maxTicks = opts.maxTicks || 200000;
  while (!s.done && s.tick < maxTicks) {
    step(s, strategyFn(s));
  }
  return {
    won: s.done,
    ticks: s.tick,
    population: Math.floor(s.res.population),
    maxDepth: s.M.depth,
    flags: [...s.flags],
    timeline: s.log,
    state: s,
  };
}

module.exports = { CONFIG, createState, step, simulate };
