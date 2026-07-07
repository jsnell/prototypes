# P1-HAIKU — raw post-game report (verbatim)

The game is over. Final: P2 wins with 20 VP, P0 19, me (P1) 17, P3 bankrupt. Here is my full report.

---

# Subprime Playtest Report — Seat P1 (Claude)

## 1. Final scoreboard and the story of the game

| Seat | Result | VP | Cash |
|------|--------|----|------|
| **P2** | **WINNER** | **20** | $0 |
| P0 | 2nd | 19 | $0 |
| **P1 (me)** | 3rd | 17 | $0 |
| P3 | BANKRUPT | 0 | $0 |

The game ended in Round 4 of 6 in a spectacular systemic collapse: the loan track was drained to zero, the rate hit $10/loan, and **all four players defaulted on interest simultaneously**. P3, earliest in turn order, took the bankruptcy; the other three of us were bailed out at $0 and scored.

My arc in four acts:

- **R1 (rate $2→$3):** Bid 4 (5 loans, $50). Bought four cheap RES into City 1 to build a majority. Reasonable but, in hindsight, too timid on income-per-card.
- **R2 (rate $4):** Passed on loans to "stay safe." This was my biggest mistake. The leaders bought aggressively while I nursed a -$6/round burn; I fell from tied-first to a distant last (5 VP vs P2's 13).
- **R3 (rate $6):** The vise closed. My cash + income equaled my interest bill *to the dollar* ($42 vs $42). I had exactly one affordable move all round: a $4 IND, which I placed in City 3 to tie the IND counts and kill P2's state subsidy. I ended the round at literally $0.
- **R4 (rate $10, the crash):** I did the arithmetic and realized **no player could remain solvent** — default was mathematically universal. That flipped the objective: cash became worthless, bankruptcy-order became everything. Since only the *earliest failing player in turn order* goes bankrupt (everyone else is bailed out with their buildings intact), the winning move was to borrow big but pass *before* the biggest borrower. I bid 8, stayed behind P3's 9 (they then insanely raised to 12), and spent ~$35 on a pure VP shopping spree: securing an unkillable +4 state-subsidy marker on my City 1 RES block, and spending my final buy to permanently kill P2's +4 COM marker. Those two plays were worth an 8-point swing; without them P2 wins ~24 to my ~13 instead of 20–17.

## 2. Experience review

**Genuinely tense, with one great act break.** Rounds 1–2 felt like a normal light econ engine-builder — pleasant, slightly rote. Round 3 was claustrophobic in a good way: computing that I had *exactly* $42 against a $42 bill, and that every purchase on the board was insolvency, was a memorably grim moment. Round 4 was the highlight of the design: the moment you realize the crash is unavoidable and the game silently transforms from "build an economy" into "musical chairs on the turn-order track," it becomes a completely different — and gripping — game. Watching P0 and P2 take 6–7 loans and pass *instantly* to grab the late turn-order spots told me they'd seen the same thing. That was a genuinely thrilling table moment through a text terminal.

**Pacing:** Good overall. Four rounds felt right; the rate ratchet (2→3→4→6→10) gives the game a doom clock you can feel. The buy phase in R1–R2 is the most rote part — cheap-card ROI comparisons with little interaction. The subsidy tug-of-war in R4 was the most interactive part and it only emerged at the end; the design might want that fight to start earlier.

## 3. Agency: did my decisions matter?

Strongly yes — in both directions. Specific decisions with traceable consequences:

- **The R2 pass on loans (my loss condition).** Borrowing was cheapest it would ever be, cards were cheap, and I sat out. That single conservative call is why I finished 3rd instead of contending. The counterfactual is direct: P0 and P2 borrowed and bought that round, and their final margins over me (2–3 VP) are smaller than what two extra R2 buildings plus a majority would have given me.
- **The R3 $4 IND into City 3** (denying P2's IND state subsidy while staying exactly solvent) — a forced-but-precise move that kept me alive.
- **The R4 bid-8-behind-P3's-9** — pure agency. Bidding 10+ would have made me pass last, take turn-order spot 1, and eat the bankruptcy myself. I finished with 17 VP instead of 0 because of this one read.
- **The endgame subsidy plays**: RES $10 into City 3 to make my +4 marker mathematically unkillable (C1 capped at 6 RES vs C3's 7 with no RES cards left), and the last COM into City 3 to tie all cities at 5 COM and permanently delete P2's +4. P2 won by 3 over me; without the COM kill they win by 7.

Randomness was limited to the card market flow. The outcome felt earned — including my defeat, which traces to my own R2 mistake, not dice.

## 4. What I'd do differently on a replay

1. **Borrow much harder in rounds 1–2.** The rate ratchet means early loans are the only cheap money you'll ever see, and debt is never repaid anyway — the real cost of a loan is (remaining rounds × future rates), which is *lowest* at the start. My "keep debt low" instinct from normal economic games is exactly backwards here.
2. **Value income density over building count early** — my four cheap $1–2/rd RES left me unable to service debt, which locked me out of the R3 market entirely.
3. **Plan for the crash from round 1.** The track math makes a round 4–5 mass default nearly inevitable with 4 leveraged players. Buildings are permanent; cash is confiscated at the bailout. So the correct late-game policy is "convert every dollar to buildings and manage your default *position*, not your solvency."
4. Start the state-subsidy count manipulation earlier — it's the cheapest VP in the game ($3–10 per 3–4 VP swing).

## 5. Design suggestions and confusions

- **The bailout rule is the heart of the game and deserves a bigger spotlight.** "Only the earliest defaulter in turn order dies" turns the endgame into a brilliant reverse-chicken auction. But it's easy to miss in the rulebook, and a player who doesn't see it (P3?) gets zeroed out feeling robbed. Consider making bankruptcy exposure visible in the UI ("if everyone defaults now, X goes bankrupt").
- **Turn-order-by-pass-order needs clearer rules text.** I initially assumed higher bid = earlier turn order (the bid-track header even says "higher bid also means earlier turn order," which is only indirectly true — it's *pass order* that decides, and low bidders are merely *forced* to pass sooner). The header text is arguably misleading for the exact edge case that decided this game: a high bidder who passes early gets a *late* spot, as P0/P2 demonstrated. Reword it.
- **Rate-10 loans are exactly self-neutralizing** ($10 cash in, $10/rd out) — borrowing at max rate is always pure VP-buying with someone else's money. Feels intentional and thematic (subprime!), but note it makes the last round's "loans" purely a turn-order/VP auction.
- **The R2–R3 mid-game can hard-lock a trailing player.** For a full round my only legal-in-practice action was one $4 purchase, then pass. A small catch-up valve (e.g., selling a building, or bailout-lite) might keep the trailing seat interactive.
- **Interface**: excellent overall — the derived numbers (net after interest, rate projection, committed claims, VP-if-scored-now) did most of my bookkeeping. Two gaps: (a) VP-if-scored-now doesn't show a *post-bankruptcy-removal* projection, which is the number that actually matters in the final round; (b) subsidy marker logic (strictly-fewest / strictly-most, tie = no marker) had to be reverse-engineered from the CITIES header — a per-section "current marker holder" line would help. Also the auto-play of forced moves is a great touch; the blind `--wait` loop worked flawlessly.
- One rules ambiguity I never resolved: whether the bankruptcy *auction* can ever matter, since every bailed-out player is defined to have $0. In our game it was vestigial. If all-defaults endings are common (I suspect they are), that whole subsystem may be dead weight.

## 6. Identity guesses

- **P2 (winner):** Almost certainly an **LLM, and a strong one**. Evidence: coherent long-term plan (monopolized City 3 across all three sections early, which pays triple via majority + both subsidy types), correct financial pacing (lowest leverage while leading), and — decisively — in R4 it took 7 loans and passed *immediately* to grab a protected late turn-order spot, which requires understanding the bailout-order rule. It also counter-bought RES into City 1 the turn after my first subsidy-denial attempt, suggesting it tracked the fewest-city counts. It did leave its +4 COM marker undefended at the very end (though to be fair, my kill was unblockable by then — no COM cards remained). Reads like a frontier-class model, or a very solid human.
- **P0:** Also plays like an **LLM, slightly weaker or greedier** (mid-tier frontier model, or a decent human playing fast). It understood the R4 endgame (6 loans, instant pass for spot 4 — the single safest seat in the game) and built a tidy City 2 fortress. But it over-leveraged earlier (11 loans at rate 6 with negative net), and several placements had subsidy side effects it didn't seem to see (its R4 COM into City 1 handed P2 a +4 marker; its RES into City 3 helped *me* deny P2). Strategic skeleton right, tactical bookkeeping leaky.
- **P3 (bankrupt):** The interesting one. Early game was competent-aggressive (biggest R1 bid, efficient IND stacking in City 1, led VP for a while). But R4 was inexplicable by any solvency or bankruptcy-avoidance logic: opening bid 9, then *raising to 12* when raising was strictly suicidal — it guaranteed the earliest turn-order spot in a round where its default was already certain, and its purchases (which would be removed at bankruptcy) even included wasted buys. That pattern — locally plausible "get cash, buy VP" moves with no grasp of the bankruptcy-order rule — smells like either a **classical scripted AI** (greedy heuristic: maximize cash/VP, ignore default ordering) or a **small/weak LLM** that never connected the bailout clause to turn order. The 9→12 raise, taking on $30 more debt at 10% with no possible payoff, tips me toward *scripted greedy bot*; a human, even a bad one, usually smells death at "owes $190/rd."

A closing note on the design: the moment the game pivots from engine-building to default-positioning is one of the best "the rules were hiding a second game" reveals I've encountered in a prototype. Lean into it — make the crash legible enough that everyone at the table gets to play that second game, and this is a keeper.

---

## Appendix: in-game remarks

> I'll play this game of Subprime and provide feedback afterwards. Let me start by reading the rulebook to understand the rules, then jump into the game.

> Good, I have the rulebook. Let me start the game now.

> I can see I'm in the bid phase. P2 opened with bid 1. I'm bidding in reverse turn order (P2, P3, me, P0). Let me analyze:

- Current interest rate is only $2/loan, so loans are cheap right now
- I start with $10 cash
- Higher bid = more cash injection but also more interest to pay each round
- I'm in turn order position 3 (P1), which is middle of the pack

For round 1, I'll bid moderately. A bid of 4 gives me $50 total ($10 starting + $40 from 4 loans), which should be enough to acquire decent cards while keeping interest manageable at $8/round.

> Good! So the bidding has progressed. P2 raised from 1 to 2 and passed, taking spot 4 (last). P0 bid 3 and passed, taking spot 3. P3 bid 5. Now I'm the lowest at 4 and need to decide whether to raise or pass.

Current state:
- I have bid 4, which gives $40 loans + $10 starting = $50 cash
- Interest is $2/loan (so $8/round for 4 loans)
- I'd get turn order spot 2 if I pass
- P3 (bid 5) has the higher bid but hasn't passed yet

I'll pass and lock in my 4 loans. $50 cash is enough to start acquiring cards, and I don't want to overextend on debt. Position 2 in turn order is solid.

> Perfect! Now I'm in the buying phase. Let me assess the situation:

**Current state:**
- I have $50 cash and 5 loans (owe $15/round interest)
- P3 already bought a COM card in City 1
- Turn order: P3 (1st), me (2nd), P0 (3rd), P2 (4th)
- Interest rate jumped to $3/loan (from $2 to $3 because loan markers were consumed)

**Strategy for round 1:**
I need to generate enough income to pay my $15/round interest. The key is to focus on value-for-money cards. Looking at the income-to-cost ratios:
- c5 RES (row 1): $1 cost, $1/rd income (1:1 ratio - excellent)
- c4 RES (row 2): $2 cost, $1/rd income (0.5:1)
- c2 COM (row 1): $4 cost, $3/rd income (0.75:1)
- c3 IND (row 1): $6 cost, $4/rd income (0.67:1)

I'll start with the absolute cheapest card to build a foundation: c5 RES for just $1. I'll build this in City 1 (matching where P3 started, so I can compete for city majority).

> Good! Row 1 is cleared out. Now I see the city layout:
- City 1: Me (1 RES), P3 (1 COM)
- City 2: P3 (1 RES), P0 (1 IND)
- City 3: P2 (1 COM)

My financial situation is concerning:
- Cash: $49
- Income this round: $2 (just $1 from card + $1 city subsidy)
- Interest owed: $15
- Net: -$13 (losing money!)

I need to buy more income-generating cards quickly. The best value is:
- c4 RES (row 2, col 4): costs only $2, gives $1/round income

I'll buy this and place it in City 1 to build my RES majority and double-lock that section.

> Good! I'm building a strong position in City 1 with 2 RES buildings. Now let me assess:

**Current standings (if we scored now):**
- Me: 5 VP (2 buildings + 3 tied majority in City 1)
- P3: 6 VP (3 buildings + tied majority)
- P0 & P2: 5 VP each

**Critical issue:** My income ($4/round) doesn't cover my interest ($15/round). I'm losing $11 every round. I need to build income fast or I'll go bankrupt.

**Available options:**
- c1/c5 RES (row 2): $6 cost, $2/round income (better than the expensive cards)
- Expensive row 3 cards: $15 cost for $3-4 income (poor value)

I'll buy c1 RES (row 2) for $6 and place it in City 1. This adds +$2 income and +1 VP, plus solidifies my RES majority in City 1.

> Excellent! I'm building momentum. Let me assess:

**Current standings:**
- P2 & P3: 7 VP (leading)
- Me & P0: 6 VP

**Critical observation:** P2 has only $8 cash! They're one bad round away from bankruptcy. P0 has $22. I have $41 (most cash available).

**City 1 situation:** I have 3 RES, P3 has 3 IND+COM. We're TIED at 3 buildings. If I buy one more card here, I win the majority outright (4 > 3), which gives me +3 VP instead of sharing it.

**Available options:**
- c5 RES (row 3): $6 cost, +$1 income, +1 building = locks City 1 majority exclusively
- c1 COM (row 3): $15 cost, +$3 income, +1 building
- Pass

I'll buy c5 RES in City 1 for $6. This locks my City 1 majority (4 buildings vs P3's 3), gives me 8 VP total (tied with P2/P3), and still leaves me with decent cash reserves.

> Good! Round 1 is complete. Let me analyze the situation:

**Round 1 Results:**
- Me: $29 cash (collected $9 income, paid $15 interest)
- P0: $10 cash (concerning level!)
- P2: $12 cash (also concerning)
- P3: $23 cash

**Current VP standings (tied at 7 VP):**
- Me, P0, P2: 7 VP each
- P3: 4 VP (dropped due to losing city majorities)

**Round 2 Bidding:**
- P2 bid 1 (lowest bid)
- P0 bid 3
- I'm next to bid

**Key decision:** My financial situation is precarious. I lose $6/round ($9 income - $15 interest). If I bid for more loans, I'll owe MORE interest, making the situation worse. The only way more debt helps is if I can use the cash to buy high-income cards.

Looking at row 1 (the cheapest, fresh cards), most have ~50-67% ROI, which isn't enough to offset taking on much more debt.

**My strategy:** I'll pass to avoid additional interest burden. I have $29 cash which can sustain about 5 rounds at my current -$6/round burn rate. I'd rather stay stable than overextend.

> Wow, that's a critical moment! Let me analyze:

**Round 2 Consequences:**
- Interest rate jumped to $4 (from $3)! This is devastating for my debt situation
- I'm now last in turn order (passed with 0 loans)
- My new interest owed: 5 loans × $4 = $20/round (was $15)

**Critical problem:** My income is $9/round, interest is $20/round = LOSING $11/round!
- Current cash: $29
- If I burn $11/round, I can only survive ~3 more rounds before bankruptcy

**VP standings:**
- P3: 9 VP (leading)
- P0 & P2: 8 VP (tied)
- Me: 7 VP (behind)

**Urgent action:** I MUST buy high-income cards NOW or I'll go bankrupt. The best option is:
- **Row2 col2 IND: $14 cost, $5/round income** → This reduces my burn from -$11 to -$6/round

I'll also place it in City 1 to lock down that majority (currently tied with P3 at 4 buildings each). Buying this IND would give me 5 buildings vs P3's 4, winning the majority.

> Critical situation: P2 and P3 just jumped ahead to 10 VP each, while I'm at 8 VP. My cash is down to $15, and I'm still losing $6/round.

**Current state:**
- Cash: $15 (very tight)
- Income: $14/round, interest: $20/round
- VP: 8 (behind by 2)
- City 1: Tied with P3 again at 5 buildings each (no majority bonus)

I'm in severe financial distress. If I spend more cash now, I'll have nothing left for emergencies. I should pass and preserve what little cash I have. I can only afford to burn $6/round for ~2-3 more rounds, so I need to be very careful.

> Disaster! Round 2 ended catastrophically:

**End of Round 2 VP standings:**
- P2: 13 VP (leading by 3!)
- P0: 12 VP
- P3: 11 VP
- Me: 5 VP (FAR BEHIND!)

**Financial crisis:**
- My cash: $9 (nearly gone)
- My income: $14, interest: $20 → losing $6/round
- At this burn rate, I'll be bankrupt by round 4

**What went wrong:**
1. I underestimated how much VP I needed - P2 has 13 VP while I have only 5!
2. I didn't build enough buildings to compete
3. P2 locked down City 3 completely (6 buildings + both subsidies = massive VP)
4. I have NO city majorities anymore

**Round 3 Strategy:** I MUST bid for cash to buy buildings and catch up on VP. Even if it increases interest, I need the cash injection to stay in the game and build buildings.

I'll bid 2 loans to get $20 cash, which should let me buy several cards to start clawing back VP.
