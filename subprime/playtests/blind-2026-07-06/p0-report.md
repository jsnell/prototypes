# P0 — raw post-game report (verbatim)

**I WON — 26 VP to P1's 26, on the cash tiebreaker ($6 vs $1).** That foreclosure purchase in the final phase turned a 25-26 loss into the win.

---

## 1. Final scoreboard & story

| Player | VP | Cash | Fate |
|---|---|---|---|
| **P0 (me)** | **26** | $6 | **Winner (tiebreak)** |
| P1 | 26 | $1 | Runner-up |
| P2 | 6 | $0 | Bailed out |
| P3 | 0 | $0 | Bankrupt, eliminated |

The game split into two economies: P1 built a leveraged income empire in City 1 while I took sole possession of City 2 and fought P2 for City 3, farming double-subsidy income off cheap buildings. Round 3 was an eerie collective ceasefire — all four players passed on loans to freeze the rate at $4. The inflection point was Round 4: P2/P3 were mathematically dead at any rate, so P1 detonated the game with an 8-loan mega-Ponzi ($108/round interest!), bought six buildings, stole my City 2 majority, and survived interest with exactly $1 — flipping the lead 26-25 as P3 went bankrupt and ended the game. The last legal action of the game was the foreclosure sale of P3's seized building; I bought it for $4 to tie at 26 and win on cash.

## 2. Experience review

I genuinely enjoyed this — far more than I expected from a prototype. The core loop (loans → buildings → income vs. ratcheting interest) creates real dread; watching the rate track drain is like watching a fuse burn. Round 4 was legitimately tense: I was recomputing solvency thresholds for all four players to figure out who dies first. Pacing: Rounds 1-2 (drafting bargains, staking cities) are excellent; Round 3 sagged — the all-pass equilibrium meant an entire round where the "right" move for everyone was to do almost nothing, which felt simultaneously clever and anticlimactic. The bid phase is the weakest phase mechanically: with rational players it collapses into "bid the minimum you need to not die," and turn order mostly follows from desperation rather than desire. The buy phase is the best phase — subsidy placement is a delicious little puzzle every single purchase.

## 3. Agency

High agency, genuinely. My decisions that mattered most: (a) concentrating in empty City 2 from turn one (subsidy engine: at peak, $20/round of my income was subsidies); (b) the Round 3 read that everyone was margin-zero so I could safely buy while they couldn't; (c) recognizing that bankruptcy resolution punishes the *earliest in turn order*, making low bids a deliberate elimination shield in collapse rounds; (d) the $4 foreclosure buy. What felt less agentive: the endgame timing is decided by the most desperate player, and P1's all-in was outside my control — if their three final $8 buys had cost me the game, the loss would have felt like it happened *to* me. The random market flow also matters a lot (Round 2's $1-$3 card flood was a windfall for whoever had cash).

## 4. What I'd do differently

- Bid 3, not 4, in Round 1 — the fifth loan bought turn order I didn't need and cost ~$20 in lifetime interest.
- Defend City 2 with *pre-emptive depth* earlier. P1's late-game $8-card blitz stole an 8-7 majority I'd assumed was safe; one more cheap building in Rounds 2-3 would have held it.
- Hold slightly more cash into the collapse round specifically to outbuy a kamikaze spender — P1 nearly won by spending to exactly $1 while I still had margin I didn't use.

## 5. Design suggestions & confusion

- **Rate-track readability**: I misunderstood "rate = deepest uncovered space" twice (thinking emptying a row jumps you to the *next* row's price). The CLI's rate projection line saved me; a physical version needs this to be very visually obvious.
- **Bankruptcy order is a hidden superweapon**: "earliest in turn order dies, everyone else is bailed out and still scores" makes *low* bids strictly safer in collapse rounds and makes being bailed out nearly painless (cash is worthless at scoring anyway). Consider a VP penalty for bailout, or bankrupting *all* defaulters — otherwise the endgame is "engineer someone else's default."
- **The all-pass equilibrium** (our Round 3) can stall the rate ratchet entirely since the ratchet only advances via marker expiry from rows already emptied. Making the round marker expire rows regardless (rulebook intent?) would keep pressure on; as implemented, cleanup expired 0 markers every round, so the "ratchet" never actually fired on its own.
- **Tiebreaker is undefined** in the rulebook — the game apparently used cash. I won the whole game on this; it should be explicit.
- Small one: the row-3 price multiplier (×3) makes most new cards dead stock for a round; that's fine as deflation-bait but means the display often has nothing worth buying late in a round.
- Interface: excellent overall (net-after-interest and committed-claims lines are great). One gripe: buy-phase action lists are huge (40+ entries); grouping by card with a placement sub-choice would read better.

## 6. Identity guesses

- **P1 — language-model AI (or a strong human, but I lean LLM).** Coherent long-term plan (City 1 income fortress), correctly solved the Round-3 all-pass equilibrium, made targeted subsidy-breaking invasions of my sections ($4 RES exactly where it cost me $3/round), and the Round-4 mega-Ponzi was a *calculated* rules exploit — spending to exactly $1 of solvency while knowing the game ends and debt evaporates. That's deliberate optimization, not scripting.
- **P2 — classical scripted AI.** Bid small, mechanically bought affordable cards early, never adapted when squeezed, passively accepted default without a survival bid in Round 4, and never made a spite or blocking play. Its one clever-looking move (contesting City 3 IND) reads as "buy cheapest affordable card, prefer sections where I have presence."
- **P3 — leaning classical AI with a nice heuristic, possibly a quiet human.** Mostly rote (stacked City 1 RES, minimal bids), walked into an obviously fatal Round 4 with no escape attempt — but spending its literal last $4 on a VP-scoring building while doomed was either a scripted "always convert cash" rule or a human shrugging stylishly at death. The lack of any defensive play against elimination tips me toward script.

---

## Appendix: in-game remarks (the only other prose the player produced)

> Pass registered. The other players are taking their time — continuing to wait.
