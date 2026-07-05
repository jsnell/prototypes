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
    survival_margin: float = 0.0   # cash cushion required after projected
                                   # interest (very negative = ignore survival)
    survival_horizon: int = 1      # rounds ahead to project the interest
                                   # ratchet (expiry floor + rivals borrowing
                                   # at the same pace) when judging a bid
    kill_instinct: float = 0.0     # >0: stretch bids to force a rival's
                                   # default when the post-kill score favors us
    endgame_awareness: float = 0.0 # >0: drain the loan track to end the game
                                   # while leading the would-be scoring
    contest_model: bool = True     # discount majority leads by rivals'
                                   # capacity to contest them
    denial_weight: float = 0.5     # value of breaking a rival's subsidy
                                   # stream or city majority
    debt_cooldown: float = 0.0     # reduce loan demand by this x our excess
                                   # loans over the rival average (coast after
                                   # an overbid instead of keeping pace)


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

    def _expected_others_take(self, s, pid):
        """Markers the other players will plausibly take this phase:
        committed bids for players still on the track, a modest guess for
        players yet to place an initial bid."""
        take = sum(v for q, v in s.bids.items() if q != pid)
        take += 2 * sum(1 for q in s.bid_pending if q != pid)
        return take

    def _survivable(self, s, pid, d):
        """Could we keep paying interest after taking d loans? Projects
        `survival_horizon` rounds: the rate the track will show once
        everyone has taken theirs, ratcheted each further round by the
        cleanup-expiry floor and by rivals borrowing at the same pace.
        Income is held at current printed income and cash is retained
        (no purchases) — the option to hunker down and survive. Under
        fixed-rate loans, existing debt does not reprice."""
        p = s.players[pid]
        cfg = s.config
        others = self._expected_others_take(s, pid)
        income = self._printed_income(s, pid)
        cash = p.money + d * cfg.money_per_loan + income
        taken = others + d
        take_rate = s.rate_after(taken)          # new loans priced near here
        horizon = max(1, self.p.survival_horizon)
        for step in range(horizon):
            k = s.round + step                   # round being projected
            if k > cfg.max_rounds:
                break
            rate = s.rate_after(taken)
            if k >= 2:                           # expiry floor is public info
                i = min(k - 2, len(cfg.loan_row_rates) - 1)
                rate = max(rate, cfg.loan_row_rates[i])
            due = engine.interest_due(s, p, rate=rate)
            if cfg.interest_per_loan:
                due += d * (take_rate if cfg.fixed_rate_loans else rate)
            if step > 0:
                cash += income
            cash -= due
            if cash < self.p.survival_margin:
                return False
            taken += others                      # rivals keep borrowing
        return True

    def _am_leading(self, s, pid, exclude=None):
        snap = engine.score_snapshot(s, exclude=exclude)
        mine = snap.get(pid, 0)
        rivals = [v for q, v in snap.items() if q != pid]
        return mine >= max(rivals, default=0)

    def _forcing_bid(self, s, pid, max_bid):
        """Smallest bid that ends the game in our favor this round, either
        by draining the loan track or by pushing the rate past what some
        rival can pay. None if impossible or not favorable."""
        others = self._expected_others_take(s, pid)
        candidates = []

        if self.p.endgame_awareness > 0 and self._am_leading(s, pid):
            need = s.markers_left() - others
            if 0 < need <= max_bid:
                candidates.append(need)

        if self.p.kill_instinct > 0:
            for q in s.players:
                if q.pid == pid or q.bankrupt:
                    continue
                q_bid = s.bids.get(q.pid, 0)
                q_cash = (q.money + q_bid * s.config.money_per_loan
                          + self._printed_income(s, q.pid))
                for my_d in range(0, max_bid + 1):
                    rate = s.rate_after(others + my_d)
                    due = engine.interest_due(s, q, rate=rate)
                    if s.config.interest_per_loan:
                        due += q_bid * rate
                    if due > q_cash:
                        # they default; do we like the world after that?
                        if self._am_leading(s, pid, exclude=q.pid):
                            candidates.append(my_d)
                        break

        good = [c for c in candidates if self._survivable(s, pid, c)]
        return min(good) if good else None

    def _desired_loans(self, s, pid):
        cfg = s.config
        max_bid = max(cfg.bid_spaces)
        remaining = cfg.max_rounds - s.round + 1
        d = self.p.loan_appetite * remaining - self.p.rate_fear * s.current_rate()
        if self.p.demand_aware:
            d = min(d, self._demand_cap(s, pid))
        if self.p.debt_cooldown > 0:
            rivals = [q.loans for q in s.players
                      if q.pid != pid and not q.bankrupt]
            if rivals:
                excess = s.players[pid].loans - sum(rivals) / len(rivals)
                d -= self.p.debt_cooldown * max(0.0, excess)
        d = max(0, min(int(round(d)), max_bid))
        while d > 0 and not self._survivable(s, pid, d):
            d -= 1
        if self.p.kill_instinct > 0 or self.p.endgame_awareness > 0:
            force = self._forcing_bid(s, pid, max_bid)
            if force is not None and force > d:
                d = force
        return d

    def _bid(self, s, pid, actions, current=None):
        desired = self._desired_loans(s, pid)
        values = sorted(a[1] for a in actions if a[0] == "bid")
        at_most = [v for v in values if v <= desired]
        if current is None:                      # initial placement
            if at_most:
                return ("bid", at_most[-1])
            # every open space overbids; escape if the variant allows it,
            # unless the overshoot is small and survivable
            overshoot_ok = (self._survivable(s, pid, values[0])
                            and values[0] - desired <= desired)
            if PASS in actions and not overshoot_ok:
                return PASS
            return ("bid", values[0])
        if current < desired and at_most:        # raise toward desired
            return ("bid", at_most[0])           # legal raises are all > current
        if values and self._position_worth_raise(s, pid, current, desired,
                                                 values[0]):
            return ("bid", values[0])            # pay extra purely for position
        return PASS

    def _position_worth_raise(self, s, pid, current, desired, raise_to):
        """Is outlasting the remaining bidders worth the extra loans?
        Marginal loan cost = projected lifetime interest minus the cash the
        loan grants. (Bids are honored even when the loan track runs dry,
        so extra loans always cost — but draining the track is itself a
        weapon, handled by endgame_awareness, not here.)"""
        if self.p.turn_order_value <= 0:
            return False
        rivals = len(s.bids) - 1                 # bidders we could outlast
        if rivals <= 0:
            return False
        if not self._survivable(s, pid, raise_to):
            return False
        cfg = s.config
        # charge the WHOLE premium over economic desire, not the marginal
        # step — otherwise minimal counter-raises look individually free
        # and the war escalates without bound
        extra = raise_to - desired
        if extra <= 0:
            return True
        per_loan = max(0.5, self._lifetime_rate(s) - cfg.money_per_loan)
        return extra * per_loan <= self.p.turn_order_value * rivals

    def _lifetime_rate(self, s):
        """Projected interest one NEW loan accrues from now to game end.
        Fixed-rate: today's rate, every remaining round. Adjustable (doc):
        rates never fall, and cleanup expiry alone guarantees a known
        floor each future round."""
        cfg = s.config
        rate = s.current_rate()
        remaining = cfg.max_rounds - s.round + 1
        if cfg.fixed_rate_loans:
            return rate * remaining
        total = 0
        for k in range(s.round, cfg.max_rounds + 1):
            i = min(k - 2, len(cfg.loan_row_rates) - 1)
            floor = cfg.loan_row_rates[i] if k >= 2 else 0
            total += max(rate, floor)
        return total

    # -- phase 2 -------------------------------------------------------
    def _interest_due(self, s, pid):
        return engine.interest_due(s, s.players[pid])

    def _printed_income(self, s, pid):
        return sum(b.card.income
                   for city in s.cities for t in BUILDING_TYPES
                   for b in city.sections[t] if b.owner == pid)

    def _reserve(self, s, pid):
        """Cash to keep so this round's interest is payable (income arrives
        first, so conservative expected income offsets it)."""
        need = self._interest_due(s, pid) - self._printed_income(s, pid)
        return max(0, need) * self.p.keep_reserve

    def _contest_capacity(self, s, pid, typ):
        """How many buildings of this type the strongest rival could still
        add from the current display — the force available to fight my
        lead. 0 when opponent modeling is off."""
        if not self.p.contest_model:
            return 0
        cfg = s.config
        prices = sorted(cell[0].cost * cfg.row_cost_multipliers[r]
                        for r, row in enumerate(s.display)
                        for cell in row if cell and cell[0].type == typ)
        rich = max((q.money for q in s.players
                    if q.pid != pid and not q.bankrupt), default=0)
        afford = 0
        for price in prices:                     # cheapest first
            if rich < price:
                break
            rich -= price
            afford += 1
        return afford

    def _placement_value(self, s, pid, card, city_idx):
        """Rough $ value of owning this card in this city until game end,
        including what the placement does to rivals' positions."""
        cfg = s.config
        remaining = cfg.max_rounds - s.round + 1  # income phases left, incl. now
        val = card.income * remaining
        city = s.cities[city_idx]
        mine_sec = city.owned_count(pid, card.type) + 1

        rival_counts = {}
        for b in city.sections[card.type]:
            if b.owner is not None and b.owner != pid:
                rival_counts[b.owner] = rival_counts.get(b.owner, 0) + 1
        by_count = sorted(rival_counts.values(), reverse=True)
        top_rival = by_count[0] if by_count else 0
        second_rival = by_count[1] if len(by_count) > 1 else 0

        # city subsidy: a strict section lead, discounted by how easily the
        # strongest rival could still contest it with cards on the display
        bonus_stream = cfg.single_subsidy_bonus * remaining * self.p.subsidy_weight
        if mine_sec > top_rival:
            margin = mine_sec - top_rival
            capacity = self._contest_capacity(s, pid, card.type)
            # floor at 0.5: rivals who *could* contest usually build their
            # own engines instead (capability is not intent)
            hold = max(0.5, margin / (margin + capacity)) if capacity else 1.0
            val += mine_sec * bonus_stream * hold

        # denial: a tie kills a rival's city-subsidy marker (ties place no
        # marker), so matching a strict leader is itself worth their stream
        leader_was_strict = top_rival > max(second_rival, mine_sec - 1)
        if leader_was_strict and mine_sec >= top_rival:
            val += self.p.denial_weight * top_rival * bonus_stream

        # state subsidy: would this city be the strict-fewest for the type?
        counts = [c.type_count(card.type) for c in s.cities]
        counts[city_idx] += 1
        if counts.count(min(counts)) == 1 and counts[city_idx] == min(counts):
            val += mine_sec * bonus_stream * 0.5

        # endgame VPs
        val += cfg.vp_per_building * self.p.vp_weight
        mine_city = city.owned_count(pid) + 1
        city_counts = sorted((city.owned_count(q.pid) for q in s.players
                              if q.pid != pid and not q.bankrupt), reverse=True)
        top_city = city_counts[0] if city_counts else 0
        second_city = city_counts[1] if len(city_counts) > 1 else 0
        if mine_city > top_city:
            val += cfg.vp_city_majority * self.p.vp_weight * 0.5
        # exceeding (not tying — city ties still score) a strict city
        # leader strips their 3vp majority
        if (top_city > max(second_city, mine_city - 1)
                and mine_city > top_city):
            val += (self.p.denial_weight * cfg.vp_city_majority
                    * self.p.vp_weight)
        return val

    def _drowning(self, s, pid):
        """Even hoarding every dollar, would we default within two rounds
        without new loans? (Then deleveraging outranks building.)"""
        p = s.players[pid]
        cfg = s.config
        income = self._printed_income(s, pid)
        rate = s.current_rate()
        cash = p.money + income
        for k in (s.round, s.round + 1):
            if k > cfg.max_rounds:
                break
            r_k = rate
            if k >= 2:
                i = min(k - 2, len(cfg.loan_row_rates) - 1)
                r_k = max(rate, cfg.loan_row_rates[i])
            cash -= engine.interest_due(s, p, rate=r_k)
            if cash < 0:
                return True
            cash += income
        return False

    def _buy(self, s, pid, actions):
        player = s.players[pid]
        if ("repay",) in actions and self._drowning(s, pid):
            return ("repay",)   # lifeline: survival outranks profit
        reserve = self._reserve(s, pid)
        best, best_net = PASS, self.p.buy_threshold
        for a in actions:
            if a[0] == "repay":
                # deleveraging: pay now, stop bleeding the remaining
                # lifetime interest of the dearest held loan
                cost = s.config.loan_repayment_cost
                if player.money - cost < reserve:
                    continue
                if s.config.fixed_rate_loans and player.loan_rates:
                    remaining = s.config.max_rounds - s.round + 1
                    net = max(player.loan_rates) * remaining - cost
                else:
                    net = self._lifetime_rate(s) - cost
            elif a[0] == "buy":
                _, r, c, city_idx = a
                card, money_on = s.display[r][c]
                cost = card.cost * s.config.row_cost_multipliers[r]
                if player.money + money_on - cost < reserve:
                    continue
                net = (self._placement_value(s, pid, card, city_idx)
                       - cost + money_on)
            else:
                continue
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
    # the works: demand-aware, position-buying, hunts forced bankruptcies
    # and drains the loan track to end the game while ahead
    "shark": lambda seed: HeuristicAgent(
        HeuristicParams(demand_aware=True, turn_order_value=2.0,
                        kill_instinct=1.0, endgame_awareness=1.0), seed=seed),
    # shark that projects the interest ratchet two rounds out before
    # bidding — safer, builds less; loses to the reckless shark head-to-head
    "shark-h2": lambda seed: HeuristicAgent(
        HeuristicParams(demand_aware=True, turn_order_value=2.0,
                        kill_instinct=1.0, endgame_awareness=1.0,
                        survival_horizon=2), seed=seed),
    # shark that coasts after over-borrowing (cuts loan demand by its debt
    # excess over the rival average) — the "catch-up" style: rivals level
    # the loan counts while it digests the overbid
    "shark-cool": lambda seed: HeuristicAgent(
        HeuristicParams(demand_aware=True, turn_order_value=2.0,
                        kill_instinct=1.0, endgame_awareness=1.0,
                        debt_cooldown=1.0), seed=seed),
    "mc": lambda seed: MonteCarloAgent(seed=seed),
    "mc-fast": lambda seed: MonteCarloAgent(rollouts=6, max_actions=8, seed=seed),
}


def make_agent(name, seed=None):
    if name not in AGENT_REGISTRY:
        raise ValueError(f"unknown agent {name!r}; "
                         f"available: {', '.join(sorted(AGENT_REGISTRY))}")
    return AGENT_REGISTRY[name](seed)
