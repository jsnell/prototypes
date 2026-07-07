/* Subprime AI players — JavaScript port of subprime/agents.py
 * (HeuristicAgent + RandomAgent; the Monte Carlo agent is not ported —
 * it's a research tool, too slow for interactive play). */
(function () {
"use strict";

const E = (typeof module !== "undefined")
  ? require("./engine.js") : globalThis.SubprimeEngine;
const { TYPES, PASS } = E;

const DEFAULT_PARAMS = {
  loanAppetite: 0.8, rateFear: 0.5, vpWeight: 3.0, subsidyWeight: 1.0,
  buyThreshold: 0.0, keepReserve: 1.0,
  demandAware: false, marketShare: 1.0, turnOrderValue: 0.0,
  survivalMargin: 0.0, survivalHorizon: 1,
  killInstinct: 0.0, endgameAwareness: 0.0,
  contestModel: true, denialWeight: 0.5,
  debtCooldown: 0.0, patience: 0.0, cashReserveValue: 0.0,
  initialPositionBids: true, reserveUsesProjected: true,
  incomeKills: true,
  // blind-playtest fixes (see agents.py for the full rationale)
  lifeline: false, pickAware: false,
  shieldAwareness: false, defaultClock: false,
};

class RandomAgent {
  constructor(seed) { this.rng = E.makeRng(seed >>> 0); }
  act(s, pid, actions) { return this.rng.choice(actions); }
}

class HeuristicAgent {
  constructor(params, seed) {
    this.p = Object.assign({}, DEFAULT_PARAMS, params || {});
    this.rng = E.makeRng(seed >>> 0);
  }

  // ---- shared projections -----------------------------------------
  printedIncome(s, pid) {
    let n = 0;
    for (const city of s.cities) for (const t of TYPES) {
      for (const b of city[t]) if (b.owner === pid) n += b.card.income;
    }
    return n;
  }

  projectedIncome(s, pid) {
    // printed income + subsidy bonuses as they'd be placed now; used where
    // generosity is correct (kill targets' resources, declaring doom)
    const [stateSubs, citySubs] = E.determineSubsidies(s.cities);
    const cfg = s.cfg;
    let total = 0;
    s.cities.forEach((city, ci) => {
      for (const t of TYPES) {
        const st = stateSubs.has(E.key(ci, t));
        const cs = citySubs[E.key(ci, t)];
        for (const b of city[t]) {
          if (b.owner !== pid) continue;
          const bonus = st && cs === pid ? cfg.doubleSubsidyBonus
                      : (st || cs === pid) ? cfg.singleSubsidyBonus : 0;
          total += b.card.income + bonus;
        }
      }
    });
    return total;
  }

  lifetimeRate(s, fromRound) {
    const cfg = s.cfg;
    const rate = E.currentRate(s);
    const start = fromRound === undefined ? s.round : fromRound;
    if (cfg.fixedRateLoans) return rate * (cfg.maxRounds - start + 1);
    let total = 0;
    for (let k = start; k <= cfg.maxRounds; k++) {
      const i = Math.min(k - 2, cfg.loanRowRates.length - 1);
      const floor = k >= 2 ? cfg.loanRowRates[i] : 0;
      total += Math.max(rate, floor);
    }
    return total;
  }

  expectedOthersTake(s, pid) {
    let take = 0;
    for (const q of Object.keys(s.bids)) {
      if (Number(q) !== pid) take += s.bids[q];
    }
    take += 2 * s.bidPending.filter(q => q !== pid).length;
    return take;
  }

  survivable(s, pid, d, horizonOverride) {
    const p = s.players[pid];
    const cfg = s.cfg;
    const others = this.expectedOthersTake(s, pid);
    const income = this.printedIncome(s, pid);
    let cash = p.money + d * cfg.moneyPerLoan + income;
    let taken = others + d;
    const takeRate = E.rateAfter(s, taken);
    const horizon = Math.max(1, horizonOverride === undefined
                                ? this.p.survivalHorizon : horizonOverride);
    for (let step = 0; step < horizon; step++) {
      const k = s.round + step;
      if (k > cfg.maxRounds) break;
      let rate = E.rateAfter(s, taken);
      if (k >= 2) {
        const i = Math.min(k - 2, cfg.loanRowRates.length - 1);
        rate = Math.max(rate, cfg.loanRowRates[i]);
      }
      let due = E.interestDue(s, p, rate);
      if (cfg.interestPerLoan) due += d * (cfg.fixedRateLoans ? takeRate : rate);
      if (step > 0) cash += income;
      cash -= due;
      if (cash < this.p.survivalMargin) return false;
      taken += others;
    }
    return true;
  }

  projectedDefaulters(s) {
    // players whose resources — counted generously, subsidies included —
    // still can't cover this round's bill: locked into default
    return s.players
      .filter(q => !q.bankrupt &&
              q.money + this.projectedIncome(s, q.pid) < E.interestDue(s, q))
      .map(q => q.pid);
  }

  bankruptcyPick(s, defaulters) {
    // mirror the engine's pick rule: who dies if `defaulters` all fail
    const pick = s.cfg.bankruptcyPick;
    let order;
    if (pick === "latest") order = [...s.turnOrder].reverse();
    else if (pick === "most_loans") {
      order = [...s.turnOrder].sort(
        (a, b) => s.players[b].loans - s.players[a].loans);
    } else order = s.turnOrder;            // "earliest" (doc rule)
    for (const q of order) if (defaulters.includes(q)) return q;
    return null;
  }

  endangered(s, pid, d) {
    // shield: at this bid we default THIS round and some rival is also
    // drowning — early turn order is then a death warrant (the pick rule
    // eats the earliest defaulter); with no fall-guy, position keeps its
    // normal value
    if (!this.p.shieldAwareness) return false;
    if (this.survivable(s, pid, d, 1)) return false;
    const drowning = new Set(this.projectedDefaulters(s));
    return s.players.some(q =>
      q.pid !== pid && !q.bankrupt &&
      (drowning.has(q.pid) ||
       !this.survivable(s, q.pid, s.bids[q.pid] || 0, 1)));
  }

  amLeading(s, pid, exclude) {
    const snap = E.scoreSnapshot(s, exclude);
    const mine = snap[pid] || 0;
    let best = 0;
    for (const q of Object.keys(snap)) {
      if (Number(q) !== pid) best = Math.max(best, snap[q]);
    }
    return mine >= best;
  }

  // ---- phase 1: bidding --------------------------------------------
  demandCap(s, pid) {
    const cfg = s.cfg;
    let displayCost = 0;
    s.display.forEach((row, r) => {
      for (const cell of row) {
        if (cell) displayCost += cell.card.cost * cfg.rowCostMultipliers[r];
      }
    });
    const share = displayCost / s.nPlayers * this.p.marketShare;
    const rate = E.currentRate(s);
    const p = s.players[pid];
    const due = E.interestDue(s, p);
    const need = share + due - p.money - this.printedIncome(s, pid);
    const netPerLoan = cfg.moneyPerLoan - (cfg.interestPerLoan ? rate : 0);
    if (need <= 0 || netPerLoan <= 0) return 0;
    return Math.ceil(need / netPerLoan);
  }

  forcingBid(s, pid, maxBid) {
    const others = this.expectedOthersTake(s, pid);
    const candidates = [];
    if (this.p.endgameAwareness > 0 && this.amLeading(s, pid)) {
      const need = E.markersLeft(s) - others;
      if (need > 0 && need <= maxBid) candidates.push(need);
    }
    if (this.p.killInstinct > 0) {
      for (const q of s.players) {
        if (q.pid === pid || q.bankrupt) continue;
        const qBid = s.bids[q.pid] || 0;
        // generous estimate: a kill that merely might land is a bad trade
        const qCash = q.money + qBid * s.cfg.moneyPerLoan +
                      this.projectedIncome(s, q.pid);
        for (let myD = 0; myD <= maxBid; myD++) {
          const rate = E.rateAfter(s, others + myD);
          let due = E.interestDue(s, q, rate);
          if (s.cfg.interestPerLoan) due += qBid * rate;
          if (due > qCash) {
            if (this.amLeading(s, pid, q.pid)) candidates.push(myD);
            break;
          }
        }
      }
    }
    // a forcing bid must survive a MISS (2-round horizon): if the kill
    // lands the game ends, but a miss leaves us holding the stretch
    const good = candidates.filter(c => this.survivable(s, pid, c, 2));
    return good.length ? Math.min(...good) : null;
  }

  desiredLoans(s, pid) {
    const cfg = s.cfg;
    const maxBid = Math.max(...cfg.bidSpaces);
    const remaining = cfg.maxRounds - s.round + 1;
    let d = this.p.loanAppetite * remaining - this.p.rateFear * E.currentRate(s);
    if (this.p.demandAware) d = Math.min(d, this.demandCap(s, pid));
    if (this.p.debtCooldown > 0) {
      const rivals = s.players.filter(q => q.pid !== pid && !q.bankrupt)
                              .map(q => q.loans);
      if (rivals.length) {
        const excess = s.players[pid].loans -
                       rivals.reduce((a, b) => a + b, 0) / rivals.length;
        d -= this.p.debtCooldown * Math.max(0, excess);
      }
    }
    d = Math.max(0, Math.min(Math.round(d), maxBid));
    while (d > 0 && !this.survivable(s, pid, d)) d--;
    if (this.p.lifeline && !this.survivable(s, pid, d)) {
      // loan cash is exactly what covers a bill we otherwise can't pay:
      // hunt upward for the smallest borrow that survives
      for (let k = d + 1; k <= maxBid; k++) {
        if (this.survivable(s, pid, k)) { d = k; break; }
      }
    }
    if (this.p.killInstinct > 0 || this.p.endgameAwareness > 0) {
      const force = this.forcingBid(s, pid, maxBid);
      if (force !== null && force > d) d = force;
    }
    return d;
  }

  positionWorthRaise(s, pid, current, desired, raiseTo) {
    if (this.p.turnOrderValue <= 0) return false;
    const rivals = Object.keys(s.bids).length - 1;
    if (rivals <= 0) return false;
    if (!this.survivable(s, pid, raiseTo)) return false;
    if (this.endangered(s, pid, raiseTo)) return false; // late order = armor
    const extra = raiseTo - desired;   // whole premium over economic desire
    if (extra <= 0) return true;
    const perLoan = Math.max(0.5, this.lifetimeRate(s) - s.cfg.moneyPerLoan);
    return extra * perLoan <= this.p.turnOrderValue * rivals;
  }

  bid(s, pid, actions, current) {
    const desired = this.desiredLoans(s, pid);
    const values = actions.filter(a => a[0] === "bid").map(a => a[1])
                          .sort((a, b) => a - b);
    const atMost = values.filter(v => v <= desired);
    const canPass = actions.some(a => a[0] === "pass");
    if (current === undefined) {         // initial placement
      if (atMost.length) return ["bid", atMost[atMost.length - 1]];
      const v = values[0];
      if (v !== undefined && this.survivable(s, pid, v)) {
        if (v - desired <= desired) return ["bid", v];  // mild overshoot
        // position bid: pay above desire purely for turn order, within
        // the raise-war budget (else a 0-desire round cedes first pick)
        if (this.p.initialPositionBids && this.p.turnOrderValue > 0 &&
            !this.endangered(s, pid, v)) {
          const perLoan = Math.max(0.5, this.lifetimeRate(s) - s.cfg.moneyPerLoan);
          const budget = this.p.turnOrderValue * (s.nPlayers - 1);
          if ((v - desired) * perLoan <= budget) return ["bid", v];
        }
      }
      if (canPass) return PASS;
      return ["bid", values[0]];
    }
    if (current < desired && atMost.length) return ["bid", atMost[0]];
    if (values.length &&
        this.positionWorthRaise(s, pid, current, desired, values[0])) {
      return ["bid", values[0]];
    }
    return PASS;
  }

  // ---- phase 2: buying ----------------------------------------------
  interestDueNow(s, pid) { return E.interestDue(s, s.players[pid]); }

  secureIncome(s, pid) {
    // printed income plus only the subsidy bonuses whose margins survive
    // a single rival purchase (1-card leads can be tied away; ties void
    // the marker)
    const cfg = s.cfg;
    const [stateSubs, citySubs] = E.determineSubsidies(s.cities);
    const stateMargin = {};
    for (const t of TYPES) {
      const counts = s.cities.map(c => c[t].length).sort((a, b) => a - b);
      stateMargin[t] = counts.length > 1 ? counts[1] - counts[0] : 99;
    }
    let total = 0;
    s.cities.forEach((city, ci) => {
      for (const t of TYPES) {
        const mine = city[t].filter(b => b.owner === pid);
        if (!mine.length) continue;
        const st = stateSubs.has(E.key(ci, t)) && stateMargin[t] >= 2;
        let cs = false;
        if (citySubs[E.key(ci, t)] === pid) {
          let rivalBest = 0;
          for (const q of s.players) {
            if (q.pid !== pid && !q.bankrupt) {
              rivalBest = Math.max(rivalBest,
                city[t].filter(b => b.owner === q.pid).length);
            }
          }
          cs = mine.length - rivalBest >= 2;
        }
        const bonus = st && cs ? cfg.doubleSubsidyBonus
                    : (st || cs) ? cfg.singleSubsidyBonus : 0;
        total += mine.reduce((n, b) => n + b.card.income, 0)
                 + bonus * mine.length;
      }
    });
    return total;
  }

  reserve(s, pid) {
    const income = this.p.reserveUsesProjected
      ? this.secureIncome(s, pid) : this.printedIncome(s, pid);
    const need = this.interestDueNow(s, pid) - income;
    return Math.max(0, need) * this.p.keepReserve;
  }

  cashMult(s, pid) {
    if (this.p.cashReserveValue <= 0 || s.round >= s.cfg.maxRounds) return 1.0;
    const nxt = this.lifetimeRate(s, s.round + 1);
    const prem = Math.max(0, nxt / s.cfg.moneyPerLoan - 1);
    return 1 + this.p.cashReserveValue * prem;
  }

  contestCapacity(s, pid, typ) {
    if (!this.p.contestModel) return 0;
    const cfg = s.cfg;
    const prices = [];
    s.display.forEach((row, r) => {
      for (const cell of row) {
        if (cell && cell.card.type === typ) {
          prices.push(cell.card.cost * cfg.rowCostMultipliers[r]);
        }
      }
    });
    prices.sort((a, b) => a - b);
    let rich = 0;
    for (const q of s.players) {
      if (q.pid !== pid && !q.bankrupt) rich = Math.max(rich, q.money);
    }
    let afford = 0;
    for (const price of prices) {
      if (rich < price) break;
      rich -= price;
      afford++;
    }
    return afford;
  }

  placementValue(s, pid, card, cityIdx, remainingOverride) {
    const cfg = s.cfg;
    const remaining = remainingOverride === undefined
      ? cfg.maxRounds - s.round + 1 : remainingOverride;
    let val = card.income * remaining;
    const city = s.cities[cityIdx];
    const mineSec = E.ownedCount(city, pid, card.type) + 1;

    const rivalCounts = {};
    for (const b of city[card.type]) {
      if (b.owner !== null && b.owner !== pid) {
        rivalCounts[b.owner] = (rivalCounts[b.owner] || 0) + 1;
      }
    }
    const byCount = Object.values(rivalCounts).sort((a, b) => b - a);
    const topRival = byCount[0] || 0;
    const secondRival = byCount[1] || 0;

    // MARGINAL accounting: a placement is credited with what it CHANGES —
    // taking a lead credits the whole stream, extending an existing lead
    // credits only the new card (full-stream crediting caused fortress
    // piling and blinded the agents to spreading across cities)
    const bonusStream = cfg.singleSubsidyBonus * remaining * this.p.subsidyWeight;
    const wasLeadSec = (mineSec - 1) > topRival;
    const nowLeadSec = mineSec > topRival;
    const gainedSec = nowLeadSec ? (wasLeadSec ? 1 : mineSec) : 0;
    if (nowLeadSec) {
      const margin = mineSec - topRival;
      const capacity = this.contestCapacity(s, pid, card.type);
      const hold = capacity ? Math.max(0.5, margin / (margin + capacity)) : 1.0;
      val += gainedSec * bonusStream * hold;
    }
    const leaderWasStrict = topRival > Math.max(secondRival, mineSec - 1);
    if (leaderWasStrict && mineSec >= topRival) {
      val += this.p.denialWeight * topRival * bonusStream;
    }

    const counts = s.cities.map(c => c[card.type].length);
    counts[cityIdx] += 1;
    const low = Math.min(...counts);
    if (counts.filter(x => x === low).length === 1 && counts[cityIdx] === low) {
      // the new card itself earns the state bonus...
      val += bonusStream * 0.5;
      if (nowLeadSec) {
        // ...and leading a state-subsidized section stacks to the double
        // bonus AND scores 1 VP per building at game end
        const stack = cfg.doubleSubsidyBonus - 2 * cfg.singleSubsidyBonus;
        val += gainedSec * stack * remaining * this.p.subsidyWeight * 0.5;
        val += cfg.vpStateSubsidyPerBuilding * gainedSec * this.p.vpWeight * 0.5;
      }
    }

    val += cfg.vpPerBuilding * this.p.vpWeight;
    const mineCity = E.ownedCount(city, pid) + 1;
    const cityCounts = s.players
      .filter(q => q.pid !== pid && !q.bankrupt)
      .map(q => E.ownedCount(city, q.pid)).sort((a, b) => b - a);
    const topCity = cityCounts[0] || 0;
    const secondCity = cityCounts[1] || 0;
    // flat 3 VP majority: credit only when this placement newly takes it
    if (mineCity > topCity && !((mineCity - 1) > topCity)) {
      val += cfg.vpCityMajority * this.p.vpWeight * 0.5;
    }
    if (topCity > Math.max(secondCity, mineCity - 1) && mineCity > topCity) {
      val += this.p.denialWeight * cfg.vpCityMajority * this.p.vpWeight;
    }
    return val;
  }

  waitNet(s, card, r, moneyOn, valueNow) {
    const cfg = s.cfg;
    let costNext, moneyNext;
    if (r === 0) {
      costNext = card.cost * cfg.rowCostMultipliers[0];
      moneyNext = moneyOn;
    } else {
      costNext = card.cost * cfg.rowCostMultipliers[r - 1];
      moneyNext = moneyOn;
    }
    return (valueNow - card.income) - costNext + moneyNext;
  }

  drowning(s, pid) {
    const p = s.players[pid];
    const cfg = s.cfg;
    const income = this.printedIncome(s, pid);
    const rate = E.currentRate(s);
    let cash = p.money + income;
    for (const k of [s.round, s.round + 1]) {
      if (k > cfg.maxRounds) break;
      let rK = rate;
      if (k >= 2) {
        const i = Math.min(k - 2, cfg.loanRowRates.length - 1);
        rK = Math.max(rate, cfg.loanRowRates[i]);
      }
      cash -= E.interestDue(s, p, rK);
      if (cash < 0) return true;
      cash += income;
    }
    return false;
  }

  robberyBonus(s, pid, card, cityIdx) {
    // value of stealing enough subsidy income to flip a solvent rival
    // into default this round (game ends), when we like the aftermath
    if (this.p.killInstinct <= 0 || !this.p.incomeKills) return 0;
    const rivals = s.players.filter(q => q.pid !== pid && !q.bankrupt);
    const before = {};
    for (const q of rivals) {
      const due = E.interestDue(s, q);
      const inc = this.projectedIncome(s, q.pid);
      if (q.money + inc >= due) before[q.pid] = due;
    }
    if (!Object.keys(before).length) return 0;
    const sec = s.cities[cityIdx][card.type];
    sec.push({ card, owner: pid });
    try {
      for (const q of rivals) {
        if (before[q.pid] === undefined) continue;
        const after = this.projectedIncome(s, q.pid);
        if (q.money + after < before[q.pid] &&
            this.amLeading(s, pid, q.pid)) {
          return 30 * this.p.killInstinct;
        }
      }
    } finally {
      sec.pop();
    }
    return 0;
  }

  buy(s, pid, actions) {
    const player = s.players[pid];
    if (actions.some(a => a[0] === "repay") && this.drowning(s, pid)) {
      return ["repay"];
    }
    // certain default this round: the bailout confiscates cash anyway —
    // convert every dying dollar into VP instead of hoarding
    const doomed = player.money + this.projectedIncome(s, pid) <
                   E.interestDue(s, player);
    const defaulters = ((doomed && this.p.pickAware) || this.p.defaultClock)
      ? this.projectedDefaulters(s) : [];
    if (doomed && this.p.pickAware &&
        this.bankruptcyPick(s, defaulters) === pid) {
      // WE are the one the pick rule eats: buildings are repossessed with
      // us and VP zeroed — buying converts doomed cash into doomed
      // buildings, don't feed the bank
      return PASS;
    }
    // a rival locked into default ends the game this round: income streams
    // have one payout left and saved dollars have no future
    let lastRound = s.round >= s.cfg.maxRounds;
    if (this.p.defaultClock && defaulters.some(q => q !== pid)) {
      lastRound = true;
    }
    const remaining = lastRound ? 1 : undefined;
    const reserve = doomed ? 0 : this.reserve(s, pid);
    const cashMult = (doomed || lastRound) ? 1.0 : this.cashMult(s, pid);
    let best = PASS, bestNet = this.p.buyThreshold;
    for (const a of actions) {
      let net;
      if (a[0] === "repay") {
        const cost = s.cfg.loanRepaymentCost;
        if (player.money - cost < reserve) continue;
        if (s.cfg.fixedRateLoans && player.loanRates.length) {
          const remaining = s.cfg.maxRounds - s.round + 1;
          net = Math.max(...player.loanRates) * remaining - cost;
        } else net = this.lifetimeRate(s) - cost;
      } else if (a[0] === "buy") {
        const [, r, c, cityIdx] = a;
        const cell = s.display[r][c];
        const cost = cell.card.cost * s.cfg.rowCostMultipliers[r];
        if (player.money + cell.money - cost < reserve) continue;
        const value = this.placementValue(s, pid, cell.card, cityIdx, remaining)
                      + this.robberyBonus(s, pid, cell.card, cityIdx);
        const out = Math.max(0, cost - cell.money);
        net = value - cost + cell.money - (cashMult - 1) * out;
        // scores tie-break on remaining cash: on near-equal value, keep
        // the dollar
        if (lastRound) net -= 0.02 * out;
        if (this.p.patience > 0 && !doomed && !lastRound &&
            s.round < s.cfg.maxRounds) {
          const wait = this.waitNet(s, cell.card, r, cell.money, value);
          if (wait > net) net -= this.p.patience * (wait - net);
        }
      } else continue;
      if (net > bestNet) { best = a; bestNet = net; }
    }
    return best;
  }

  // ---- bailout auction ----------------------------------------------
  bailout(s, pid, actions) {
    let best = PASS, bestNet = 0;
    for (const a of actions) {
      if (a[0] !== "bailout_buy") continue;
      const lot = s.bailoutLots[a[1]];
      const price = lot.bldg.card.cost * s.cfg.bailoutPriceMultiplier;
      if (s.players[pid].money < price) continue;
      const cfg = s.cfg;
      const city = s.cities[lot.city];
      let val = cfg.vpPerBuilding * this.p.vpWeight;
      let rival = 0;
      for (const q of s.players) {
        if (q.pid !== pid && !q.bankrupt) {
          rival = Math.max(rival, E.ownedCount(city, q.pid));
        }
      }
      if (E.ownedCount(city, pid) + 1 > rival) {
        val += cfg.vpCityMajority * this.p.vpWeight;
      }
      if (val > bestNet) { best = a; bestNet = val; }
    }
    return best;
  }

  act(s, pid, actions) {
    if (s.phase === "bid_initial") return this.bid(s, pid, actions);
    if (s.phase === "bid_raise") return this.bid(s, pid, actions, s.bids[pid]);
    if (s.phase === "buy") return this.buy(s, pid, actions);
    if (s.phase === "bailout") return this.bailout(s, pid, actions);
    return actions[0];
  }
}

// turnOrderValue 12: under the final bid rules higher position valuations
// beat lower ones head-to-head (12 > 6 > 2) — first pick is gold
const SHARK = { demandAware: true, turnOrderValue: 12.0,
                killInstinct: 1.0, endgameAwareness: 1.0 };

const REGISTRY = {
  random: (seed) => new RandomAgent(seed),
  greedy: (seed) => new HeuristicAgent({}, seed),
  timid: (seed) => new HeuristicAgent({ loanAppetite: 0.4, rateFear: 1.0 }, seed),
  leveraged: (seed) => new HeuristicAgent(
    { loanAppetite: 1.5, rateFear: 0.2, keepReserve: 0.5 }, seed),
  sharp: (seed) => new HeuristicAgent({ demandAware: true }, seed),
  "sharp-pos": (seed) => new HeuristicAgent(
    { demandAware: true, turnOrderValue: 12.0 }, seed),
  shark: (seed) => new HeuristicAgent(SHARK, seed),
  digest: (seed) => new HeuristicAgent(
    Object.assign({}, SHARK,
      { debtCooldown: 1.0, patience: 0.5, cashReserveValue: 0.4 }), seed),
  // digest + the blind-playtest lessons: lifeline borrowing, pick-aware
  // doomed spending, the bankruptcy shield, and the default game clock
  digest2: (seed) => new HeuristicAgent(
    Object.assign({}, SHARK,
      { debtCooldown: 1.0, patience: 0.5, cashReserveValue: 0.4,
        lifeline: true, pickAware: true,
        shieldAwareness: true, defaultClock: true }), seed),
};

const Agents = { RandomAgent, HeuristicAgent, REGISTRY, DEFAULT_PARAMS };
if (typeof module !== "undefined") module.exports = Agents;
if (typeof globalThis !== "undefined") globalThis.SubprimeAgents = Agents;
})();
