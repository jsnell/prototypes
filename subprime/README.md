# Subprime — board game design lab

A simulation framework for iterating on the *Subprime* board game design.
The rules engine implements the design doc; **every number the doc leaves
open is a field on `GameConfig`**, so a design variant is one changed line,
and AI players + batch simulation turn variants into comparable metrics.

Pure Python 3.11+, stdlib only. No dependencies to install.

## Quick start

```bash
cd subprime  # this project directory

# PLAY the game in a browser: you vs 3 AIs (then open localhost:8000)
python3 -m subprime.web

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

## Findings so far

See the bottom of DESIGN_NOTES.md for the current state of knowledge. The
headline results:

- Cautious tables finish all 6 rounds with 0% bankruptcies under every
  config tested — early collapse comes from aggressive *bidding*, not from
  the economy itself.
- The market is a fixed-size money sink (~$120 of stock per round at 4
  players); a max-bid round injects ~$460, the board sells out, and the
  excess is pure interest liability. Price-blind agents do this anyway —
  so early conclusions like "building prices don't affect survival" were
  **agent artifacts**. Methodological lesson: make agents demand-aware
  (`sharp`, `sharp-lev`) before reading economics off the sims.
- With demand-aware agents, the building price level is the primary pacing
  lever: row multipliers (1,2,3) → ~2% bankruptcies; (1,2,4) → 46%;
  (1,3,4) → 97%; (2,3,4) → 100% with round-2.6 collapse. The transition is
  smooth, so the bankruptcy rate is tunable by pricing alone.
- Interest scales per-loan (see `interest_per_loan` in DESIGN_NOTES.md):
  a round-1 loan costs ≥$16 in lifetime interest against $10 received, so
  loans only pay if converted into income *immediately*.

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
| `subprime/web.py` + `webui.html` | browser game: 1 human vs 3 agents (stdlib HTTP server) |
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
| `sharp` | demand-aware `greedy`: caps loans by what the market can absorb |
| `sharp-lev` | `sharp` with maximum appetite — aggressive but market-aware |
| `sharp-pos` | `sharp` that also pays for turn order ($2 per outlasted rival) |
| `shark` | `sharp-pos` plus survival math at projected rates, kill-bids that force a rival's default, and loan-track draining to end the game while ahead |
| `mc` / `mc-fast` | flat Monte Carlo over legal actions (slow / cheaper) |
