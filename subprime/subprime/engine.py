"""Rules engine.

Driven as a decision-point state machine:

    state = new_game(config, n_players, seed)
    while state.phase != P_OVER:
        pid = decision_player(state)
        action = agents[pid].act(state, pid, legal_actions(state))
        apply_action(state, action)

Actions are plain tuples:
    ("bid", value)               phase 1: place/raise to an empty bid space
    ("pass",)                    phase 1 raise, phase 2, or bailout auction
    ("buy", row, col, city)      phase 2: buy display card, build in city
    ("bailout_buy", lot_index)   phase 4 auction

All automatic work (income, interest, bankruptcy resolution, cleanup) runs
inside apply_action's advance loop.
"""

import random

from .cards import BUILDING_TYPES, build_deck
from .state import (GameState, PlayerState, City, Building,
                    P_BID_INITIAL, P_BID_RAISE, P_BUY, P_RESOLVE,
                    P_BAILOUT, P_OVER)

PASS = ("pass",)


class IllegalAction(Exception):
    pass


# ---------------------------------------------------------------- setup

def new_game(config, n_players, seed=None, collect_events=False):
    config.validate(n_players)
    s = GameState()
    s.config = config
    s.n_players = n_players
    s.rng = random.Random(seed)
    if collect_events:
        s.events = []

    # loan track
    for row_no, (size, rate) in enumerate(
            zip(config.loan_row_sizes, config.loan_row_rates), start=1):
        for _ in range(size):
            s.loan_rates.append(rate)
            s.loan_rows.append(row_no)
    s.loan_markers = [True] * len(s.loan_rates)

    # players (starting loan markers come off the track, cheapest spaces first)
    for pid in range(n_players):
        p = PlayerState(pid, money=config.starting_money)
        taken = _take_loan_markers(s, config.starting_loans)
        p.loans += taken
        s.players.append(p)

    # cities
    s.cities = [City() for _ in range(config.n_cities(n_players))]

    # deck and display
    s.deck = build_deck(config.card_distribution)
    s.rng.shuffle(s.deck)
    cols = config.display_cols(n_players)
    s.display = [[None] * cols for _ in range(config.display_rows)]
    _refill_display(s)

    # random initial turn order
    s.turn_order = list(range(n_players))
    s.rng.shuffle(s.turn_order)
    s.log(f"setup: turn order {s.turn_order}, interest rate {s.current_rate()}")

    _start_bid_phase(s)
    _advance(s)
    return s


def _take_loan_markers(s, wanted):
    """Remove up to `wanted` markers from the track, cheapest spaces first.
    Returns how many were actually available (doc leaves the shortage case
    open; we allow partial takes)."""
    taken = 0
    for i, has_marker in enumerate(s.loan_markers):
        if taken == wanted:
            break
        if has_marker:
            s.loan_markers[i] = False
            taken += 1
    return taken


# ------------------------------------------------------- decision layer

def decision_player(s):
    if s.phase == P_BID_INITIAL:
        return s.bid_pending[0]
    if s.phase == P_BID_RAISE:
        return _lowest_bidder(s)
    if s.phase == P_BUY:
        return s.turn_order[s.buy_ptr]
    if s.phase == P_BAILOUT:
        return s.bailout_queue[0]
    return None


def legal_actions(s):
    cfg = s.config
    if s.phase == P_BID_INITIAL:
        taken = set(s.bids.values())
        return [("bid", v) for v in cfg.bid_spaces if v not in taken]

    if s.phase == P_BID_RAISE:
        pid = _lowest_bidder(s)
        taken = set(s.bids.values())
        current = s.bids[pid]
        raises = [("bid", v) for v in cfg.bid_spaces
                  if v > current and v not in taken]
        return raises + [PASS]

    if s.phase == P_BUY:
        pid = s.turn_order[s.buy_ptr]
        player = s.players[pid]
        actions = []
        for r, row in enumerate(s.display):
            mult = cfg.row_cost_multipliers[r]
            for c, cell in enumerate(row):
                if cell is None:
                    continue
                card, money_on = cell
                if player.money + money_on >= card.cost * mult:
                    for city in range(len(s.cities)):
                        actions.append(("buy", r, c, city))
        actions.append(PASS)
        return actions

    if s.phase == P_BAILOUT:
        pid = s.bailout_queue[0]
        player = s.players[pid]
        actions = []
        for i, (_city, card) in enumerate(s.bailout_lots):
            if card is not None and player.money >= card.cost * cfg.bailout_price_multiplier:
                actions.append(("bailout_buy", i))
        actions.append(PASS)
        return actions

    return []


def apply_action(s, action):
    if action not in legal_actions(s):
        raise IllegalAction(f"{action} not legal in phase {s.phase}")
    pid = decision_player(s)

    if s.phase == P_BID_INITIAL:
        s.bids[pid] = action[1]
        s.bid_pending.pop(0)
        s.log(f"P{pid} opens bid at {action[1]}")

    elif s.phase == P_BID_RAISE:
        if action == PASS:
            _bid_pass(s, pid)
        else:
            s.log(f"P{pid} raises bid {s.bids[pid]} -> {action[1]}")
            s.bids[pid] = action[1]

    elif s.phase == P_BUY:
        if action == PASS:
            s.buy_passed.add(pid)
            s.log(f"P{pid} passes")
        else:
            _do_buy(s, pid, *action[1:])
        s.buy_ptr = (s.buy_ptr + 1) % s.n_players

    elif s.phase == P_BAILOUT:
        if action != PASS:
            _do_bailout_buy(s, pid, action[1])
        s.bailout_queue.pop(0)

    _advance(s)


# --------------------------------------------------------- advance loop

def _advance(s):
    while True:
        if s.phase == P_BID_INITIAL:
            if s.bid_pending:
                return
            s.phase = P_BID_RAISE

        elif s.phase == P_BID_RAISE:
            if s.bids:
                return
            _finish_bidding(s)

        elif s.phase == P_BUY:
            if len(s.buy_passed) == s.n_players:
                collect_income(s)
                pay_interest(s)
                s.phase = P_RESOLVE
            else:
                while s.turn_order[s.buy_ptr] in s.buy_passed:
                    s.buy_ptr = (s.buy_ptr + 1) % s.n_players
                return

        elif s.phase == P_RESOLVE:
            # ends the game, starts the bailout auction, or begins the
            # next round — the loop re-dispatches on the new phase
            _resolve_round_end(s)

        elif s.phase == P_BAILOUT:
            if s.bailout_queue:
                return
            _finish_bailout(s)

        elif s.phase == P_OVER:
            return


# ------------------------------------------------------ phase 1: loans

def _start_bid_phase(s):
    s.phase = P_BID_INITIAL
    s.bid_pending = list(reversed(s.turn_order))  # last player bids first
    s.bids = {}
    s.next_order = [None] * s.n_players


def _lowest_bidder(s):
    return min(s.bids, key=s.bids.get)


def _bid_pass(s, pid):
    bid = s.bids.pop(pid)
    # last free (latest) spot on the turn order track
    slot = max(i for i, v in enumerate(s.next_order) if v is None)
    s.next_order[slot] = pid
    taken = _take_loan_markers(s, bid)
    player = s.players[pid]
    player.loans += taken
    player.loans_taken += taken
    player.money += taken * s.config.money_per_loan
    short = f" (only {taken} markers left)" if taken < bid else ""
    s.log(f"P{pid} passes at bid {bid}: +{taken} loans, "
          f"+${taken * s.config.money_per_loan}{short}; turn order spot {slot + 1}")


def _finish_bidding(s):
    s.turn_order = list(s.next_order)
    s.buy_ptr = 0
    s.buy_passed = set()
    s.phase = P_BUY
    s.log(f"turn order: {s.turn_order}, interest rate now {s.current_rate()}")


# -------------------------------------------------------- phase 2: buy

def _do_buy(s, pid, row, col, city_idx):
    cfg = s.config
    card, money_on = s.display[row][col]
    cost = card.cost * cfg.row_cost_multipliers[row]
    player = s.players[pid]
    player.money += money_on   # money on the card may pay for the card
    player.money -= cost
    s.display[row][col] = None
    s.cities[city_idx].sections[card.type].append(Building(card, pid))
    s.log(f"P{pid} buys {card.short()} from row {row + 1} for ${cost}"
          f"{f' (+${money_on} on card)' if money_on else ''} -> city {city_idx}")


# ----------------------------------------------------- phase 3: income

def collect_income(s):
    cfg = s.config
    s.state_subsidies = set()
    s.city_subsidies = {}

    # State subsidies: per building type, the city with strictly the fewest
    # buildings of that type (owned or not) gets a marker.
    for typ in BUILDING_TYPES:
        counts = [c.type_count(typ) for c in s.cities]
        low = min(counts)
        if counts.count(low) == 1:
            s.state_subsidies.add((counts.index(low), typ))

    # City subsidies: per city section, the player with strictly the most
    # buildings gets a marker.
    for ci, city in enumerate(s.cities):
        for typ in BUILDING_TYPES:
            owned = {}
            for b in city.sections[typ]:
                if b.owner is not None:
                    owned[b.owner] = owned.get(b.owner, 0) + 1
            if owned:
                best = max(owned.values())
                leaders = [p for p, n in owned.items() if n == best]
                if len(leaders) == 1:
                    s.city_subsidies[(ci, typ)] = leaders[0]

    # Payout.
    for ci, city in enumerate(s.cities):
        for typ in BUILDING_TYPES:
            state_sub = (ci, typ) in s.state_subsidies
            city_sub_owner = s.city_subsidies.get((ci, typ))
            for b in city.sections[typ]:
                if b.owner is None:
                    continue
                p = s.players[b.owner]
                p.money += b.card.income
                p.income_earned += b.card.income
                both = state_sub and city_sub_owner == b.owner
                single = state_sub or city_sub_owner == b.owner
                bonus = (cfg.double_subsidy_bonus if both
                         else cfg.single_subsidy_bonus if single else 0)
                p.money += bonus
                p.subsidy_earned += bonus
    s.log("income collected; subsidies: state="
          f"{sorted(s.state_subsidies)} city={s.city_subsidies}")


def pay_interest(s):
    rate = s.current_rate()
    s.unable = set()
    for p in s.players:
        if p.bankrupt:
            continue
        due = rate * p.loans if s.config.interest_per_loan else rate
        paid = min(due, p.money)
        p.money -= paid
        p.interest_paid += paid
        if paid < due:
            s.unable.add(p.pid)
            s.log(f"P{p.pid} owes ${due} interest, can only pay ${paid} — DEFAULT")
        else:
            s.log(f"P{p.pid} pays ${due} interest (rate {rate} x {p.loans} loans)")


# --------------------------------------- phase 4: bankruptcy / game end

def _resolve_round_end(s):
    if s.unable:
        _setup_bankruptcy(s)
        return
    if s.markers_left() == 0:
        s.end_cause = "loans_exhausted"
        _score_and_end(s)
        return
    if s.round >= s.config.max_rounds:
        s.end_cause = "rounds"
        _score_and_end(s)
        return
    cleanup(s)
    _start_bid_phase(s)


def _setup_bankruptcy(s):
    s.end_cause = "bankruptcy"
    # Earliest defaulter in turn order goes bankrupt; the rest are bailed out.
    for pid in s.turn_order:
        if pid in s.unable:
            s.bankrupt_pid = pid
            break
    bankrupt = s.players[s.bankrupt_pid]
    bankrupt.bankrupt = True
    for pid in s.unable:
        if pid != s.bankrupt_pid:
            s.bailed_out.add(pid)
            s.players[pid].money = 0  # bailed out, but stripped of cash
    s.log(f"P{s.bankrupt_pid} goes bankrupt; bailed out: {sorted(s.bailed_out)}")

    # Repossess: per city, one random building goes up for sale, the rest
    # return to the city unowned.
    s.bailout_lots = []
    for ci, city in enumerate(s.cities):
        mine = []
        for typ in BUILDING_TYPES:
            keep = []
            for b in city.sections[typ]:
                (mine if b.owner == s.bankrupt_pid else keep).append(b)
            city.sections[typ] = keep
        if mine:
            pick = s.rng.randrange(len(mine))
            for i, b in enumerate(mine):
                if i == pick:
                    s.bailout_lots.append((ci, b.card))
                else:
                    b.owner = None
                    city.sections[b.card.type].append(b)

    if s.bailout_lots:
        s.bailout_queue = [pid for pid in s.turn_order
                           if not s.players[pid].bankrupt]
        s.phase = P_BAILOUT
    else:
        _score_and_end(s)


def _do_bailout_buy(s, pid, lot_index):
    ci, card = s.bailout_lots[lot_index]
    price = card.cost * s.config.bailout_price_multiplier
    s.players[pid].money -= price
    s.cities[ci].sections[card.type].append(Building(card, pid))
    s.bailout_lots[lot_index] = (ci, None)  # sold
    s.log(f"P{pid} buys repossessed {card.short()} in city {ci} for ${price}")


def _finish_bailout(s):
    # Unsold lots return to their city, unowned.
    for ci, card in s.bailout_lots:
        if card is not None:
            s.cities[ci].sections[card.type].append(Building(card, None))
    s.bailout_lots = []
    _score_and_end(s)


def _score_and_end(s):
    cfg = s.config
    for p in s.players:
        if p.bankrupt:
            p.vp = 0
            continue
        vp = 0
        for city in s.cities:
            vp += cfg.vp_per_building * city.owned_count(p.pid)
        p.vp = vp

    # City majorities: most owned buildings in each city, ties all score.
    for city in s.cities:
        counts = {p.pid: city.owned_count(p.pid) for p in s.alive_players()}
        if not counts:
            continue
        best = max(counts.values())
        if best > 0:
            for pid, n in counts.items():
                if n == best:
                    s.players[pid].vp += cfg.vp_city_majority

    # State-subsidized sections: most buildings there scores 1vp/building.
    for (ci, typ) in s.state_subsidies:
        city = s.cities[ci]
        counts = {p.pid: city.owned_count(p.pid, typ) for p in s.alive_players()}
        if not counts:
            continue
        best = max(counts.values())
        if best > 0:
            for pid, n in counts.items():
                if n == best:
                    s.players[pid].vp += cfg.vp_state_subsidy_per_building * n

    alive = s.alive_players()
    if alive:
        best_key = max((p.vp, p.money) for p in alive)
        s.winners = [p.pid for p in alive if (p.vp, p.money) == best_key]
    s.phase = P_OVER
    s.log(f"game over ({s.end_cause}); "
          f"vp={[p.vp for p in s.players]} money={[p.money for p in s.players]} "
          f"winners={s.winners}")


# ---------------------------------------------------- phase 5: cleanup

def cleanup(s):
    cfg = s.config
    s.state_subsidies = set()
    s.city_subsidies = {}

    # $1 on every unpicked card in row 1
    for cell in s.display[0]:
        if cell is not None:
            cell[1] += cfg.stale_card_money

    # slide cards down to the lowest free row of their column
    for col in range(len(s.display[0])):
        stack = [s.display[r][col] for r in range(cfg.display_rows)
                 if s.display[r][col] is not None]
        for r in range(cfg.display_rows):
            s.display[r][col] = stack[r] if r < len(stack) else None

    _refill_display(s)

    # advance the round marker; loan markers on rows below it expire
    s.round += 1
    expired = 0
    for i in range(len(s.loan_markers)):
        if s.loan_markers[i] and s.loan_rows[i] < s.round:
            s.loan_markers[i] = False
            expired += 1
    s.log(f"cleanup: round -> {s.round}, {expired} loan markers expired, "
          f"rate now {s.current_rate()}")


def _refill_display(s):
    for row in s.display:
        for col in range(len(row)):
            if row[col] is None and s.deck:
                row[col] = [s.deck.pop(), 0]


# ------------------------------------------------------------ run loop

def run_game(config, agents, seed=None, collect_events=False):
    """Play one full game. `agents[i]` decides for player i."""
    s = new_game(config, len(agents), seed, collect_events)
    while s.phase != P_OVER:
        pid = decision_player(s)
        action = agents[pid].act(s, pid, legal_actions(s))
        apply_action(s, action)
    return s
