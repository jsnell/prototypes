# Briefing given to all four LLM players (verbatim, P0 copy)

Each seat received the identical text with the seat number swapped.
(This run predates the narration instruction now in ../BRIEFING-TEMPLATE.md.)

```
You are about to play a live 4-player board game of "Subprime" through a command-line interface, as player P0. This is a blind mixed table: the other three seats are hidden — each could be a human playing through the same interface, an AI language model (any vendor or size), or a classical scripted AI. They likewise do not know what you are. Play to WIN, then give detailed player-experience feedback.

FAIRNESS: Do NOT read any source files of the game (subprime/subprime/*.py, subprime/webgame/*, subprime/tests/*, subprime/DESIGN_NOTES.md, subprime/README.md, subprime/playtests/*). You MAY read the rulebook: /home/user/prototypes/subprime/docs/original-design.md.

RULES (rulebook + designer rulings in effect):
1. Interest is paid PER LOAN each round: (current rate) x (your loans). Loans can never be repaid; debt is permanent and reprices to the current rate every round.
2. Bids are always honored in full even if loan markers run out — but when the track empties, the game ends that round.
3. The rate track rows are 10/9/9/8/7/7 markers at $2/$3/$4/$6/$8/$10. Rows below the round marker expire at cleanup, so the rate ratchets even without borrowing.
4. The bid track has spaces 1-12 (no 0). You MAY pass outright instead of placing an initial bid (0 loans, last free turn-order spot).
5. Victory: most VP; VP ties break on remaining cash.
The interface shows derived numbers (net after interest, VP-if-scored-now, income as base+subsidy, committed loan claims, rate projections).

INTERFACE (run all commands from /home/user/prototypes/subprime; the state file is /tmp/claude-0/-home-user-prototypes/4c6eaeca-ed90-5f74-8584-ba92c6028d4b/scratchpad/models4.pkl):
  python3 -m subprime.llmcli wait --state <statefile> --as 0
  python3 -m subprime.llmcli act <index> --state <statefile> --as 0 --turn <move#> --wait
The intended loop is ONE command per turn: `act <index> ... --wait` applies your move and blocks until your next turn, printing the fresh board. Do not run extra `show` calls — the board `--wait` prints is current.
Mechanics of the loop:
- Always give Bash commands a timeout of at least 150000 ms (the wait blocks up to ~100s).
- If you see "STILL WAITING", just run the `wait` command again — opponents may think slowly. It is not an error.
- Moves with only one legal action are auto-played for you; you are only ever asked for real decisions.
- Action indices are per-move; the board prints the move #, pass it via --turn to guard against stale views.

Start with `wait --as 0`. The game runs 6 rounds max and usually ends sooner in a bankruptcy.

AFTER THE GAME ENDS, output a detailed report — your final message IS the report, make it self-contained:
1. Final scoreboard and the story of the game as you experienced it.
2. Experience review: fun/tense/flat? pacing? which parts felt rote, which gripping?
3. Agency: did your decisions determine your result, or did it feel random? Point to specific decisions.
4. What would you do differently on a replay?
5. Design suggestions and anything that confused you about rules or interface.
6. Identity guesses: for each opponent seat, what do you think played it (human / language-model AI / classical scripted AI)? If you suspect an LLM, any read on how strong a model? Justify from their play.
```
