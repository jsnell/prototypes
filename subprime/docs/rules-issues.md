# Rules-text issues (living list)

STATUS 2026-07-07: the rulebook revision (e40ae0d, zones/blocks
terminology) resolved every item in the original playtester-compiled
list — winner + money tiebreak now stated, per-loan interest explicit,
pass-before-bid and turn-order-equals-bid-order in the text, "running
out of loan markers" written out (loan chits), city-subsidy recipient
disambiguated by blocks, Insolvent! cards make default state explicit,
starting loans come off row 1, auction at base price. The $1-on-stale-
cards cleanup rule was removed outright (implemented in engine rev.
that accompanied this file).

Remaining items from the consistency review of the revised text:

## Resolved by the c46b85b doc update

1. ~~Do the bankrupt player's buildings compete at scoring?~~ **Ruled
   and implemented**: they still count for majorities — a sole dead
   winner of a city/zone means nobody scores it; ties including the
   bankrupt player still pay the living tied players. Agents'
   bankruptcy previews (score_snapshot exclude) updated to match.
2. ~~Insolvent! cards: 4 vs 5 players~~ — components now say 5.
3. ~~Post-auction subsidy recompute~~ — replaced with "The subsidy
   markers are not moved" (designer: the original design deliberately
   avoided post-bankruptcy subsidy updates). Engine reverted to
   income-phase markers persisting to scoring.

## Observations (no action strictly required)

4. **Bid track range (1-12, no 0) still unstated** — the components
   list doesn't give the space count, and it mattered (a playtester
   bid 12).
5. **Income bullet phrasing**: "modified by the subsidy tokens in the
   zone/block" — consider "in that zone and in the player's own block"
   to fully exclude reading a rival's block marker as paying you. The
   block model otherwise makes this unambiguous in spirit.
6. **Elevator pitch no longer states the goal** — the dangling "The
   player with the largest" was deleted rather than completed; the
   pitch now ends without a win condition (scoring has it, but the
   pitch is where a reader looks first).

## Typos / nits

7. Setup: "Give each player one loan markers" → "one loan marker".
8. Phase 1: "the lowest current bid is given the opportunity" → "the
   player with the lowest current bid".
9. Phase list says "4. Bailout and end of the game"; the section is
   titled "Phase 4 - Bankruptcy and end of game" — pick one.
10. Phase 1 doesn't state that a player who passed without placing an
    initial bid takes zero loans (clearly implied, never said).
