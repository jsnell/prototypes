"""Text interface for playing seats against (or alongside) the AIs —
designed for LLM agents and terminal die-hards. The game persists to a
pickle file, so each move is a single command:

  python3 -m subprime.llmcli new --state /tmp/game.pkl \\
      --agents digest,shark,greedy [--seed N] [--doc-rates] [--humans 1]
  python3 -m subprime.llmcli show --state /tmp/game.pkl [--as N]
  python3 -m subprime.llmcli act 3 --state /tmp/game.pkl [--as N] --wait
  python3 -m subprime.llmcli wait --state /tmp/game.pkl --as N

Seats 0..humans-1 are externally controlled; the rest are AI agents and
play automatically. With --humans 2+ all player names are hidden (just
P0..P3) and each external player acts with --as SEAT, using `wait` to
block until it is their turn. File locking makes concurrent players from
separate processes safe.

Token economy (matters when the player is an LLM): `act` prints only the
events your move caused plus a one-line status — the full board is shown
only when it is actually your turn, by `wait` or `show`. The intended
loop is a single `act <i> --wait` per turn; do not interleave extra
`show` calls, the board you got is current until the game moves on.
"""

import argparse
import fcntl
import json
import pickle
import sys
import time

from .cards import BUILDING_TYPES
from .config import GameConfig
from .engine import (new_game, legal_actions, apply_action, decision_player,
                     interest_due, IllegalAction)
from .agents import make_agent, AGENT_REGISTRY
from .state import P_OVER

CANDIDATE_RATES = (2, 3, 4, 6, 8, 10)  # current best (see DESIGN_NOTES)


class _Lock:
    """Exclusive advisory lock so concurrent players can share a state
    file safely."""

    def __init__(self, path):
        self.f = open(path + ".lock", "a+")

    def __enter__(self):
        fcntl.flock(self.f, fcntl.LOCK_EX)
        return self

    def __exit__(self, *exc):
        fcntl.flock(self.f, fcntl.LOCK_UN)
        self.f.close()


def _humans(sess):
    return sess.get("humans", [0])


def _run_agents(sess):
    s = sess["state"]
    humans = _humans(sess)
    while s.phase != P_OVER and decision_player(s) not in humans:
        pid = decision_player(s)
        apply_action(s, sess["agents"][pid].act(s, pid, legal_actions(s)))


def _describe(s, a, viewer):
    if a == ("pass",):
        if s.phase == "bid_initial":
            return "pass — take no loans, last turn-order spot"
        if s.phase == "bid_raise":
            return (f"pass — lock in {s.bids[viewer]} loan(s) "
                    f"(+${s.bids[viewer] * s.config.money_per_loan}) and the "
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


def _view(sess, events, viewer):
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
        add("You " + ("WON!" if viewer in s.winners else "did not win."))
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

    from .engine import score_snapshot
    snap = score_snapshot(s)
    def pname(pid):
        return sess["names"][pid] + (" (you)" if pid == viewer else "")
    add("PLAYERS (turn order: " +
        ", ".join(pname(p) for p in s.turn_order) +
        ") — income shown as base+subsidy")
    for p in s.players:
        due = interest_due(s, p)
        bld = sum(c.owned_count(p.pid) for c in s.cities)
        base = sum(b.card.income for c in s.cities for t in BUILDING_TYPES
                   for b in c.sections[t] if b.owner == p.pid)
        sub = proj[p.pid] - base
        status = " BANKRUPT" if p.bankrupt else ""
        bid = f" | bid marker on {s.bids[p.pid]}" if p.pid in s.bids else ""
        vp = f" | {snap[p.pid]} VP if scored now" if p.pid in snap else ""
        net = p.money + proj[p.pid] - due
        add(f"  {pname(p.pid):<22} ${p.money:<4} {p.loans} loans "
            f"(owes ${due}/rd) | {bld} bldgs, income ${base}"
            f"{f'+${sub}' if sub else ''}/rd | net {net:+d} after interest"
            f"{' <== DEFAULT RISK' if net < 0 else ''}{vp}{bid}{status}")
    add("")

    if s.phase in ("bid_initial", "bid_raise"):
        committed = sum(s.bids.values())
        if committed:
            add(f"COMMITTED: bids on the track claim {committed} more "
                f"markers (cheapest first) when their owners pass -> rate "
                f"heads for ${s.rate_after(committed)}")
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
        "state-subsidized sections score 1VP/bldg to the leader; VP ties "
        "break on remaining cash)")
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

    dp = decision_player(s)
    move = sess.get("moves", 0)
    if dp != viewer:
        add(f"WAITING: it is {sess['names'][dp]}'s turn to act, not yours. "
            f"Run: python3 -m subprime.llmcli wait --as {viewer} "
            f"--state <file>")
        return "\n".join(out)
    acts = legal_actions(s)
    add(f"YOUR LEGAL ACTIONS (you are {sess['names'][viewer]}; this is "
        f"move #{move} — indices are only valid for this move):")
    # group buy actions by card: each display card spawns one action per
    # city, which flat-listed reads as a 45-item wall (15 cards x 3)
    lines, buy_groups = [], {}
    for i, a in enumerate(acts):
        if a[0] == "buy":
            r, c = a[1], a[2]
            if (r, c) not in buy_groups:
                card, money = s.display[r][c]
                cost = card.cost * s.config.row_cost_multipliers[r]
                extra = f", ${money} on card" if money else ""
                buy_groups[(r, c)] = [
                    f"buy row{r + 1} col{c + 1} [{card.type[:3].upper()} "
                    f"cost ${cost}, +${card.income}/rd{extra}] ->"]
                lines.append(buy_groups[(r, c)])
            buy_groups[(r, c)].append(f"{i}:City{a[3] + 1}")
        else:
            lines.append(f"  {i}: {_describe(s, a, viewer)}")
    for ln in lines:
        add("  " + " ".join(ln) if isinstance(ln, list) else ln)
    add("")
    add(f"Move with: python3 -m subprime.llmcli act <index> --as {viewer} "
        f"--state <file> --turn {move} --wait   (--wait blocks until your "
        f"next turn and prints the fresh board — one command per turn, no "
        f"'show' needed in between)")
    return "\n".join(out)


def _emit(sess, viewer):
    s = sess["state"]
    cursors = sess.setdefault("cursors", {})
    cur = cursors.get(viewer, sess.get("cursor", 0))
    events = (s.events or [])[cur:]
    cursors[viewer] = len(s.events or [])
    print(_view(sess, events, viewer))


def _emit_brief(sess, viewer):
    """After `act`: just the events the move caused plus a status line.
    The full board is printed only when it is actually the viewer's turn
    (by `wait` or `show`) — keeps per-move output small for LLM players."""
    s = sess["state"]
    cursors = sess.setdefault("cursors", {})
    cur = cursors.get(viewer, sess.get("cursor", 0))
    events = (s.events or [])[cur:]
    cursors[viewer] = len(s.events or [])
    out = []
    if events:
        out.append("--- your move caused ---")
        out += ["  " + e for e in events]
    dp = decision_player(s)
    if dp == viewer:
        out.append(f"OK — it is your turn again (move "
                   f"#{sess.get('moves', 0)}); `wait` returns the fresh "
                   f"board immediately.")
    else:
        out.append(f"OK — now waiting on {sess['names'][dp]}. Run: "
                   f"python3 -m subprime.llmcli wait --as {viewer} "
                   f"--state <file>  (or use act ... --wait next time)")
    print("\n".join(out))


def main(argv=None):
    ap = argparse.ArgumentParser(prog="subprime.llmcli")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("new")
    p.add_argument("--state", required=True)
    p.add_argument("--agents", default="digest,shark,greedy")
    p.add_argument("--humans", type=int, default=1,
                   help="externally controlled seats 0..N-1 (default 1). "
                        "With 2+, player identities are hidden (P0..Pn)")
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--doc-rates", action="store_true",
                   help="use the design doc's 1-6 curve instead of the tuned one")
    p = sub.add_parser("show")
    p.add_argument("--state", required=True)
    p.add_argument("--as", dest="seat", type=int, default=0)
    p = sub.add_parser("act")
    p.add_argument("action")
    p.add_argument("--state", required=True)
    p.add_argument("--as", dest="seat", type=int, default=0)
    p.add_argument("--turn", type=int, default=None,
                   help="expected move number; errors if the game has moved on")
    p.add_argument("--wait", action="store_true",
                   help="after acting, block until it is your turn again and "
                        "print the fresh board (recommended: one command per "
                        "turn)")
    p.add_argument("--poll", type=float, default=2.0)
    p.add_argument("--max-wait", type=float, default=240.0)
    p = sub.add_parser("wait",
                       help="block until it is your seat's turn (or game over)")
    p.add_argument("--state", required=True)
    p.add_argument("--as", dest="seat", type=int, default=0)
    p.add_argument("--poll", type=float, default=2.0)
    p.add_argument("--max-wait", type=float, default=240.0)

    args = ap.parse_args(argv)

    def load():
        with open(args.state, "rb") as f:
            return pickle.load(f)

    def save(sess):
        with open(args.state, "wb") as f:
            pickle.dump(sess, f)

    if args.cmd == "new":
        names = [a.strip() for a in args.agents.split(",") if a.strip()]
        for n in names:
            if n not in AGENT_REGISTRY:
                sys.exit(f"unknown agent {n!r}; "
                         f"options: {', '.join(sorted(AGENT_REGISTRY))}")
        humans = list(range(max(1, args.humans)))
        n_players = len(humans) + len(names)
        cfg = (GameConfig() if args.doc_rates
               else GameConfig(loan_row_rates=CANDIDATE_RATES))
        seed = args.seed
        if seed is None:
            import os
            seed = int.from_bytes(os.urandom(4), "big")
        state = new_game(cfg, n_players, seed=seed, collect_events=True)
        if len(humans) > 1:
            pnames = [f"P{i}" for i in range(n_players)]   # identities hidden
        else:
            pnames = ["P0-YOU"] + [f"P{i + 1}-{n}"
                                   for i, n in enumerate(names)]
        sess = {
            "state": state,
            "agents": [None] * len(humans) +
                      [make_agent(n, seed=seed + 1 + i)
                       for i, n in enumerate(names)],
            "names": pnames,
            "humans": humans,
            "cursors": {},
        }
        _run_agents(sess)
        _emit(sess, humans[0])
        save(sess)
        return

    if args.cmd == "show":
        with _Lock(args.state):
            sess = load()
            viewer = args.seat
            cursors = sess.setdefault("cursors", {})
            cur = cursors.get(viewer, sess.get("cursor", 0))
            s = sess["state"]
            print(_view(sess, (s.events or [])[max(0, cur - 12):cur], viewer))
        return

    def do_wait(seat, poll, max_wait):
        deadline = time.time() + max_wait
        while True:
            with _Lock(args.state):
                sess = load()
                s = sess["state"]
                dp = None if s.phase == P_OVER else decision_player(s)
                if s.phase == P_OVER or dp == seat:
                    _emit(sess, seat)
                    save(sess)
                    return
            if time.time() >= deadline:
                print(f"STILL WAITING — {sess['names'][dp]} is deciding. "
                      f"Run 'wait --as {seat}' again.")
                return
            time.sleep(poll)

    if args.cmd == "wait":
        do_wait(args.seat, args.poll, args.max_wait)
        return

    # act
    with _Lock(args.state):
        sess = load()
        s = sess["state"]
        if s.phase == P_OVER:
            sys.exit("game is over — start a new one")
        if args.seat not in _humans(sess):
            sys.exit(f"seat {args.seat} is not an external player")
        dp = decision_player(s)
        if dp != args.seat:
            sys.exit(f"not your turn — {sess['names'][dp]} is to act; "
                     f"run: wait --as {args.seat}")
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
        s = sess["state"]
        if s.phase == P_OVER:
            _emit(sess, args.seat)          # game-over view is short
        elif not args.wait:
            _emit_brief(sess, args.seat)
        else:
            # events stay unconsumed: the wait below prints them with the board
            print(f"move #{sess['moves'] - 1} applied; waiting for your "
                  f"next turn...")
        save(sess)
    if args.cmd == "act" and args.wait and sess["state"].phase != P_OVER:
        do_wait(args.seat, args.poll, args.max_wait)


if __name__ == "__main__":
    main()
