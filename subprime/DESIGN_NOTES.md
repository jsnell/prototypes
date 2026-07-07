# Design notes: gaps filled & rules interpreted

The design doc defines the mechanisms but leaves numbers and some rules
open. This file lists every gap/ambiguity, the default chosen, and the
`GameConfig` knob (or code location) that controls it — so each one can be
tested by simulation instead of argued about.

## Gaps in the doc (no answer given)

| gap | default chosen | knob |
|---|---|---|
| **Card distribution** (100 cards: types, costs, incomes) | residential cheap/plentiful (34), commercial mid (33), industrial expensive/high-income (33); costs 1–7, incomes 1–5 | `card_distribution` — table in `config.py` |
| **Loan track layout** (50 markers, rate numbers, rows) | 6 rows of 10/9/9/8/7/7 spaces with rates 1/2/3/4/5/6; the round marker sits beside row N in round N, so cleanup expiry removes rows below the current round | `loan_row_sizes`, `loan_row_rates` |
| **Bid track spaces** | integers 0–12; a bid's value = loans taken | `bid_spaces` |
| **"Running out of loan markers"** (dangling heading in the doc) | **resolved by designer ruling**: bids are always honored in full ($10 + one loan per bid step, markers or not); the markers only track supply, and an empty track ends the game in phase 4 | `_bid_pass` in `engine.py` |
| **Row cost multipliers** | doc says "multiplied by the card row": row 1 = ×1 (the stale/discount row that collects $1), row 3 = ×3 | `row_cost_multipliers` |
| **Bailout auction price** ("normal purchase price") | printed cost ×1 (no row multiplier — the card isn't in the display) | `bailout_price_multiplier` |
| **Where a bailout-bought building goes** | into the city it was repossessed from (it's "next to" that city) | `_do_bailout_buy` |
| **Winner tiebreak** (pitch sentence is cut off) | most VP, then most money, then shared win | `_score_and_end` |
| **Victory pitch** ("player with the largest…") | assumed: largest real-estate empire = VP scoring as written in the scoring section | — |

## Ambiguous rules (doc readable two ways)

| ambiguity | reading chosen | knob |
|---|---|---|
| **Interest: flat or per loan?** Doc literally says "each player must pay this amount", which makes extra loans free money. | pay `rate × own loans` by default; the literal flat reading is available for comparison | `interest_per_loan` |
| **Starting loan markers** — from the track or from supply? | off the track (cheapest spaces), so the rate is visible from round 1 | `starting_loans` |
| **Cleanup expiry** "loans below the round marker's position" | after advancing to round N, rows < N expire (round track aligned with loan rows). Matches the doc's "after round 3, no markers on rows 1–2". | `cleanup()` |
| **State-subsidy building counts** — do unowned (repossessed) buildings count toward a city's "fewest buildings"? | yes: a building is a building | `City.type_count` |
| **State-subsidy scoring** ("most buildings scores 1vp per building") | 1 VP per building *the leader owns in that section*; ties all score | `_score_and_end` |
| **Bailout auction eligibility** | every non-bankrupt player in turn order gets one chance to buy one building; bailed-out players are in the queue but have $0 by construction | `_setup_bankruptcy` |
| **Initial bid** — may a player decline to bid? | **designer ruling**: yes — a player may pass outright instead of placing (0 loans, last free turn-order spot), and there is no 0 space on the bid track (spaces 1–12). The doc's literal must-place reading remains available via `compulsory_initial_bids=True` | `legal_actions`, `bid_spaces` |
| **City subsidy with a single owner in a section** | sole ownership is "most" — subsidy granted | `collect_income` |

## Known dynamics (from simulation — updated as experiments run)

- **Two regimes, selected by bidding behavior, not by the economy.**
  Homogeneous cautious tables (`timid`, `greedy`) play all 6 rounds with
  0% bankruptcies under *every* config variant tested. Aggressive tables
  collapse by round ~2 — by bankruptcy, or (if buildings are made richer/
  cheaper) by the loan-track-empty end condition at the same point.
- **The market is a fixed-size money sink.** At 4 players the display
  holds ~$120 of stock per round; a max-bid round injects ~$460. The board
  sells out in round 1 and $200+ sits idle as pure interest liability
  (measured: `display_left_by_round` / `unspent_cash_by_round`).
- **Agent-artifact warning (methodological).** The first sweeps concluded
  "building prices don't affect survival" — wrong. The blind agents' bid
  policies ignored prices and market depth entirely. With demand-aware
  bidders (`sharp`, `sharp-lev`, which cap loans by what money can buy),
  price level becomes the *primary* pacing lever: row multipliers
  (1,2,3) → 2% bankruptcy, (1,2,4) → 46%, (1,3,4) → 97%, (2,3,4) → 100%
  (collapse by round 2.6). The transition is smooth — the bankruptcy rate
  is tunable by pricing alone, no bid-track cap needed. Conclusions from
  sims are only as good as the agents' economic literacy.
- A loan taken in round 1 pays $10 and costs ≥$16 in lifetime interest
  even in the best case (expiry alone forces rates 1,1,2,3,4,5). Leverage
  must convert to income immediately — likely the intended theme; the
  steepness is tunable via `loan_row_rates` / `money_per_loan`.
- A bid-track cap (≤3) also restores 5.7-round games with ~60% bankruptcy
  *even for price-blind players* — useful as a robustness knob against
  irrational tables, but it treats the symptom; pricing is the root lever.
- Row-1 ($1-accumulating) purchases and fresh row-3 purchases both see
  play, and all three building types get bought at roughly even rates with
  the default card table — the market mechanism itself looks healthy.
- **Track-draining is a dominant endgame lever.** With bids honored in
  full (designer ruling above), a player who leads the would-be scoring
  can unilaterally end the game by bidding for the remaining markers. The
  `shark` agent does this: against demand-aware rivals in the default
  economy it wins 40.6% (vs 25% baseline) and converts **91% of games**
  into deliberate loans-exhausted endings — only 6% reach round 6. Design
  question: intended kingmaker-proofing, or does the end condition need a
  buffer (e.g. the game ends one full round *after* the track empties)?
- **Forced bankruptcies work as a weapon.** In a tense economy the shark
  stretches its bid to push the rate past what a cash-poor rival can pay
  when the post-bankruptcy scoring favors it: 9.2% of its seats are wins
  via a rival's bust, against 16.8% self-busts.
- **When *everyone* is endgame-aware, the drain becomes a race — but a
  bounded one.** The 50-marker track physically can't be emptied before
  round ~4 (a drain needs remaining markers ≤ one bid plus the table's
  normal take), so all-shark tables play 4–5 rounds; round 6 simply never
  happens (0% of 400 games). Track size, not the round counter, is the
  real game clock. In the safe economy 90% of all-shark games end in a
  deliberate drain; in the tense economy universal kill-hunting turns
  into brinkmanship — 68% of games end in bankruptcy and average VP
  halves (23.6 → 13.5). Endgame awareness is individually rational
  either way (2 sharks vs 2 sharps: 31–34% vs 16–19% win rate), so the
  shortened, bloodier game IS the equilibrium meta.
- **Initial-bid order inverts under pressure.** Round-1 turn order seat 1
  places its initial bid *last* (bids go in inverse turn order), finds
  the low bid spaces taken, lands as the lowest bidder, and gets
  raise-squeezed into over-leverage: in all-shark tense games seat 1
  averages 14.2 loans and busts 34%, vs ~10–13 loans and 9–12% busts for
  the other seats — with matching win-rate inversion (16% vs 38% for the
  last seat). The "informed" late placement is a trap when raising is
  dangerous; early commitment to a low spot is protection.
- **Realism check on the squeeze: it is rules-structural, and prudence
  cannot escape it.** Decomposing busted players' loans in all-shark
  tense games: they carry 2.6 *forced* initial overbids (vs 1.0 for
  survivors) — placing last when the low bid spaces are taken, with bids
  only allowed to go up — plus more economically-intended loans taken
  under a one-round-myopic survival check. Fixing the myopia
  (`survival_horizon` projects the expiry ratchet and rivals' borrowing
  pace) lengthens games (round 6 returns: 39–50% of games) but
  *concentrates* the squeeze: seat 1 busts 51% at horizon 2 while
  everyone else drops to ~3%. And prudence is individually irrational:
  horizon-2 sharks lose to reckless horizon-1 sharks 18.5% to 31.5%,
  because both default at the same total rate (~28%) — smaller bids only
  demote a default from fatal bankruptcy (big bid → early turn order →
  you die) to a bailout (late turn order → stripped but alive) while
  building 1.6 fewer buildings. Winner-take-all scoring pays the
  variance-maximizer; the moral-hazard equilibrium is the theme working
  as intended. If prudence should be viable, the levers are the
  bankruptcy-selection rule (earliest in turn order) or softer
  winner-take-all (e.g. money mattering beyond a tiebreak).
- **Realism check on kill bids: they are not an intra-round ambush.** A
  kill could in principle exploit commitment order — the victim passes
  (locking loans and cash), then the killer stretches the rate with no
  reaction possible. Measured across 300 all-shark tense games (both
  reckless and prudent victims): the average rate escalation *after* a
  defaulter's pass is 0.04 points, and only 3% of defaults were
  "survivable at the rate they saw when passing, dead at the final
  rate" — and in 100% of those a bigger defensive bid at their pass
  moment would have survived (at rates ≤ 6, an extra loan is always
  +cash this round). The auction structure itself protects victims: the
  cash-poor are by construction among the lowest bidders, so they act
  repeatedly *after* seeing the hunter's committed high bid and price it
  into their survival check. Kill bids execute or accelerate positions
  already doomed by the debt ratchet; they don't manufacture deaths via
  information advantage. (A worst-case-anticipation bid check could
  close even the residual 3%, deliberately not added at that effect
  size.)
- **The seat-1 squeeze is a repeated forcing loop, and no tested fix is
  free.** Measured: the round-1 turn order leader suffers a forced
  initial overbid in 1.09 rounds/game and is forced 2+ times in 26% of
  games (vs 6–7% for late seats) — overbidding keeps them first in turn
  order, which keeps them placing initial bids last. The victims usually
  default *alone*, so changing the who-dies-among-co-defaulters rule
  (`bankruptcy_pick`: earliest/latest/most_loans) has no effect. Fix
  grid in the tense (1,2,4) economy, all-shark, 400 games each
  (fairness = win-rate spread across round-1 seats; doc rules = 25pp
  spread with seat 1 busting 34%):
  - gentler rate curves: remove tense-economy bankruptcy wholesale and
    whipsaw the seat advantage — overshoot, not a fix
  - extra baseline debt (`starting_loans=3`): 100% bankruptcy by round
    2 — disaster
  - forced minimum bid (`bid_spaces` starting at 2): best economic fix
    — spread 25→18pp, seat-1 busts 34→20% — but degrades the *safe*
    economy's fairness (9→25pp)
  - un-inverted initial placement (`initial_bids_inverted=False`):
    relocates the trap to the trailing seat (busts 37%) and also breaks
    safe-economy fairness — the doc's inversion is *correct* in a mild
    economy, where it taxes the leader's first-pick advantage; it only
    turns toxic when the economy is harsh enough that forced overbids
    kill
  Follow-up (both ideas tested as config flags):
  - `compulsory_initial_bids=False` (may pass immediately for 0 loans,
    no initial-bid round obligation): removes literal forcing entirely
    (0.00 forced overbids with a strict agent policy) — but seat 1
    still busts 29% vs ~8% for late seats. The compulsion was a
    correlate, not the cause.
  - The real root is the **raise-leapfrog mechanic**: the last placer
    lands lowest (rivals hold the mid spots), and "raise to a higher
    *empty* space" forces the lowest bidder to leapfrog the whole
    cluster or exit. Measured: seat 1 does 8.8 spaces of raising per
    game vs 1.1–2.8 for other seats, ending with the most loans.
  - `unique_bid_spaces=False` (markers may share a space, minimal
    raises, FIFO ties): kills the leapfrog and the seat-1 bust
    concentration — but the squeeze moves to whoever places *first*
    (FIFO-first at shared levels; seat 4 falls to 7–9% wins), and it
    reveals that **space uniqueness is the game's credit rationing**:
    without it every player bids their full desire every round, and
    even the safe economy collapses (84% bankruptcy, 3.4-round games).
  Net: the auction asymmetry is conserved — every softening either
  relocates the squeeze (someone is always first in the queue) or
  un-rations credit.
- **Why the bag is static: debt is permanent.** The agents are *not*
  overspending — demand-aware bidders self-correct (after an overbid
  they enter the next auction with ~$20 and want only 2 loans; seat 1's
  loan demand is the lowest at the table from round 3 on). The
  stickiness is that loans can never be repaid: an early forced overbid
  is a permanent interest annuity whose price the rate ratchet keeps
  raising. The bag-holder is chosen in rounds 1–2 and is irredeemable.
- **A deleveraging valve makes the bag dynamic** (`loan_repayment_cost`:
  repaying one loan is a buy-phase action). Agents needed a "lifeline"
  rule to use it (survival outranks profit when default is 2 rounds
  out — repayment competes badly with building on pure ROI). Dose
  response in the tense economy, all-shark, busts by round-1 seat:
  - no repayment: 37/14/12/10 (win spread 24pp)
  - $10 (principal price): **61**/10/4/8 — cheap repayment is a poverty
    trap: the rich deleverage easily, the drowning player spends every
    dollar treading water and still dies
  - $20 (~2x principal): **29/13/32/25, win spread 12pp** — bag fully
    dynamic, bankruptcy still 100% (someone always holds it), the
    leapfrog auction untouched
  Caveat: repayment shortens tense games to ~3.3 rounds and pushes
  bankruptcy to 100%. **Designer verdict: repayment rejected as a rule.**
  The knob stays in the code for reference but defaults to off
  (`loan_repayment_cost=0`), and no registered agent enables it.
- **Why "the counts should level out" doesn't happen** (the natural
  objection to the sticky bag): measured trajectories show (1) rivals
  never catch up on loans (+3.2 gap at bust time) because loan demand is
  derived from the display-capped market — everyone builds ~3/round
  regardless, so rivals match the overbidder's *buildings* (lead shrinks
  1.5 → 0.9 by round 4) with 3 fewer *loans*; catch-up borrowing would
  buy nothing. And (2) the interest is back-loaded: the doc's rule is
  effectively an adjustable-rate mortgage — all debt reprices to the
  current rate — so an overbid costing $3–6/round at signing costs
  $15–19/round by the endgame (cumulative extra ≈ $31, not "a few
  dollars"). Strikingly, busted bag-holders enter their final round with
  the *best income at the table* (+4.7 vs average): their engine is
  fine; the annuity simply outgrows it.
- **The catch-up defense works — when agents actually play it**
  (`debt_cooldown` on `HeuristicParams`: cut loan demand by your debt
  excess over the rival average, i.e. coast after an overbid while
  rivals level the counts). The market-share-driven bidders never
  coasted — they kept borrowing +2.5/round after an overbid because
  their cash was already invested in buildings. With cooldown, in
  all-shark tense fields: loan counts fully level (seat 1 ends with the
  *fewest* loans: 13.3 vs 14.1–15.8), seat-1 busts drop 37% → 19%,
  table bankruptcy 73% → 51%, and coasting is individually viable
  (23.8% vs 26.2% head-to-head — unlike blanket prudence, which lost
  18.5/31.5). BUT the seat disadvantage transmutes rather than
  vanishes: seat 1's win rate stays lowest (11% vs 35–37%) because the
  coasting rounds are rounds rivals spend building. The forced overbid
  is paid either as an annuity (bust) or as tempo (VP deficit) — the
  catch-up levels the debt, not the economy.
- **"Invest the windfall immediately" is wrong — banked cash has real
  option value** (designer's insight, confirmed). Two agent upgrades:
  `patience` (a card at row r costs up to 3x what it will after sliding
  down; discount buys by the waiting option) and, more generally,
  `cash_reserve_value` (a spent dollar is priced above face value when
  it would have to be re-borrowed next round at the ratcheted rate —
  rate expectations, and hence rivals' bids, enter through the
  projected rate path). Head-to-head vs the spend-it-all shark:
  patience 0.8 wins 29.4/20.6; cash valuation 0.4 wins **30.1/19.9** —
  the strongest single buy-policy edge found. The combined `digest`
  agent (cooldown + patience + cash valuation) wins 28.9/21.1 with the
  lowest bust rate. In an all-digest field, busts even out
  (15/16/6/7 by seat) and bankruptcy drops to 46%, but seat 1's *win*
  deficit persists (11% vs ~35%): even optimally digested, the round-1
  forced overbid costs irrecoverable tempo. That residual is now a
  measured, rules-rooted first-mover tax, not an agent artifact.
- **Fixed-rate loans (tested: each marker pays its space's printed rate
  forever) are catastrophic**: early credit becomes strictly cheap, the
  table races to drain the track, and games collapse to 2 rounds with
  huge seat unfairness — in the safe economy too. The ARM repricing is
  load-bearing: it is the game's only throttle on early credit. It
  cannot be removed, which is exactly why the repayment valve (pay off
  the back-loaded annuity mid-game, at a stiff price) is the right
  shape of fix for bag dynamism. `fixed_rate_loans` stays as a knob for
  the record.
- **Denial is a public good in multiplayer.** First A/B of buy-phase
  opponent modeling came out *negative*: discounting leads by rivals'
  raw capacity to contest over-discounts (capability ≠ intent), and a
  denial buy costs the denier alone while all rivals share the benefit.
  With an intent floor on the contest discount (hold ≥ 0.5), the modeled
  buyer beats a naive one by +2pp (safe) / +4pp (tense economy). Majority
  fights are real but second-order next to engine quality.

- **CORRECTION (post agent-bug fix): the back-loaded-curve fairness
  result below was contaminated.** The forcing-bid death spiral (see the
  LLM probe section) was randomizing who died, faking bag dynamism. With
  fixed agents, (1,2,3,5,7,9) still gives ~100% bankruptcy and longer
  games (5.8 rounds), but busts re-concentrate on seat 1 (39% mixed,
  60-89% uniform tables). Clean re-sweep found a better cell: **rates
  (1,2,3,4,6,8)** — mixed field: 94% bankruptcy, 5.7 rounds, 7pp win
  spread, busts 29/23/21/21. That is the current candidate (now the
  webgame/llmcli default). Remaining soft corner: a table of four
  identical expert agents mostly escapes into drain endings (7% bank);
  min-bid floors do NOT help under steep tails (99% seat-1 busts).
  Also ruled: the bailout's cost stays "forfeit the post-bankruptcy
  foreclosure purchase" — if the bailout shield needs further tuning,
  strengthen that lever rather than adding VP penalties.
- **Superseded — candidate tuning: back-load the rate curve.** With skilled (digest)
  play, only 46% of tense games ended in bankruptcy — the rest were
  leader drains (54%, zero games reaching round 6): the bag was being
  dropped before it landed. Deepening the track backfires (softer
  credit, 3–5% busts). The dial that works is steepening the *back* of
  the rate curve: `loan_row_rates=(1,2,3,5,7,9)` keeps early credit
  priced for the arms race but makes the expiry floor brutal in rounds
  5–6, so the bag lands on whoever mistimes late-game leverage instead
  of round-1's squeezed seat. Results: all-digest at (1,2,4) prices —
  95% bankruptcy, 4.4 rounds, busts near-uniform by seat (23/19/25/26).
  Mixed-skill field at doc prices — **99% bankruptcy, 4.6 rounds, win
  spread 4pp, busts 24/26/23/25**: the design target ("someone is left
  holding the bag ~always, dynamically") hit with a rate-curve change
  only, no rule changes. Homogeneous expert mirrors retain a ~15-20pp
  first-mover win deficit; mixed tables are flat. Default config keeps
  the doc curve pending designer sign-off.

## LLM playtest strength probe (via `subprime.llmcli`)

Two Claude subagents each played a full game (tuned rate curve), armed
with the rulebook + rulings but barred from reading agent code or these
notes. **Both won with 21 VP** — vs digest/shark/greedy (round-3
bankruptcy ending) and vs 3x digest (round-4). Convergent findings:

- **Verdict**: the digest table plays "solid intermediate" — tight local
  purchase economics, good subsidy placement, one AI even grabbed the
  turn-order bankruptcy shield — but they lack a terminal-state model.
  The mixed table rated below a rules-literate first-timer.
- **Bug/weakness: forcing-bid death spirals under the steep curve** —
  in both games one AI escalated its own bid into unsurvivable debt
  (2→11 raises, 14 loans). Root cause: a kill bid was priced as if it
  always lands (if it lands the game ends, so the 1-round survival gate
  passes trivially on loan cash), but a *missed* kill leaves the
  stretched debt in the ratchet. **Fixed**: forcing bids must now
  survive a miss (2-round horizon), kill targets' resources are
  estimated generously (subsidy-inclusive income), and doomed players
  (interest unpayable this round) spend their forfeit cash on VP
  instead of hoarding. All steep-curve findings re-measured after the
  fix — see the correction bullet above.
- **Missing endgame play, twice over**: (a) when mass default is
  inevitable, cash is worthless (bailout zeroes it anyway) — the right
  move is to spend every dying dollar on buildings, which the AIs never
  do; (b) no reactive majority defense even when telegraphed for two
  rounds (known limitation, confirmed at the table).
- **Meta discovered by both playtesters independently**: "maximize
  buildings, engineer your default behind someone else's" — the bailout
  costs nothing but cash, so only the earliest-in-turn-order defaulter
  is punished. ~~Design question: should bailed-out players suffer a
  scoring penalty?~~ **Designer ruling (2026-07-07): the shield is
  design intent** — an intended reward for turn-order play. It must NOT
  be explained in player-facing materials (rulebook states the
  mechanic, players discover the strategy); the fact that three
  independent LLM cohorts each re-derived it is evidence the discovery
  works.

### Re-probe after the agent fixes (tuned 1,2,3,4,6,8 curve)

Two fresh LLM playtests against the fixed agents. Claude still won both,
but the margins collapsed and the texture changed completely:

- vs digest/shark/greedy: **28 / 25 / 18 / 0** (round-5 drain + greedy
  bankrupt). digest came within 3 VP — "a human in its seat wins this
  game." shark's denial modeling showed up at the table (it twice sniped
  the playtester's subsidy majority). greedy's "spending into default"
  was the new doomed-cash behavior working as designed (it was already
  unsalvageable).
- vs 3x digest: **34 / 23 / 20 / 12** (round-5 drain, no bankruptcies —
  the expert-mirror drain corner, live). Digests deleveraged when debt
  turned toxic and correctly took cash-positive rate-$8 loans in the
  endgame drain race.
- Verdict shift: from "below a first-time human" (pre-fix, mixed table)
  to "**solid intermediate — competent but passive**." Remaining gaps
  the LLM exploited both games: no endgame VP micro-play (majority
  ties, subsidy flips, final-round buys with cash in hand), no model of
  the loan track as a game clock, and (their read) under-leveraging in
  rounds 1-2 when loans are cheapest.

- **NOTE ON EVERYTHING ABOVE THIS LINE**: all findings earlier than this
  bullet (including the LLM playtests) were measured under the doc's
  literal bid rules — compulsory initial placement, bid track 0–12.
  The pass-before-bid ruling below changes the baseline; directional
  conclusions carry over, specific percentages do not.
- **Final bid rules re-move the balance (again).** With pass-before-bid
  as the rule and no 0 space, cautious agents simply decline lethal
  debt: the (1,2,3,4,6,8) candidate collapses to 6% bankruptcy /
  full-length games. Re-tuned under the corrected rules:
  **(2,3,4,6,8,10)** gives the mixed field 51% bankruptcy, 5.9 rounds,
  4pp win spread, busts 10/10/15/15 — the current tuned default.
  Pushing the bag rate higher costs fairness again ((3,4,5,7,9,11):
  79% bankruptcy but 30pp spread with seat 4 busting 47% — under the
  pass rule the squeeze reappears on the *trailing* seat at harsh
  rates). Getting to ~90% bag-holding with even seats under the final
  rules likely needs a different lever than the rate curve alone
  (track size, money_per_loan, card economics) — open tuning question.

- **Subsidy robbery is real, structural, and bounded.** The buy phase
  precedes income, so a player budgeting against currently-placed
  subsidies can have them stolen by a later buyer (a tie voids a city
  marker; one purchase can flip strict-fewest) and default on a bill
  they had covered. Measured in mixed fields: **~9% of terminal
  defaults** are such robberies (avg theft $3.2), even with no agent
  hunting them deliberately. Hardening the agents' spend reserve to
  count only theft-proof income (margins ≥ 2) barely reduces the rate
  (9% → 8%) because most victims were already holding all their cash —
  the attack hits income, not spending, and the only real defenses are
  upstream (borrow a buffer loan, or keep subsidy margins ≥ 2). The
  secure reserve still wins its A/B (27.6/22.4) and ships as default.
  Adversarial test (designer insisted, correctly): agents now hunt the
  exploit (`income_kills`, on for kill-instinct agents) — a buy that
  steals enough subsidy income to flip a solvent rival into default is
  valued as a kill when the aftermath scores well. Results: the robber
  wins its A/B (27.8/22.2), but even a dedicated hunter lands few
  literal kills (7 robbery-deaths in 1081 defaults vs 3 blind victims)
  — the strike window (solvent but within ~$3, with a 1-margin marker)
  is thin. Verdict: legitimate, thematic, *bounded* depth; the reserve
  change didn't widen it (the hole is structural: buy-before-income +
  flippable markers), and the AI table now both prices and plays it.

### Blind experience playtest (2 Claude + 2 digest, identities hidden)

First *experience-focused* playtest under the final rules + tuned curve
(seed 31337). Two Claude subagents in seats P0/P1, two digests in P2/P3;
nobody was told who was what ("opponents could be human, claude, or
classical ai"). Result: **P0 26 VP $6 beats P1 26 VP $1 on the money
tiebreak**; digests 6 (bailed out) and 0 (bankrupt), round-4 bankruptcy
ending. Both LLMs filed detailed reports afterwards — the raw, unedited
reports and the exact briefing they played under are archived in
`playtests/blind-2026-07-06/`.

- **Experience verdict: strongly positive on agency.** Both called it
  tense and decision-driven — P1: "a game decided by decisions, not
  dice"; P1 could trace its loss to a single identifiable sequencing
  error (buying a COM $6 before denying P0 the $3 RES that both defended
  P0's City 2 majority *and* activated his +3VP state subsidy). The
  round-4 endgame — computing whether a rival's bankruptcy is forcible,
  then pivoting to a majority war funded by a deliberate rate detonation
  — was praised as a first-class "cornered-animal" puzzle. The subsidy
  system again singled out as "the hidden gem."
- **The money tiebreak is invisible — fix in rules + UI.** Neither
  player knew VP ties break on remaining cash until the game ended on
  exactly that (26-26, $6 vs $1). P1 optimized its final cash to $1 and
  lost to a rule it couldn't have known; P0 independently flagged the
  same gap. Cheap fix: state it in the rulebook and show it wherever
  VP-if-scored-now appears.
- **Austerity stalemate.** Rounds 3-4 froze into all-pass bids: trailing
  players won't touch lethal debt, so quiet rounds accrue to the leader.
  P0 claimed "cleanup expired 0 markers every round, so the ratchet
  never fired on its own" — verified against the engine: expiry *does*
  fire unconditionally (rows below the round marker die each cleanup),
  but in this game borrowing had already emptied every cheap row before
  it could expire, and the *current* round's row never expires, so the
  rate genuinely plateaus for a round during a pass-standoff.
  **Designer ruling (2026-07-07): working as intended** — the expiry
  ratchet is a backstop for overly timid tables, not a pacing mechanism
  expected to fire in normal play; demand emptying the rows first *is*
  the normal case, and the 1-round plateau during a pass-standoff is
  accepted tension.
- **Bankruptcy-order shield, third sighting.** Both reports re-derived
  the meta already in the notes: bailout costs only cash, so low bids
  double as elimination armor and engineered late defaults are nearly
  free. **Ruled: design intent** (see the ruling bullet in the strength
  probe section above) — intended to be discovered, never spoonfed in
  player materials. No changes.
- **Dead-player problem.** P2/P3 spent the last two rounds
  mathematically dead with zero counterplay (P3 spent its last $4 on a
  building while facing an unpayable $30 bill). Elimination-adjacent
  states may need an out (distress sales?) — or the game wants to end
  faster once deaths are locked in.
- **Rules-text gap**: whether state-subsidy income pays all owners in
  the section or only the leader had to be reverse-engineered from the
  income log mid-game. Clarify in the rulebook.
- **Identity guesses: 4/4 correct.** Each LLM pegged the other as
  LLM-or-strong-human (citing multi-purpose moves and tiebreak-aware
  play) and both digests as classical scripts — the tell was not
  weak play but *non-reactive* play: neither digest ever fought its
  visible death spiral. Matches the known no-terminal-model gap.
- **Scaffolding note** (tooling, not design): the run was slow and
  token-heavy (P0 130k / P1 211k tokens) because every `act` reprinted
  the full ~2k-token board and every `wait` timeout cost an LLM
  round-trip. Fixed in `llmcli`: `act` now prints only caused events +
  status, the full board arrives only when it's actually your turn, and
  `act <i> --wait` does move-and-block in one command (max-wait 240s).
  Future probes should be materially cheaper and likely stronger.

## Questions the framework can answer next

1. What loan-track rate curve makes *some* bankruptcies happen without
   dominating every game? (sweep `loan_row_rates`)
2. Is the double-subsidy bonus ($3) enough to fight over? (sweep
   `double_subsidy_bonus`, watch `subsidy_earned` and win rates)
3. Does the game need 6 rounds, or is it decided by round 4? (sweep
   `max_rounds`, watch whether late purchases still change winners)
4. ~~How much is turn order actually worth?~~ **Answered** (see
   `turn_order_value` on `HeuristicParams`, swept 0/2/4/8/16/32 against a
   volume-only control agent): in the default (safe) economy, position adds
   ~nothing at matched loan volume — the apparent gain from bidding up is
   just the extra borrowed cash. In a tense economy (row multipliers
   1,2,4), valuing position at ~$2 per outlasted rival is worth ~+7pp win
   rate over volume-only borrowing, but $4+ becomes a debt trap (37–48%
   bankruptcy, win rate collapses). Design takeaway: the bid auction only
   creates real turn-order tension when the price/income economy bites;
   in a soft economy it degenerates into a pure borrow-more auction.
5. Card economy: are cheap residentials strictly better than industrials?
   (purchases-by-type vs. win correlation from the JSON dumps)
