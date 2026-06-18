# COMPOUND — Game Design Document (v0.3.1)

*Working title — the colony **compound** you build, and the compounding capability
you unlock.*

A turn-based, single-player space-colony **spatial flow puzzle** on a hex map.
Perfect information, fully deterministic, transparent formulas. You don't manage a
stockpile or a budget — you **place buildings on a grid** so that per-turn **flows**
line up, and you **complete directives** that progressively unlock more of the game.
The skill is in the **layout and the adjacencies**, not in hoarding resources.

> ## Why v0.3 is a pivot (read this first)
>
> v0.1–v0.2 modelled an **accumulation economy**: stockpile resources, spend them on
> buildings and on directives. A scripted prototype + a heuristic AI (`sim.js`,
> `FINDINGS.md`) played it ~15 times and surfaced a **fundamental flaw**:
>
> - **Basic resources become free byproducts of growth.** Under accumulation, any
>   resource you produce piles up, so a directive that demands a lump (metal, food,
>   pop) is paid trivially from the buffer. The intended guns-vs-butter tension kept
>   collapsing; the only real choices left were among scarce high-tier goods.
> - **Metal-as-currency kept inflating to abundance**, and reserving it for a gate
>   *froze all construction* — an ugly, brittle interaction.
>
> The root cause is **accumulation vs. one-shot gates**. v0.3 removes accumulation
> entirely:
>
> 1. **Everything is a per-turn flow. Nothing stockpiles.** Unused output is spent on
>    an active directive or **lost**.
> 2. **Buildings are free, but rate-limited.** Earth ships you a limited number of new
>    buildings per turn. The binding currency is now **build-rate + map space**, which
>    can't inflate away.
> 3. **Workers are a flow too** (housing emits worker-capacity; buildings consume it as
>    staffing). No population stockpile, so labour can't grow "for free" either.
> 4. **Directives are the progression system** — a dynamic tech tree. Completing them
>    unlocks new buildings, raises the build-rate, opens tiles/deposits. The compound
>    curve now runs *through the directives*, not through a resource balance.
> 5. **Adjacency is the core game.** With the economy simplified to flow, depth lives in
>    *where* you place things on the grid.
>
> What carries over from v0.2: the **dense production graph** (§4), the **map/terrain**
> (§3), and the **adjacency system** (§7) — now promoted from garnish to main course.
>
> ### v0.3.1 — concrete findings from the flow + map prototypes
> Two prototypes (`flow.js` abstract-space, `map.js` real hex grid; see `FINDINGS.md`)
> validated the model end-to-end and pinned down several rules now folded in below:
> - **Housing must require zero staffing**, or labour can never bootstrap (housing needs
>   water, water needs workers, workers need housing — a deadlock unless building housing
>   itself costs no labour). §2.
> - **Adjacency efficiency is a throttle, not all-or-nothing.** An uncooled heat-emitter
>   should run *partially* (small passive base cooling) with an adjacent Radiator as a
>   big boost — a hard "no radiator = dead" rule just produces radiator sprawl. §7.
> - **Co-location is a concrete bonus** (≈+10–15% output per adjacent input-producer),
>   which is what makes laying chains out spatially the puzzle. §7.
> - **Deposits are precious — don't waste them.** Placing a non-extractor on a deposit
>   tile squanders it; deposit tiles want reserving. §2.
> - **Scarce shared inputs (Rare Earths) must be a *squeeze, not a wall*.** Tuned too
>   tight, one consumer (foundries) starves another (circuits) into an unrecoverable
>   block; the bottleneck should force *reallocation*, not a dead end. §4.
> - **Demolish-to-reallocate is a core verb**, not a cleanup afterthought: the best plays
>   are spatial reworks (raze a foundry to move Rare onto circuits; raze solar for dense
>   reactors). §2.
> - **The binding build-tier migrates upward** (bt1 contention early — power vs housing
>   vs extractors; the late wall is bt3, shared by assemblers/circuit-fabs/labs). §2.

---

## 1. Design pillars

1. **Flow, not stock.** Each turn every building converts input flows to output flows.
   No buffers, no warehouses — **not even Power** (the one thing that is genuinely a flow
   in reality, so it would be perverse to let it stockpile). If you make more Metal — or
   Power — than is used this turn, the surplus is gone. This is what makes every unit of
   production *cost* something every turn, and it is why no resource is ever "free."
2. **Placement is the puzzle.** Buildings are free to receive but you can only place a
   few per turn, and the map is finite. *Where* each one goes — which deposits, which
   neighbours, how heat and radiation district the map — is the game.
3. **Directives are the tech tree.** A live, partly-dynamic offer of objectives. Each
   pays out in **capability**: new building types, +1 build-rate, opened terrain, a
   global multiplier. You choose which to chase; that *is* your build order.
4. **Compounding through capability.** Completing directives faster → more build-rate
   and better buildings sooner → complete more directives → … The exponential is real
   but it is *unlock-driven*, so being behind compounds against you.
5. **Total transparency.** Deterministic, perfect information, all formulas and the
   current directive offer visible. A solvable puzzle, kept open by rich adjacency and a
   shifting directive offer rather than by hidden information.

### Where the tension lives now
Not in banking (that decision was degenerate and is gone). Each turn you decide:
**which buildings to place** (build-rate is scarce), **where** (adjacency/space), and
**which directives to feed** with your finite flow. Short-vs-long is: feed a directive
that pays out *now* (small unlock) vs. build base / chase a directive that pays a
**build-rate or multiplier** later; and spatially, solve the immediate need vs. lay
out toward a future high-value cluster. Overflow is lost, so idle capacity is wasted —
you always want to be pushing *something*.

---

## 2. The core loop & economy

### Flows
A resource is a **rate** (units/turn), never a stored amount. A building that is
**placed**, **powered**, **staffed**, and **fed its inputs** produces its outputs *this
turn*; otherwise it produces proportionally less (throttles) or nothing. Outputs are
consumed, in priority order, by: (1) life-support and other buildings' inputs, (2)
**active directives** (flow sinks), (3) otherwise **lost**.

- **No stockpiles, including Power.** The whole economy balances per turn. A chain that
  loses an input upstream stalls downstream the same turn — tight coupling is the point.
  Power generation must cover Power demand *this turn* or low-priority buildings brown
  out; there is no battery.

### Buildings are free but rate-limited — *per tier*
- You do **not** pay resources to build. Each turn Earth delivers new buildings, but at
  a **separate rate per building tier** (extraction, power/infra, refining, advanced,
  high-tech, housing). You place up to that tier's rate of *unlocked* buildings.
- Splitting the rate by tier means "what Earth will send you" is a textured constraint:
  early you can place plenty of extractors but only a trickle of advanced plants, so the
  bottleneck migrates up the tiers as you progress. **Directives raise specific tiers'
  rates** (and unlock the building types), so the directive tree literally shapes what
  you can build how fast.
- **Squeeze-not-wall applies to build-tiers, too** (map-prototype finding). When several
  late gates share one build-tier — e.g. Circuit Fabs, Assemblers and Labs all draw on
  the bt3 rate — that rate must open up enough (via directive rewards) to build their
  industries *concurrently*. Tuned too low it's a wall: you can build the circuit
  industry **or** the research industry but not both in time. The AI cleared the scenario
  only once the advanced tier's rate opened to ~3/turn when it unlocked.
- **Placement costs**: a tile (finite map), a matching **deposit** for extractors, and
  ongoing **flow** to run it (power + staffing + inputs). So every placement is a real,
  *permanent* opportunity cost: the tile, and the worker-flow to operate it forever.
- **Deposit tiles are precious.** Only the matching extractor uses a deposit, and
  carelessly seating some other building on a Rare/Ore/Ice tile squanders it — placement
  should account for reserving deposit tiles for their extractors.
- **Demolish** is free and frees the tile (but wastes the build-rate that placed it).
  This is a **core verb, not a cleanup option**: because the map fills and inputs are
  contested, the strongest plays are *spatial reworks* — raze a Foundry to reallocate a
  scarce Rare-Earth feed onto Circuits; raze a field of Solar for a couple of dense
  Reactors; clear a district to seat a megastructure. The UI should make
  demolish-to-reallocate a first-class, low-friction action.

### Workers as a flow
- **Housing** emits **worker-capacity/turn**. Every building consumes some as
  **staffing**. Σ staffing ≤ Σ worker-capacity, or low-priority buildings idle.
- **Housing itself requires zero staffing.** This is a hard rule, not a detail: it's the
  only thing that lets labour bootstrap. Housing needs water; water needs workers;
  workers need housing — a deadlock the moment you're fully staffed, *unless* adding
  housing costs no labour. So "place a Habitat" is always the available labour-relief
  move. (Prototype confirmed: without this, the AI couldn't start at all.)
- No population *stock* — you can't "grow pop for free" and cash it later. Want more
  labour? Place housing (costs a tile + build-rate + its own life-support flow).
- Housing still needs **life-support flow** (Food + Water + O₂ + Power per worker), so
  expanding labour pulls on the whole graph — the same rich dependency, no accumulation.

### What is scarce now (and can't inflate)
| Scarce thing | Why it stays scarce |
|---|---|
| **Build-rate (per tier)** | Fixed per turn per tier; only directives raise it. Always want > what Earth sends; the binding tier migrates upward over time. |
| **Tiles / space** | Map is finite; megastructures force demolition. |
| **Deposits** | Fixed locations and counts (ore, ice, silica, rare, volatiles, vents, sunline). |
| **Per-turn flow** | Can't be banked; feeding a directive genuinely costs capacity *for its duration*. |
| **Adjacency slots** | A tile has only 6 neighbours; clusters compete for them. |

Because none of these is an accumulating stockpile, the v0.2 "free byproduct" failure
cannot recur: producing Metal still costs a placement, a tile, and worker-flow — every
turn it runs.

---

## 3. The map

- **Grid:** ~9 × 6 hexes (≈ 54 tiles), flat-top, axial coords. Some tiles start as
  **wreckage** or **off-limits craters** to shape each scenario.
- **The sunline:** one edge is **sunward**; Solar output falls off with distance from
  it. Prime solar sits opposite the best ice/ore — you can't keep everything close.
- **Space genuinely runs out.** A maxed endgame wants more tiles than exist; you will
  **demolish** early buildings to seat late-tier industry and megastructures.

### Terrain
| Terrain | Effect |
|---|---|
| **Regolith plain** | Default, buildable, no bonus. |
| **Ice deposit** | Ice Extractors only here. |
| **Ore vein** | Ore Mines only here. |
| **Silica / sand flat** | Silica Quarries only here. |
| **Rare vein** *(scarce)* | Rare-Earth Mines only here — the tech bottleneck. |
| **Gas pocket / cold trap** | Volatiles Wells only here. |
| **Crater rim / highland** | Solar +bonus. |
| **Lava tube / cavern** | Housing here gets +capacity & **radiation shielding**. |
| **Geothermal vent** | Enables a steady, sunline-independent Geothermal Plant. |
| **Off-limits / wreckage** | Unbuildable; shapes adjacency and routing. |

---

## 4. Resources — the flow graph

Unchanged in structure from v0.2.1 (a **dense web**, ~20 materials, five tiers), but
every entry is now a **rate**. High **fan-out** (Power, Water, Metal, Silicon, Glass,
Rare Earths feed many recipes) and high **fan-in** (advanced goods take 3–4 inputs from
different branches) mean a layout must balance *several* flows at once. **Co-products**
(electrolysis → O₂ *and* H₂) and **byproduct heat** couple the graph to the grid (§7).

### Raw extraction (deposit-bound)
| Raw | Deposit | Gateway to |
|---|---|---|
| **Ore** | ore vein | Metal |
| **Ice** | ice deposit | Water (→ everything) |
| **Silica** | silica flat | Silicon, Glass |
| **Rare Earths** | rare vein *(scarce)* | Alloy, Electronics, Circuits |
| **Volatiles** | gas pocket | Polymer, Fertilizer, Propellant |
| **Regolith** | any plain | Concrete |

### Energy / heat (pure flows)
- **Power** — consumed by nearly every recipe; Solar (sunline-scaled), Geothermal
  (vent), Fission/Fusion/Antimatter. Pure flow — generation must meet demand each turn,
  no battery.
- **Heat** — byproduct flow of refining/reactors; must be carried off by **Radiators**
  or the emitter throttles. A spatial cost (§7).

### Refined goods (recipe → what it feeds)
**Tier 1:** Metal (Ore) · Water (Ice) · Oxygen + Hydrogen (Water, co-products) ·
Silicon (Silica) · Glass (Silica, heat) · Gases N₂/CO₂ (Volatiles) · Concrete
(Regolith + Water).
**Tier 2:** Alloy (Metal + Rare + O₂, heat) · Polymer (Volatiles + H₂) · Electronics
(Silicon + Rare + Glass) · Fertilizer (N₂ + Water) · Food (Water + CO₂ + Fertilizer) ·
Propellant (H₂ + O₂).
**Tier 3:** Components (Alloy + Polymer + Electronics) · Circuits (Electronics + Glass
+ Rare) · Composites (Alloy + Polymer + Glass) · Modules (Components + Concrete + Glass).
**Tier 4:** Research/Data (Components + Circuits) · Robotics (Components + Circuits) ·
Megastructure Parts (Composites + Circuits + Components).

Why it's hard, not just big: **Rare Earths** gate Alloy *and* Electronics *and*
Circuits from one scarce vein; **Water** is shared by five branches; every Tier-3/4 good
is 3–4-input so a directive for it silently demands its whole sub-tree be *flowing in
balance, simultaneously* — which on a finite grid is a placement puzzle.

> **Balance rule from the map prototype — squeeze, not wall.** Rare Earths are the
> strongest source of decisions precisely because Alloy/Electronics/Circuits compete for
> them. But tuned *too* tight, one consumer (Foundries making Alloy→Components) eats all
> the Rare and the player can never start Circuits — a dead end, not a decision. The
> contention should force **reallocation** (raze a Foundry, move the Rare onto a Circuit
> Fab), so calibrate scarce shared inputs so the squeeze is navigable by reworking the
> layout, never an unrecoverable block.

> **Design note from the prototype:** real flexible-fulfillment *choices* only exist
> between **comparably-costly Tier-3+ goods** (e.g. Circuits vs Composites). Offering a
> cheap option (Metal/Food/worker-flow) beside an expensive one is a non-choice — the
> cheap one always wins. See §6.

---

## 5. Buildings & the capability ladder

Buildings are **unlocked by directives** (§6), not by a fixed era/Research threshold.
"Eras" are now just a rough ordering of when unlocks tend to arrive.

- **Extraction:** Ore Mine, Ice Extractor, Silica Quarry, Regolith Scraper, Rare-Earth
  Mine, Volatiles Well (each deposit-bound).
- **Power:** Solar (sunline), Geothermal (vent), Fission (heat+radiation), Fusion,
  Antimatter; **Radiator** (cooling). No battery — power is pure flow.
- **Tier-1 refining:** Smelter, Water Plant, Electrolysis, Glass Kiln, Silicon
  Refinery, Concrete Plant.
- **Tier-2:** Foundry, Polymer Plant, Chem Plant, Greenhouse.
- **Tier-3:** Electronics Fab, Assembler, Circuit Fab, Composite Plant, Module Assembly.
- **Tier-4 / multipliers:** Lab (Research), Robotics Plant, **Automation Hub**
  (staffing relief in radius), **AI Core** (global +% output), **Self-Replicating
  Fabricator** (raises effective build-rate / auto-places), Mass Driver, Orbital Tether,
  Dyson Node.
- **Housing:** Habitat (worker-capacity + life-support draw), Arcology (dense; best in
  lava tube).

The compounding multipliers now pay into the things that are actually scarce:
**Automation Hub** frees worker-flow, the **Fabricator** raises build-rate, **AI Core**
lifts output — each makes the *next* directive cheaper to satisfy.

---

## 6. Directives — the dynamic tech tree

The heart of v0.3. At any time a **visible offer** of directives is available; each is a
**flow objective** with a **payout in capability**.

### Objective forms (flexible fulfillment, from v0.2 — now flow-native)
- **Sustained flow:** "supply 8 Components/turn for 4 turns." Costs that capacity *for
  the duration* — the clean per-turn opportunity cost (no buffer can pre-pay it).
- **Flow-fill:** route a good into the directive; it fills a meter over several turns.
- **State:** "have ≥ N worker-capacity," "a Circuit Fab adjacent to a Lab exists."
- **Alternatives / meet-k-of-n:** `any` of several bundles, or `k of n` clauses — the
  player picks which part of the layout to lean on. **Lesson from the sim:** make the
  alternatives **comparably costly Tier-3+ goods**, and never include a clause that's
  satisfied as a byproduct of normal growth (it makes the choice a free pass).

### Payouts (capability, not score)
- Unlock a **new building type**.
- **+1 build-rate** (more buildings/turn from Earth) — the most powerful, pulls the
  whole curve forward.
- **Open terrain** (clear wreckage, unlock a deposit or a map region).
- A **global/area multiplier** (output %, staffing relief, sunline boost).
- Occasionally **flat Prestige** (score, §8).

### Dynamic offer
- Completing a directive can **reveal** follow-ons (a tree), and some directives
  **expire** or rotate. So the offer shifts — there isn't one fixed climb to memorise,
  which is the main guard against the puzzle collapsing to a single solved line.
- **Early-completion bonus** stays: finishing a directive ahead of its window grants a
  bigger/earlier capability payout — the genuine "pull the curve forward vs. now" bet.

### Short vs long, concretely
Feed a directive that unlocks the **Glass Kiln now** (immediately useful) vs. push the
harder one that grants **+1 build-rate** (compounds for the rest of the game) vs. just
lay more base. Build-rate is scarce, so you can't do all three this turn.

---

## 7. Adjacency — the core puzzle

With the economy on flow and buildings free, depth lives here. A tile has 6 neighbours;
clusters compete for them; deposits are fixed.

**Positive**
- **Co-location bonus (the central one):** a building gets **≈+10–15% output per distinct
  input whose producer sits on an adjacent tile** (short pipes / no routing loss), capped
  at a few. This is what makes laying supply chains out spatially the puzzle — a tight
  Silicon→Glass→Electronics cluster is far more tile-efficient than a sprawled one. It
  fights heat, radiation, and space, which is the tension.
- **Synergy clusters:** Lab↔Lab and Lab↔Habitat boost Lab output.
- **Automation Hub** radius cuts staffing for neighbours (frees worker-flow).
- **Lava-tube housing:** +capacity + radiation shielding — how to tuck housing beside
  industry.
- **Sunline / crater rim:** Solar far stronger near the sunward edge.

**Negative**
- **Waste heat (a throttle, not a kill-switch):** reactors/smelters/foundries/etc. emit
  heat. A little dissipates passively (so a lone emitter still runs at reduced output,
  ~50%); an **adjacent Radiator is a big boost** back toward full, with a radiator's
  cooling *shared* among the emitters touching it. Modelling it as "no radiator ⇒ zero
  output" was tried and just produces radiator sprawl — the partial-throttle version
  keeps the decision (cluster heat sources and pay neighbour tiles for Radiators) without
  being punishing.
- **Radiation:** reactors/antimatter penalise adjacent housing/greenhouses unless
  shielded (lava tube) — forces industrial-vs-residential **districting**.
- **Shadowing:** tall/late structures shadow adjacent Solar along the sunline.

Because flows don't buffer, **co-location matters**: a balanced cluster (e.g. Silicon +
Glass + Electronics + the Rare feed, with a Radiator and a power tap) is a tile-efficient
engine; a sprawled one wastes flow and tiles. Optimising these layouts — under finite
tiles, fixed deposits, and heat/radiation districting — is the game.

---

## 8. Turn structure, victory & scoring

### Turn (deterministic phases)
1. **Delivery:** build-rate `B` new buildings become available.
2. **Placement:** player places up to `B` buildings and/or demolishes.
3. **Flow resolution:** power balance → staffing allocation → run all buildings raw→
   refined, applying adjacency, heat throttling, and input availability.
4. **Allocation:** route surplus flow to active directives; overflow is lost.
5. **Directives:** advance/complete objectives; apply capability payouts; reveal/expire
   offers.

### Victory & score
- **Defeat:** a required directive's deadline passes unmet.
- **Minor victory:** all required directives completed.
- **Major victory:** Minor **plus** Prestige ≥ threshold.
- **Prestige (score only, not spendable):** colony valuation (buildings + worker-capacity
  + active flow throughput) + Prestige-bearing directives + an **efficiency/speed** term
  (finish early → higher grade; **Declare Complete** once required directives are done).

The chase: a tidy layout limps to Minor at the deadline; a strong one clears the major
bar; a *dominant* one snowballs build-rate and multipliers early and declares ahead of
time for a top grade.

---

## 9. Open questions for the v0.3 prototype

The next build should answer these (validation plan: a flow + hex-grid model with a
placement AI; confirm the freeness flaw is gone and that **placement** and **directive
choice** carry real strategic diversity):

1. **Is build-rate + tiles tight enough to keep everything contested?** If Earth is
   generous or the map roomy, it flattens. This is the master tuning dial.
2. **Does the directive tree produce a real compound curve** (build-rate/multiplier
   payouts) without flattening or running away?
3. **Is the per-turn decision rich** — placement + which directives to feed — or does it
   reduce to an obvious greedy?
4. **Does flexible fulfillment create genuine forks** once alternatives are
   comparably-costly Tier-3 goods and the dynamic offer shifts? (The thing v0.2's gates
   failed at.)
5. **How punishing should no-buffer coupling be** — full stall on a missing input, or a
   soft throttle? (Determinism makes either fair; it's a feel question.)
6. **Demolition cadence** — how often does the filling map force rework, and is that fun
   or fiddly?

---

## 10. What the v0.1–v0.2 prototype established (kept for reference)

`sim.js` / `FINDINGS.md` (an accumulation-economy model + heuristic AI) produced a clean
major victory and these durable lessons, all of which shaped v0.3:

- **Accumulation makes basic resources free** against one-shot gates → the v0.3 flow
  model exists to kill exactly this.
- **A directive good must not also be the build currency** → v0.3 removes build cost
  entirely (buildings are free, rate-limited).
- **Population/labour dominates if mistuned** → v0.3 makes it a flow with explicit
  worker-capacity.
- **The tech tree is vestigial unless directives pull players through the tiers** →
  v0.3 *is* directives-as-tech-tree.
- **Real flexible-fulfillment choices need comparably-costly high-tier alternatives**;
  cheap-vs-expensive and "k of n with free clauses" are non-choices.
- **Power-as-flow and finite tiles already create real squeeze** → promoted to the core.

---

*Status: v0.3 design draft — a deliberate pivot to a flow + placement + directive-tree
model, prompted by prototype data. Next step: a flow/grid prototype to validate §9.
Numbers throughout are illustrative and fully tunable.*
