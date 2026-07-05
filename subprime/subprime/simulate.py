"""Batch simulation and design-metric reporting.

run_series() plays many games (rotating which agent sits in which seat),
summarize() turns the records into the numbers a designer cares about:
who wins, how games end, whether the loan/interest engine bites, whether
all three market rows and building types see play, and whether turn order
position is worth anything.
"""

import json
import statistics
from dataclasses import dataclass, field, asdict

from .cards import BUILDING_TYPES
from .agents import make_agent
from .engine import new_game, decision_player, legal_actions, apply_action
from .state import P_BUY, P_OVER


@dataclass
class GameRecord:
    seed: int
    n_players: int
    rounds_played: int
    end_cause: str
    final_rate: int
    winners: list                 # player ids
    bankrupt: object              # pid or None
    bailed_out: list
    agents: list                  # agent name per player id
    initial_order: list           # setup turn order (pids first -> last)
    vp: list
    money: list
    loans: list
    loans_taken: list
    interest_paid: list
    income_earned: list
    subsidy_earned: list
    buildings: list
    buys_by_row: list = field(default_factory=lambda: [0, 0, 0])
    buys_by_type: dict = field(default_factory=dict)
    cards_left_in_deck: int = 0
    # market saturation, one entry per round (after the buy phase)
    display_left_by_round: list = field(default_factory=list)
    unspent_cash_by_round: list = field(default_factory=list)


def _record(state, agent_names, seed, initial_order, buys_by_row, buys_by_type):
    ps = state.players
    return GameRecord(
        seed=seed,
        n_players=state.n_players,
        rounds_played=state.round,
        end_cause=state.end_cause,
        final_rate=state.current_rate(),
        winners=list(state.winners),
        bankrupt=state.bankrupt_pid,
        bailed_out=sorted(state.bailed_out),
        agents=list(agent_names),
        initial_order=initial_order,
        vp=[p.vp for p in ps],
        money=[p.money for p in ps],
        loans=[p.loans for p in ps],
        loans_taken=[p.loans_taken for p in ps],
        interest_paid=[p.interest_paid for p in ps],
        income_earned=[p.income_earned for p in ps],
        subsidy_earned=[p.subsidy_earned for p in ps],
        buildings=[sum(c.owned_count(p.pid) for c in state.cities) for p in ps],
        buys_by_row=buys_by_row,
        buys_by_type=buys_by_type,
        cards_left_in_deck=len(state.deck),
        display_left_by_round=[rs["display_left"] for rs in state.round_stats],
        unspent_cash_by_round=[sum(rs["cash_after_buy"])
                               for rs in state.round_stats],
    )


class _Instrumented:
    """Wraps an agent to record what gets bought from where."""

    def __init__(self, agent, buys_by_row, buys_by_type):
        self.agent = agent
        self.buys_by_row = buys_by_row
        self.buys_by_type = buys_by_type

    def act(self, state, pid, actions):
        action = self.agent.act(state, pid, actions)
        if state.phase == P_BUY and action[0] == "buy":
            _, r, c, _city = action
            self.buys_by_row[r] += 1
            typ = state.display[r][c][0].type
            self.buys_by_type[typ] = self.buys_by_type.get(typ, 0) + 1
        return action


def play_recorded(config, agent_names, seed, collect_events=False):
    buys_by_row = [0] * config.display_rows
    buys_by_type = {}
    agents = [_Instrumented(make_agent(name, seed=seed * 7919 + i),
                            buys_by_row, buys_by_type)
              for i, name in enumerate(agent_names)]
    state = new_game(config, len(agents), seed=seed,
                     collect_events=collect_events)
    initial_order = list(state.turn_order)  # bidding hasn't reordered it yet
    while state.phase != P_OVER:
        pid = decision_player(state)
        state_action = agents[pid].act(state, pid, legal_actions(state))
        apply_action(state, state_action)
    rec = _record(state, agent_names, seed, initial_order, buys_by_row,
                  buys_by_type)
    return state, rec


def run_series(config, agent_names, n_players, n_games, base_seed=0,
               rotate_seats=True):
    """Play n_games; agent_names are cycled to fill n_players seats and,
    when rotate_seats, shifted every game so no agent owns a seat."""
    records = []
    for g in range(n_games):
        shift = g % n_players if rotate_seats else 0
        seats = [agent_names[(i + shift) % len(agent_names)]
                 for i in range(n_players)]
        _state, rec = play_recorded(config, seats, seed=base_seed + g)
        records.append(rec)
    return records


# ------------------------------------------------------------- reporting

def _pct(x, n):
    return f"{100.0 * x / n:5.1f}%" if n else "  n/a"


def summarize(records):
    n = len(records)
    if not n:
        return "no games"
    out = []
    add = out.append
    n_players = records[0].n_players
    add(f"=== {n} games, {n_players} players ===")
    add(f"avg rounds played: "
        f"{statistics.mean(r.rounds_played for r in records):.2f} "
        f"(design max {max(r.rounds_played for r in records)})")

    causes = {}
    for r in records:
        causes[r.end_cause] = causes.get(r.end_cause, 0) + 1
    add("end causes:        " + ", ".join(
        f"{c} {_pct(k, n).strip()}" for c, k in sorted(causes.items())))
    add(f"avg final interest rate: "
        f"{statistics.mean(r.final_rate for r in records):.2f}")
    bailed = sum(len(r.bailed_out) for r in records)
    add(f"bankruptcies: {_pct(sum(1 for r in records if r.bankrupt is not None), n).strip()}"
        f" of games; government bailouts: {bailed} total")

    # win rate per agent name (ties share the win)
    wins, seats = {}, {}
    for r in records:
        for pid, name in enumerate(r.agents):
            seats[name] = seats.get(name, 0) + 1
            if pid in r.winners:
                wins[name] = wins.get(name, 0) + 1.0 / len(r.winners)
    add("win rate by agent:")
    for name in sorted(seats):
        add(f"  {name:<12} {_pct(wins.get(name, 0), seats[name])}"
            f"  ({seats[name]} seats)")

    # positional advantage: initial (round 1) turn order
    pos_wins = [0.0] * n_players
    for r in records:
        for pos, pid in enumerate(r.initial_order):
            if pid in r.winners:
                pos_wins[pos] += 1.0 / len(r.winners)
    add("win rate by initial turn order position: " +
        " ".join(_pct(w, n).strip() for w in pos_wins))

    def per_player(attr):
        vals = [v for r in records for v in getattr(r, attr)]
        return statistics.mean(vals)

    add(f"per player: vp {per_player('vp'):.1f} | money end ${per_player('money'):.1f} | "
        f"loans {per_player('loans'):.1f} | interest paid ${per_player('interest_paid'):.1f}")
    add(f"            income ${per_player('income_earned'):.1f} "
        f"(+${per_player('subsidy_earned'):.1f} subsidies) | "
        f"buildings {per_player('buildings'):.1f}")

    total_buys = sum(sum(r.buys_by_row) for r in records)
    rows = [sum(r.buys_by_row[i] for r in records)
            for i in range(len(records[0].buys_by_row))]
    add("purchases by display row (1=cheap): " + " ".join(
        f"r{i + 1} {_pct(k, total_buys).strip()}" for i, k in enumerate(rows)))
    types = {}
    for r in records:
        for t, k in r.buys_by_type.items():
            types[t] = types.get(t, 0) + k
    add("purchases by type: " + " ".join(
        f"{t[:3]} {_pct(types.get(t, 0), total_buys).strip()}"
        for t in BUILDING_TYPES))
    add(f"avg cards left in deck: "
        f"{statistics.mean(r.cards_left_in_deck for r in records):.1f} / deck")

    # market saturation: unsold stock and idle cash after each buy phase
    depth = max(len(r.display_left_by_round) for r in records)
    cells = []
    for i in range(depth):
        left = [r.display_left_by_round[i] for r in records
                if len(r.display_left_by_round) > i]
        cash = [r.unspent_cash_by_round[i] for r in records
                if len(r.unspent_cash_by_round) > i]
        cells.append(f"r{i + 1} {statistics.mean(left):.1f}|${statistics.mean(cash):.0f}")
    add("after buy phase (cards unsold | idle cash, table total): "
        + "  ".join(cells))
    return "\n".join(out)


def records_to_json(records, path):
    with open(path, "w") as f:
        json.dump([asdict(r) for r in records], f, indent=1)


# ---------------------------------------------------------------- sweeps

def sweep(base_config, param, values, agent_names, n_players, n_games,
          base_seed=0):
    """Re-run the same series for several values of one config field and
    print the summaries side by side."""
    chunks = []
    for v in values:
        cfg = base_config.with_changes(**{param: v})
        records = run_series(cfg, agent_names, n_players, n_games, base_seed)
        chunks.append(f"\n##### {param} = {v!r} #####\n" + summarize(records))
    return "\n".join(chunks)
