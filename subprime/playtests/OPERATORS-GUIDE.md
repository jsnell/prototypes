# Operator's guide: running LLM agent evals

How to run a multi-seat Subprime playtest with LLM players — written
for a Claude session operating the eval. Two prior runs to crib from:
`blind-2026-07-06/` (2 LLMs + 2 heuristic agents) and
`models-2026-07-07/` (4 LLMs, one per model tier).

## What an eval is

One shared game (a pickle file driven by `subprime.llmcli`), one
background subagent per external seat, each playing blind through the
CLI and filing a post-game experience report. The operator creates the
game, launches the players, monitors, recovers crashes, then archives
the raw reports and distills findings. Everything runs local — no
server.

## 1. Create the game

From `/home/user/prototypes/subprime` (state file in your scratchpad):

    python3 -m subprime.llmcli new --state <scratch>/game.pkl \
        --agents "" --humans 4 --seed <SEED> [--names A,B,C,D]

- `--humans N` = number of externally-played seats (0..N-1); list any
  heuristic agents for the rest in `--agents` (e.g. `digest2,digest2`
  with `--humans 2` for a mixed table). `digest2` is the strongest
  scripted agent.
- Pick a fresh seed and RECORD it — it goes in the archive README.
- `--names`: display names replace P0..Pn in all output. For blind
  runs use neutral names or the Px default; never model names.

## 2. Brief the players

Instantiate `BRIEFING-TEMPLATE.md` once per seat ({SEAT}, {STATEFILE}).
Rules of the template:

- Keep the FAIRNESS list in sync with the repo (it must bar the source,
  DESIGN_NOTES, README, and all of playtests/ — the archived reports
  would leak the meta).
- Keep identities hidden and symmetric: every player is told the
  others "could be a human, an LLM, or a classical scripted AI",
  regardless of what they actually are.
- Don't edit briefings or coach players mid-game; it contaminates the
  probe. If a player asks the operator something, the answer is the
  rulebook or silence.
- The narration requirement stays in — the designer reads it, and it's
  the player's own recovery point after a crash.

Launch one background subagent per seat, all in a single message so
they start together, with the model override per seat as desired.
Record which model got which seat (it is NOT in the game state).

## 3. Monitor

Turns are strictly sequential; a 4-LLM game runs ~90-120 min and is
~85% model thinking, so long quiet stretches are normal. Expect
~100-160k tokens per seat.

Check-ins: schedule one every ~30-45 min (send_later). At each one:

- Game progress: `llmcli show --state <file> --as 0 | head -15`
  (round/phase) and the state file mtime.
- Per-seat liveness: last-write time of each player's transcript
  (`/root/.claude/projects/.../subagents/agent-<id>.jsonl`). All seats
  writing within the last few minutes = healthy.
- The web UI task chips are unreliable across crash/resume — trust the
  filesystem timestamps, not the chips.
- Stalled = the game waits on one seat AND that seat's transcript has
  been silent for 10+ min while others were active.

DO NOT read a player's transcript/output file wholesale (it's a full
JSONL session and will overflow your context). Tail small byte ranges
if you must inspect.

## 4. Crash recovery

Players die in batches when the API hiccups (one outage killed all
four at the same second). Nothing is lost: the pickle holds every
move, and `--turn` guards prevent stale actions. To resume a seat,
SendMessage to its agent id:

    Your previous run was interrupted by a transient API connection
    error — the game is still live and waiting. You are still player
    <NAME> (seat <N>). Resume: run `python3 -m subprime.llmcli wait
    --state <FILE> --as <N>` from /home/user/prototypes/subprime
    (Bash timeout >= 300000 ms) to catch up, then continue the
    one-command-per-turn loop. All original instructions stand,
    including the post-game report.

The resumed agent keeps its full context. You may need to do this more
than once per game; it's routine.

## 5. Collect and archive

Each player's final message is its report; it arrives in the task
completion notification. Archive VERBATIM (the designer reads the raw
text) to `playtests/<name>-<date>/`:

- `pN-<who>-report.md` — the report, plus the player's in-game
  remarks as an appendix. Extract from the transcript: parse the
  agent's `.jsonl`, collect `message.role == "assistant"` text blocks;
  the last block is the report, earlier ones are the remarks.
- `prompt.md` — the verbatim briefing (one copy; note seat
  substitution).
- `README.md` — seed, seat→model map, result table, one-paragraph
  summary, identity-guess scoreboard.

Then: distill design findings into DESIGN_NOTES.md (new subsection,
follow the existing style — findings, corrections, and what changed),
deliver the synthesis to the designer, and commit + push everything
straight to master (repo convention: no branches, no PRs).

## 6. Handling what the players claim

- Reports are authoritative about EXPERIENCE (fun, agency, pacing,
  legibility) and evidence about STRATEGY.
- Reports are NOT authoritative about RULES. Verify every rules claim
  against the engine before changing anything — one playtester's
  confident wrong model of the bid track made it into a UI string
  before the designer caught it. `docs/rules-issues.md` is the living
  list for genuine rules-text problems.
- Design-intent boundary: the bankruptcy shield and similar discovered
  strategies must never be explained in player-facing materials.
  Rules must be unambiguous; implications stay discoverable.

## 7. Known footguns

- Bash timeout vs wait: players must pass a Bash timeout >= 300000 ms;
  `--max-wait` defaults to 100s and the briefing says 270s (stays
  under the 5-minute prompt-cache TTL — longer waits expire the cache
  and make every turn re-read the seat's whole history).
- Forced moves auto-play (logged); a seat that seems "skipped" wasn't.
- Only the lowest bidder acts in the raise phase — if a player claims
  the turn/auction behaved wrongly, check the engine first (it has
  been right every time so far).
- The state file is only safely touched through llmcli (it does file
  locking); never edit or copy it while a game runs.
