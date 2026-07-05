/* Subprime rules engine — JavaScript port of subprime/engine.py.
 * Plain script (no modules) so index.html works from file://; also
 * usable from node via module.exports for tests.
 *
 * The Python package remains the design lab / source of truth for
 * simulation; this port implements the same rules for in-browser play.
 * Actions are arrays: ["bid",v] ["pass"] ["buy",r,c,city]
 * ["bailout_buy",i] ["repay"].
 */
(function () {
"use strict";

const RES = "residential", COM = "commercial", IND = "industrial";
const TYPES = [RES, COM, IND];

// (type, printed cost, printed income, count) — mirrors config.py
const DEFAULT_CARDS = [
  [RES, 1, 1, 6], [RES, 2, 1, 8], [RES, 3, 2, 10], [RES, 4, 2, 6],
  [RES, 5, 3, 4],
  [COM, 2, 1, 5], [COM, 3, 2, 8], [COM, 4, 3, 8], [COM, 5, 3, 7],
  [COM, 6, 4, 5],
  [IND, 3, 2, 5], [IND, 4, 3, 7], [IND, 5, 4, 8], [IND, 6, 4, 7],
  [IND, 7, 5, 6],
];

function defaultConfig() {
  return {
    startingMoney: 10, startingLoans: 1, moneyPerLoan: 10, maxRounds: 6,
    bidSpaces: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    initialBidsInverted: true, compulsoryInitialBids: true,
    uniqueBidSpaces: true,
    loanRowSizes: [10, 9, 9, 8, 7, 7],
    loanRowRates: [1, 2, 3, 4, 5, 6],
    interestPerLoan: true, baseInterestRate: 0, fixedRateLoans: false,
    displayRows: 3, displayColsExtra: 1, rowCostMultipliers: [1, 2, 3],
    staleCardMoney: 1,
    singleSubsidyBonus: 1, doubleSubsidyBonus: 3,
    bailoutPriceMultiplier: 1, bankruptcyPick: "earliest",
    loanRepaymentCost: 0,
    vpPerBuilding: 1, vpCityMajority: 3, vpStateSubsidyPerBuilding: 1,
    cardDistribution: DEFAULT_CARDS,
    citiesFewerThanPlayers: 1,
  };
}

// deterministic PRNG (mulberry32)
function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    random: next,
    randrange: (n) => Math.floor(next() * n),
    choice: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    },
  };
}

const PASS = ["pass"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------- setup

function newGame(cfg, nPlayers, seed, collectEvents) {
  if (nPlayers < 3 || nPlayers > 5) throw new Error("3-5 players");
  const s = {
    cfg, nPlayers, rng: makeRng(seed >>> 0),
    round: 1, phase: "bid_initial",
    players: [], turnOrder: [],
    loanRates: [], loanRows: [], loanMarkers: [],
    deck: [], display: [], cities: [],
    bidPending: [], bids: {}, bidSeq: {}, bidCounter: 0, nextOrder: [],
    buyPtr: 0, buyPassed: new Set(),
    stateSubsidies: new Set(), citySubsidies: {},
    unable: new Set(), bailedOut: new Set(),
    bankruptPid: null, bailoutLots: [], bailoutQueue: [],
    endCause: null, winners: [],
    events: collectEvents ? [] : null,
  };
  cfg.loanRowSizes.forEach((size, i) => {
    for (let k = 0; k < size; k++) {
      s.loanRates.push(cfg.loanRowRates[i]);
      s.loanRows.push(i + 1);
      s.loanMarkers.push(true);
    }
  });
  for (let pid = 0; pid < nPlayers; pid++) {
    const p = { pid, money: cfg.startingMoney, loans: 0, bankrupt: false,
                vp: 0, interestPaid: 0, incomeEarned: 0, subsidyEarned: 0,
                loansTaken: 0, loanRates: [] };
    grantLoans(s, p, cfg.startingLoans);
    p.loansTaken = 0;
    s.players.push(p);
  }
  const nCities = nPlayers - cfg.citiesFewerThanPlayers;
  for (let i = 0; i < nCities; i++) {
    s.cities.push({ [RES]: [], [COM]: [], [IND]: [] });
  }
  let id = 0;
  for (const [t, cost, income, count] of cfg.cardDistribution) {
    for (let k = 0; k < count; k++) s.deck.push({ id: id++, type: t, cost, income });
  }
  s.rng.shuffle(s.deck);
  const cols = nPlayers + cfg.displayColsExtra;
  for (let r = 0; r < cfg.displayRows; r++) {
    s.display.push(new Array(cols).fill(null));
  }
  refillDisplay(s);
  s.turnOrder = [...Array(nPlayers).keys()];
  s.rng.shuffle(s.turnOrder);
  log(s, `setup: turn order ${s.turnOrder}, interest rate ${currentRate(s)}`);
  startBidPhase(s);
  advance(s);
  return s;
}

function log(s, msg) { if (s.events) s.events.push(`[R${s.round}] ${msg}`); }

function takeLoanMarkers(s, wanted) {
  const rates = [];
  for (let i = 0; i < s.loanMarkers.length && rates.length < wanted; i++) {
    if (s.loanMarkers[i]) { s.loanMarkers[i] = false; rates.push(s.loanRates[i]); }
  }
  return rates;
}

function grantLoans(s, player, count) {
  const rates = takeLoanMarkers(s, count);
  const taken = rates.length;
  while (rates.length < count) rates.push(Math.max(currentRate(s), 1));
  player.loans += count;
  player.loansTaken += count;
  player.loanRates.push(...rates);
  return taken;
}

// ------------------------------------------------------------ queries

function currentRate(s) {
  let best = s.cfg.baseInterestRate;
  for (let i = 0; i < s.loanMarkers.length; i++) {
    if (!s.loanMarkers[i]) best = Math.max(best, s.loanRates[i]);
  }
  return best;
}

function rateAfter(s, extraTaken) {
  let best = s.cfg.baseInterestRate, left = extraTaken;
  for (let i = 0; i < s.loanMarkers.length; i++) {
    if (!s.loanMarkers[i]) best = Math.max(best, s.loanRates[i]);
    else if (left > 0) { left--; best = Math.max(best, s.loanRates[i]); }
  }
  return best;
}

function markersLeft(s) {
  return s.loanMarkers.reduce((n, m) => n + (m ? 1 : 0), 0);
}

function interestDue(s, player, rate) {
  const r = rate === undefined ? currentRate(s) : rate;
  if (!s.cfg.interestPerLoan) return r;
  if (s.cfg.fixedRateLoans) return player.loanRates.reduce((a, b) => a + b, 0);
  return r * player.loans;
}

function ownedCount(city, pid, typ) {
  const types = typ ? [typ] : TYPES;
  let n = 0;
  for (const t of types) for (const b of city[t]) if (b.owner === pid) n++;
  return n;
}

function scoreSnapshot(s, exclude) {
  const cfg = s.cfg;
  const pids = s.players.filter(p => !p.bankrupt && p.pid !== exclude)
                        .map(p => p.pid);
  const vp = {};
  pids.forEach(pid => vp[pid] = 0);
  const [stateSubs] = determineSubsidies(s.cities);
  for (const city of s.cities) {
    const counts = {};
    let best = 0;
    for (const pid of pids) {
      counts[pid] = ownedCount(city, pid);
      vp[pid] += cfg.vpPerBuilding * counts[pid];
      best = Math.max(best, counts[pid]);
    }
    if (best > 0) for (const pid of pids) {
      if (counts[pid] === best) vp[pid] += cfg.vpCityMajority;
    }
  }
  for (const key of stateSubs) {
    const [ci, typ] = splitKey(key);
    const counts = {};
    let best = 0;
    for (const pid of pids) {
      counts[pid] = ownedCount(s.cities[ci], pid, typ);
      best = Math.max(best, counts[pid]);
    }
    if (best > 0) for (const pid of pids) {
      if (counts[pid] === best) vp[pid] += cfg.vpStateSubsidyPerBuilding * counts[pid];
    }
  }
  return vp;
}

const key = (ci, typ) => `${ci}|${typ}`;
function splitKey(k) { const i = k.indexOf("|"); return [Number(k.slice(0, i)), k.slice(i + 1)]; }

// ------------------------------------------------------ decision layer

function lowestBidder(s) {
  let best = null;
  for (const pidStr of Object.keys(s.bids)) {
    const pid = Number(pidStr);
    if (best === null ||
        s.bids[pid] < s.bids[best] ||
        (s.bids[pid] === s.bids[best] &&
         (s.bidSeq[pid] || 0) < (s.bidSeq[best] || 0))) best = pid;
  }
  return best;
}

function decisionPlayer(s) {
  if (s.phase === "bid_initial") return s.bidPending[0];
  if (s.phase === "bid_raise") return lowestBidder(s);
  if (s.phase === "buy") return s.turnOrder[s.buyPtr];
  if (s.phase === "bailout") return s.bailoutQueue[0];
  return null;
}

function legalActions(s) {
  const cfg = s.cfg;
  if (s.phase === "bid_initial") {
    const taken = cfg.uniqueBidSpaces ? new Set(Object.values(s.bids)) : new Set();
    const acts = cfg.bidSpaces.filter(v => !taken.has(v)).map(v => ["bid", v]);
    if (!cfg.compulsoryInitialBids) acts.push(PASS);
    return acts;
  }
  if (s.phase === "bid_raise") {
    const pid = lowestBidder(s);
    const taken = cfg.uniqueBidSpaces ? new Set(Object.values(s.bids)) : new Set();
    const cur = s.bids[pid];
    const acts = cfg.bidSpaces.filter(v => v > cur && !taken.has(v))
                              .map(v => ["bid", v]);
    acts.push(PASS);
    return acts;
  }
  if (s.phase === "buy") {
    const pid = s.turnOrder[s.buyPtr];
    const player = s.players[pid];
    const acts = [];
    s.display.forEach((row, r) => {
      const mult = cfg.rowCostMultipliers[r];
      row.forEach((cell, c) => {
        if (!cell) return;
        if (player.money + cell.money >= cell.card.cost * mult) {
          for (let city = 0; city < s.cities.length; city++) {
            acts.push(["buy", r, c, city]);
          }
        }
      });
    });
    if (cfg.loanRepaymentCost > 0 && player.loans > 0 &&
        player.money >= cfg.loanRepaymentCost) acts.push(["repay"]);
    acts.push(PASS);
    return acts;
  }
  if (s.phase === "bailout") {
    const pid = s.bailoutQueue[0];
    const player = s.players[pid];
    const acts = [];
    s.bailoutLots.forEach((lot, i) => {
      if (lot.card && player.money >= lot.card.cost * cfg.bailoutPriceMultiplier) {
        acts.push(["bailout_buy", i]);
      }
    });
    acts.push(PASS);
    return acts;
  }
  return [];
}

function applyAction(s, action) {
  if (!legalActions(s).some(a => same(a, action))) {
    throw new Error(`illegal action ${JSON.stringify(action)} in ${s.phase}`);
  }
  const pid = decisionPlayer(s);
  if (s.phase === "bid_initial") {
    s.bidPending.shift();
    if (same(action, PASS)) passOut(s, pid, 0);
    else { setBid(s, pid, action[1]); log(s, `P${pid} opens bid at ${action[1]}`); }
  } else if (s.phase === "bid_raise") {
    if (same(action, PASS)) { passOut(s, pid, s.bids[pid]); delete s.bids[pid]; }
    else { log(s, `P${pid} raises bid ${s.bids[pid]} -> ${action[1]}`); setBid(s, pid, action[1]); }
  } else if (s.phase === "buy") {
    if (same(action, PASS)) { s.buyPassed.add(pid); log(s, `P${pid} passes`); }
    else if (same(action, ["repay"])) {
      const p = s.players[pid];
      p.money -= s.cfg.loanRepaymentCost;
      p.loans -= 1;
      p.loanRates.splice(p.loanRates.indexOf(Math.max(...p.loanRates)), 1);
      log(s, `P${pid} repays a loan for $${s.cfg.loanRepaymentCost}`);
    } else doBuy(s, pid, action[1], action[2], action[3]);
    s.buyPtr = (s.buyPtr + 1) % s.nPlayers;
  } else if (s.phase === "bailout") {
    if (!same(action, PASS)) doBailoutBuy(s, pid, action[1]);
    s.bailoutQueue.shift();
  }
  advance(s);
}

// --------------------------------------------------------- advance loop

function advance(s) {
  for (;;) {
    if (s.phase === "bid_initial") {
      if (s.bidPending.length) return;
      s.phase = "bid_raise";
    } else if (s.phase === "bid_raise") {
      if (Object.keys(s.bids).length) return;
      finishBidding(s);
    } else if (s.phase === "buy") {
      if (s.buyPassed.size === s.nPlayers) {
        collectIncome(s);
        payInterest(s);
        s.phase = "resolve";
      } else {
        while (s.buyPassed.has(s.turnOrder[s.buyPtr])) {
          s.buyPtr = (s.buyPtr + 1) % s.nPlayers;
        }
        return;
      }
    } else if (s.phase === "resolve") {
      resolveRoundEnd(s);
    } else if (s.phase === "bailout") {
      if (s.bailoutQueue.length) return;
      finishBailout(s);
    } else if (s.phase === "over") {
      return;
    }
  }
}

// ------------------------------------------------------ phase 1: loans

function startBidPhase(s) {
  s.phase = "bid_initial";
  s.bidPending = s.cfg.initialBidsInverted
    ? [...s.turnOrder].reverse() : [...s.turnOrder];
  s.bids = {};
  s.bidSeq = {};
  s.bidCounter = 0;
  s.nextOrder = new Array(s.nPlayers).fill(null);
}

function setBid(s, pid, value) {
  s.bids[pid] = value;
  s.bidSeq[pid] = s.bidCounter++;
}

function passOut(s, pid, bid) {
  let slot = s.nPlayers - 1;
  while (s.nextOrder[slot] !== null) slot--;
  s.nextOrder[slot] = pid;
  const player = s.players[pid];
  const taken = grantLoans(s, player, bid);
  player.money += bid * s.cfg.moneyPerLoan;
  const dry = taken < bid ? ` (track dry: only ${taken} markers removed)` : "";
  log(s, `P${pid} passes at bid ${bid}: +${bid} loans, ` +
         `+$${bid * s.cfg.moneyPerLoan}${dry}; turn order spot ${slot + 1}`);
}

function finishBidding(s) {
  s.turnOrder = [...s.nextOrder];
  s.buyPtr = 0;
  s.buyPassed = new Set();
  s.phase = "buy";
  log(s, `turn order: ${s.turnOrder}, interest rate now ${currentRate(s)}`);
}

// -------------------------------------------------------- phase 2: buy

function doBuy(s, pid, r, c, cityIdx) {
  const cfg = s.cfg;
  const cell = s.display[r][c];
  const cost = cell.card.cost * cfg.rowCostMultipliers[r];
  const player = s.players[pid];
  player.money += cell.money;
  player.money -= cost;
  s.display[r][c] = null;
  s.cities[cityIdx][cell.card.type].push({ card: cell.card, owner: pid });
  log(s, `P${pid} buys ${cell.card.type.slice(0, 3)}(c${cell.card.cost}/` +
         `i${cell.card.income}) from row ${r + 1} for $${cost}` +
         `${cell.money ? ` (+$${cell.money} on card)` : ""} -> city ${cityIdx + 1}`);
}

// ----------------------------------------------------- phase 3: income

function determineSubsidies(cities) {
  const stateSubs = new Set();
  for (const typ of TYPES) {
    const counts = cities.map(c => c[typ].length);
    const low = Math.min(...counts);
    if (counts.filter(x => x === low).length === 1) {
      stateSubs.add(key(counts.indexOf(low), typ));
    }
  }
  const citySubs = {};
  cities.forEach((city, ci) => {
    for (const typ of TYPES) {
      const owned = {};
      for (const b of city[typ]) {
        if (b.owner !== null) owned[b.owner] = (owned[b.owner] || 0) + 1;
      }
      const vals = Object.values(owned);
      if (vals.length) {
        const best = Math.max(...vals);
        const leaders = Object.keys(owned).filter(p => owned[p] === best);
        if (leaders.length === 1) citySubs[key(ci, typ)] = Number(leaders[0]);
      }
    }
  });
  return [stateSubs, citySubs];
}

function collectIncome(s) {
  const cfg = s.cfg;
  [s.stateSubsidies, s.citySubsidies] = determineSubsidies(s.cities);
  s.cities.forEach((city, ci) => {
    for (const typ of TYPES) {
      const stateSub = s.stateSubsidies.has(key(ci, typ));
      const citySubOwner = s.citySubsidies[key(ci, typ)];
      for (const b of city[typ]) {
        if (b.owner === null) continue;
        const p = s.players[b.owner];
        p.money += b.card.income;
        p.incomeEarned += b.card.income;
        const both = stateSub && citySubOwner === b.owner;
        const single = stateSub || citySubOwner === b.owner;
        const bonus = both ? cfg.doubleSubsidyBonus
                    : single ? cfg.singleSubsidyBonus : 0;
        p.money += bonus;
        p.subsidyEarned += bonus;
      }
    }
  });
  log(s, "income collected");
}

function payInterest(s) {
  const rate = currentRate(s);
  s.unable = new Set();
  for (const p of s.players) {
    if (p.bankrupt) continue;
    const due = interestDue(s, p);
    const paid = Math.min(due, p.money);
    p.money -= paid;
    p.interestPaid += paid;
    if (paid < due) {
      s.unable.add(p.pid);
      log(s, `P${p.pid} owes $${due} interest, can only pay $${paid} — DEFAULT`);
    } else {
      log(s, `P${p.pid} pays $${due} interest (rate ${rate} x ${p.loans} loans)`);
    }
  }
}

// --------------------------------------- phase 4: bankruptcy / game end

function resolveRoundEnd(s) {
  if (s.unable.size) { setupBankruptcy(s); return; }
  if (markersLeft(s) === 0) { s.endCause = "loans_exhausted"; scoreAndEnd(s); return; }
  if (s.round >= s.cfg.maxRounds) { s.endCause = "rounds"; scoreAndEnd(s); return; }
  cleanup(s);
  startBidPhase(s);
}

function setupBankruptcy(s) {
  s.endCause = "bankruptcy";
  let order;
  if (s.cfg.bankruptcyPick === "latest") order = [...s.turnOrder].reverse();
  else if (s.cfg.bankruptcyPick === "most_loans") {
    order = [...s.turnOrder].sort((a, b) => s.players[b].loans - s.players[a].loans);
  } else order = s.turnOrder;
  for (const pid of order) {
    if (s.unable.has(pid)) { s.bankruptPid = pid; break; }
  }
  s.players[s.bankruptPid].bankrupt = true;
  for (const pid of s.unable) {
    if (pid !== s.bankruptPid) { s.bailedOut.add(pid); s.players[pid].money = 0; }
  }
  log(s, `P${s.bankruptPid} goes bankrupt; bailed out: ` +
         `[${[...s.bailedOut].join(", ")}]`);
  s.bailoutLots = [];
  s.cities.forEach((city, ci) => {
    const mine = [];
    for (const typ of TYPES) {
      const keep = [];
      for (const b of city[typ]) {
        (b.owner === s.bankruptPid ? mine : keep).push(b);
      }
      city[typ] = keep;
    }
    if (mine.length) {
      const pick = s.rng.randrange(mine.length);
      mine.forEach((b, i) => {
        if (i === pick) s.bailoutLots.push({ city: ci, card: b.card });
        else { b.owner = null; city[b.card.type].push(b); }
      });
    }
  });
  if (s.bailoutLots.length) {
    s.bailoutQueue = s.turnOrder.filter(pid => !s.players[pid].bankrupt);
    s.phase = "bailout";
  } else scoreAndEnd(s);
}

function doBailoutBuy(s, pid, lotIndex) {
  const lot = s.bailoutLots[lotIndex];
  const price = lot.card.cost * s.cfg.bailoutPriceMultiplier;
  s.players[pid].money -= price;
  s.cities[lot.city][lot.card.type].push({ card: lot.card, owner: pid });
  log(s, `P${pid} buys repossessed building in city ${lot.city + 1} for $${price}`);
  lot.card = null;
}

function finishBailout(s) {
  for (const lot of s.bailoutLots) {
    if (lot.card) s.cities[lot.city][lot.card.type].push({ card: lot.card, owner: null });
  }
  s.bailoutLots = [];
  scoreAndEnd(s);
}

function scoreAndEnd(s) {
  const cfg = s.cfg;
  const alive = s.players.filter(p => !p.bankrupt);
  for (const p of s.players) {
    p.vp = p.bankrupt ? 0
      : s.cities.reduce((n, c) => n + cfg.vpPerBuilding * ownedCount(c, p.pid), 0);
  }
  for (const city of s.cities) {
    let best = 0;
    const counts = {};
    for (const p of alive) {
      counts[p.pid] = ownedCount(city, p.pid);
      best = Math.max(best, counts[p.pid]);
    }
    if (best > 0) for (const p of alive) {
      if (counts[p.pid] === best) p.vp += cfg.vpCityMajority;
    }
  }
  for (const k of s.stateSubsidies) {
    const [ci, typ] = splitKey(k);
    let best = 0;
    const counts = {};
    for (const p of alive) {
      counts[p.pid] = ownedCount(s.cities[ci], p.pid, typ);
      best = Math.max(best, counts[p.pid]);
    }
    if (best > 0) for (const p of alive) {
      if (counts[p.pid] === best) p.vp += cfg.vpStateSubsidyPerBuilding * counts[p.pid];
    }
  }
  if (alive.length) {
    let bestKey = [-1, -1];
    for (const p of alive) {
      if (p.vp > bestKey[0] || (p.vp === bestKey[0] && p.money > bestKey[1])) {
        bestKey = [p.vp, p.money];
      }
    }
    s.winners = alive.filter(p => p.vp === bestKey[0] && p.money === bestKey[1])
                     .map(p => p.pid);
  }
  s.phase = "over";
  log(s, `game over (${s.endCause}); winners: [${s.winners.join(", ")}]`);
}

// ---------------------------------------------------- phase 5: cleanup

function cleanup(s) {
  const cfg = s.cfg;
  s.stateSubsidies = new Set();
  s.citySubsidies = {};
  for (const cell of s.display[0]) if (cell) cell.money += cfg.staleCardMoney;
  const cols = s.display[0].length;
  for (let c = 0; c < cols; c++) {
    const stack = [];
    for (let r = 0; r < cfg.displayRows; r++) {
      if (s.display[r][c]) stack.push(s.display[r][c]);
    }
    for (let r = 0; r < cfg.displayRows; r++) {
      s.display[r][c] = r < stack.length ? stack[r] : null;
    }
  }
  refillDisplay(s);
  s.round += 1;
  let expired = 0;
  for (let i = 0; i < s.loanMarkers.length; i++) {
    if (s.loanMarkers[i] && s.loanRows[i] < s.round) {
      s.loanMarkers[i] = false;
      expired++;
    }
  }
  log(s, `cleanup: round -> ${s.round}, ${expired} loan markers expired, ` +
         `rate now ${currentRate(s)}`);
}

function refillDisplay(s) {
  for (const row of s.display) {
    for (let c = 0; c < row.length; c++) {
      if (!row[c] && s.deck.length) row[c] = { card: s.deck.pop(), money: 0 };
    }
  }
}

// ------------------------------------------------------------- exports

const Engine = {
  TYPES, RES, COM, IND, PASS,
  defaultConfig, makeRng, newGame, legalActions, applyAction, decisionPlayer,
  currentRate, rateAfter, markersLeft, interestDue, ownedCount, scoreSnapshot,
  determineSubsidies, key, splitKey, same,
};
if (typeof module !== "undefined") module.exports = Engine;
if (typeof globalThis !== "undefined") globalThis.SubprimeEngine = Engine;
})();
