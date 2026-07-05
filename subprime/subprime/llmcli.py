"""Text interface for playing one seat against the AIs — designed for
LLM agents (and terminal die-hards). The game persists to a pickle file,
so each move is a single command:

  python3 -m subprime.llmcli new --state /tmp/game.pkl \\
      --agents digest,shark,greedy [--seed N] [--doc-rates]
  python3 -m subprime.llmcli show --state /tmp/game.pkl
  python3 -m subprime.llmcli act 3 --state /tmp/game.pkl   # by index
  python3 -m subprime.llmcli act '["bid", 5]' --state /tmp/game.pkl

You are always player P0. After your action the AIs play until it is
your turn again (or the game ends); everything that happened is printed.
"""

import argparse
import json
import pickle
import sys

from .cards import BUILDING_TYPES
from .config import GameConfig
from .engine import (new_game, legal_actions, apply_action, decision_player,
                     interest_due, IllegalAction)
from .agents import make_agent, AGENT_REGISTRY
from .state import P_OVER

HUMAN = 0
CANDIDATE_RATES = (1, 2, 3, 4, 6, 8)   # current best (see DESIGN_NOTES)


def _run_agents(sess):
    s = sess["state"]
    while s.phase != P_OVER and decision_player(s) != HUMAN:
        pid = decision_player(s)
        apply_action(s, sess["agents"][pid].act(s, pid, legal_actions(s)))


def _describe(s, a):
    if a == ("pass",):
        if s.phase == "bid_initial":
            return "pass — take no loans, last turn-order spot"
        if s.phase == "bid_raise":
            return (f"pass — lock in {s.bids[HUMAN]} loan(s) "
                    f"(+${s.bids[HUMAN] * s.config.money_per_loan}) and the "
                    "latest free turn-order spot")
        return "pass"
    if a[0] == "bid":
        return (f"bid {a[1]} — {a[1]} loan(s) = "
                f"+${a[1] * s.config.money_per_loan} if you pass there")
    if a[0] == "buy":
        _, r, c, city = a
        card, money = s.display[r][c]
        cost = card.cost * s.config.row_cost_multipliers[r]
        extra = f", ${money} on card" if money else ""
        return (f"buy row{r + 1} col{c + 1} "
                f"[{card.type[:3].upper()} cost ${cost}, +${card.income}/rd"
                f"{extra}] -> City {city + 1}")
    if a[0] == "repay":
        return f"repay one loan for ${s.config.loan_repayment_cost}"
    if a[0] == "bailout_buy":
        ci, card = s.bailout_lots[a[1]]
        return (f"foreclosure: buy {card.type[:3].upper()} (+${card.income}/rd)"
                f" in City {ci + 1} for "
                f"${card.cost * s.config.bailout_price_multiplier}")
    return str(a)


def _view(sess, events):
    s = sess["state"]
    cfg = s.config
    out = []
    add = out.append

    if events:
        add("--- since your last move ---")
        for e in events:
            add("  " + e)
        add("")

    if s.phase == P_OVER:
        add(f"=== GAME OVER ({s.end_cause}) ===")
        ranked = sorted([p for p in s.players],
                        key=lambda p: (-p.vp, -p.money))
        for p in ranked:
            tag = (" <- BANKRUPT" if p.bankrupt else
                   " <- WINNER" if p.pid in s.winners else "")
            add(f"  {sess['names'][p.pid]:<22} {p.vp} VP, ${p.money}{tag}")
        add("You " + ("WON!" if HUMAN in s.winners else "did not win."))
        return "\n".join(out)

    rate = s.current_rate()
    add(f"=== SUBPRIME | round {s.round}/{cfg.max_rounds} | phase: {s.phase} "
        f"| interest ${rate}/loan | loan markers left {s.markers_left()} ===")
    track = []
    idx = 0
    for size, rrate in zip(cfg.loan_row_sizes, cfg.loan_row_rates):
        left = sum(1 for i in range(idx, idx + size) if s.loan_markers[i])
        track.append(f"${rrate}:{left}/{size}")
        idx += size
    add("loan track (rate:markers, cheapest first; rows below the round "
        "marker expire each cleanup): " + "  ".join(track))
    add("")

    # projected income including the subsidies as they'd be placed now
    from .engine import determine_subsidies
    state_subs, city_subs = determine_subsidies(s.cities)
    proj = {p.pid: 0 for p in s.players}
    for ci, city in enumerate(s.cities):
        for t in BUILDING_TYPES:
            st = (ci, t) in state_subs
            cs = city_subs.get((ci, t))
            for b in city.sections[t]:
                if b.owner is None:
                    continue
                bonus = (cfg.double_subsidy_bonus if st and cs == b.owner
                         else cfg.single_subsidy_bonus if st or cs == b.owner
                         else 0)
                proj[b.owner] += b.card.income + bonus

    add("PLAYERS (turn order: " +
        ", ".join(sess["names"][p] for p in s.turn_order) + ")")
    for p in s.players:
        due = interest_due(s, p)
        bld = sum(c.owned_count(p.pid) for c in s.cities)
        status = " BANKRUPT" if p.bankrupt else ""
        bid = f" | bid marker on {s.bids[p.pid]}" if p.pid in s.bids else ""
        add(f"  {sess['names'][p.pid]:<22} ${p.money:<4} {p.loans} loans "
            f"(owes ${due}/rd) | {bld} bldgs, ~${proj[p.pid]}/rd income "
            f"incl. current subsidies{bid}{status}")
    add("")

    if s.phase in ("bid_initial", "bid_raise"):
        hints = ", ".join(f"+{k} taken -> ${s.rate_after(k)}"
                          for k in (1, 3, 5, 8))
        add(f"RATE PROJECTION (rate = deepest uncovered track space; "
            f"if more markers leave the track: {hints})")
        occ = {v: pid for pid, v in s.bids.items()}
        spaces = " ".join(f"[{v}{':' + sess['names'][occ[v]][:6] if v in occ else ''}]"
                          for v in cfg.bid_spaces)
        add("BID TRACK (a bid = loans you take on passing; higher bid also "
            "means earlier turn order): " + spaces)
        add("")

    add("MARKET (prices shown are FINAL prices, multiplier included; unsold "
        "cards slide DOWN a row each cleanup and get cheaper, row-1 "
        "leftovers gain $1)")
    for r in range(cfg.display_rows - 1, -1, -1):
        mult = cfg.row_cost_multipliers[r]
        cells = []
        for c, cell in enumerate(s.display[r]):
            if cell is None:
                cells.append(f"c{c + 1}:—")
            else:
                card, money = cell
                m = f"(+${money} on it)" if money else ""
                cells.append(f"c{c + 1}:{card.type[:3].upper()} "
                             f"${card.cost * mult}{m} +${card.income}/rd")
        add(f"  row{r + 1} x{mult}: " + " | ".join(cells))
    add("")

    add("CITIES (income phase: city subsidy = strictly most in a section, "
        "+$1/card; state subsidy = city with strictly fewest of a type, "
        "+$1/card; both = +$3/card. Scoring: 1VP/bldg, 3VP most in city, "
        "state-subsidized sections score 1VP/bldg to the leader)")
    for ci, city in enumerate(s.cities):
        parts = []
        for t in BUILDING_TYPES:
            owners = {}
            for b in city.sections[t]:
                key = "bank" if b.owner is None else sess["names"][b.owner][:6]
                owners[key] = owners.get(key, 0) + 1
            marks = ""
            if (ci, t) in s.state_subsidies:
                marks += "*state"
            if (ci, t) in s.city_subsidies:
                marks += f"*city:{sess['names'][s.city_subsidies[(ci, t)]][:6]}"
            body = ",".join(f"{k}x{v}" for k, v in owners.items()) or "-"
            parts.append(f"{t[:3].upper()}[{body}]{marks}")
        add(f"  City {ci + 1}: " + "  ".join(parts))
    add("")

    acts = legal_actions(s)
    move = sess.get("moves", 0)
    add(f"YOUR LEGAL ACTIONS (you are {sess['names'][HUMAN]}; this is your "
        f"move #{move} — indices are only valid for this move):")
    for i, a in enumerate(acts):
        add(f"  {i}: {_describe(s, a)}")
    add("")
    add(f"Move with: python3 -m subprime.llmcli act <index> --state <file>"
        f"   (add --turn {move} to guard against acting on a stale view)")
    return "\n".join(out)


def _emit(sess):
    s = sess["state"]
    events = (s.events or [])[sess["cursor"]:]
    sess["cursor"] = len(s.events or [])
    print(_view(sess, events))


def main(argv=None):
    ap = argparse.ArgumentParser(prog="subprime.llmcli")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("new")
    p.add_argument("--state", required=True)
    p.add_argument("--agents", default="digest,shark,greedy")
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--doc-rates", action="store_true",
                   help="use the design doc's 1-6 curve instead of the tuned one")
    p = sub.add_parser("show")
    p.add_argument("--state", required=True)
    p = sub.add_parser("act")
    p.add_argument("action")
    p.add_argument("--state", required=True)
    p.add_argument("--turn", type=int, default=None,
                   help="expected move number; errors if the game has moved on")

    args = ap.parse_args(argv)

    if args.cmd == "new":
        names = [a.strip() for a in args.agents.split(",") if a.strip()]
        for n in names:
            if n not in AGENT_REGISTRY:
                sys.exit(f"unknown agent {n!r}; "
                         f"options: {', '.join(sorted(AGENT_REGISTRY))}")
        cfg = (GameConfig() if args.doc_rates
               else GameConfig(loan_row_rates=CANDIDATE_RATES))
        seed = args.seed
        if seed is None:
            import os
            seed = int.from_bytes(os.urandom(4), "big")
        state = new_game(cfg, 1 + len(names), seed=seed, collect_events=True)
        sess = {
            "state": state,
            "agents": [None] + [make_agent(n, seed=seed + 1 + i)
                                for i, n in enumerate(names)],
            "names": ["P0-YOU"] + [f"P{i + 1}-{n}" for i, n in enumerate(names)],
            "cursor": 0,
        }
        _run_agents(sess)
        _emit(sess)
        with open(args.state, "wb") as f:
            pickle.dump(sess, f)
        return

    with open(args.state, "rb") as f:
        sess = pickle.load(f)

    if args.cmd == "show":
        cur = sess["cursor"]
        sess["cursor"] = 0
        s = sess["state"]
        print(_view(sess, (s.events or [])[max(0, cur - 12):cur]))
        sess["cursor"] = cur
        return

    # act
    s = sess["state"]
    if s.phase == P_OVER:
        sys.exit("game is over — start a new one")
    if args.turn is not None and args.turn != sess.get("moves", 0):
        sys.exit(f"stale view: this is move #{sess.get('moves', 0)}, you "
                 f"expected #{args.turn} — run 'show' and re-decide")
    acts = legal_actions(s)
    raw = args.action.strip()
    try:
        if raw.lstrip("-").isdigit():
            action = acts[int(raw)]
        else:
            action = tuple(json.loads(raw))
    except (ValueError, IndexError):
        sys.exit(f"bad action {raw!r}: give an index 0..{len(acts) - 1} "
                 "or a JSON action")
    try:
        apply_action(s, action)
    except IllegalAction as e:
        sys.exit(str(e))
    sess["moves"] = sess.get("moves", 0) + 1
    _run_agents(sess)
    _emit(sess)
    with open(args.state, "wb") as f:
        pickle.dump(sess, f)


if __name__ == "__main__":
    main()
