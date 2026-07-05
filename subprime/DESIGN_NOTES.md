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
| **"Running out of loan markers"** (dangling heading in the doc) | you take what's left (partial fill) and get $10 only per marker actually received | `_take_loan_markers` in `engine.py` |
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
