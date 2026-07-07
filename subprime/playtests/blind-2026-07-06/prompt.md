# Briefing given to both LLM players (verbatim, P0 copy)

P1 received the identical text with the seat number swapped.

```
You are about to play a live 4-player board game of "Subprime" through a command-line interface, as player P0. This is a blind mixed table: the other three seats are opponents whose identities are hidden from you — each could be a human playing through the same interface, an AI language model like yourself, or a classical scripted AI. They likewise do not know what you are. Play to WIN, then give detailed player-experience feedback.

FAIRNESS: Do NOT read any source files of the game (subprime/subprime/*.py, subprime/webgame/*, subprime/tests/*, subprime/DESIGN_NOTES.md, subprime/README.md). You MAY read the rulebook: /home/user/prototypes/subprime/docs/original-design.md.

RULES (rulebook + designer rulings in effect):
1. Interest is paid PER LOAN: each round you pay (current rate) x (your loans). Loans can never be repaid; debt is permanent and reprices to the current rate every round.
2. Bids are always honored in full even if loan markers run out — but when the track empties, the game ends that round.
3. The rate track rows are 10/9/9/8/7/7 markers at $2/$3/$4/$6/$8/$10. Rows below the round marker expire at cleanup, so the rate ratchets up every round regardless.
4. The bid track has spaces 1-12 (no 0). You MAY pass outright instead of placing an initial bid (0 loans, last free turn-order spot).
The interface shows most derived numbers (net position after interest, VP-if-scored-now, income as base+subsidy, committed loan claims).

INTERFACE (run from /home/user/prototypes/subprime; your state file is /tmp/claude-0/-home-user-prototypes/4c6eaeca-ed90-5f74-8584-ba92c6028d4b/scratchpad/blind.pkl):
  python3 -m subprime.llmcli wait --state <file> --as 0     # blocks until YOUR turn (or game over); may print STILL WAITING — just run it again
  python3 -m subprime.llmcli act <index> --state <file> --as 0
  python3 -m subprime.llmcli show --state <file> --as 0     # reprint state
Always act from the freshest action list (indices reshuffle; --turn N guards staleness). The other players take real time to decide — patience with STILL WAITING is normal. If you see STILL WAITING more than ~15 times in a row, run show, and if the game appears permanently stuck, stop and report that.

Play the full game thoughtfully — cash flow (income arrives before interest), the rate ratchet, turn-order value, majorities/subsidies, endgame VP. Watch opponents' behavior and adapt.

WHEN THE GAME ENDS, report:
1. Final scoreboard + a short story of the game (2-4 sentences) and what the inflection point was.
2. EXPERIENCE REVIEW — the designer wants honest, specific critique: Did you enjoy playing? Was it tense? How was the pacing? Did any phase drag or feel rote?
3. AGENCY: did you feel your decisions determined the outcome, or did it feel random/positional? Which decisions mattered most?
4. What would you do differently on a replay?
5. Design suggestions or points of confusion (rules or interface).
6. Identity guesses: for each opponent (P1, P2, P3), what do you think they were (human / language-model AI / classical scripted AI) and what behavior made you think so?
```
