# Headless prototype — findings

Ran a deterministic, no-UI simulation of the 5-game slice (A/M/B/K/C) with several scripted
play strategies, to test the core design bet: **is the cross-game routing actually load-bearing,
or is it chores with arrows?**

Run it: `node alphabet-idlers/sim/run.js` (Node, no deps).

## What the engine models

- One **manual action per tick** (click / dig / deposit / place / buy) = scarce player attention.
- **Passive production every tick** for unlocked/automated systems.
- A shared resource economy (`sparks` feed *both* the Bank and the Kiln — a real contention point)
  and 7 unlock flags fired by thresholds.
- The full dependency DAG from the design doc: 2 free entry points, the A→B soft-gate, the
  M↔K broken cycle (Mine caps at depth 10 until the Kiln grants `MINE_CAP_RAISE`), and the
  diamond into C (needs both `BRICKS_EXPORT` from K and `BLUEPRINT_WORKSHOP` from B).

## Verdict: the core concept holds

**1. Order matters — strongly.** Of six strategies, two **soft-lock and never win**:

| strategy | result | why |
|---|---|---|
| interleaved / bankRush | win ~1:05 | bootstrap A → dig M → run K while growing B → build C |
| kilnGreedy | win ~1:01 (fastest) | hoarding sparks for the Kiln slightly beats |
| serialNaive | win ~1:33 (1.5x slower) | finishing each game before the next starts the Kiln far too late |
| **mFirst** | **FAIL** | digging the Mine before bootstrapping the Automaton lets the Kiln strangle the spark economy |
| **roundRobin** | **FAIL (pop 200)** | attention spread too thin; Bank never reaches Blueprint → stuck at the diamond |

That two plausible-looking orders fail outright (not just run slow) is the strongest signal that
routing is a real decision, not decoration.

**2. The `mFirst` soft-lock is an emergent trap, not a scripted one.** Diagnostic: clickPower never
rises above 1, so auto-click yields 1 spark/tick while the Kiln (running on depth-25 ore) consumes
2/tick. Sparks pin at zero, the Bank never gets fed, ore piles uselessly to ~179k. Cause: digging
first means automation arrives *after* the Kiln is already at full tilt, so the Spark economy can
never bootstrap. This is exactly the "wrong order strangles you" dynamic we hoped for.
(Caveat: it's escapable — a player who manually clicks to rebuild clickPower can recover. So it's a
punishing-but-recoverable mistake, which is good, not a literal dead end.)

**3. All four structural claims verified** (by disabling one unlock and re-simulating):

- `BRICKS_EXPORT` removed → city can't build at all → **cannot win** (Kiln path is mandatory).
- `BLUEPRINT_WORKSHOP` removed → houses cap population at 200 → **cannot win** (the diamond is real).
- `MINE_CAP_RAISE` removed → Mine **stuck at depth 10** (the broken cycle is real); winning still
  possible but ~1.6x slower (the cap-raise is valuable, not just flavor).

**4. The soft-gate works.** Reaching the Bank's Blueprint takes **~1.9x longer** without
`AUTO_CLICKER` (hand-feeding sparks) than with it — enough to make automation feel necessary
without a hard lock.

## What's weak / needs work

- **Absolute pacing is way off.** Everything resolves in ~1 minute vs. the design's 15–30 min
  target. Pure tuning (thresholds/rates are tiny), but it means these runs test *structure*, not
  *feel*. Scale the numbers before judging pacing.
- **The Bank↔Kiln spark contention is underexpressed on the main line.** `bankRush` (deposit
  everything, reserve 0) tied `interleaved` exactly — starving the Kiln didn't cost anything for
  winning strategies. The interesting tension currently lives at the *bootstrap* (mFirst), not at
  the Bank/Kiln split. If we want the shared-spark decision to bite during normal play, the Kiln
  needs to be hungrier or sparks scarcer.
- **The critical path is just Bank→Blueprint** (fires at 0:49 of a 1:05 win). Most routing choices
  only change how fast you reach that one node. With only 5 games the "puzzle" is shallow — more
  nodes/bridges are needed before the routing has genuine branching depth. This is expected at 5
  games; it's the main reason to test a larger subset next.

## Bottom line

The mechanics work and the dependency web produces real, legible consequences for play order —
including two distinct soft-lock failure modes and four verified structural dependencies. The
concept is worth pursuing. The immediate next step isn't polish, it's **more nodes**: 5 games make
the routing demonstrable but shallow. Re-run this harness at ~8–10 games (and retuned pacing) to
see whether the route genuinely branches.
