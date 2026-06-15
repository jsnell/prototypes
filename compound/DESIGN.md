# COMPOUND — Game Design Document (v0.1)

*Working title — a double meaning: the colony **compound** you build, and the **compound growth** curve you're racing.*

A turn-based, single-player space-colony optimization puzzle on a tiny hex map.
Perfect information, fully deterministic, transparent formulas. The game is the
*search for a better build sequence*, not the management of hidden risk.

---

## 1. Design pillars & the core tension

The brief's hardest requirement is the **short-term vs. long-term tradeoff**. The
key realization: that tension **cannot live in the scoring**. If a scenario is
judged by one final number (a single goal or a single score), the optimal policy
is always "maximize the long-term curve and back-solve" — the short term
disappears. The tension has to be structural.

So the spine of COMPOUND is:

> **Directives** — extrinsic demands from Earth with **hard deadlines** — that you
> satisfy by *spending the exact same economic output you would otherwise
> reinvest into compound growth.*

Every resource shipped to satisfy a Directive is a resource that did **not**
compound. Every turn of construction capacity spent meeting a quota is a turn not
spent building the engine. Because Directives have deadlines and (some) are
**mandatory**, you can't turtle into a pure growth strategy. Because the late
game rewards a strong economy, you can't mindlessly over-serve the early
Directives either. **The skill is sequencing: invest as hard as possible while
shaving each deadline as close as you dare.**

The five pillars:

1. **Guns vs. butter, made literal.** Construction capacity and output are shared
   between "serve the Directive now" and "grow the engine for later."
2. **Compound growth you can see.** Tech tiers and multiplier buildings make the
   economy curve visibly exponential; falling one turn behind the curve costs
   more every subsequent turn.
3. **Spatial sequencing.** 54 hexes, heavy adjacency, and a per-turn build limit
   mean *order and placement* dominate. Demolish-and-rebuild is a real lever.
4. **Score chase with a speed dimension.** Minor vs. major victory, plus a graded
   score where a dominant economy can declare victory *early* for a higher grade.
5. **Total transparency.** All future Directives, all terrain, all formulas are
   visible from turn 1. No randomness, no hidden state. It's a puzzle.

---

## 2. The map

- **Grid:** ~9 columns × 6 rows of hexes (≈ 54 tiles). Flat-top hexes, axial
  coordinates. Some tiles are pre-occupied by **wreckage/obstacles** or are
  **off-limits** (unbuildable craters) to shape each scenario.
- **The sunline:** one edge of the map is the **sunward edge**. Solar output
  falls off with distance (column index) from it. This turns placement into a
  positional economy: prime solar real estate is scarce and on one side, while
  the best ice/ore deposits may be on the far side — you can't have everything
  close.
- **Space is genuinely scarce.** A maxed late-game colony wants more tiles than
  exist, so you will demolish early-era buildings to make room for megastructures.

### Terrain types

| Terrain | Effect |
|---|---|
| **Regolith plain** | Default. Buildable, no bonus. |
| **Ice deposit** | Water Extractors get a large bonus here; Greenhouses adjacent to ice get free Water. |
| **Ore vein** | Mines get a large bonus here. |
| **Crater rim / highland** | Solar +bonus; Comms/Sensors get range. |
| **Lava tube / cavern** | Habitats here are shielded: +population capacity, cheaper, morale bonus. |
| **Geothermal vent** | Enables Geothermal Plant (steady power, no sunline dependence). |
| **Boulder field** | Must be **cleared** (costs construction capacity + Materials) before building. |
| **Off-limits crater / wreckage** | Permanently unbuildable; pure obstacle / pathing of adjacency. |

---

## 3. Resources (deep: 6 tracked + 1 score currency)

Production chain, escalating from basic life-support to hard sci-fi:

| Resource | Role | Primary sources | Major sinks |
|---|---|---|---|
| **Power** | Universal enabler; almost everything consumes it | Solar → Fission → Fusion → Antimatter | Every active building |
| **Water** | Life support + feedstock (hydroponics, electrolysis, fusion deuterium) | Ice Extractors | Greenhouses, Habitats, Fusion |
| **Food** | Feeds population; surplus drives growth | Greenhouses → Hydroponics → Agro-towers | Population upkeep |
| **Workforce** | Labor; staffs buildings **and** powers construction | Population in Habitats | Building staffing + **construction capacity** |
| **Materials** | Construction + refined into advanced Alloys | Mines (ore) → Refineries (alloys) | All construction; advanced builds need Alloys |
| **Research (Data)** | Unlocks tech tiers and multiplier buildings | Labs | Tech unlocks |

**Workforce is the linchpin of guns-vs-butter.** Each turn your population is
split between **staffing** producing buildings and **construction crews**. You can
only start `K` construction actions per turn, where `K` scales with idle
Workforce. Pull workers onto a build and production drops this turn; leave them
producing and the colony grows slower. This is the literal lever.

**Storage caps.** Each resource has a cap (raised by Depots/tech). Hoarding is
punished — overflow is wasted — so you must keep choosing: **spend on a Directive,
or spend on growth.** You can't just sit on a war chest.

### The score currency: **Prestige**

Separate from the economy. **Prestige is the score.** You earn it by fulfilling
Directives (especially optional ones) and from final colony valuation. It is
*not* spendable on the economy (except via debt, see §9), so it can't be
recycled into the growth loop — it's a pure measure of mission success.

---

## 4. Directives — the short-term engine

Each scenario ships with a **fully visible schedule** of Directives. A Directive
is a bundle of output demanded by a **deadline turn**:

```
T8  [MANDATORY]  Ship 30 Food                       → +120 Prestige
T8  [OPTIONAL]   Ship +20 Alloys                    → +90 Prestige, unlock Refinery II
T14 [MANDATORY]  Deliver 60 Alloys                  → +200 Prestige
T14 [OPTIONAL]   Reach 50 cumulative Research        → +150 Prestige, unlock Fusion early
T22 [FINAL]      Population ≥ 50 AND ship 40 Food    → scenario end
```

- **Fulfilling** a Directive consumes the demanded resources from your stockpile
  the turn you meet it (or accumulates toward a cumulative target). The resources
  leave your economy.
- **Mandatory** Directives missed at their deadline → harsh penalty (large
  Prestige loss + a lasting economic debuff, e.g. a morale/sanctions hit) or, for
  the worst, scenario failure. The scenario tuning chooses how punishing.
- **Optional** Directives are the fuel for major victory — extra Prestige and
  often **tech unlocks pulled forward**, letting a strong economy snowball.

Directives are deliberately spiky and badly timed relative to your natural growth
curve — that's the design. They force you to interrupt compounding at the worst
moments, and finding the build order that absorbs the spikes cheaply is the
puzzle.

---

## 5. Buildings & tech eras

Tech tiers unlock via **Research thresholds** and/or by completing Directives.
Investing in Labs is the purest long-term play: a Lab produces no Power, Food, or
Materials — it only buys you *future* multipliers. Building one early means
surviving the next Directive with less. That's the long-term gamble in a single
building.

### Era 1 — Foothold (butter basics)
| Building | Produces / does | Key adjacency |
|---|---|---|
| **Habitat** | Houses Workforce | +cap in lava tube; −morale next to industry |
| **Greenhouse** | Food | +Food per adjacent Water source/ice; +Food per adjacent Power; −Food if adjacent to a polluter |
| **Solar Array** | Power | Scales with closeness to sunline + crater rim; −if shadowed by adjacent tall structure |
| **Ice Extractor** | Water | Huge bonus on ice deposit |
| **Regolith Mine** | Materials (ore) | Huge bonus on ore vein; emits pollution |
| **Depot** | +Storage cap | — |

### Era 2 — Industry
| Building | Produces / does | Key adjacency |
|---|---|---|
| **Fission Reactor** | Lots of Power, no sunline dependence | needs Water; pollution |
| **Refinery** | Ore → Alloys | needs Power; heavy pollution |
| **Hydroponics** | Food (denser than Greenhouse) | needs lots of Power + Water; pollution-immune |
| **Research Lab** | Research | +cluster bonus per adjacent Lab; +per adjacent Habitat (talent) |
| **Comms Array** | Prestige trickle + Directive discount | range from highlands |

### Era 3 — Maturity (the curve bends up)
| Building | Produces / does | Key adjacency |
|---|---|---|
| **Fusion Plant** | Massive Power | needs Water (deuterium); large footprint |
| **Mass Driver** | Cheap exports — discounts the *cost* of shipping Directives | clear line to sunline edge |
| **Arcology** | Dense housing + morale | best in lava tube; anchors Lab/Hab clusters |
| **Automation Hub** | Reduces Workforce needed to staff nearby buildings | radius effect — frees Workforce for construction |

### Era 4 — Hard sci-fi (compounding endgame)
| Building | Produces / does | Key adjacency |
|---|---|---|
| **Self-Replicating Fabricator** | Each turn, reduces construction cost of all builds **and** can spawn another Fabricator — explicit exponential | stacks globally |
| **AI Core** | Global multiplier (+% to all production per tier) | unique; one per colony |
| **Antimatter Plant** | Enormous Power; enables top-tier builds | needs Fusion adjacency; large footprint |
| **Orbital Tether / Space Elevator** | Trivializes Directive shipping cost; large Prestige | edge tile, huge footprint |
| **Dyson Swarm Node** | Endgame Power + Prestige engine | needs prime sunline tiles |

**Compounding spine:** Labs → unlock Automation/AI/Fabricators → these multiply
production and *cheapen construction*, which lets you build more multipliers. The
curve is genuinely exponential, which is exactly why being one Directive-spike
behind is so costly — and why front-loading via debt can pay off.

---

## 6. Adjacency system

The thing that makes a tiny map deep. Rules of thumb:

- **Synergy clusters:** Labs want to touch Labs and Habitats; Greenhouses want
  Water + Power neighbors. Tight clusters multiply.
- **Pollution conflicts:** Mines, Refineries, Reactors emit pollution that
  *reduces* adjacent Food and Habitat morale. You must physically separate the
  industrial district from the agricultural/residential district — on 54 tiles,
  with deposits fixed by terrain, that's a real packing problem.
- **Shadowing:** tall/late structures cast a shadow on adjacent Solar (sunline
  direction), so placement order and neighbors matter.
- **Radius effects:** Automation Hub, AI Core, Comms act on a radius, rewarding
  central placement and re-planning as the colony grows.

Because deposits are fixed and clusters fight for the same neighbors, **placement
is a constraint-satisfaction puzzle layered on top of the timing puzzle.**

---

## 7. Turn structure (deterministic)

Each turn resolves in fixed phases (order-independent within a phase so results
are unambiguous):

1. **Production** — every staffed, powered building produces. Resources accrue up
   to storage caps; overflow is lost.
2. **Upkeep & growth** — Population consumes Food/Water; with surplus + housing it
   **grows** (compounding!); shortfall shrinks it. Debt interest accrues.
3. **Construction** — player starts up to `K` builds/demolitions/upgrades
   (`K` = f(idle Workforce)). Clear boulders. Re-assign Workforce between
   staffing and construction.
4. **Directives & finance** — fulfill any matured Directives (spend resources);
   take or repay loans; deadlines checked, penalties applied.
5. **End check** — final Directive met? Victory tier evaluated (see §8).

Everything a player needs to plan all 22-ish turns is on screen from turn 1.

---

## 8. Victory, scoring & the speed dimension

A scenario ends when the **Final Directive** is satisfied, or its deadline
passes, or you choose to **Declare Complete** once eligible.

- **Defeat:** a Mandatory Directive missed badly enough (per scenario tuning), or
  Final Directive deadline reached unmet.
- **Minor victory:** all Mandatory Directives met through the Final.
- **Major victory:** Minor **plus** a Prestige threshold (driven by Optional
  Directives + colony valuation + efficiency).
- **Grade / score:** `Prestige_total` adjusted by a **time factor** — finishing
  before the Final deadline grants a bonus per turn saved. So:
  - A *just-strong-enough* economy limps to the Final deadline → **Minor**.
  - A *strong* economy clears the Prestige bar at the deadline → **Major**.
  - A *dominant* economy clears the bar **early** and Declares Complete → **Major,
    faster, higher grade.**

This is what gives the score chase its teeth: the same scenario invites
"can I get the major?" → "can I get the major by turn 18 instead of 22?" → "can I
beat my best grade?" Perfect information means the ceiling is a real, discoverable
optimum to chase.

---

## 9. Compound growth & (optional) debt

**Compounding** comes from three stacking sources: population growth, production
multipliers (AI Core, Automation), and construction-cost reduction (Fabricators).
Reinvested output snowballs; the gap between an on-curve and off-curve player
widens every turn.

**Debt (optional accelerant — included as a high-skill lever, not forced):**

- **Bonds:** borrow Materials/Power *now*, repay principal + **compounding
  interest** over N turns. Lets you build a Reactor or Lab before your economy
  could afford it, pulling the whole curve forward.
- **Prestige advances:** borrow against future Directive rewards.
- **Why it's interesting under perfect information:** debt is a pure
  exponential-vs-exponential bet — does the growth you unlock out-compound the
  interest before the next Directive spike forces you to divert? Skilled players
  use it to convert a Minor into a fast Major; careless use buries the economy
  under interest right as a Mandatory deadline hits. Entirely opt-in: scenarios
  are beatable for Minor without ever borrowing.

---

## 10. Worked example — "Mare Frigoris Charter" (24 turns)

Map: ice deposits clustered on the far (anti-sun) side; ore veins center; one lava
tube; sunline on the west edge; a boulder field blocking the ice cluster.

Directive schedule (all visible from T1):
```
T6   [MANDATORY] Ship 30 Food                         +120 Prestige
T6   [OPTIONAL]  Reach 40 cumulative Research          +100 Prestige, unlock Fission early
T12  [MANDATORY] Deliver 50 Alloys                     +220 Prestige
T12  [OPTIONAL]  Ship +30 Food                         +110 Prestige
T18  [MANDATORY] Deliver 90 Alloys + ship 40 Food      +320 Prestige
T18  [OPTIONAL]  Population ≥ 40                        +160 Prestige
T24  [FINAL]     Population ≥ 60 AND 60 Alloys stockpiled
Major threshold: 1100 Prestige.
```

The tension in play:
- **The T6 food** forces early Greenhouses on the far side near ice — but the
  boulder field blocks the best ice tiles, so do you spend scarce early
  construction clearing it, or settle for weaker Greenhouses and ship a thinner
  margin?
- **The T6 optional Research** is pure long-term: a Lab built by T3 produces
  nothing toward the food deadline, but unlocking Fission early means the T12
  Alloy spike (refineries are power-hungry) is far cheaper. Skipping it keeps you
  safe at T6 but makes T12 brutal.
- **A bond at T3** could fund both Greenhouses *and* an early Lab — front-loading
  the curve — but interest comes due right around T12.
- **By T18** the industrial district (mines + refineries) is polluting; if you
  packed it next to your Greenhouses to save tiles, your Food output craters
  exactly when T18 also demands Food. Spatial sequencing bites.
- **Going for the fast Major:** stacking Automation + a Fabricator by ~T15 can let
  a dominant economy hit 60 pop and 60 alloys before T24 and Declare Complete at
  T21 for a top grade.

Many viable paths; one (discoverable) optimum. That's the chase.

---

## 11. Why it's fun / where the skill lives

- **A deterministic puzzle with a huge branching factor** (placement × order ×
  timing × debt) but a knowable optimum — perfect for "beat your best."
- **Every Directive is a fork:** serve it cheaply-but-late, over-serve early for
  safety, or invest through it and shave the deadline. No dominant answer.
- **Replayability** comes from new scenarios (terrain, deposits, Directive
  schedules) varying which strategies are viable, plus the grade chase on each.
- **Readable mastery:** because it's transparent, players *learn* the system and
  feel themselves getting better, rather than getting luckier.

---

## 12. Open tuning knobs (for next iteration)

- Exact resource counts/formulas and the steepness of the compound curve.
- How punishing a missed Mandatory is (penalty vs. instant fail) — controls how
  much the short term dominates.
- Construction-capacity formula `K` — the master knob for how much guns-vs-butter
  bites each turn.
- Number of Directives and how "off-beat" their timing is vs. natural growth.
- Whether tech unlocks are global (Research thresholds) or per-scenario gated by
  Directives.
- Whether to include a light **map-traversal/logistics** layer (distance from a
  building to the launch edge affecting Directive cost) or keep shipping abstract.

---

*Status: v0.1 draft for discussion. Numbers are illustrative and fully tunable.
Next step after we converge on the design: a paper/script model of one scenario to
sanity-check the compound curve and Directive pacing before any real prototype.*
