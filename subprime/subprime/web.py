"""Web game: one human vs three agents.

    python3 -m subprime.web [--port 8000]

Zero-dependency stdlib HTTP server. The human is always player 0 (seat
randomized by setup); agents play out their decisions server-side between
the human's actions. Single game session per server (it's a prototype).
"""

import argparse
import json
import os
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

from .cards import BUILDING_TYPES
from .config import GameConfig
from .engine import (new_game, legal_actions, apply_action, decision_player,
                     IllegalAction)
from .agents import make_agent, AGENT_REGISTRY
from .state import P_OVER, P_BAILOUT

CANDIDATE_RATES = (1, 2, 3, 5, 7, 9)   # DESIGN_NOTES: back-loaded curve
AI_NAMES = ["Bear & Stearns", "Lehman Sisters", "Northern Rock"]

SESSION = {"state": None, "agents": None, "names": None, "cursor": 0}


def new_session(agent_names=("digest", "shark", "greedy"), seed=None,
                steep=True):
    cfg = GameConfig(loan_row_rates=CANDIDATE_RATES) if steep else GameConfig()
    if seed is None:
        seed = int.from_bytes(os.urandom(4), "big")
    state = new_game(cfg, 1 + len(agent_names), seed=seed, collect_events=True)
    agents = [None] + [make_agent(n, seed=seed + 1 + i)
                       for i, n in enumerate(agent_names)]
    names = ["You"] + [f"{AI_NAMES[i % len(AI_NAMES)]} ({n})"
                       for i, n in enumerate(agent_names)]
    SESSION.update(state=state, agents=agents, names=names, cursor=0)
    _run_agents()
    return session_view()


def _run_agents():
    s, agents = SESSION["state"], SESSION["agents"]
    while s.phase != P_OVER and decision_player(s) != 0:
        pid = decision_player(s)
        apply_action(s, agents[pid].act(s, pid, legal_actions(s)))


def human_act(action):
    s = SESSION["state"]
    if s is None or s.phase == P_OVER or decision_player(s) != 0:
        raise IllegalAction("not your turn")
    apply_action(s, tuple(action))
    _run_agents()
    return session_view()


def _card(card, money=0, price=None):
    d = {"type": card.type, "cost": card.cost, "income": card.income}
    if money:
        d["money"] = money
    if price is not None:
        d["price"] = price
    return d


def session_view():
    s = SESSION["state"]
    cfg = s.config
    events = s.events[SESSION["cursor"]:]
    SESSION["cursor"] = len(s.events)

    # loan track by row
    track, idx = [], 0
    for size, rate in zip(cfg.loan_row_sizes, cfg.loan_row_rates):
        left = sum(1 for i in range(idx, idx + size) if s.loan_markers[i])
        track.append({"rate": rate, "size": size, "left": left})
        idx += size

    players = []
    for p in s.players:
        players.append({
            "name": SESSION["names"][p.pid],
            "money": p.money, "loans": p.loans,
            "buildings": sum(c.owned_count(p.pid) for c in s.cities),
            "income": sum(b.card.income for c in s.cities
                          for t in BUILDING_TYPES
                          for b in c.sections[t] if b.owner == p.pid),
            "bankrupt": p.bankrupt,
            "bailedOut": p.pid in s.bailed_out,
            "vp": p.vp,
        })

    display = []
    for r, row in enumerate(s.display):
        mult = cfg.row_cost_multipliers[r]
        display.append([None if cell is None else
                        _card(cell[0], cell[1], cell[0].cost * mult)
                        for cell in row])

    cities = [{t: [{"card": _card(b.card), "owner": b.owner}
                   for b in city.sections[t]] for t in BUILDING_TYPES}
              for city in s.cities]

    human_turn = s.phase != P_OVER and decision_player(s) == 0
    view = {
        "phase": s.phase, "round": s.round, "maxRounds": cfg.max_rounds,
        "rate": s.current_rate(), "markersLeft": s.markers_left(),
        "loanTrack": track,
        "moneyPerLoan": cfg.money_per_loan,
        "interestPerLoan": cfg.interest_per_loan,
        "bidSpaces": list(cfg.bid_spaces),
        "bids": {str(pid): v for pid, v in s.bids.items()},
        "turnOrder": s.turn_order,
        "nextOrder": s.next_order,
        "players": players,
        "display": display,
        "rowMultipliers": list(cfg.row_cost_multipliers),
        "cities": cities,
        "stateSubsidies": sorted(list(s.state_subsidies)),
        "citySubsidies": {f"{c},{t}": pid
                          for (c, t), pid in s.city_subsidies.items()},
        "humanTurn": human_turn,
        "legal": [list(a) for a in legal_actions(s)] if human_turn else [],
        "decisionPlayer": None if s.phase == P_OVER else decision_player(s),
        "over": s.phase == P_OVER,
        "endCause": s.end_cause,
        "winners": s.winners,
        "events": events,
    }
    if s.phase == P_BAILOUT:
        view["bailoutLots"] = [
            None if card is None else
            {"city": ci, "card": _card(card, price=card.cost
                                       * cfg.bailout_price_multiplier)}
            for ci, card in s.bailout_lots]
    return view


# ------------------------------------------------------------- server

def _html():
    path = os.path.join(os.path.dirname(__file__), "webui.html")
    with open(path, "rb") as f:
        return f.read()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj).encode())

    def log_message(self, fmt, *args):   # quiet
        pass

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/":
            self._send(200, _html(), "text/html; charset=utf-8")
        elif path == "/api/state":
            if SESSION["state"] is None:
                self._json({"error": "no game"}, 404)
            else:
                self._json(session_view())
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            if parsed.path == "/api/new":
                agents = qs.get("agents", ["digest,shark,greedy"])[0].split(",")
                agents = [a.strip() for a in agents if a.strip()]
                if not 1 <= len(agents) <= 4:
                    raise ValueError("1-4 agents")
                for a in agents:
                    if a not in AGENT_REGISTRY:
                        raise ValueError(f"unknown agent {a!r}")
                seed = int(qs["seed"][0]) if "seed" in qs else None
                steep = qs.get("steep", ["1"])[0] != "0"
                self._json(new_session(tuple(agents), seed, steep))
            elif parsed.path == "/api/act":
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length) or b"{}")
                self._json(human_act(body["action"]))
            else:
                self._json({"error": "not found"}, 404)
        except (IllegalAction, ValueError, KeyError) as e:
            self._json({"error": str(e)}, 400)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Subprime web game")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args(argv)
    httpd = HTTPServer((args.host, args.port), Handler)
    print(f"Subprime: open http://{args.host}:{args.port}/ "
          f"(Ctrl-C to stop)")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
