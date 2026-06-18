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

## Suggested next steps
1. Lock in the **laddered-directive** principle in DESIGN.md (gates climb the tiers;
   gate goods are never the build currency).
2. Add **demolition** to the model and AI, then re-test the tile squeeze honestly.
3. Build the real **hex/adjacency** layer and a placement AI to test the spatial pillar.
4. Sweep scenarios (deposit layouts, deadline density) to map the difficulty curve.
