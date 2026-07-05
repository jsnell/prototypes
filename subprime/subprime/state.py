"""Game state. The whole game — including mid-phase progress — lives in
GameState, so the engine can be driven as pure functions
(legal_actions/apply_action) and any decision point can be cloned and
rolled out by search-based agents."""

import random
from dataclasses import dataclass

from .cards import BUILDING_TYPES

# Phases of the state machine ("phase 4" from the doc is split into
# RESOLVE + BAILOUT; phases 3 and 5 are automatic).
P_BID_INITIAL = "bid_initial"
P_BID_RAISE = "bid_raise"
P_BUY = "buy"
P_RESOLVE = "resolve"
P_BAILOUT = "bailout"
P_OVER = "over"


@dataclass
class Building:
    card: object
    owner: object  # player index, or None for government-repossessed buildings

    def copy(self):
        return Building(self.card, self.owner)


class City:
    __slots__ = ("sections",)

    def __init__(self):
        self.sections = {t: [] for t in BUILDING_TYPES}

    def copy(self):
        c = City.__new__(City)
        c.sections = {t: [b.copy() for b in bs] for t, bs in self.sections.items()}
        return c

    def owned_count(self, pid, typ=None):
        types = [typ] if typ else BUILDING_TYPES
        return sum(1 for t in types for b in self.sections[t] if b.owner == pid)

    def type_count(self, typ):
        """All buildings of a type, owned or not (used for state subsidies)."""
        return len(self.sections[typ])


@dataclass
class PlayerState:
    pid: int
    money: int = 0
    loans: int = 0
    bankrupt: bool = False
    vp: int = 0
    # per-game stats for the analysis layer
    interest_paid: int = 0
    income_earned: int = 0
    subsidy_earned: int = 0
    loans_taken: int = 0

    def copy(self):
        return PlayerState(self.pid, self.money, self.loans, self.bankrupt,
                           self.vp, self.interest_paid, self.income_earned,
                           self.subsidy_earned, self.loans_taken)


class GameState:
    def __init__(self):
        self.config = None
        self.n_players = 0
        self.rng = None
        self.round = 1
        self.phase = P_BID_INITIAL
        self.players = []
        self.turn_order = []          # player ids, current round's order

        # loan track: parallel lists over spaces (index 0 = cheapest space)
        self.loan_rates = []          # printed rate per space
        self.loan_rows = []           # 1-based row number per space
        self.loan_markers = []        # bool: marker still on the space

        # cards
        self.deck = []
        self.display = []             # display[row][col] -> None | [card, money]

        self.cities = []

        # phase 1 progress
        self.bid_pending = []         # pids yet to place an initial bid
        self.bids = {}                # pid -> bid space value (still on track)
        self.next_order = []          # next round's order, filled back-to-front

        # phase 2 progress
        self.buy_ptr = 0
        self.buy_passed = set()

        # phase 3/4 results
        self.state_subsidies = set()  # {(city_idx, type)}
        self.city_subsidies = {}      # (city_idx, type) -> pid
        self.unable = set()           # pids that couldn't pay full interest
        self.bailed_out = set()       # pids rescued by the government (any round)
        self.bankrupt_pid = None
        self.bailout_lots = []        # [(city_idx, card)] buildings up for auction
        self.bailout_queue = []       # pids still to act in the auction

        self.end_cause = None         # 'bankruptcy' | 'loans_exhausted' | 'rounds'
        self.winners = []             # pids (ties possible)
        self.events = None            # list[str] when event logging is on

    # -- convenience ---------------------------------------------------
    def current_rate(self):
        rates = [r for r, m in zip(self.loan_rates, self.loan_markers) if not m]
        return max(rates) if rates else self.config.base_interest_rate

    def markers_left(self):
        return sum(self.loan_markers)

    def alive_players(self):
        return [p for p in self.players if not p.bankrupt]

    def log(self, msg):
        if self.events is not None:
            self.events.append(f"[R{self.round}] {msg}")

    # -- cloning (for Monte Carlo rollouts) ----------------------------
    def clone(self, seed=None, reshuffle_deck=False):
        """Copy the state. reshuffle_deck=True re-randomizes the (hidden)
        deck order, so rollouts don't leak the true draw order."""
        s = GameState()
        s.config = self.config
        s.n_players = self.n_players
        s.rng = random.Random(seed if seed is not None
                              else self.rng.getrandbits(64))
        s.round = self.round
        s.phase = self.phase
        s.players = [p.copy() for p in self.players]
        s.turn_order = list(self.turn_order)
        s.loan_rates = self.loan_rates          # immutable after setup
        s.loan_rows = self.loan_rows
        s.loan_markers = list(self.loan_markers)
        s.deck = list(self.deck)
        if reshuffle_deck:
            s.rng.shuffle(s.deck)
        s.display = [[None if cell is None else [cell[0], cell[1]]
                      for cell in row] for row in self.display]
        s.cities = [c.copy() for c in self.cities]
        s.bid_pending = list(self.bid_pending)
        s.bids = dict(self.bids)
        s.next_order = list(self.next_order)
        s.buy_ptr = self.buy_ptr
        s.buy_passed = set(self.buy_passed)
        s.state_subsidies = set(self.state_subsidies)
        s.city_subsidies = dict(self.city_subsidies)
        s.unable = set(self.unable)
        s.bailed_out = set(self.bailed_out)
        s.bankrupt_pid = self.bankrupt_pid
        s.bailout_lots = list(self.bailout_lots)
        s.bailout_queue = list(self.bailout_queue)
        s.end_cause = self.end_cause
        s.winners = list(self.winners)
        s.events = None
        return s
