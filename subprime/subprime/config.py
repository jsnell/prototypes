"""All tunable design parameters in one place.

The design doc specifies the *mechanisms* but leaves most numbers open.
Every gap is a field here, so a design variant is just a modified
GameConfig. DESIGN_NOTES.md documents the reasoning behind each default
and which fields correspond to open questions in the doc.
"""

from dataclasses import dataclass, replace, fields

from .cards import RESIDENTIAL, COMMERCIAL, INDUSTRIAL

# Default 100-card distribution: (type, printed_cost, printed_income, count).
# Personalities: residential = cheap & plentiful, commercial = mid-range,
# industrial = expensive with the best income. Pure guesswork — this is the
# single biggest gap in the design doc and the main thing to iterate on.
DEFAULT_CARD_DISTRIBUTION = (
    (RESIDENTIAL, 1, 1, 6),
    (RESIDENTIAL, 2, 1, 8),
    (RESIDENTIAL, 3, 2, 10),
    (RESIDENTIAL, 4, 2, 6),
    (RESIDENTIAL, 5, 3, 4),
    (COMMERCIAL, 2, 1, 5),
    (COMMERCIAL, 3, 2, 8),
    (COMMERCIAL, 4, 3, 8),
    (COMMERCIAL, 5, 3, 7),
    (COMMERCIAL, 6, 4, 5),
    (INDUSTRIAL, 3, 2, 5),
    (INDUSTRIAL, 4, 3, 7),
    (INDUSTRIAL, 5, 4, 8),
    (INDUSTRIAL, 6, 4, 7),
    (INDUSTRIAL, 7, 5, 6),
)  # totals 100 cards


@dataclass(frozen=True)
class GameConfig:
    # --- players / money ---
    starting_money: int = 10
    starting_loans: int = 1          # dealt from the loan track at setup
    money_per_loan: int = 10

    # --- rounds ---
    max_rounds: int = 6              # game ends in phase 4 of this round

    # --- bid track (phase 1): the spaces players can put bid markers on;
    # a bid's value = number of loans taken when passing ---
    bid_spaces: tuple = tuple(range(0, 13))
    initial_bids_inverted: bool = True  # doc rule: initial bids placed last-
                                        # to-first in turn order. False =
                                        # first-to-last (structural variant)
    compulsory_initial_bids: bool = True  # doc rule: everyone must place an
                                          # initial bid. False = a player may
                                          # pass immediately (0 loans) instead
                                          # of being forced onto a high space
    unique_bid_spaces: bool = True  # doc rule: one marker per bid space, so
                                    # raising leapfrogs occupied spaces. False
                                    # = markers may share a space (minimal
                                    # raises possible; ties act FIFO)
    loan_repayment_cost: int = 0    # variant: if > 0, repaying one loan is a
                                    # buy-phase action at this price (a
                                    # deleveraging valve; doc has none, so
                                    # early overbids are permanent)

    # --- loan track: row sizes (must sum to the number of loan markers)
    # and the interest rate printed on every space of each row. The round
    # marker sits next to row N in round N; at cleanup, markers on rows
    # below it are removed from the game. ---
    loan_row_sizes: tuple = (10, 9, 9, 8, 7, 7)   # 50 markers
    loan_row_rates: tuple = (1, 2, 3, 4, 5, 6)
    interest_per_loan: bool = True   # True: pay rate * own loans. False: flat rate
                                     # per player (literal doc reading).
    fixed_rate_loans: bool = False   # variant: each loan pays the rate printed
                                     # on the space its marker came from,
                                     # forever. Doc rule (False) is effectively
                                     # adjustable-rate: all debt reprices to
                                     # the current visible rate every round.
    base_interest_rate: int = 0      # rate when no track space is uncovered

    # --- card display (phase 2) ---
    display_rows: int = 3
    display_cols_extra: int = 1      # columns = players + this
    row_cost_multipliers: tuple = (1, 2, 3)  # index 0 = row 1 (cheap, stale row)
    stale_card_money: int = 1        # $ put on unpicked row-1 cards at cleanup

    # --- subsidies (phase 3) ---
    single_subsidy_bonus: int = 1    # per owned card, state OR city subsidy
    double_subsidy_bonus: int = 3    # per owned card, both subsidies

    # --- bankruptcy (phase 4) ---
    bailout_price_multiplier: int = 1  # auction price = printed cost * this
    bankruptcy_pick: str = "earliest"  # who dies among co-defaulters:
                                       # "earliest" (doc: earliest in turn
                                       # order), "latest", or "most_loans"

    # --- scoring ---
    vp_per_building: int = 1
    vp_city_majority: int = 3
    vp_state_subsidy_per_building: int = 1

    # --- cards / cities ---
    card_distribution: tuple = DEFAULT_CARD_DISTRIBUTION
    cities_fewer_than_players: int = 1  # city boards = players - this

    def n_cities(self, n_players):
        return n_players - self.cities_fewer_than_players

    def display_cols(self, n_players):
        return n_players + self.display_cols_extra

    def n_loan_markers(self):
        return sum(self.loan_row_sizes)

    def deck_size(self):
        return sum(count for *_ignored, count in self.card_distribution)

    def validate(self, n_players):
        if not 3 <= n_players <= 5:
            raise ValueError("the game is designed for 3-5 players")
        if len(self.loan_row_sizes) != len(self.loan_row_rates):
            raise ValueError("loan_row_sizes and loan_row_rates must match")
        if len(self.loan_row_sizes) < self.max_rounds:
            raise ValueError("need a loan track row per round")
        if len(self.row_cost_multipliers) != self.display_rows:
            raise ValueError("row_cost_multipliers must match display_rows")
        if len(self.bid_spaces) < n_players:
            raise ValueError("bid track must have at least one space per player")
        if self.n_cities(n_players) < 1:
            raise ValueError("need at least one city board")

    def with_changes(self, **kwargs):
        return replace(self, **kwargs)

    @staticmethod
    def field_names():
        return [f.name for f in fields(GameConfig)]
