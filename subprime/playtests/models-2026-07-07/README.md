# Four-model blind playtest — 2026-07-07

Four-player game of Subprime, seed 20260707, tuned rate curve, final
rules. ALL FOUR seats were LLM players (no heuristic agents), one per
Claude model tier, playing live through `subprime.llmcli` multi-seat
mode. Identities hidden — each was told the others "could be a human,
an AI language model (any vendor or size), or a classical scripted AI."

| seat | model | VP | fate |
|------|-------|----|------|
| P2 | **Fable** | **20** | bailed out — **WINNER** |
| P0 | Opus | 19 | bailed out |
| P1 | Haiku | 17 | bailed out |
| P3 | Sonnet | 0 | **bankrupt** (bid 9, raised to 12 while insolvent) |

The game ended in round 4 of 6 with a quadruple default: the round-4
bid war (9/8/7/6) drained the loan track, spiked the rate to $10/loan,
and made every player insolvent. Sonnet, earliest in turn order, took
the bankruptcy; everyone else was bailed out at $0. Final margin 1 VP.

Files: `prompt.md` (verbatim briefing), `p<seat>-<model>-report.md`
(each player's raw post-game report, with their spontaneous in-game
remarks as an appendix — Opus 16, Haiku 12, Fable 1, Sonnet 0).

Identity-guess scoreboard: all three opponents identified Fable as the
strong LLM at the table. All three called Sonnet a classical scripted
AI (the insolvent bid-12 raise read as "no model of the bankruptcy
rule"). Sonnet in turn called Opus a greedy script. One endgame
blunder dominated identity perception more than 3 rounds of competent
play. Nobody guessed any seat was human.

Distilled design findings live in `../../DESIGN_NOTES.md`.
