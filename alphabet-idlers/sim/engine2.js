'use strict';
// Alphabet Idlers — headless engine v2 (10-game slice: A/M/E/R/B/K/T/P/F/C).
// Goal of this version: enough nodes + substitutable paths that ROUTING can branch.
// Key structure:
//   - 4 free entry points (A sparks, M ore, E power, R pearls)
//   - City (C) grows two substitutable ways: construction (bricks->buildings) OR agriculture (food)
//   - gold has THREE sources (Bank compounding / Trade selling / Reef+Trade) -> Bank not mandatory
//   - Research (P) is an engine: gold->science unlocks discounts/gates that help BOTH paths
//   - a per-run BOON (seed) perturbs one game, to test whether the best route shifts

const BOONS = ['NONE', 'RICH_VEIN', 'FERTILE', 'BULL_MARKET', 'TRADE_WINDS', 'POWER_SURGE'];

function boonMult(s) {
  const b = s.boon;
  return {
    ore:   b === 'RICH_VEIN' ? 2 : 1,
    farm:  b === 'FERTILE' ? 2 : 1,
    bank:  b === 'BULL_MARKET' ? 2 : 1,
    trade: b === 'TRADE_WINDS' ? 2 : 1,
    power: b === 'POWER_SURGE' ? 2 : 1,
  };
}

const CFG = {
  A: { startPower: 1, upBase: 10, upGrow: 2, upMult: 2, maxUp: 8, autoAt: 200 },
  M: { dig: 1, depthCost: 8, baseCap: 10, raisedCap: 25, yield: 0.2, drillAt: 5, exportAt: 10 },
  E: { crank: 1, onlineAt: 50, sparkRate: 3, powerPerSpark: 2 }, // grid: sparks->power
  R: { baseFish: 0.04, fisheryMult: 4, fisheryAt: 20 },          // pearls/tick
  B: { deposit: 200, rate: 0.002, boostRate: 0.006, blueprintAt: 10000 },
  K: { orePerBrick: 2, sparkPerBrick: 1, rate: 2, exportAt: 200 },
  T: { oreSell: 50, oreRate: 2, pearlSell: 5, pearlRate: 25, buyGold: 100, foodPerBuy: 8,
       routeBonus: 2, routeAt: 2000 },                          // tradeGold cumulative
  P: { goldPerResearch: 100, sciPerResearch: 10,
       fertilizerAt: 50, massProdAt: 150, superAt: 300 },
  F: { rate: 10, fertMult: 1 },                                 // power->food (needs FERTILIZER); rate>grid so power binds
  C: { house: { cost: 10, pop: 5, max: 40, needs: ['BRICKS_EXPORT'] },
       workshop: { cost: 40, pop: 60, max: 20, needs: ['BRICKS_EXPORT', 'BLUEPRINT_WORKSHOP'] },
       foodGrowthCap: 12, popPerFood: 1, win: 1000 },
};

function createState(opts = {}) {
  return {
    tick: 0, boon: opts.boon || 'NONE', cfg: CFG,
    res: { sparks: 0, ore: 0, gold: 0, bricks: 0, power: 0, food: 0, pearls: 0, science: 0, population: 0 },
    cum: { sparks: 0, gold: 0, bricks: 0, power: 0, food: 0, pearls: 0, tradeGold: 0 },
    flags: new Set(), log: [],
    A: { power: CFG.A.startPower, up: 0 },
    M: { depth: 0, prog: 0 }, B: { principal: 0 }, C: { houses: 0, workshops: 0 },
    done: false, disabled: new Set(opts.disable || []),
  };
}

function emit(s, flag) {
  if (!s.flags.has(flag) && !s.disabled.has(flag)) { s.flags.add(flag); s.log.push({ tick: s.tick, flag }); }
}
const has = (s, f) => s.flags.has(f);

// ---- manual actions (one per tick) -----------------------------------------
function applyAction(s, a) {
  if (!a || a.type === 'idle') return;
  const C = s.cfg, bm = boonMult(s);
  switch (a.type) {
    case 'click': s.res.sparks += s.A.power; s.cum.sparks += s.A.power; break;
    case 'buyA': {
      if (s.A.up >= C.A.maxUp) break;
      const cost = C.A.upBase * Math.pow(C.A.upGrow, s.A.up);
      if (s.res.sparks >= cost) { s.res.sparks -= cost; s.A.up++; s.A.power *= C.A.upMult; }
      break;
    }
    case 'dig': {
      const cap = has(s, 'MINE_CAP_RAISE') ? C.M.raisedCap : C.M.baseCap;
      if (s.M.depth < cap && (s.M.prog += C.M.dig) >= C.M.depthCost) { s.M.prog = 0; s.M.depth++; }
      break;
    }
    case 'crank': s.res.power += C.E.crank; s.cum.power += C.E.crank; break;
    case 'deposit': { const amt = Math.min(C.B.deposit, s.res.sparks); s.res.sparks -= amt; s.B.principal += amt; break; }
    case 'research': {
      if (s.res.gold >= C.P.goldPerResearch) { s.res.gold -= C.P.goldPerResearch; s.res.science += C.P.sciPerResearch; }
      break;
    }
    case 'sellOre': {
      const amt = Math.min(C.T.oreSell, s.res.ore); if (amt <= 0) break;
      const g = amt * C.T.oreRate * (has(s, 'TRADE_ROUTE') ? C.T.routeBonus : 1) * bm.trade;
      s.res.ore -= amt; s.res.gold += g; s.cum.gold += g; s.cum.tradeGold += g; break;
    }
    case 'sellPearls': {
      const amt = Math.min(C.T.pearlSell, s.res.pearls); if (amt <= 0) break;
      const g = amt * C.T.pearlRate * (has(s, 'TRADE_ROUTE') ? C.T.routeBonus : 1) * bm.trade;
      s.res.pearls -= amt; s.res.gold += g; s.cum.gold += g; s.cum.tradeGold += g; break;
    }
    case 'buyFood': {
      if (s.res.gold >= C.T.buyGold) { s.res.gold -= C.T.buyGold; const f = C.T.foodPerBuy * bm.trade; s.res.food += f; s.cum.food += f; }
      break;
    }
    case 'plant': { // manual farm before HARVESTER
      if (!has(s, 'FERTILIZER')) break;
      const u = Math.min(s.res.power, C.F.rate); if (u <= 0) break;
      s.res.power -= u; const f = u * C.F.fertMult * bm.farm; s.res.food += f; s.cum.food += f; break;
    }
    case 'place': {
      const def = C.C[a.building]; if (!def || !def.needs.every((f) => has(s, f))) break;
      const built = a.building === 'house' ? s.C.houses : s.C.workshops; if (built >= def.max) break;
      const cost = def.cost * (has(s, 'MASS_PRODUCTION') ? 0.5 : 1);
      if (s.res.bricks >= cost) { s.res.bricks -= cost; s.res.population += def.pop;
        if (a.building === 'house') s.C.houses++; else s.C.workshops++; }
      break;
    }
  }
}

// ---- passive production (every tick) ---------------------------------------
function applyPassive(s) {
  const C = s.cfg, bm = boonMult(s);
  // producers
  if (has(s, 'AUTO_CLICKER')) { s.res.sparks += s.A.power; s.cum.sparks += s.A.power; }
  if (has(s, 'DRILL')) {
    const cap = has(s, 'MINE_CAP_RAISE') ? C.M.raisedCap : C.M.baseCap;
    if (s.M.depth < cap && (s.M.prog += C.M.dig) >= C.M.depthCost) { s.M.prog = 0; s.M.depth++; }
  }
  s.res.ore += s.M.depth * C.M.yield * bm.ore;
  s.res.pearls += (has(s, 'FISHERY') ? C.R.baseFish * C.R.fisheryMult : C.R.baseFish);
  s.cum.pearls += (has(s, 'FISHERY') ? C.R.baseFish * C.R.fisheryMult : C.R.baseFish);
  // grid: sparks -> power
  if (has(s, 'GRID_ONLINE')) {
    const sp = Math.min(s.res.sparks, C.E.sparkRate);
    s.res.sparks -= sp; const p = sp * C.E.powerPerSpark * (has(s, 'SUPERCONDUCTOR') ? 2 : 1) * bm.power;
    s.res.power += p; s.cum.power += p;
  }
  // farm: power -> food (auto once HARVESTER)
  if (has(s, 'HARVESTER') && has(s, 'FERTILIZER')) {
    const u = Math.min(s.res.power, C.F.rate); s.res.power -= u;
    const f = u * C.F.fertMult * bm.farm; s.res.food += f; s.cum.food += f;
  }
  // bank interest
  const r = (has(s, 'RATE_BOOST') ? C.B.boostRate : C.B.rate) * bm.bank;
  const g = s.B.principal * r; s.res.gold += g; s.cum.gold += g;
  // kiln: ore + sparks -> bricks
  if (has(s, 'ORE_EXPORT')) {
    const made = Math.min(C.K.rate, s.res.ore / C.K.orePerBrick, s.res.sparks / C.K.sparkPerBrick);
    if (made > 0) { s.res.ore -= made * C.K.orePerBrick; s.res.sparks -= made * C.K.sparkPerBrick;
      s.res.bricks += made; s.cum.bricks += made; }
  }
  // city eats food -> population
  if (has(s, 'FOOD_EXPORT')) {
    const eat = Math.min(s.res.food, C.C.foodGrowthCap); s.res.food -= eat; s.res.population += eat * C.C.popPerFood;
  }
}

function checkThresholds(s) {
  const C = s.cfg;
  if (s.cum.sparks >= C.A.autoAt) emit(s, 'AUTO_CLICKER');
  if (s.M.depth >= C.M.drillAt) emit(s, 'DRILL');
  if (s.M.depth >= C.M.exportAt) emit(s, 'ORE_EXPORT');
  if (s.cum.power >= C.E.onlineAt) emit(s, 'GRID_ONLINE');
  if (s.cum.pearls >= C.R.fisheryAt) emit(s, 'FISHERY');
  if (s.cum.gold >= C.B.blueprintAt) { emit(s, 'BLUEPRINT_WORKSHOP'); emit(s, 'RATE_BOOST'); }
  if (s.cum.bricks >= C.K.exportAt) { emit(s, 'BRICKS_EXPORT'); emit(s, 'MINE_CAP_RAISE'); }
  if (s.cum.tradeGold >= C.T.routeAt) emit(s, 'TRADE_ROUTE');
  if (s.res.science >= C.P.fertilizerAt) emit(s, 'FERTILIZER');
  if (s.res.science >= C.P.massProdAt) emit(s, 'MASS_PRODUCTION');
  if (s.res.science >= C.P.superAt) emit(s, 'SUPERCONDUCTOR');
  if (s.cum.food >= 100) { emit(s, 'HARVESTER'); emit(s, 'FOOD_EXPORT'); }
  if (s.res.population >= C.C.win) s.done = true;
}

function step(s, a) { applyAction(s, a); applyPassive(s); checkThresholds(s); s.tick++; return s; }

function simulate(strategyFn, opts = {}) {
  const s = createState(opts);
  const max = opts.maxTicks || 200000;
  while (!s.done && s.tick < max) step(s, strategyFn(s));
  return { won: s.done, ticks: s.tick, population: Math.floor(s.res.population),
    flags: [...s.flags], timeline: s.log, state: s };
}

module.exports = { CFG, BOONS, createState, step, simulate, has };
