# Subprime — board game design lab

A simulation framework for iterating on the *Subprime* board game design.
The rules engine implements the design doc; **every number the doc leaves
open is a field on `GameConfig`**, so a design variant is one changed line,
and AI players + batch simulation turn variants into comparable metrics.

Pure Python 3.11+, stdlib only. No dependencies to install.

## Quick start

```bash
cd subprime  # this project directory

# watch one game with a full event log
python3 -m subprime.cli play --agents greedy,random,greedy,random --seed 3

# 500 games, design metrics report (~2 seconds)
python3 -m subprime.cli sim --games 500 --players 4 \
    --agents greedy,random,timid,leveraged

# compare design variants: sweep any GameConfig field
python3 -m subprime.cli sweep --param bid_spaces \
    --values "(0,1,2,3,4,5,6,7,8,9,10,11,12);(0,1,2,3,4,5,6)" \
    --games 300 --players 4 --agents greedy,random,timid,leveraged

# tests
python3 -m unittest discover -s tests
```

## What the report tells you

`sim` prints the numbers a designer cares about:

- **game length & end causes** — is the game ending by bankruptcy, loan
  exhaustion, or playing out all 6 rounds? (A healthy design probably mixes
  these; all-bankruptcy-by-round-2 means the debt spiral is too steep.)
- **win rate by agent** — do cautious, greedy, and hyper-leveraged
  strategies all have a chance? If `leveraged` dominates, debt is too cheap;
  if `timid` dominates, loans aren't worth taking.
- **win rate by initial turn order position** — positional fairness.
- **loans / interest / income / subsidy averages** — is the interest engine
  biting? Are subsidies a real income source or noise?
- **purchases by display row and building type** — does the ×1/×2/×3 row
  pricing see use across all rows? Do all three building types get bought?

`--json out.json` dumps per-game records for your own analysis.

## Findings so far (with default config)

Even the first runs produce design signal:

- With a bid track of 0–12, players *can* take 10+ loans in round 1; the
  50-marker track drains, the rate jumps to 6, and **96% of games end in
  bankruptcy by round 2–3**. Capping the bid track at 6 lengthens games and
  triples the win rate of the most leveraged strategy — leverage becomes a
  sharp edge instead of a suicide pact.
- Interest scales per-loan (see `interest_per_loan` in DESIGN_NOTES.md):
  a round-1 loan costs ~$21 in lifetime interest against $10 received, so
  loans only pay if converted into income *immediately*. Whether that's the
  intended knife-edge is a design decision the sweeps can inform.

## Layout

Paths relative to this directory; the inner `subprime/` is the Python package.

| file | what |
|---|---|
| `subprime/config.py` | `GameConfig` — every design knob, incl. the 100-card distribution |
| `subprime/cards.py` | card model + deck builder |
| `subprime/state.py` | full game state (clonable at any decision point) |
| `subprime/engine.py` | rules engine: `legal_actions` / `apply_action` state machine |
| `subprime/agents.py` | RandomAgent, HeuristicAgent (parameterized), MonteCarloAgent |
| `subprime/simulate.py` | batch runner, metrics, config sweeps |
| `subprime/cli.py` | `play` / `sim` / `sweep` commands |
| `tests/` | rule unit tests + full-game smoke tests |
| `DESIGN_NOTES.md` | every gap/ambiguity in the doc → the config knob that fills it |
| `docs/original-design.md` | the design doc, as received |

## Iterating on the design

1. **Change a number**: edit `GameConfig` defaults or pass alternatives via
   `sweep`. The card distribution is `DEFAULT_CARD_DISTRIBUTION` in
   `config.py` — a plain table of `(type, cost, income, count)`.
2. **Change a rule interpretation**: ambiguous rules are config flags
   (e.g. `interest_per_loan`); genuinely different mechanisms are small,
   isolated functions in `engine.py`.
3. **Add a strategy**: subclass `Agent` (one method: `act(state, pid,
   actions) -> action`) or just instantiate `HeuristicAgent` with different
   `HeuristicParams`, and register it in `AGENT_REGISTRY`. If a new
   strategy dominates, the design has a hole; simulate before printing.
4. **Sanity-check with search**: the `mc` agent plays by flat Monte Carlo
   rollouts with no built-in strategy assumptions — slow, but useful for
   checking whether a heuristic conclusion is an artifact.

## Agents

| name | behavior |
|---|---|
| `random` | uniform over legal moves — stress-tests rules, baseline |
| `greedy` | heuristic: bids by loan appetite vs. rate fear, buys by projected income + subsidies + endgame VPs, keeps an interest reserve |
| `timid` | `greedy` with low loan appetite, high rate fear |
| `leveraged` | `greedy` with high appetite, thin reserves |
| `mc` / `mc-fast` | flat Monte Carlo over legal actions (slow / cheaper) |
