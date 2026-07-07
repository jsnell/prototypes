# Rules-text issues reported by playtesters

Compiled from the six archived LLM playtest reports
(`playtests/blind-2026-07-06/`, `playtests/models-2026-07-07/`),
cross-checked against `original-design.md` and the engine. Scope:
ambiguous, misleading, or missing RULES TEXT only — strategic
implications of correct rules are deliberately excluded (designer
policy: implications are for players to discover).

## A. Reported ambiguities / gaps (each cost or confused a player)

1. **Winner and tiebreak are never stated.** The scoring section lists
   point sources but never says "most VP wins," and the money tiebreak
   appears nowhere. A blind-game player lost 26-26 on cash without
   knowing the rule existed; both players in that game flagged it.
   Implemented rule: most VP wins; VP ties break on remaining money;
   still-tied players share the win. (The elevator pitch also cuts off
   mid-sentence at exactly this point: "The player with the largest".)

2. **City-subsidy income: who gets the $1/card?** The marker is placed
   "next to that player's cards," but the income bullet says "$1 per
   owned card in that section" — readable as paying every owner in the
   section. Implemented: ONLY the marker holder (the strict-most
   player) collects the city-subsidy bonus. A blind-game player had to
   reverse-engineer this from the income log mid-game.

3. **State-subsidy income vs. VP asymmetry.** Income: every owner in a
   state-subsidized section gets +$1/card (the text does say this, but
   only implicitly by omitting a leader restriction). VP: only the
   strict-most player scores. Two playtesters (one per game) said the
   asymmetry took a careful re-read / never fully resolved. One
   explicit sentence contrasting the two would settle it.

4. **Do subsidy markers persist to scoring after a bankruptcy?**
   Markers are placed in phase 3; the bankrupt player's buildings are
   removed in phase 4; scoring then references "each city section with
   a state subsidy marker." Nothing says whether markers are
   re-evaluated after the removals. Implemented (and supported by the
   physical-marker reading): markers stay exactly as placed at income
   time. A player built its final — potentially game-winning — play on
   the opposite reading and lost by 1 VP.

5. **Do unowned buildings count toward city totals?** Repossessed
   buildings "are returned to the appropriate section... without
   ownership markers" — but do they still count when determining the
   city with "the fewest buildings of that type" (and city majorities)?
   Implemented: yes for section/type counts (they are buildings in the
   city), no for any income, VP, or majority credit (no owner). One
   player flagged this as "unclear, and it ended up mattering."

6. **"Running out of loan markers." is a dangling fragment** — a
   heading with no body. The designer ruling that fills it: bids are
   always honored in full even when markers run out, and an emptied
   track ends the game that round. Two games have now ended through
   exactly this interaction; the text for it doesn't exist.

7. **Interest: per loan, or flat?** The doc says "Each player must pay
   this amount in interest" — literally a flat payment per player.
   The intended (ruled, implemented, and briefed) rule is rate × loans
   held. Playtesters never reported this one only because every
   briefing states the ruling explicitly; a cold reader of the doc
   gets the game-breakingly wrong version.

## B. Designer rulings in effect but absent from the doc

(Sourced from the rulings log in DESIGN_NOTES; a cold reader cannot
learn these from the doc at all.)

- **Passing without an initial bid** is allowed (0 loans, last free
  turn-order spot); initial bid placement is otherwise compulsory in
  the text.
- **Bid track spaces are 1-12, no 0 space** (components list doesn't
  give the range).
- **Loans can never be repaid** (the doc never says either way; ruled:
  permanent, repricing every round).
- **Starting loans come off the track** (setup gives each player a
  marker right after placing "all" markers on the track — ambiguous
  which pile they come from; ruled: off the track, cheapest spaces).
- **Bailout auction price** — "its normal purchase price" doesn't say
  which row multiplier; ruled: base card cost (×1).

## C. Correct but worth an example (legibility, not errors)

- **Rate = highest visible (uncovered) number** + row expiry under the
  round marker: two strong players initially mis-modeled the combined
  behavior; one asked whether a fully-empty row keeps the rate at its
  printed number (it does — the number is visible). The text is right;
  a one-line worked example ("row 4 empty, row 5 full → rate is row
  4's $6") would prevent the misreads.
- **Bid/turn-order mechanism**: the text is complete and correct
  (lowest-may-act, pass takes the last free spot ⇒ turn order is bid
  order). One playtester still invented a wrong model ("a high bidder
  who passes early goes late" — impossible). Consider stating the
  consequence outright: "the final turn order always equals bid order,
  highest bid first." That's a derived fact, but it's mechanical, not
  strategic — stating it doesn't spoonfeed play.
