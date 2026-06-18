# Headless prototype v2 (10 games) — does the route branch?

v1 (5 games) proved order *matters* but the routing was shallow — one critical path
(Bank→Blueprint). v2 scales to 10 games specifically to test whether the route **branches**:
are there multiple genuinely-different viable routes, and does the *best* route change with
conditions (the seeded-roguelike hypothesis from the design doc)?

Run it: `node alphabet-idlers/sim/run2.js` (Node, no deps).

## The 10-game graph

4 free entry points (A sparks · M ore · E power · R pearls). The City (C) wins at population 1000
and grows **two substitutable ways**: construction (bricks→buildings) **or** agriculture (food).
Crucially, **gold has three sources** — Bank compounding (B), Trade selling ore/pearls (T), and
Reef+Trade (R→T) — so the Bank is no longer a mandatory chokepoint. Research (P, gold→science) is
an engine node unlocking FERTILIZER (gates Farm), MASS_PRODUCTION (½ brick cost), SUPERCONDUCTOR.
A per-run **boon** (seed) doubles one lever to test whether the optimal route shifts.

## Verdict: yes, it branches — but only along bootstrap-facing axes

**Multiple distinct routes win, and the winner changes with the seed:**

```
boon          construction  constr+engine  agriculture  trade-engine   | winner
NONE              1:07          1:08          1:15         1:23         | construction
RICH_VEIN         1:07          1:09          0:40         0:57         | agriculture
FERTILE           1:07          1:08          1:13         1:17         | construction
BULL_MARKET       1:05          0:51          1:15         1:23         | constr+engine
TRADE_WINDS       1:07          1:08          1:05         1:07         | agriculture
POWER_SURGE       1:07          1:08          1:15         1:18         | construction
```

3 different routes are each optimal under some seed (construction default; **agriculture** under
RICH_VEIN & TRADE_WINDS; **constr+engine** under BULL_MARKET). That's real branching: with no
single dominant strategy, "what's the best route *this run*?" becomes a genuine question — which is
exactly the seeded-roguelike pitch.

## The most useful finding: a design law about *where* rewards must land

Three boons flip the winner (RICH_VEIN, BULL_MARKET, TRADE_WINDS); **two are completely inert**
(FERTILE, POWER_SURGE — agriculture's time is identical with or without them). Tracing why:

```
agriculture, NONE:      win @75s   (FERTILIZER unlocked @64s, FOOD_EXPORT @65s)
agriculture, FERTILE:   win @73s   — steady-state farm x2, basically no change
agriculture, RICH_VEIN: win @40s   (FERTILIZER @30s) — bootstrap x2, decisive
```

Agriculture spends **64 of 75 seconds reaching FERTILIZER**; actual farming is a 10-second tail.
So:
- **RICH_VEIN / TRADE_WINDS** speed the *bootstrap* (more ore / better ore→gold → faster research) → big.
- **FERTILE / POWER_SURGE** speed *steady-state throughput* (the 10s tail) → invisible.

**The law:** in a saturating, parallel idler, total time is dominated by the unlock/bootstrap phase,
not the steady state. Cross-game rewards and seeds must therefore target **bootstrap economies**
(unlock gates, cost curves, the resource that funds the next unlock) — not steady-state multipliers.
This is the same rule the v1 reward taxonomy stated from intuition ("no flat % multipliers; change
the curve / automate / gate") — here the simulation *derives* it. Good independent confirmation that
the taxonomy is the right design discipline.

## What's still weak

- **trade-engine never wins** — it's currently a dominated route (the pearl-gold nerf overcorrected).
  A 10-node graph wanting 4 live routes needs more balancing passes; one route being dead is fine for
  a prototype but shows hand-tuning 26 games will be real work (argues for tooling / auto-tuning).
- **Pacing is still ~1 min** vs the 15–30 min design target — numbers are tiny; structural test only.
- **roundRobin still hard-fails** (pop 60) — spreading attention thin soft-locks, consistent with v1.
- **Only 3 of 5 boons are live**, by the law above. To make FERTILE/POWER_SURGE matter, the *farm/
  power economy itself* would need to gate an unlock (e.g., power required to research SUPERCONDUCTOR),
  moving those levers onto the bootstrap path. That's the concrete next tuning move.

## Bottom line

The route genuinely branches at 10 games: no dominant strategy, and the optimal route depends on the
seed — the seeded-roguelike direction is validated in miniature. The simulation also produced a
reusable design law (rewards/seeds must hit bootstrap economies, not steady-state rates) that should
drive how the remaining 16 games and their unlocks are designed. Two open items before scaling
further: better balancing tooling (manual tuning of 26 interacting games won't scale), and a real
pacing pass so "feel," not just structure, can be evaluated.
