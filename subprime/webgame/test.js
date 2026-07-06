/* JS engine tests — run: node webgame/test.js
 * Mirrors the invariants of the Python suite (the design-lab source of
 * truth) so the port can be trusted for play. */
"use strict";
const E = require("./engine.js");
const A = require("./agents.js");

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
}

// ---- full games with every registered agent terminate cleanly -------
const names = Object.keys(A.REGISTRY);
for (let seed = 1; seed <= 30; seed++) {
  const lineup = [0, 1, 2, 3].map(i => names[(seed + i) % names.length]);
  const agents = lineup.map((n, i) => A.REGISTRY[n](seed * 100 + i));
  const s = E.newGame(E.defaultConfig(), 4, seed, false);
  let steps = 0;
  while (s.phase !== "over") {
    const pid = E.decisionPlayer(s);
    const acts = E.legalActions(s);
    check(acts.length > 0, "no legal actions");
    E.applyAction(s, agents[pid].act(s, pid, acts));
    check(++steps < 3000, "game did not terminate");
    if (steps >= 3000) break;
  }
  check(["bankruptcy", "loans_exhausted", "rounds"].includes(s.endCause),
        `bad end cause ${s.endCause}`);
  check(s.round <= s.cfg.maxRounds, "exceeded max rounds");
  for (const p of s.players) {
    check(p.money >= 0, `negative money ${p.money}`);
    check(p.vp >= 0, "negative vp");
    check(p.loanRates.length === p.loans,
          `loanRates ${p.loanRates.length} != loans ${p.loans}`);
  }
  if (!s.players.every(p => p.bankrupt)) {
    check(s.winners.length > 0, "no winners");
  }
}

// ---- determinism ------------------------------------------------------
function play(seed) {
  const agents = [0, 1, 2, 3].map(i => A.REGISTRY.digest(7 + i));
  const s = E.newGame(E.defaultConfig(), 4, seed, false);
  while (s.phase !== "over") {
    const pid = E.decisionPlayer(s);
    E.applyAction(s, agents[pid].act(s, pid, E.legalActions(s)));
  }
  return JSON.stringify([s.endCause, s.winners, s.players.map(p => p.vp)]);
}
check(play(42) === play(42), "not deterministic for same seed");

// ---- setup counts ------------------------------------------------------
{
  const s = E.newGame(E.defaultConfig(), 4, 1, false);
  check(s.cities.length === 3, "cities != players-1");
  check(s.display.length === 3 && s.display[0].length === 5, "display dims");
  check(s.deck.length === 100 - 15, "deck after deal");
  check(E.markersLeft(s) === 50 - 4, "starting loans off track");
  for (const p of s.players) {
    check(p.loans === 1 && p.money === 10, "starting resources");
  }
  check(E.currentRate(s) === 1, "initial visible rate");
  check(E.rateAfter(s, 6) === 1 && E.rateAfter(s, 7) === 2 &&
        E.rateAfter(s, 999) === 6, "rateAfter projection");
}

// ---- bid flow: loans, turn order, full grants when track dry -----------
{
  const s = E.newGame(E.defaultConfig(), 3, 2, false);
  // drain to 2 markers
  let left = E.markersLeft(s) - 2;
  for (let i = 0; i < s.loanMarkers.length && left > 0; i++) {
    if (s.loanMarkers[i]) { s.loanMarkers[i] = false; left--; }
  }
  const order = [...s.turnOrder];
  const [p5, p6, p0] = [order[2], order[1], order[0]];
  E.applyAction(s, ["bid", 5]);
  E.applyAction(s, ["bid", 6]);
  E.applyAction(s, ["pass"]);   // p0 passes outright (no 0 space; ruling)
  E.applyAction(s, ["pass"]);   // p5: only 2 markers, full 5 loans anyway
  E.applyAction(s, ["pass"]);   // p6
  check(s.players[p5].loans === 6 && s.players[p5].money === 60,
        "bid honored when markers run out");
  check(s.players[p6].loans === 7 && s.players[p6].money === 70,
        "second dry bid honored");
  check(E.markersLeft(s) === 0, "track drained");
  check(E.same(s.turnOrder, [p6, p5, p0]), "turn order high bid first");
  check(s.phase === "buy", "buy phase after bidding");
}

// ---- income & subsidies -------------------------------------------------
{
  const s = E.newGame(E.defaultConfig(), 3, 3, false);
  for (const c of s.cities) for (const t of E.TYPES) c[t] = [];
  const card = { id: 900, type: E.RES, cost: 2, income: 2 };
  s.cities[0][E.RES] = [{ card, owner: 0 }, { card, owner: 0 }];
  s.cities[1][E.RES] = [{ card, owner: 1 }];
  s.players.forEach(p => { p.money = 0; });
  const [stateSubs, citySubs] = E.determineSubsidies(s.cities);
  check(stateSubs.has(E.key(1, E.RES)) && stateSubs.size === 1,
        "state subsidy strict fewest");
  check(citySubs[E.key(0, E.RES)] === 0 && citySubs[E.key(1, E.RES)] === 1,
        "city subsidies to strict leaders");
  // payout: P0 2x($2+$1)=6; P1 1x($2+$3 both)=5
  s.stateSubsidies = stateSubs; s.citySubsidies = citySubs;
  s.cities.forEach((city, ci) => {
    for (const t of E.TYPES) {
      const st = stateSubs.has(E.key(ci, t));
      const cs = citySubs[E.key(ci, t)];
      for (const b of city[t]) {
        if (b.owner === null) continue;
        const both = st && cs === b.owner, single = st || cs === b.owner;
        s.players[b.owner].money += b.card.income +
          (both ? 3 : single ? 1 : 0);
      }
    }
  });
  check(s.players[0].money === 6, `P0 income ${s.players[0].money}`);
  check(s.players[1].money === 5, `P1 double subsidy ${s.players[1].money}`);
}

// ---- scoreSnapshot with bankruptcy preview ------------------------------
{
  const s = E.newGame(E.defaultConfig(), 3, 4, false);
  for (const c of s.cities) for (const t of E.TYPES) c[t] = [];
  const rc = { id: 901, type: E.RES, cost: 2, income: 1 };
  const cc = { id: 902, type: E.COM, cost: 2, income: 1 };
  s.cities[0][E.RES] = [{ card: rc, owner: 0 }, { card: rc, owner: 0 }];
  s.cities[0][E.COM] = [{ card: cc, owner: 1 }];
  const snap = E.scoreSnapshot(s);
  check(snap[0] === 5 && snap[1] === 1 && snap[2] === 0,
        `snapshot ${JSON.stringify(snap)}`);
  const ex = E.scoreSnapshot(s, 0);
  check(ex[1] === 4 && ex[2] === 0, "exclude preview hands majority to P1");
}

// ---- steep-curve config -----------------------------------------------
{
  const cfg = E.defaultConfig();
  cfg.loanRowRates = [2, 3, 4, 6, 8, 10];
  const s = E.newGame(cfg, 4, 5, false);
  check(E.rateAfter(s, 999) === 10, "tuned curve max rate");
}

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("all JS engine tests passed");
