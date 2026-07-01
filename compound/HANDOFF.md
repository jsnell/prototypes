# COMPOUND — handoff

A hex-grid space-colony **flow-puzzle**. You place buildings on a fixed map;
buildings turn raw deposits into refined goods through supply chains; you must
satisfy timed **directives** (sustain a production rate for N turns by a
deadline). Score is a **star rating** = number of *optional* directives cleared.
Required directives are the entry bar — failing one is a defeat; clearing all
required with zero optionals is a valid 0-star win.

The design work has two intertwined halves:
1. **The game model** — the economy, the flow solver, the worker mechanic, the UI.
2. **Scenario design** — using a search-based "lab" to build directive sets that
   are *interesting*: an optimal player should score far better than a naive one.

---

## Repo layout

| Path | Role |
|---|---|
| `engine.js` | **The playable game logic** — map, buildings, flow solver, directives, turn processing. Runs in the browser (`window.COMPOUND`) and Node (`require(...).COMPOUND`). |
| `index.html` | The playable UI. Loads `engine.js` via `<script src="engine.js?v=…">`. |
| `search-rs/` | **The lab** (Rust). A faithful port of the engine + a greedy AI + a beam search + scenario-design tools. This is where all balancing/analysis happens. |
| `replay-check.js` | Node harness that replays a Rust-exported AI solution through `engine.js` and asserts the outcome matches — the **Rust↔JS parity check**. |
| `HANDOFF.md` | This file. |

**Canonicality rule:** the Rust lab (`search-rs/src/main.rs`) is the source of
truth for *logic and scenarios*. `engine.js` is the playable mirror. Any change
to mechanics or the scenario must be made in **both** and confirmed with
`replay-check.js`. They are kept in sync by hand, not generated.

---

## The game model

- **Map:** 9×7 odd-r offset hex grid (63 tiles), hardcoded deposits (ore/ice/
  silica/rare), wrecks, and lava tubes. Tile id = `r*9 + q`, identical in Rust
  and JS.
- **Goods (14):** power, workers, food, water, ore, ice, silica, rare, metal,
  glass, alloy, electronics, components, research.
- **Buildings (19)** in three tiers. Each turn you may place a limited number per
  tier (`buildRate`). Tier 3 (assembler, lab) is locked until directive D3.
  Placement is free; the constraint is the per-tier per-turn budget and tiles.
- **Flow solver** (`solveFlows` in JS / `solve` in Rust): an iterative
  fixed-point that throttles every consumer proportionally when a good is short.
  **Life support** (food/water/power, 0.2/colonist) is a first claim before
  industry. Heat-producing buildings need adjacent radiators or they run at a
  reduced `heatRatio`. Adjacency gives clustering / lab-synergy / solar / lava
  multipliers.
- **Population** grows by immigration each turn *if* life support was fully met,
  up to housing capacity. Colonists supply labor (`workers`) exogenously.
- **Directives:** "sustain `good ≥ rate` for `dur` turns by `deadline`." Required
  (`must`) vs optional. Some requireds grant **rewards** on completion (build-rate
  increases, the tier-3 unlock, a demolish allowance). The run ends only when
  *every* directive is resolved (done or failed past deadline), so optionals can
  still be earned after the requireds are done.

### The worker mechanic (important, and subtle)

Workers are allocated by a **uniform, single-pass, no-reclaim** rule:

- Nominal demand `wd = Σ (raw worker input of each building)` — the **raw**
  requirement, *not* scaled by heat or by any throttle.
- The worker throttle `wr = min(1, pop / wd)` is computed **once** and frozen.
  Every worker-consuming building is cut by the same `wr`.
- Labor is **never reclaimed**: if a building turns out to be limited by a
  material shortage (or heat), the labor it reserved is simply wasted, not handed
  back to raise `wr` for others.

Why this design:
- It's **legible** — one colony-wide ratio, not an opaque equilibrium.
- It **penalizes overbuilding** — an idle or half-fed building still ties up its
  full labor, so you can't spam speculative infrastructure for free.

The UI reflects this: the workers row shows **labor balance = `pop − wd`**
(goes negative exactly when over-subscribed / red), and the building inspector
shows each building's claim `raw_demand × wr`.

> **Bug we fixed here:** worker demand originally used `raw × heatRatio`, so a
> thermally-throttled building reserved *less* labor — inconsistent, since heat
> is a throttle like any other. Demand is now the raw requirement. This made
> labor genuinely scarcer and invalidated scenarios tuned to the old behavior.

---

## Scenario design — the interesting part

A scenario is 5 required directives (the food→metal→electronics→components→
research **tech-tree spine**, with the rewards attached) plus 4 optionals. The
goods are treated as a **fixed property of the seed** (the spine's identity);
what we tune is **ordering, durations, rates, and deadlines**.

The quality metric is **gap = (optimum's stars) − (greedy's stars)**. A big gap
means skill matters: the optimal player clears optionals the naive heuristic
can't. The current shipped scenario is **gap 4** (greedy 0/4, optimum 4/4 @T18) —
every optional demands non-greedy play.

### Things we learned (don't relearn them)

1. **An optional a greedy heuristic can pass is probably not interesting.** So
   maximize the gap; the ceiling (greedy 0/4) is the goal, not a worry. We have
   *not* been anywhere near "unfair."

2. **The gap comes from timing/amount/contention, not from the good.** Optionals
   create a gap when they demand *more* than the matching required (e.g. research
   opt @5×3 vs required @2×2), or need output *earlier*, or need a buildout that
   **contends** with a different required's buildout. Shared goods do **not** hand
   greedy the optionals.

3. **Beam search is non-monotonic; `plancap` is the lever, not beam width.**
   A wider beam can return *fewer* stars. The instability was `plancap` truncating
   the winning plan composition — at `plancap 800` the optimum is found reliably
   across beams 64–256. `beam 64` is fine once plancap is high enough. Treat the
   search as the optimum oracle **only at plancap ≥ 800**.

4. **The hill-climb needs a timing-aware gradient.** The gap (an integer) is a
   flat plateau, so the climb rides a continuous "tension" signal. The first
   version used greedy's *peak surplus margin* — which is **timing-blind** (max
   over all turns) and only ever discovered "amount" gaps; it stalled at gap 2.
   Switching tension to greedy's per-directive **progress shortfall** (which is
   inherently deadline- and contention-sensitive) found gap 4 with goods fixed.

5. **The full-clear constraint traps the climb.** Requiring the optimum to clear
   all optionals at *every* step walls off the valleys the climb must cross.
   Since gap already rewards a high optimum, leave the constraint off
   (`FULLCLEAR=0`, the default) and a full-clearable peak emerges on its own.

6. **The gradient can't tighten everything; a deterministic pass mops up.** The
   gradient only tightens directives greedy is "on the edge" of — required
   deadlines carry *no* tension, and an already-failed optional's deadline has a
   flat gradient. The `tighten` mode deterministically pulls the remaining slack
   to the joint feasibility edge. Division of labor: **gradient for the gap,
   deterministic pass for the slack.**

---

## Operating the lab

Build once:

```
cd search-rs && cargo build --release
```

Then `./target/release/search <mode>` (default mode is `search`). All tuning is
via env vars; the important defaults are `BEAM=64`, `PLANCAP=800`.

### Modes

| Mode | What it does |
|---|---|
| `search` | Beam-search the current scenario for the optimum; prints stars, finish turn, and the per-turn plan. |
| `greedy` | Run the greedy heuristic AI; prints its stars and per-directive completion. |
| `gap` | Run both and print the gap, with the search plan. **The go-to sanity check.** |
| `hill` | Hill-climb the scenario for maximum gap (see below). Prints the best scenario + a full-beam verify. |
| `tighten` | Deterministically remove slack from the current scenario (pull deadlines / raise rates to the joint edge) while holding greedy 0 and optimum full-clear. `NORATE=1` = deadlines only. |
| `slack` | Per-directive: how early each deadline can go (others fixed) while staying feasible. Diagnostic. |
| `export` | Emit both AI solutions as explicit per-turn moves (JSON) for `replay-check.js`. |
| `gen` | Older random-sampling scenario generator (fixed spine + sampled optionals). Superseded by `hill` but still handy. |
| `sweep` / `validate` / `nobuild` | Variant sweeps, JS-order replay check, and a build-nothing economy trace. |

### Env vars

| Var | Default | Meaning |
|---|---|---|
| `BEAM` | 64 | Beam width. |
| `PLANCAP` | 800 | Plans kept per node. **Keep ≥ 800** or the optimum is unreliable. |
| `HORIZON` | 18 (=TURNS) | Search depth. |
| `ITERS` | 120 | Hill-climb steps per restart. |
| `RESTARTS` | 3 | Hill-climb restarts (best kept). |
| `HBEAM` | =`BEAM` | Beam used *inside* the hill-climb fitness. Keep = production beam. |
| `SEED` | fixed | RNG seed for `hill` / `gen`. |
| `FULLCLEAR` | 0 | `1` forces the optimum to full-clear at every climb step (traps it — leave 0). |
| `NORATE` | 0 | `1` makes `tighten` deadlines-only (no rate bumps). |
| `GENN`/`GENK`/`REWARDS` | — | `gen`-mode knobs. |
| `PARAMS` | — | Load econ+directives from a file instead of the built-in scenario. |

### Typical scenario-design loop

```
# 1. start from a loose, feasible baseline in scenario() (main.rs), confirm:
./target/release/search gap                      # greedy clears requireds, some gap

# 2. climb for max gap (goods stay fixed; rate/deadline/dur mutate):
ITERS=120 RESTARTS=4 SEED=<n> ./target/release/search hill

# 3. paste the BEST directives into scenario() in main.rs, re-verify:
./target/release/search gap

# 4. optionally remove leftover slack:
NORATE=1 ./target/release/search tighten         # deadlines only
#   ...paste tightened deadlines back into scenario(), re-verify with gap
```

---

## Shipping a scenario to the game (the sync + parity ritual)

The lab result only counts once it's mirrored into the playable game and proven
equivalent. Every scenario change goes through this:

1. **Rust:** set the directives in `scenario()` in `search-rs/src/main.rs`.
   `./target/release/search gap` → confirm greedy/optimum stars.
2. **JS:** mirror the same directives into the `directives:` array in
   `engine.js` (id/name/good/rate/dur/deadline/req/must/reward). Required goods
   and their rewards must match the Rust spine.
3. **Cache-bust:** bump the `?v=…` token on the `engine.js` include in
   `index.html` (browsers/preview cache the subresource; bumping forces a refetch
   *and* changes `index.html` so it can't be served stale).
4. **Parity:** 
   ```
   ./search-rs/target/release/search export > /tmp/sol.json
   node replay-check.js /tmp/sol.json
   ```
   Both AI solutions must report `✓ MATCH` (search stars and greedy stars
   identical in Rust and JS). This is what proves the JS engine and the Rust lab
   still agree — especially after any mechanics change.

If parity fails, the two engines have diverged (a mechanic ported to one but not
the other); fix before shipping.

---

## Playing / debugging the game

- Open `index.html`. Build from the tier-grouped palette, end turns, watch the
  **resource balance** table (production / life / inputs / directives / balance
  per good) and the directive progress bars.
- **Copy** dumps the full game log; **Paste** replays a pasted log to reconstruct
  a state (great for reproducing a situation or continuing from a shared log).
- The workers row and the building inspector's "workers: X / Y allocated" line
  are the window into the labor mechanic.

---

## Current state

- **Scenario:** hill-climbed (timing-aware) then deadlines-only tightened —
  greedy 0/4, optimum 4/4 @T18. Fixed tech-tree spine; optionals research/
  water/electronics/alloy chosen for timing/amount/contention, not goods.
- **Worker model:** corrected (raw demand, no heat discount), uniform no-reclaim.
- **Search:** reliable at `plancap 800`.
- Rust and JS verified in parity.

## Open threads / next ideas

- The `hill` gradient could also become required-deadline-aware if we ever want
  the climb (not the `tighten` pass) to front-load the spine.
- `must`/optional flips and reward re-assignment are *not* mutated by the climb —
  the required spine + rewards are held fixed. Making those mutable is a larger
  design change (rewards are attached to specific requireds).
- No automated Rust↔JS parity test in CI; `replay-check.js` is run by hand.
