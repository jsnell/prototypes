"""Command line interface.

  python -m subprime.cli play  --agents greedy,random,random,random --seed 1
  python -m subprime.cli sim   --games 500 --players 4 --agents greedy,random
  python -m subprime.cli sweep --param interest_per_loan --values "True;False" \\
                               --games 200 --players 4 --agents greedy
"""

import argparse
import ast
import sys

from .config import GameConfig
from .simulate import play_recorded, run_series, summarize, sweep, records_to_json


def _agent_list(spec, n_players):
    names = [a.strip() for a in spec.split(",") if a.strip()]
    if not names:
        raise SystemExit("--agents must name at least one agent")
    return names, n_players or len(names)


def cmd_play(args):
    names, n_players = _agent_list(args.agents, args.players)
    seats = [names[i % len(names)] for i in range(n_players)]
    state, rec = play_recorded(GameConfig(), seats, seed=args.seed,
                               collect_events=True)
    for line in state.events:
        print(line)
    print()
    for p in state.players:
        tag = " BANKRUPT" if p.bankrupt else (" WINNER" if p.pid in state.winners else "")
        print(f"P{p.pid} [{seats[p.pid]:<9}] vp={p.vp:<3} money=${p.money:<4} "
              f"loans={p.loans} interest_paid=${p.interest_paid}{tag}")


def cmd_sim(args):
    names, n_players = _agent_list(args.agents, args.players)
    records = run_series(GameConfig(), names, n_players, args.games,
                         base_seed=args.seed)
    print(summarize(records))
    if args.json:
        records_to_json(records, args.json)
        print(f"\nwrote {len(records)} game records to {args.json}")


def cmd_sweep(args):
    names, n_players = _agent_list(args.agents, args.players)
    if args.param not in GameConfig.field_names():
        raise SystemExit(f"unknown config field {args.param!r}; "
                         f"fields: {', '.join(GameConfig.field_names())}")
    values = [ast.literal_eval(v) for v in args.values.split(";")]
    print(sweep(GameConfig(), args.param, values, names, n_players,
                args.games, base_seed=args.seed))


def main(argv=None):
    ap = argparse.ArgumentParser(prog="subprime",
                                 description="Subprime board game simulator")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, games=None):
        p.add_argument("--agents", default="greedy,random",
                       help="comma-separated agent names (cycled over seats)")
        p.add_argument("--players", type=int, default=0,
                       help="number of players (default: number of agents)")
        p.add_argument("--seed", type=int, default=0)
        if games:
            p.add_argument("--games", type=int, default=games)

    p = sub.add_parser("play", help="play one game with a full event log")
    common(p)
    p.set_defaults(fn=cmd_play)

    p = sub.add_parser("sim", help="run many games and print design metrics")
    common(p, games=200)
    p.add_argument("--json", help="also dump raw game records to this file")
    p.set_defaults(fn=cmd_sim)

    p = sub.add_parser("sweep", help="compare values of one config field")
    common(p, games=100)
    p.add_argument("--param", required=True, help="GameConfig field name")
    p.add_argument("--values", required=True,
                   help="semicolon-separated python literals, e.g. 'True;False'")
    p.set_defaults(fn=cmd_sweep)

    args = ap.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
