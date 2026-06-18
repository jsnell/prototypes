# COMPOUND — findings from the v0.1 mechanics prototype

`sim.js` is an ES5 (node) executable model of the mechanics plus a heuristic AI
that plays the "Mare Frigoris" scenario. `playthrough.txt` is a winning run.
Run it yourself: `node sim.js` (full turn log) or `node sim.js quiet` (summary).

The point was **data**: does the production graph + compounding + directive pacing
actually produce the intended tension? Getting from "AI starves on turn 5" to a
clean **MAJOR VICTORY** took ~15 iterations, and each failure taught us something
structural. Those lessons matter more than the final numbers.

## What the model covers
Full production graph (6 raws → ~20 goods), power-as-flow with brownouts,
population-as-labour, staffing/heat/deposit/tile constraints, tech eras, the
compounding multipliers (Automation Hub, AI Core, self-replicating Fabricator),
and the laddered directive schedule with optional early-completion bonuses.
Spatial layer is **aggregate** (global tile budget + deposit slots + heat budget),
not a hex grid — enough to surface the *costs* of space without a placement AI.

## The big findings (design-level, not just balance)

1. **Flat "ship metal" gates make the entire tech tree vestigial.** The first
   schedules only ever demanded metal — which is also the build currency. Optimal
   play was to spam smelters and *never touch* components/research/eras. The whole
   compounding pillar was dead weight.
   → **Fix that changed the game: ladder the directives up the tiers**
   (metal → components → circuits → modules). Now each gate drags the player one
   layer deeper into the graph, and reaching Era 3/4 + multipliers is *mandatory*,
   not optional. This is the single most important design change to lock in.

2. **A directive good must not also be the build currency**, or banking for the
   gate *freezes all construction*. When R3 demanded 100 metal, the colony stopped
   building for 5 turns. Higher-tier gate goods (components/circuits/modules) avoid
   this — metal keeps flowing to construction while you bank the tier-3 good.

3. **Population is a master resource and dominates everything if mistuned.** At
   staff 2–3/building with pop 12, labour was the *only* constraint that ever
   bound — the resource graph never got to matter. Dropping to staff 1–2 and making
   solar passive let the other systems breathe. Population (→ housing → labour) is
   the real pacing dial.

4. **Deep chains need deadline lead time proportional to depth.** Components sit
   ~6 buildings deep (ore→metal→alloy, silica→silicon/glass→electronics,
   volatiles→polymer, then assembler). A gate that demands them must allow ~6–8
   turns of runway from a cold start, or it's simply unmeetable.

5. **The compounding curve is real and visible once it engages.** In the winning
   run: Era 2 through ~t13, Era 3 at t13, Era 4 at t14; then Automation Hubs (staff
   relief) + Fabricators (cheaper builds) + AI Core (+25% output) compound so hard
   that t22–24 produce more than the entire first half. "Behind the curve" genuinely
   snowballs — exactly the intended feel.

6. **Space running out is a real, load-bearing constraint.** The colony fills the
   map with low-tier sprawl and has no room for the final module/megastructure
   industry. A human would *demolish* early buildings; the AI can't, so we had to
   cap its population sprawl as a proxy. This validates the "demolish to seat
   megastructures" pillar — it's not flavour, it's required.

7. **Emergent: raw deposits hard-cap sustainable population.** Ice slots → water
   throughput → max pop. Push population past what your ice can hydrate and water
   crashes. This came out of the system unprompted and is a nice strategic ceiling.

8. **Power-as-flow needs a buffer or it constantly interrupts.** Running power lean
   meant brownouts stalled tech-building every other turn. Keeping generation a step
   ahead of demand is a real, ongoing decision — the flow model works.

9. **The short/long tension shows up exactly where v0.2 predicted.** It's *opportunity
   cost in banking windows* (divert output to the gate vs. feed the curve) plus the
   *tech-rush-vs-now* decision, not deadline risk. Optional O2 (research-by-T → +10%
   output + early Era 4) measurably pulled the curve forward when taken — the
   early-completion *economic* bonus does what it's supposed to.

## Caveats
- The AI is a greedy heuristic, not an optimizer — a weak-to-medium baseline. That a
  modest AI can *just* clear a major victory suggests the scenario is appropriately
  hard, but it isn't proof of the skill ceiling.
- Balance is **sensitive**: many knobs interact (staffing × power × metal income ×
  era thresholds × deadlines). Keep a sim in the loop while tuning — eyeballing
  numbers repeatedly produced soft-locks.
- Adjacency clusters, heat/radiation *placement*, and the sunline gradient are
  abstracted, not spatial yet.

## Update: flexible-fulfillment directives + strategic diversity

Implemented the v0.2 planned mechanism: gates are now clause-based with
`all` / `any` / `kofn(k)` modes and clause kinds `{pop}` / `{ship}` / `{have}` /
`{anyOf}`. The deadline resolver satisfies the **cheapest** option; the AI has a
planner that *chooses which alternative to target ahead of time*, biased by a
tunable **strategy** weight. Run `node sim.js compare` to see four strategies play.

Result — **there is real strategic diversity, but it's narrower than the gate
count suggests**:

| strategy | outcome | prestige | R4 path | R5 path |
|---|---|---|---|---|
| balanced | MAJOR | 3660 | 12 composites | 8 modules |
| **tech** | MAJOR | **4264** | **14 circuits** | **24 circuits** |
| brute | MAJOR | 3660 | 12 composites | 8 modules |
| pop | MAJOR | 3660 | 12 composites | 8 modules |

What this tells us:

1. **The mechanism works and produces a genuinely distinct, independently-viable
   line.** `tech` builds circuit fabs instead of composite plants — a different
   factory — and its R5 is **path-dependent**: having built circuits for R4, the
   "24 circuits in stock" option becomes the natural way to finish. That emergent
   path-dependency is exactly the good kind of choice.
2. **A flexible gate is only a real choice between comparably-costly high-tier
   goods.** R4 (circuits vs composites, both Tier-3) is a true fork. R2 (metal vs
   components) and R3 (meet-2-of-{pop, components, food}) are *dominated*: metal,
   pop and food come essentially **free as byproducts of normal growth**, so the
   cheap option always wins and every strategy picks identically. A `kofn` that
   includes auto-satisfied clauses isn't a decision.
3. **`tech` is currently strictly best (4264 vs 3660)** — circuits are over-rewarded
   relative to composites/modules. A balanced design wants the alternatives within
   a few % of each other so the choice is a real trade-off, not a dominant line.

Design takeaways for the doc:
- Flexible-fulfillment gates should pit **two (or more) similarly-priced Tier-3+
  goods** against each other, not a cheap good vs an expensive one.
- `meet-k-of-n` only creates a decision if **fewer than k clauses are satisfiable
  from normal growth** — otherwise it's a free pass.
- Keep alternative payoffs **balanced in prestige/value**, or the "choice" collapses
  to the highest-value branch.

## v0.3 flow prototype (`flow.js`) — results

A second prototype implements the v0.3 pivot: **pure per-turn flow, no stockpiles
(not even power)**, **free buildings delivered at a limited rate per tier**, **workers
as a flow**, and **directives as a dynamic tech tree** (rewards = capability: unlock
buildings, +build-rate, prestige). Space is still abstract (tile budget + deposits) —
the adjacency layer needs the real grid and is the next prototype. Flows are solved to
a **fixed point** each turn, which handles the circular deps (reactor↔water, the
housing→workers→everything loop). Run `node flow.js`.

Outcome: a clean **end-to-end run to a MINOR victory** (550 vs 600 major). The whole
spine completed (food → metal → components → circuits → research); build-rate climbed
3/1/0 → 3/2/3 via directive rewards; the AI **demolished** to rework a full map. What
the model establishes:

1. **The free-resource flaw is gone.** With no stockpiles, a directive that wants
   N/turn of a good costs that *capacity* for its whole duration — and capacity is a
   permanent cost (a tile + worker-flow). Nothing is ever "free from the buffer,"
   because there is no buffer. This was the whole point of the pivot and it holds.
2. **Per-tier build-rate is strongly binding, and the bottleneck migrates upward** —
   exactly as intended. Early turns contend for bt1 (power vs housing vs extractors);
   late game is gated by bt3 (advanced plants), which only directives raise.
3. **Directives-as-tech-tree produces the compound curve.** Build-rate and unlock
   rewards let you build faster/deeper, which completes the next directive, which raises
   build-rate again. The exponential now runs through the directive web, not a resource
   balance.
4. **"Space runs out → demolish" is load-bearing and real.** The colony fills the map,
   then must raze over-provisioned tiles (all solar → denser reactors; greenhouses →
   circuit industry) to advance. Without demolition the AI hard-stalled; with it, it
   finished. This validates the pillar as a core mechanic, not flavour.
5. **Power density is a genuine decision even in abstract space** (reactor 44/tile vs
   solar 10/tile). With real adjacency it becomes richer (heat, radiators, sunline).
6. **Guns-vs-butter survives in flow form.** The AI secured the required spine and left
   the *optional* directives (D4, D6, worth +120 prestige) on the table — which is why
   it landed Minor not Major. Chasing optionals competes for the same finite per-turn
   capacity. That's the tension, intact.

Caveats: the AI is again a greedy baseline; the abstract-space model **cannot test
adjacency**, which is the actual core of v0.3. The fixed-point flow solver works but
worker-flow + life-support coupling is a strong constraint (the AI must hold a labour
buffer or it stalls).

## v0.3 MAP prototype (`map.js`) — the real spatial layer

The big one: buildings are placed on **specific hex tiles** and their effective output
is driven by **local adjacency**, on top of the v0.3 flow economy. Run `node map.js`
(it prints a turn log and an ASCII map of the final colony).

Adjacency implemented:
- **Heat is local:** a heat-emitter runs only as far as *adjacent* Radiators cool it
  (shared among the emitters touching each radiator; small passive base so a lone
  emitter still runs ~50%).
- **Radiation is local:** Reactors irradiate their 6 neighbours; adjacent Habitats /
  Greenhouses are crippled unless the tile is a shielded **lava tube**.
- **Sunline:** Solar scales with how sunward (low-q) the tile is.
- **Co-location:** +12% per distinct input whose producer is on an adjacent tile — so
  supply chains want to physically cluster.
- **Lab clusters:** Labs boost adjacent Labs/Habitats.

Plus a **placement AI** that scores tiles, a fixed-point flow solver run over individual
building instances, per-tier build-rate, directives-as-tech-tree, and demolition.

### Result: the model works and is the most interesting yet — but it's *hard*
The baseline AI clears **5 of 7 directives (DEFEAT, missing the circuits gate)**, vs the
abstract-space `flow.js` which reached a Minor victory with the same directive tree.
Adding the real spatial layer materially raised the difficulty — which is the point —
and surfaced several **emergent tensions**, all visible in the final ASCII map:

1. **Supply chains visibly cluster** (co-location bonus) — refiners pack next to their
   input producers, exactly the layout behaviour we wanted.
2. **Heat forces districting**: emitters pair with radiators; you can't pack heat
   sources without paying neighbour tiles for cooling.
3. **Reactor radiation vs. housing** is a real separation constraint (housing drifts
   away from reactors / into lava tubes).
4. **Deposits must be reserved** — an early AI bug placed an Assembler *on* a rare vein,
   wasting it; the fix (don't build non-extractors on deposits) was necessary and is a
   genuine player consideration.
5. **Rare-earth contention is the emergent crux.** Foundries (alloy→components) and
   Electronics and Circuit Fabs all compete for the scarce rare veins. The greedy AI
   could **hard-block its own circuits** by spending all rare on foundries — and it
   can't make the skilled move (raze a foundry to *reallocate* rare to circuits). This
   is the most interesting decision the map creates; it's a feature, and it's beyond a
   greedy baseline.
6. **Labour bootstrap is a cycle** (housing needs water; water needs workers; workers
   need housing). The break is that Habitats need **zero staff**, so "build a Habitat"
   is always the labour-relief move — the AI needed that special case to start at all.
7. **Tiles saturate → demolition is mandatory**, and *safe* demolition (never raze the
   last producer of a good; prefer radiators cooling nothing) matters a lot.

### Why the AI falls short (and what a stronger one needs)
The late required gate (circuits) is gated by three simultaneous constraints — **bt3
build-rate** (shared by assemblers/circuit-fabs/labs), a **full map** (needs demolition
to make room), and **rare contention** (needs reallocation). The greedy, one-step AI
handles any one but not their conjunction. A competent player (or a lookahead AI) would:
reserve bt3 for circuits once D3 is done, pre-clear tiles, and demolish a foundry to
move rare onto circuits. That this is a *recognisable, describable* strategy is a good
sign — the depth is real, not noise.

### Design takeaways
- The **adjacency layer carries the game** as intended: layout is the puzzle, and the
  positive/negative effects (co-location vs heat/radiation/space) genuinely trade off.
- **Per-tier build-rate is the right pacing dial**, and *which tier* binds shifts over
  the run (bt1 contention early; bt3 the late wall).
- **Scarce shared inputs (rare earths)** create the strongest decisions — but tune them
  as a *squeeze, not a wall* (foundry rare draw had to come down so the bottleneck was
  navigable rather than fatal).
- A real game needs an **undo/reallocation** affordance (demolish-to-reallocate) to be
  front-and-centre, since the best plays are spatial reworks.

## Suggested next steps
1. Lock in the **laddered-directive** principle in DESIGN.md (gates climb the tiers;
   gate goods are never the build currency).
2. Add **demolition** to the model and AI, then re-test the tile squeeze honestly.
3. Build the real **hex/adjacency** layer and a placement AI to test the spatial pillar.
4. Sweep scenarios (deposit layouts, deadline density) to map the difficulty curve.
