# P2-FABLE — raw post-game report (verbatim)

**VICTORY — Final: P2 (me) 20 VP, P0 19, P1 17, P3 0 (bankrupt). All players finished at $0 after the systemic default.**

---

# Subprime Playtest Report — P2 (winner, 20 VP)

## 1. Final scoreboard and the story of the game

| Seat | VP | Fate |
|------|-----|------|
| **P2 (me)** | **20** | Bailed out, WINNER |
| P0 | 19 | Bailed out |
| P1 | 17 | Bailed out |
| P3 | 0 | Bankrupt (19 loans!) |

**R1:** The table leveraged hard out of the gate (P3 took 6 total loans, P1 5, P0 4). I deliberately under-bid (3 loans), used my last-pick turn to colonize the empty City 3, and stumbled into the game's best engine: sole ownership of a city means city subsidies on every section, and being the "fewest RES" city gave my RES section the double subsidy (+$3/card). By R2 I had the best income-to-interest ratio at the table.

**R2:** P1/P3 slammed the brakes (0-loan passes) while P0 doubled down to 7 loans. I took 1 cheap loan, got 2nd pick, and kept stuffing City 3.

**R3:** Rate hit $6. P0 went to 11 loans and 19 VP in a blaze of acquisitions; opponents started invading City 3 to tie away my subsidies. I ran the solvency math and realized P1 was *mathematically incapable* of surviving R4 — the game had a hard end date nobody had announced.

**R4 — the crash:** P3 opened bid 9, P1 bid 8, and suddenly the loan track was heading empty and the rate to $10/loan, at which point **loans are exactly free** (+$10 cash, -$10 interest) and *everyone* was insolvent. The game became: grab bailout money, buy VP, and don't be earliest in turn order. P3 inexplicably raised to bid 12, volunteering to be the corpse. I bid 7 (just under P1's 8), took $70 of doomed money, and spent the buy phase in a genuinely thrilling subsidy knife-fight: my RES-subsidy reclaim was counter-attacked within one pick; my two-IND play to tie City 2's IND count 5-5 killed P0's 3 VP state subsidy — and P3 unwittingly bought the only IND that could have restored it. The last card on the board fell to me for the 20th point. Won by 1.

## 2. Experience review

**Genuinely tense, with a flat middle.** R1 setup and the R4 endgame were excellent. The R4 crash — realizing that at rate $10 debt becomes free and the game flips from economics to a pure positional VP scramble with a designated scapegoat — was the best board-game moment I've had in a CLI. The buy-phase counter-play (subsidy attack/defend, one pick apart) was gripping and *fast*.

The flat parts: R2 was rote (obvious cheap buys, no real decisions), and bid phases where I was lowest bidder produced trivially forced "raise or lock" loops. The income/interest phase resolving automatically was a good call — no bookkeeping tedium.

Pacing: 4 rounds, ~90 minutes wall-clock, ended at the perfect moment. The rate ratchet (rows expiring under the round marker) is a superb doom clock — you can *see* R5-R6 becoming unsurvivable.

## 3. Agency: my decisions mattered, specifically

This did **not** feel random. Decisions that directly produced the 1-point win:

- **Opening low bids and colonizing empty City 3** (R1): the entire engine — 3 sections of city subsidy plus the fewest-RES state subsidy — came from one placement decision on my first purchase.
- **Solvency modeling in R3**: computing that P1 could not survive R4 under any bid (needs `10b + income ≥ rate×(7+b)`, unsatisfiable at rate 8+) told me R4 was the last round, which justified treating R4 loans as free and spending to zero.
- **Bid 7 in R4**: max money while staying strictly below P1's 8 and P3's 9 in turn order — full bailout protection, one slot of margin.
- **The C2 IND tie (IND $12 + IND $14 into City 2)**: a deliberate 2-card play that deleted exactly 3 VP from P0. Final margin: 1 VP. This single tactic was the game.
- **Defensive RES purchases** (buying cheap RES and placing them in *opponents'* cities to keep City 3 "strictly fewest") — partially defeated by counter-play, but it forced opponents to spend picks.

Luck existed — P3 buying the $18 IND (P0's only counter-ammo) was outside my control, and P0 declining to restore the subsidy was a gift — but I engineered the position where those breaks decided things in my favor.

## 4. What I'd do differently on replay

- **Bid slightly higher in R1** (4-5 instead of settling at 2). Early cheap loans + early turn order are strictly stronger than I credited: row-1 cards paying back in 1.5 rounds are effectively free VP, and the winner-relevant leverage lesson of this game is that debt is only dangerous if you're *first* to fail.
- **Not misclick COM $4 into City 1** (I sent an index for the wrong city in R3 — cost ~$2/rd income; ironically it helped by muddying the C1 COM subsidy, but it was a mistake).
- **Anticipate City 3 invasions a round earlier.** Sole-city subsidies are lucrative and visible; I should have pre-bought defensive RES/IND spread earlier to make the ties unprofitable.
- **Trigger the endgame myself.** Knowing the crash geometry, an earlier deliberate over-leverage (while sitting just below the biggest borrower's bid) might buy 2 extra rounds of free buildings.

## 5. Design suggestions and confusions

- **The bailout rule is the game's soul and its biggest exploit.** Once everyone is insolvent, only one player is punished, so the dominant strategy converges to "leverage maximally but bid one below the maniac." Consider: bailed-out players lose VP (e.g., -1 VP per unpaid $10), or bankruptcy claims *all* players who can't pay. As-is, R4 loans were literally free money, which is thematic (!) but makes the last round a different, arguably better, game than rounds 1-3.
- **Rate $10 = free loans** deserves a design pass: at rate = $10/loan exactly, borrowing is cost-neutral in the final round, producing infinite-appetite borrowing. Even $11 marginal or "new loans pay this round's interest immediately" would restore tension.
- **P3's bid-12 raise was suicide** — voluntarily taking earliest turn order while hopelessly insolvent. If that was an AI, the bankruptcy-ordering rule needs to be more prominent; if a human, the interface should warn "this makes you first in line for bankruptcy."
- **Strictly-fewest/strictly-most subsidies create great knife fights** but are wildly swingy at end-game (4 VP appearing/vanishing on a single card). Loved it as a player who won the fight; suspect it feels terrible to lose 3 VP to a $4 card with no recourse. Maybe subsidies should score the *marker-placement-time* leader.
- **Rules interaction worth clarifying:** state-subsidy markers are placed at income (pre-bankruptcy) but scored post-building-removal; also whether a fully-empty rate row keeps the rate at its price. The interface handled both, but the paper rulebook doesn't say.
- **Interface**: excellent overall — derived numbers (net after interest, VP-if-scored-now, rate projection, committed markers) drove nearly every decision. Wishlist: (a) a "VP if scored now" *breakdown* (bldgs/majorities/subs), (b) subsidy what-if preview on buy actions ("this purchase kills City 3 RES state subsidy"), (c) warning when a bid makes you earliest-in-turn-order while projected insolvent, (d) the auto-played single-action turns were great.
- One rulebook error: the elevator pitch cuts off mid-sentence ("The player with the largest").

## 6. Identity guesses

- **P0 — language model, and a good one.** The strongest opponent. Coherent long-term plan (City 2 monopoly mirroring my City 3 play), aggressive but *calculated* leverage, and — most tellingly — multi-step adversarial responses within one pick of my threats: instantly re-attacking my reclaimed RES subsidy, and pre-empting my City-1 COM trick before I played its second step. That's opponent-modeling, not greedy scripting. Its one real error (not restoring the IND subsidy on its final relevant pick, buying a COM instead) is the kind of endgame blind spot a mid-to-strong LLM makes under branching complexity. Guess: a capable frontier-class LLM.
- **P1 — weaker/smaller language model or heuristic AI with a spite/adjacency bias.** Persistently dumped RES into City 3 (four separate purchases) — effective as subsidy denial but poor for its own income and VP; its bidding lurched from 0-loan austerity to a doomed bid-8. Some awareness (the C3 COM buy killed my subsidy line), but no solvency modeling. Guess: small LLM or scripted AI with a "contest the leader's city" rule.
- **P3 — classical scripted AI.** The tells: monotone escalation, buying strictly cheapest-first in most rounds, and above all the bid-9→raise-to-12 in R4 — voluntarily seizing the bankruptcy slot while hopelessly insolvent, then spending $100+ on buildings that were guaranteed to be removed from the board. No model of the bankruptcy rule at all. Also the very long, uniform "thinking" delays felt like a fixed-depth search timing out rather than variable human/LLM deliberation. Guess: greedy/scripted bot maximizing buildings with no endgame model.
- **Human at the table: probably none.** All three played with machine-like turn cadence (P0's occasional long pauses were uniform, not bursty), nobody chatted or varied tempo on critical turns, and nobody made the distinctly human move of *hate-drafting the last card* or sandbagging a bid for table-talk reasons. If forced to pick one as human, P0 — the counter-play was the most human-like — but I'd still bet LLM.

---

## Appendix: in-game remarks

> Let me read the rulebook before making my first bid.
