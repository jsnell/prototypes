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
| **Initial bid** — may a player decline to bid? | no; but bid space 0 exists (no loans, last turn order) | `legal_actions` |
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
  Untested but most promising structural idea: duplicate low bid spaces
  (several players may sit at 0/1), which removes the forced-overbid
  mechanic entirely while keeping the inversion's leader tax.
- **Denial is a public good in multiplayer.** First A/B of buy-phase
  opponent modeling came out *negative*: discounting leads by rivals'
  raw capacity to contest over-discounts (capability ≠ intent), and a
  denial buy costs the denier alone while all rivals share the benefit.
  With an intent floor on the contest discount (hold ≥ 0.5), the modeled
  buyer beats a naive one by +2pp (safe) / +4pp (tense economy). Majority
  fights are real but second-order next to engine quality.

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
