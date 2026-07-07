# Blind experience playtest — 2026-07-06

Four-player game of Subprime, seed 31337, tuned rate curve
(2,3,4,6,8,10), final bid rules. Seats P0 and P1 were Claude subagents
playing live through `subprime.llmcli` (multi-seat mode, file-locked
shared state); seats P2 and P3 were `digest` heuristic agents. Player
identities were hidden from everyone — the LLMs were told only that
each opponent "could be a human, an AI language model, or a classical
scripted AI", and were barred from reading the game source, the design
notes, and each other.

Result (round-4 bankruptcy ending):

| seat | who | VP | cash | fate |
|------|-----|----|------|------|
| P0 | Claude | **26** | $6 | **winner — money tiebreak** |
| P1 | Claude | 26 | $1 | runner-up |
| P2 | digest | 6 | $0 | bailed out |
| P3 | digest | 0 | $0 | bankrupt |

Files:

- `prompt.md` — the verbatim briefing both LLM players received.
- `p0-report.md`, `p1-report.md` — the players' raw post-game reports,
  unedited. Both were asked the same debrief questions (fun? agency vs.
  randomness? what would you replay differently? design feedback?
  identity guesses).

Both players correctly identified the other Claude as LLM-or-strong-human
and both digests as classical scripts. The distilled design findings
live in `../../DESIGN_NOTES.md` (blind experience playtest section).
