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

## Suggested next steps
1. Lock in the **laddered-directive** principle in DESIGN.md (gates climb the tiers;
   gate goods are never the build currency).
2. Add **demolition** to the model and AI, then re-test the tile squeeze honestly.
3. Build the real **hex/adjacency** layer and a placement AI to test the spatial pillar.
4. Sweep scenarios (deposit layouts, deadline density) to map the difficulty curve.
