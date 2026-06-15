# COMPOUND — Game Design Document (v0.2.1)

*Working title — the colony **compound** you build, and the **compound growth**
curve you're racing.*

A turn-based, single-player space-colony optimization puzzle on a tiny hex map.
Perfect information, fully deterministic, transparent formulas. The game is the
*search for a better build sequence*, not the management of hidden risk.

> **Changes since v0.1** (from design review): removed all "soft-fail / miss-by-a-bit"
> language — directives are now cleanly **hard gates** or **optional**. Reframed where
> the short-vs-long tension comes from (it is opportunity cost, not deadline-chicken).
> Replaced the flat resource list with a real multi-tier **production graph**; Power is
> now a non-storable **flow**. Population is a single monotonic **number/gate**, not a
> per-turn assignment chore. Cut **morale**; replaced "pollution" with hard-sci-fi
> **heat** and **radiation** adjacency. Directives are now **flexible/multi-objective**
> with **economic** (not prestige) bonuses for early completion. Debt defined concretely
> but **deferred**.
>
> **v0.2.1:** the production graph was too sparse — expanded to ~20 materials over five
> tiers with **6 raws**, high fan-out hubs (Water, Rare Earths, Glass), 3–4-input advanced
> recipes, **co-products** (electrolysis O₂/H₂) and **byproduct heat**. Building tables
> updated so every good has a producer.

---

## 1. Design pillars & where the tension actually comes from

The hardest requirement is the **short-term vs. long-term tradeoff**. The key
realization from review: in a deterministic, perfect-information game the tension
**cannot be risk** — there's no bluffing a deadline, no "cutting it close." If a
deadline can be safely exceeded, it was never the deadline. So the tension is
pure **opportunity cost under hard, time-localized constraints**:

> **Directives** are demands with **hard deadlines**, satisfied by emitting refined
> goods that *leave the economy* — the same goods and tiles you'd otherwise pour into
> the compounding curve.

Meeting a gate isn't a gamble; it's a **diversion**. The decision is never "when do
I dare pay" (you pay as late as allowed — trivial). It's **what production capacity
to build, and in what order**, so that a lump of output can exit at turn T *while*
that capacity is exactly what the growth curve wants. The interesting *timing*
decisions are pushed onto **optional** directives whose early-completion bonus is
**economic** — delivering early pulls a multiplier forward, a clean exponential-vs-now
bet (see §4).

Five pillars:

1. **Guns vs. butter as opportunity cost.** Every refined good exported to a gate is
   one not reinvested. Hard gates force diversions at fixed, awkward moments.
2. **Visible compound growth.** Tech tiers + multiplier buildings (Automation, AI Core,
   self-replicating Fabricators) make the curve genuinely exponential; being one gate
   "behind the curve" costs more every subsequent turn.
3. **Spatial sequencing.** 54 tiles, dense positive/negative adjacency, fixed deposits,
   and a non-storable power flow make placement *and order* dominate. Demolish-and-rebuild
   is a real lever.
4. **Score chase with a speed dimension.** Minor vs. major victory; graded score; a
   dominant economy can **Declare Complete early** for a higher grade.
5. **Total transparency.** All future directives, terrain, and formulas visible from
   turn 1. No randomness, no hidden state. It is a puzzle with a discoverable optimum.

---

## 2. The map

- **Grid:** ~9 × 6 hexes (≈ 54 tiles), flat-top, axial coords. Some tiles start as
  **wreckage/obstacles** or **off-limits craters** to shape each scenario.
- **The sunline:** one edge is **sunward**; solar output falls off with distance
  (column) from it. Prime solar is on one side, while the best ice/ore may be on the
  other — you physically can't keep everything close.
- **Space genuinely runs out.** A maxed endgame wants more tiles than exist, so you
  will demolish early-era buildings to seat megastructures.

### Terrain

| Terrain | Effect |
|---|---|
| **Regolith plain** | Default, buildable, no bonus. |
| **Ice deposit** | Ice Extractors get a large bonus here. |
| **Ore vein** | Ore Mines get a large bonus here. |
| **Crater rim / highland** | Solar +bonus; sensors/comms get range. |
| **Lava tube / cavern** | Habitats here gain capacity **and natural radiation shielding** — prime spots to tuck housing near industry. |
| **Geothermal vent** | Enables a steady Geothermal Plant (sunline-independent power). |
| **Boulder field** | Must be **cleared** (Metal + a turn) before building. |
| **Off-limits / wreckage** | Permanently unbuildable; shapes adjacency and pathing. |

---

## 3. Resources — the production graph

Design goal: a **dense web, not a few straight pipes** — ~20 tracked materials across
five tiers. Two properties make it dense rather than merely long:

- **High fan-out:** the core intermediates (Power, Water, Metal, Silicon, Glass,
  Rare Earths) each feed *many* downstream recipes, so a shortage anywhere ripples
  through several branches at once.
- **High fan-in:** every advanced good takes **3–4 inputs from different branches**, so
  you cannot win by over-building one chain — each tier forces you to balance several.

Two more couplings tie the graph to space and time: **co-products** (electrolysis yields
Oxygen *and* Hydrogen — over-make one to get the other) and **byproduct heat** (refining
emits a heat *flow* that Radiators must carry off, or the emitter throttles — §6).

### Raw materials — the only "from nothing" nodes (mined from terrain)
| Raw | Source terrain | Gateway to |
|---|---|---|
| **Ore** | ore vein | Metal |
| **Ice** | ice deposit | Water (and everything downstream of it) |
| **Silica** | silica / sand flat | Silicon, Glass |
| **Rare Earths** | rare vein *(scarce!)* | Alloy, Electronics, Circuits — the tech bottleneck |
| **Volatiles** | gas pocket / cold trap | Polymer, Fertilizer, Propellant |
| **Regolith** | *any* plain (cheap, ubiquitous) | Concrete (bulk construction) |

### Energy
- **Power** — non-storable **flow** (Batteries excepted); consumed by nearly every recipe.
- **Heat** — a byproduct **flow** from refining/reactors; never stored or shipped, but it
  must be dissipated by Radiators or the emitter throttles. Effectively a spatial cost (§6).

### Refined materials (everything below has inputs; "feeds →" shows the fan-out)

**Tier 1 — basic refining**
| Good | Recipe | Feeds → |
|---|---|---|
| **Metal** | Ore + Power | Alloy, Concrete, Components, exports |
| **Water** | Ice + Power | O₂/H₂, Food, Fertilizer, Concrete, Propellant, life-support |
| **Oxygen** | Water + Power *(electrolysis — co-produces Hydrogen)* | life-support, Propellant, Alloy furnace |
| **Hydrogen** | *co-product of electrolysis* | Polymer, Propellant, fusion fuel |
| **Silicon** | Silica + Power | Electronics, Circuits, solar cells |
| **Glass / Ceramics** | Silica + Power *(heat)* | Electronics, Circuits, Modules, Composites |
| **Gases (N₂ / CO₂)** | Volatiles + Power | Fertilizer (N₂), Greenhouse (CO₂) |
| **Concrete** | Regolith + Water + Power | bulk construction, Modules |

**Tier 2 — intermediates (multi-input)**
| Good | Recipe | Feeds → |
|---|---|---|
| **Alloy** | Metal + Rare Earths + Oxygen *(heat)* | Components, Composites, megastructure |
| **Polymer** | Volatiles + Hydrogen + Power | Components, Composites, consumer goods |
| **Electronics** | Silicon + Rare Earths + Glass + Power | Components, Circuits |
| **Fertilizer** | N₂ + Water + Power | Food |
| **Food** | Water + CO₂ + Fertilizer + Power | population growth & upkeep, exports |
| **Propellant** | Hydrogen + Oxygen + Power | export / launch cost (Mass Driver, Tether) |

**Tier 3 — advanced (refined²)**
| Good | Recipe | Feeds → |
|---|---|---|
| **Components** | Alloy + Polymer + Electronics + Power | construction, Modules, Research, Robotics |
| **Circuits** | Electronics + Glass + Rare Earths + Power | Research, Robotics, AI Core, megastructure |
| **Composites** | Alloy + Polymer + Glass + Power | megastructure, Modules, Orbital Tether |
| **Modules** | Components + Concrete + Glass | high-capacity Habitats / Arcologies |

**Tier 4 — top of the tree**
| Good | Recipe | Feeds → |
|---|---|---|
| **Research / Data** | Components + Circuits + Power (+staffing) | tech-tier unlocks, multipliers |
| **Robotics** | Components + Circuits + Power | **reduces staffing colony-wide** (Automation) |
| **Megastructure Parts** | Composites + Circuits + Components | Dyson Node, Orbital Tether, AI Core |

Why this is hard, not just big:

- **Rare Earths** sit upstream of Alloy, Electronics *and* Circuits — one scarce vein gates
  the whole tech ladder; spending it on near-term Components vs. saving it for Circuits is a
  recurring squeeze.
- **Water** is the most-shared node (life-support + Food + fuel + concrete + electrolysis):
  an ice shortfall starves five branches simultaneously.
- Every Tier-3/4 good is **3–4-input**, so a directive that asks for Components or Circuits
  silently demands the *entire sub-tree beneath it* be in balance — that's the real puzzle.
- **Co-products and heat** couple the graph to layout: over-making a gas to get its partner,
  and leaving radiator room around every refining cluster.

Always-on rules:
- **Power is a flow, not a stockpile** — each turn, generation must cover consumption or the
  lowest-priority buildings brown out. Only a **Battery** carries power across turns (limited).
- **Population is NOT a resource** (never consumed) — it's a capacity/gate (§4).
- **Storage caps** on stored goods (raised by Depots/tech); overflow is wasted, so hoarding is
  punished — keep choosing *spend on a gate* vs. *spend on growth*.

---

## 4. Population, directives & victory

### Population (a single number)

- Population is **one number**. It only ever **increases** (monotonic).
- **Housing capacity** = Σ Habitat/Arcology capacity. Population grows toward capacity
  when there's **life-support surplus** (Food + Water + Power headroom for the larger
  population). No surplus ⇒ growth stalls; it never shrinks.
- Every building has a fixed **staffing requirement**. Σ staffing ≤ population at all
  times. **You may not build/operate what you can't staff.**
- This makes expansion **triple-gated** — by **Metal** (to build), **staffing** (to
  operate), and **Power** (to run) — so no artificial "N builds per turn" cap is needed.
  (Such a cap remains a possible tuning knob if playtests want it.)

### Directives — the short-term engine

A scenario ships a **fully visible** schedule. Two kinds:

**Required gates** (the short-term spine):
- A hard objective due by turn T. **Missed ⇒ run lost.** No partial credit, no penalty
  tier — clean and consistent.
- **Flexible / multidimensional fulfillment** (the part that makes them interesting):
  - *Alternative bundles*: "supply the orbital depot: **40 Food OR 30 Components OR
    25 Metal**" — pulls on whichever branch you over-built.
  - *Meet-K-of-N*: "satisfy 2 of {pop ≥ 40, ship 50 Metal, 60 cumulative Research}."
  - *State vs. flow*: an objective can be a built-up **state** (population, a structure
    exists) or a **flow** (ship N this turn) — different strategies satisfy each.

**Optional directives** (the timing/curve engine):
- No failure if skipped. Reward is an **economic/tech bonus, not prestige** — and it's
  **scaled by how early you deliver**: e.g. deliver by T6 → unlock Fusion now + a Metal
  grant; by T9 → smaller grant; after T9 → expired. Early delivery costs output *now*
  to pull a **multiplier forward**, which is a real exponential decision (the only place
  "when" genuinely matters).

### Prestige & victory (consistent)

- **Prestige is the score**, and *only* the score — it's not spendable on the economy.
  It comes from **final colony valuation** + flat prestige on some directives + an
  efficiency/speed bonus.
- **Defeat:** any required gate unmet at its deadline.
- **Minor victory:** all required gates met through the final turn (run is *completable*).
- **Major victory:** Minor **plus** Prestige ≥ the major threshold.
- **Grade / speed:** once the final required gate is met you may **Declare Complete**;
  finishing early grants a per-turn time bonus. So a just-strong economy limps to a Minor
  at the deadline; a strong one clears the major bar at the deadline; a **dominant** one
  clears it *early* and declares for a faster, higher grade. That's the chase.

---

## 5. Buildings & tech eras

Tech unlocks via **Research** thresholds and/or **optional directives** (pulled forward,
§4). A **Lab** is the purest long-term gamble: it produces nothing toward the next gate,
only *future* multipliers — building one early means surviving a gate with less.

Each building has: **build cost** (Metal, later +Components), **staffing**, **power draw**,
and adjacency effects.

### Era 1 — Foothold (extraction + basic refining)
| Building | Does | Notable adjacency |
|---|---|---|
| **Habitat** | +housing capacity; consumes life-support per pop | lava tube: +capacity & shielded; near reactor (unshielded): penalty |
| **Solar Array** | +Power (flow) | scales with sunline proximity / crater rim; **shadowed** by tall neighbors |
| **Ore Mine** | Ore (on vein) | — |
| **Ice Extractor** | Ice (on deposit) | — |
| **Silica Quarry** | Silica (on sand flat) | — |
| **Regolith Scraper** | Regolith (any plain) | — |
| **Electrolysis Unit** | Water→Oxygen + Hydrogen | — |
| **Concrete Plant** | Regolith+Water→Concrete | — |
| **Greenhouse** | Water+CO₂(+Fertilizer)→Food | +per adjacent Water/Power; **radiation-sensitive** |
| **Depot** | +storage caps | — |

### Era 2 — Industry (the multi-input web fills in)
| Building | Does | Notable adjacency |
|---|---|---|
| **Fission Reactor** | +much Power (steady) | needs Water (coolant); **emits heat** (wants Radiators) & **radiation** |
| **Smelter** | Ore→Metal | emits heat |
| **Water Plant** | Ice→Water | — |
| **Rare Earths Mine** | Rare Earths (on rare vein, scarce) | — |
| **Volatiles Well** | Volatiles→Gases (N₂/CO₂) | — |
| **Glass Kiln** | Silica→Glass/Ceramics | emits heat |
| **Silicon Refinery** | Silica→Silicon | emits heat |
| **Foundry** | Metal+Rare Earths+Oxygen→Alloy | emits heat |
| **Polymer Plant** | Volatiles+Hydrogen→Polymer | — |
| **Chem Plant** | N₂+Water→Fertilizer | — |
| **Electronics Fab** | Silicon+Rare Earths+Glass→Electronics | — |
| **Assembler** | Alloy+Polymer+Electronics→Components | emits heat |
| **Research Lab** | Components+Circuits→Research | **+cluster per adjacent Lab; +per adjacent Habitat** |
| **Radiator** | dissipates heat for adjacent emitters (lets them run at full) | pure support tile |
| **Battery** | stores a little Power across turns | — |

### Era 3 — Maturity (refined² + the curve bends up)
| Building | Does | Notable adjacency |
|---|---|---|
| **Circuit Fab** | Electronics+Glass+Rare Earths→Circuits | — |
| **Composite Plant** | Alloy+Polymer+Glass→Composites | emits heat |
| **Propellant Plant** | Hydrogen+Oxygen→Propellant | — |
| **Module Assembly** | Components+Concrete+Glass→Modules | — |
| **Robotics Plant** | Components+Circuits→Robotics | feeds Automation (staffing relief) |
| **Fusion Plant** | +huge Power | needs Water (deuterium); large footprint; heat |
| **Automation Hub** | **reduces staffing of buildings in radius** (frees population) | radius effect — central placement |
| **Arcology** | dense housing (consumes Modules to build) | best in lava tube |
| **Mass Driver** | reduces **export cost** of directives | clear line to the launch/sun edge |

### Era 4 — Hard sci-fi (compounding endgame)
| Building | Does | Notable adjacency |
|---|---|---|
| **Self-Replicating Fabricator** | each turn lowers all construction cost **and** can spawn another Fabricator — explicit exponential | stacks globally |
| **AI Core** | global +% to all production (unique) | one per colony |
| **Antimatter Plant** | enormous Power | needs Fusion adjacency; strong radiation |
| **Orbital Tether** | trivializes export cost; large Prestige | edge tile, huge footprint |
| **Dyson Swarm Node** | endgame Power + Prestige | needs prime sunline tiles |

**Compounding spine:** Labs → unlock Automation/AI/Fabricators → these multiply
production and *cheapen construction* → which funds more multipliers. The exponential is
exactly why a missed gate or a slow start compounds against you.

---

## 6. Adjacency system

A broad system of positive and negative effects — the thing that makes a tiny map deep.

**Positive**
- **Synergy clusters:** Lab↔Lab and Lab↔Habitat (talent); Greenhouse↔Water/Power.
- **Radiators** next to heat emitters let them run at full output.
- **Automation Hub** radius cuts staffing for nearby buildings.
- **Lava-tube Habitats:** capacity + free radiation shielding — the way to tuck housing
  next to industry.
- **Sunline:** Solar near the sunward edge / on crater rims is far stronger.

**Negative**
- **Waste heat:** Reactors/Smelters/Assemblers/Fusion throttle unless adjacent Radiators
  carry the load — clustering heat sources costs you tiles. (A real vacuum problem.)
- **Radiation:** Reactors/Antimatter penalize adjacent Habitats/Greenhouses unless
  shielded — forces an industrial-vs-residential districting puzzle.
- **Shadowing:** tall/late structures shadow adjacent Solar (sunline direction), so
  build order and neighbors matter.

Because deposits are fixed and clusters compete for the same neighbors, placement is a
constraint-satisfaction puzzle layered on top of the timing puzzle.

---

## 7. Turn structure (deterministic)

Fixed phases, order-independent within a phase so results are unambiguous:

1. **Power balance** — sum generation vs. consumption (after Batteries). Shortfall idles
   lowest-priority buildings this turn.
2. **Production** — every staffed, powered building runs its recipe; stored resources
   accrue up to caps (overflow lost).
3. **Population** — life-support consumed; with housing + surplus, population grows
   (never shrinks).
4. **Construction** — player builds / demolishes / upgrades (paying Metal/Components,
   respecting staffing & power), clears boulders.
5. **Directives & finance** — fulfill matured directives (resources leave the economy);
   apply early-completion bonuses; (optional) take/repay debt; check required-gate
   deadlines (unmet ⇒ defeat); evaluate victory / allow Declare Complete.

Everything needed to plan all ~22 turns is on screen from turn 1.

---

## 8. Compound growth & (optional, deferred) debt

**Compounding** stacks from three sources: population growth (→ more staffing → more
buildings), production multipliers (AI Core, Automation), and construction-cost
reduction (Fabricators). Reinvested output snowballs; the on-curve/off-curve gap widens
every turn.

**Debt — defined but deferred.** Concretely: Earth ships a lump of **Metal** now; you
repay **Metal + flat interest** over N turns. Under determinism it's a clean
"pull the curve forward vs. a fixed future drain that competes with a later gate" lever.
It's opt-in (every scenario is beatable for Minor without it). **Recommendation:** build
and prove the core loop first; add debt only if the curve needs another accelerant.

---

## 9. Worked example — "Mare Frigoris Charter" (24 turns)

Map: ice cluster on the far (anti-sun) side behind a boulder field; ore veins center; one
lava tube; sunline on the west edge.

Schedule (all visible from T1):
```
T6   REQUIRED   Supply life-support for 25 colonists       (state objective)
T6   OPTIONAL   Ship 30 Food            → by T6: unlock Fission + Metal grant; by T9: smaller
T12  REQUIRED   Deliver 50 Metal  OR  35 Components         (alternative bundle)
T12  OPTIONAL   60 cumulative Research  → by T12: unlock Fusion early
T18  REQUIRED   Meet 2 of {pop ≥ 40, ship 90 Metal, ship 40 Food}   (meet-2-of-3)
T24  FINAL/REQ  pop ≥ 60 AND 60 Metal stockpiled
Major threshold: 1100 Prestige.
```

Tensions in play:
- **T6 life-support** forces early Habitats + Greenhouses + Water — and the best ice is
  behind boulders: clear them early (spending scarce Metal) or settle for weaker output?
- **T6 optional** is the curve decision: shipping 30 Food by T6 *unlocks Fission and grants
  Metal*, making the T12 Metal/Components gate far cheaper — but it bleeds output during
  your most fragile turns. Pure exponential-vs-now.
- **T12 alternative** lets you choose your lever: if you leaned Smelters, pay Metal; if you
  built Assemblers, pay Components. Whichever you *didn't* over-build is the expensive path.
- **By T18** your industrial cluster is hot and irradiating; if you packed it next to
  Greenhouses/Habitats to save tiles, Food and growth suffer right as T18 may want Food and
  pop. Spatial sequencing bites; lava-tube housing and Radiator placement pay off.
- **Fast major:** Automation + a Fabricator by ~T15 can drive pop 60 / Metal 60 before T24
  and **Declare Complete at T21** for a top grade.

Many viable paths; one discoverable optimum. That's the chase.

---

## 10. Open tuning knobs

- Exact recipes/ratios and the steepness of the compound curve.
- Required-gate density and how off-beat their timing is vs. natural growth.
- How generous early-completion bonuses are (controls how much "rush the optional"
  dominates).
- Power-flow tightness and Battery limits (how punishing brownouts are).
- Whether tech unlocks are global (Research) or per-scenario (directive-gated).
- Whether to keep a logistics/distance layer (export cost vs. distance to launch edge)
  or keep shipping abstract.
- Whether an explicit per-turn build cap is needed on top of the Metal/staffing/power gates.

---

*Status: v0.2 draft for discussion. Numbers illustrative and fully tunable. Suggested
next step once the design converges: a script model of the Mare Frigoris scenario to
sanity-check the compound curve and gate pacing before any real prototype.*
