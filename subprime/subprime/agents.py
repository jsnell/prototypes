"""AI players.

Three tiers:
  RandomAgent      — legal-move sampler; stress-tests the rules.
  HeuristicAgent   — parameterized hand-written strategy; the parameters
                     (HeuristicParams) are the interesting part: tune or
                     evolve them to explore the strategy space.
  MonteCarloAgent  — flat Monte Carlo over legal actions with random
                     rollouts (deck order re-randomized per rollout).
                     Slow but strategy-free: good for sanity-checking
                     whether heuristic conclusions are artifacts.
"""

import random
from dataclasses import dataclass

from .cards import BUILDING_TYPES
from .state import P_BID_INITIAL, P_BID_RAISE, P_BUY, P_BAILOUT, P_OVER
from . import engine
from .engine import PASS


class Agent:
    name = "agent"

    def act(self, state, pid, actions):
        raise NotImplementedError


class RandomAgent(Agent):
    name = "random"

    def __init__(self, seed=None):
        self.rng = random.Random(seed)

    def act(self, state, pid, actions):
        return self.rng.choice(actions)


# ------------------------------------------------------------ heuristic

@dataclass
class HeuristicParams:
    loan_appetite: float = 0.8     # loans desired ~ appetite * remaining rounds
    rate_fear: float = 0.5         # desired loans reduced by fear * current rate
    vp_weight: float = 3.0         # $ value assigned to 1 VP
    subsidy_weight: float = 1.0    # weight on projected subsidy income
    buy_threshold: float = 0.0     # min net value ($) to buy instead of pass
    keep_reserve: float = 1.0      # 1.0 = always keep enough for interest
    demand_aware: bool = False     # cap loans by what the market can absorb
    market_share: float = 1.0      # fraction of a fair display share to chase
    turn_order_value: float = 0.0  # $ value of outlasting one rival on the
                                   # bid track (first pick of the display)


class HeuristicAgent(Agent):
    name = "greedy"

    def __init__(self, params=None, seed=None):
        self.p = params or HeuristicParams()
        self.rng = random.Random(seed)

    # -- phase 1 -------------------------------------------------------
    def _demand_cap(self, s, pid):
        """Most loans worth taking given what money can actually buy:
        my share of the current display, plus this round's interest bill,
        less cash and income on hand. Each loan nets money_per_loan minus
        the interest it accrues this round."""
        cfg = s.config
        display_cost = sum(cell[0].cost * cfg.row_cost_multipliers[r]
                           for r, row in enumerate(s.display)
                           for cell in row if cell)
        share = display_cost / s.n_players * self.p.market_share
        rate = s.current_rate()
        p = s.players[pid]
        due = rate * p.loans if cfg.interest_per_loan else rate
        need = share + due - p.money - self._printed_income(s, pid)
        net_per_loan = cfg.money_per_loan - (rate if cfg.interest_per_loan else 0)
        if need <= 0 or net_per_loan <= 0:
            return 0
        return int(-(-need // net_per_loan))   # ceil

    def _desired_loans(self, s, pid):
        remaining = s.config.max_rounds - s.round + 1
        d = self.p.loan_appetite * remaining - self.p.rate_fear * s.current_rate()
        if self.p.demand_aware:
            d = min(d, self._demand_cap(s, pid))
        d = min(int(round(d)), s.markers_left(), max(s.config.bid_spaces))
        return max(d, 0)

    def _bid(self, s, pid, actions, current=None):
        desired = self._desired_loans(s, pid)
        values = sorted(a[1] for a in actions if a[0] == "bid")
        at_most = [v for v in values if v <= desired]
        if current is None:                      # initial bid: must place
            return ("bid", at_most[-1] if at_most else values[0])
        if current < desired and at_most:        # raise toward desired
            return ("bid", at_most[0])           # legal raises are all > current
        if values and self._position_worth_raise(s, current, desired, values[0]):
            return ("bid", values[0])            # pay extra purely for position
        return PASS

    def _position_worth_raise(self, s, current, desired, raise_to):
        """Is outlasting the remaining bidders worth the extra loans?
        Marginal loan cost = expected lifetime interest minus the cash it
        grants; only loans actually backed by markers cost anything, so
        when the track runs dry, position comes nearly free."""
        if self.p.turn_order_value <= 0:
            return False
        rivals = len(s.bids) - 1                 # bidders we could outlast
        if rivals <= 0:
            return False
        cfg = s.config
        markers = s.markers_left()
        justified = max(current, desired)        # loans we'd take anyway
        extra = min(raise_to, markers) - min(justified, markers)
        if extra <= 0:
            return True
        # lifetime interest per extra loan: rates never fall, and cleanup
        # expiry alone guarantees a known floor each future round
        rate = s.current_rate()
        lifetime = 0
        for k in range(s.round, cfg.max_rounds + 1):
            i = min(k - 2, len(cfg.loan_row_rates) - 1)
            floor = cfg.loan_row_rates[i] if k >= 2 else 0
            lifetime += max(rate, floor)
        per_loan = max(0.5, lifetime - cfg.money_per_loan)
        return extra * per_loan <= self.p.turn_order_value * rivals

    # -- phase 2 -------------------------------------------------------
    def _interest_due(self, s, pid):
        p = s.players[pid]
        rate = s.current_rate()
        return rate * p.loans if s.config.interest_per_loan else rate

    def _printed_income(self, s, pid):
        return sum(b.card.income
                   for city in s.cities for t in BUILDING_TYPES
                   for b in city.sections[t] if b.owner == pid)

    def _reserve(self, s, pid):
        """Cash to keep so this round's interest is payable (income arrives
        first, so conservative expected income offsets it)."""
        need = self._interest_due(s, pid) - self._printed_income(s, pid)
        return max(0, need) * self.p.keep_reserve

    def _placement_value(self, s, pid, card, city_idx):
        """Rough $ value of owning this card in this city until game end."""
        cfg = s.config
        remaining = cfg.max_rounds - s.round + 1  # income phases left, incl. now
        val = card.income * remaining
        city = s.cities[city_idx]
        mine_sec = city.owned_count(pid, card.type) + 1

        # city subsidy: would I strictly lead the section?
        others = [0]
        seen = {}
        for b in city.sections[card.type]:
            if b.owner is not None and b.owner != pid:
                seen[b.owner] = seen.get(b.owner, 0) + 1
        others += list(seen.values())
        if mine_sec > max(others):
            val += (mine_sec * cfg.single_subsidy_bonus * remaining
                    * self.p.subsidy_weight)

        # state subsidy: would this city be the strict-fewest for the type?
        counts = [c.type_count(card.type) for c in s.cities]
        counts[city_idx] += 1
        if counts.count(min(counts)) == 1 and counts[city_idx] == min(counts):
            val += (mine_sec * cfg.single_subsidy_bonus * remaining
                    * self.p.subsidy_weight * 0.5)

        # endgame VPs
        val += cfg.vp_per_building * self.p.vp_weight
        mine_city = city.owned_count(pid) + 1
        rival = max((city.owned_count(q.pid) for q in s.players
                     if q.pid != pid and not q.bankrupt), default=0)
        if mine_city > rival:
            val += cfg.vp_city_majority * self.p.vp_weight * 0.5
        return val

    def _buy(self, s, pid, actions):
        player = s.players[pid]
        reserve = self._reserve(s, pid)
        best, best_net = PASS, self.p.buy_threshold
        for a in actions:
            if a[0] != "buy":
                continue
            _, r, c, city_idx = a
            card, money_on = s.display[r][c]
            cost = card.cost * s.config.row_cost_multipliers[r]
            if player.money + money_on - cost < reserve:
                continue
            net = self._placement_value(s, pid, card, city_idx) - cost + money_on
            if net > best_net:
                best, best_net = a, net
        return best

    # -- bailout auction -------------------------------------------------
    def _bailout(self, s, pid, actions):
        best, best_net = PASS, 0.0
        for a in actions:
            if a[0] != "bailout_buy":
                continue
            ci, card = s.bailout_lots[a[1]]
            price = card.cost * s.config.bailout_price_multiplier
            if s.players[pid].money < price:
                continue
            # the game is ending: only VPs matter now
            net = self._placement_value_endgame(s, pid, card, ci) - 0.0
            if net > best_net:
                best, best_net = a, net
        return best

    def _placement_value_endgame(self, s, pid, card, city_idx):
        cfg = s.config
        val = cfg.vp_per_building * self.p.vp_weight
        city = s.cities[city_idx]
        rival = max((city.owned_count(q.pid) for q in s.players
                     if q.pid != pid and not q.bankrupt), default=0)
        if city.owned_count(pid) + 1 > rival:
            val += cfg.vp_city_majority * self.p.vp_weight
        return val

    def act(self, state, pid, actions):
        if state.phase == P_BID_INITIAL:
            return self._bid(state, pid, actions)
        if state.phase == P_BID_RAISE:
            return self._bid(state, pid, actions, current=state.bids[pid])
        if state.phase == P_BUY:
            return self._buy(state, pid, actions)
        if state.phase == P_BAILOUT:
            return self._bailout(state, pid, actions)
        return actions[0]


# ---------------------------------------------------------- monte carlo

class MonteCarloAgent(Agent):
    """Flat Monte Carlo: score each candidate action by random rollouts to
    the end of the game. Deck order is hidden information, so each rollout
    reshuffles the undealt deck (determinization)."""
    name = "mc"

    def __init__(self, rollouts=16, max_actions=12, seed=None):
        self.rollouts = rollouts
        self.max_actions = max_actions
        self.rng = random.Random(seed)

    def _payoff(self, s, pid):
        if s.players[pid].bankrupt:
            return -0.5
        win = (1.0 / len(s.winners)) if pid in s.winners else 0.0
        return win + 0.005 * s.players[pid].vp  # tiny shaping term

    def act(self, state, pid, actions):
        if len(actions) == 1:
            return actions[0]
        cands = actions
        if len(cands) > self.max_actions:
            cands = self.rng.sample(actions, self.max_actions)
            if PASS in actions and PASS not in cands:
                cands[-1] = PASS

        best, best_score = None, None
        for a in cands:
            total = 0.0
            for _ in range(self.rollouts):
                sim = state.clone(seed=self.rng.getrandbits(64),
                                  reshuffle_deck=True)
                engine.apply_action(sim, a)
                _rollout(sim)
                total += self._payoff(sim, pid)
            score = total / self.rollouts
            if best_score is None or score > best_score:
                best, best_score = a, score
        return best


def _rollout(s):
    rng = s.rng
    while s.phase != P_OVER:
        engine.apply_action(s, rng.choice(engine.legal_actions(s)))


# ------------------------------------------------------------- registry

AGENT_REGISTRY = {
    "random": lambda seed: RandomAgent(seed=seed),
    "greedy": lambda seed: HeuristicAgent(seed=seed),
    "timid": lambda seed: HeuristicAgent(
        HeuristicParams(loan_appetite=0.4, rate_fear=1.0), seed=seed),
    "leveraged": lambda seed: HeuristicAgent(
        HeuristicParams(loan_appetite=1.5, rate_fear=0.2, keep_reserve=0.5),
        seed=seed),
    # demand-aware variants: loans capped by what the market can absorb
    "sharp": lambda seed: HeuristicAgent(
        HeuristicParams(demand_aware=True), seed=seed),
    "sharp-lev": lambda seed: HeuristicAgent(
        HeuristicParams(loan_appetite=2.0, rate_fear=0.2, keep_reserve=0.5,
                        demand_aware=True), seed=seed),
    # turn_order_value=2 is the empirically robust setting: higher values
    # win only when the economy is too safe to punish the extra loans
    "sharp-pos": lambda seed: HeuristicAgent(
        HeuristicParams(demand_aware=True, turn_order_value=2.0), seed=seed),
    "mc": lambda seed: MonteCarloAgent(seed=seed),
    "mc-fast": lambda seed: MonteCarloAgent(rollouts=6, max_actions=8, seed=seed),
}


def make_agent(name, seed=None):
    if name not in AGENT_REGISTRY:
        raise ValueError(f"unknown agent {name!r}; "
                         f"available: {', '.join(sorted(AGENT_REGISTRY))}")
    return AGENT_REGISTRY[name](seed)
