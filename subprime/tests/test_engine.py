"""Engine rule tests + whole-game smoke tests. Run with:
    python -m unittest discover -s tests -v
"""

import unittest

from subprime import GameConfig, RESIDENTIAL, COMMERCIAL, INDUSTRIAL
from subprime.cards import Card
from subprime.state import Building, P_OVER, P_BUY, P_BID_RAISE
from subprime import engine
from subprime.engine import (new_game, legal_actions, apply_action,
                             decision_player, run_game, collect_income,
                             pay_interest, cleanup, PASS)
from subprime.agents import (RandomAgent, HeuristicAgent, HeuristicParams,
                             MonteCarloAgent)
from subprime.simulate import run_series, summarize


CFG = GameConfig()


def fresh(n_players=4, seed=1):
    return new_game(CFG, n_players, seed=seed)


class ScriptedAgent:
    """Plays a fixed list of actions, then falls back to a policy."""

    def __init__(self, script=(), fallback=None):
        self.script = list(script)
        self.fallback = fallback or RandomAgent(seed=0)

    def act(self, state, pid, actions):
        if self.script:
            return self.script.pop(0)
        return self.fallback.act(state, pid, actions)


class TestSetup(unittest.TestCase):
    def test_setup_counts(self):
        s = fresh(4)
        self.assertEqual(len(s.players), 4)
        self.assertEqual(len(s.cities), 3)          # players - 1
        self.assertEqual(len(s.display), 3)
        self.assertEqual(len(s.display[0]), 5)      # players + 1
        self.assertTrue(all(cell is not None for row in s.display for cell in row))
        self.assertEqual(len(s.deck), 100 - 15)
        # each player starts with 1 loan (off the track) and $10
        for p in s.players:
            self.assertEqual(p.loans, 1)
            self.assertEqual(p.money, 10)
        self.assertEqual(s.markers_left(), 50 - 4)

    def test_initial_rate_visible(self):
        s = fresh(4)
        # 4 markers removed from row 1 -> highest visible rate = row 1 rate
        self.assertEqual(s.current_rate(), 1)


class TestBidding(unittest.TestCase):
    def test_bid_flow_orders_and_loans(self):
        s = fresh(3, seed=2)
        order = list(s.turn_order)
        # initial bids arrive in reverse turn order
        self.assertEqual(decision_player(s), order[-1])
        # scripted: players bid 2, 5, 0 (in reverse-order seating)...
        apply_action(s, ("bid", 2))
        self.assertEqual(decision_player(s), order[-2])
        apply_action(s, ("bid", 5))
        apply_action(s, ("bid", 0))
        # ...now the lowest bidder (bid 0) must raise or pass
        low = decision_player(s)
        self.assertEqual(s.bids[low], 0)
        self.assertIn(PASS, legal_actions(s))
        apply_action(s, PASS)                       # passes: last spot, 0 loans
        # next lowest is bid 2
        mid = decision_player(s)
        self.assertEqual(s.bids[mid], 2)
        apply_action(s, PASS)
        top = decision_player(s)
        apply_action(s, PASS)
        # bidding over -> buy phase, new turn order high bid first
        self.assertEqual(s.phase, P_BUY)
        self.assertEqual(s.turn_order, [top, mid, low])
        self.assertEqual(s.players[top].loans, 1 + 5)
        self.assertEqual(s.players[top].money, 10 + 50)
        self.assertEqual(s.players[low].loans, 1)
        self.assertEqual(s.players[low].money, 10)

    def test_raise_must_be_higher_and_empty(self):
        s = fresh(3, seed=2)
        apply_action(s, ("bid", 2))
        apply_action(s, ("bid", 5))
        apply_action(s, ("bid", 0))
        raises = [a for a in legal_actions(s) if a[0] == "bid"]
        values = {v for _, v in raises}
        self.assertNotIn(0, values)   # not higher
        self.assertNotIn(2, values)   # occupied
        self.assertNotIn(5, values)   # occupied
        self.assertIn(1, values)
        # raising re-asks the new lowest bidder
        apply_action(s, ("bid", 3))
        self.assertEqual(s.bids[decision_player(s)], 2)
        self.assertEqual(s.phase, P_BID_RAISE)


class TestBuyPhase(unittest.TestCase):
    def test_buy_costs_row_multiplier_and_uses_card_money(self):
        s = fresh(3, seed=3)
        # drain bidding: everyone bids then passes immediately
        while s.phase != P_BUY:
            acts = legal_actions(s)
            apply_action(s, PASS if PASS in acts else min(
                acts, key=lambda a: a[1]))
        pid = decision_player(s)
        card = Card(999, RESIDENTIAL, cost=3, income=2)
        s.display[2][0] = [card, 4]                # row 3 -> cost 9, $4 on card
        s.players[pid].money = 5                   # 5 + 4 >= 9: affordable
        self.assertIn(("buy", 2, 0, 0), legal_actions(s))
        apply_action(s, ("buy", 2, 0, 0))
        self.assertEqual(s.players[pid].money, 0)
        self.assertIsNone(s.display[2][0])
        self.assertEqual(s.cities[0].owned_count(pid, RESIDENTIAL), 1)

    def test_cannot_buy_unaffordable(self):
        s = fresh(3, seed=3)
        while s.phase != P_BUY:
            acts = legal_actions(s)
            apply_action(s, PASS if PASS in acts else min(
                acts, key=lambda a: a[1]))
        pid = decision_player(s)
        s.players[pid].money = 0
        for row in s.display:
            for cell in row:
                if cell:
                    cell[1] = 0
        self.assertEqual(legal_actions(s), [PASS])


def bare_state(n_players=3, seed=0):
    """A game state with the cities emptied for surgical phase tests."""
    s = fresh(n_players, seed=seed)
    for c in s.cities:
        for t in c.sections:
            c.sections[t] = []
    return s


class TestIncome(unittest.TestCase):
    def test_subsidies_and_income(self):
        s = bare_state(3)   # 3 players -> 2 city boards
        res = lambda pid: Building(Card(0, RESIDENTIAL, 2, 2), pid)
        # city 0: P0 has 2 residential; city 1: P1 has 1
        s.cities[0].sections[RESIDENTIAL] = [res(0), res(0)]
        s.cities[1].sections[RESIDENTIAL] = [res(1)]
        for p in s.players:
            p.money = 0
        collect_income(s)
        # state subsidy for residential -> city 1 (strict fewest);
        # commercial/industrial tie at 0 everywhere -> no marker
        self.assertEqual(s.state_subsidies, {(1, RESIDENTIAL)})
        # city subsidies: P0 leads city 0 res, P1 leads city 1 res
        self.assertEqual(s.city_subsidies[(0, RESIDENTIAL)], 0)
        self.assertEqual(s.city_subsidies[(1, RESIDENTIAL)], 1)
        # P0: 2 cards x ($2 income + $1 city subsidy) = $6
        self.assertEqual(s.players[0].money, 6)
        # P1: 1 card with BOTH city and state subsidy: $2 + $3 = $5
        self.assertEqual(s.players[1].money, 5)
        self.assertEqual(s.players[2].money, 0)

    def test_double_subsidy_pays_three(self):
        s = bare_state(4)   # 4 players -> 3 city boards
        b = Building(Card(0, COMMERCIAL, 2, 1), 0)
        s.cities[0].sections[COMMERCIAL] = [b]
        # make city 0 strict-fewest for commercial impossible; instead give
        # cities 1,2 more commercial so city 0 IS fewest... it has 1, give others 2
        for ci in (1, 2):
            s.cities[ci].sections[COMMERCIAL] = [
                Building(Card(1, COMMERCIAL, 2, 1), None),
                Building(Card(2, COMMERCIAL, 2, 1), None)]
        s.players[0].money = 0
        collect_income(s)
        self.assertIn((0, COMMERCIAL), s.state_subsidies)
        self.assertEqual(s.city_subsidies[(0, COMMERCIAL)], 0)
        # $1 income + $3 double subsidy
        self.assertEqual(s.players[0].money, 4)

    def test_tie_means_no_marker(self):
        s = bare_state(3)   # 2 city boards
        for ci in (0, 1):
            s.cities[ci].sections[INDUSTRIAL] = [
                Building(Card(ci, INDUSTRIAL, 3, 2), ci)]
        collect_income(s)
        # both cities tie at 1 industrial (and 0 of everything else)
        # -> no state subsidy markers anywhere
        self.assertEqual(s.state_subsidies, set())
        # sole owner in a section still gets the city subsidy
        self.assertEqual(s.city_subsidies[(0, INDUSTRIAL)], 0)
        self.assertEqual(s.city_subsidies[(1, INDUSTRIAL)], 1)


class TestInterest(unittest.TestCase):
    def test_rate_rises_with_uncovered_track(self):
        s = fresh(4)
        engine._take_loan_markers(s, 6)   # 4 starting + 6 = 10 -> row 1 done
        self.assertEqual(s.current_rate(), 1)
        engine._take_loan_markers(s, 1)   # first row-2 space uncovered
        self.assertEqual(s.current_rate(), 2)

    def test_interest_per_loan_and_default(self):
        s = fresh(4)
        p = s.players[0]
        p.loans, p.money = 3, 2           # owes 3 * rate(1) = 3, has 2
        for q in s.players[1:]:
            q.money = 100
        pay_interest(s)
        self.assertEqual(p.money, 0)
        self.assertIn(0, s.unable)
        self.assertEqual(len(s.unable), 1)

    def test_flat_interest_config(self):
        cfg = CFG.with_changes(interest_per_loan=False)
        s = new_game(cfg, 4, seed=1)
        p = s.players[0]
        p.loans, p.money = 5, 10
        pay_interest(s)
        self.assertEqual(p.money, 9)      # flat rate 1, loans irrelevant


class TestCleanup(unittest.TestCase):
    def test_stale_money_slide_refill_and_expiry(self):
        s = fresh(3, seed=5)
        col0_row0 = s.display[0][0][0]
        s.display[1][0] = None            # hole in column 0, row 2
        row3_card = s.display[2][0][0]
        deck_before = len(s.deck)
        cleanup(s)
        # row-1 card got $1 and stayed put
        self.assertEqual(s.display[0][0], [col0_row0, 1])
        # row-3 card slid down into row 2
        self.assertEqual(s.display[1][0][0], row3_card)
        # the hole (now at row 3) was refilled from the deck
        self.assertIsNotNone(s.display[2][0])
        self.assertEqual(len(s.deck), deck_before - 1)
        # round advanced, row-1 markers expired
        self.assertEqual(s.round, 2)
        self.assertTrue(all(not s.loan_markers[i]
                            for i in range(len(s.loan_markers))
                            if s.loan_rows[i] < 2))
        self.assertGreaterEqual(s.current_rate(), 1)


class TestBankruptcyAndScoring(unittest.TestCase):
    def _end_with_default(self, seed=7):
        s = bare_state(3, seed=seed)
        # P2 owns 3 buildings in city 0, P0 owns 1 in city 1
        for i in range(3):
            s.cities[0].sections[RESIDENTIAL].append(
                Building(Card(i, RESIDENTIAL, 2, 1), 2))
        s.cities[1].sections[COMMERCIAL].append(
            Building(Card(9, COMMERCIAL, 2, 1), 0))
        return s

    def test_bankrupt_player_loses_buildings_and_cannot_win(self):
        s = self._end_with_default()
        s.turn_order = [2, 0, 1]
        s.unable = {2}
        s.players[0].money = 100
        s.players[1].money = 0
        engine._resolve_round_end(s)
        self.assertEqual(s.bankrupt_pid, 2)
        self.assertTrue(s.players[2].bankrupt)
        # exactly one of P2's buildings went to auction, two returned unowned
        self.assertEqual(len(s.bailout_lots), 1)
        self.assertEqual(
            sum(1 for b in s.cities[0].sections[RESIDENTIAL]
                if b.owner is None), 2)
        # auction: P0 buys the lot, P1 (broke) can only pass
        self.assertEqual(decision_player(s), 0)
        buys = [a for a in legal_actions(s) if a[0] == "bailout_buy"]
        self.assertEqual(len(buys), 1)
        apply_action(s, buys[0])
        apply_action(s, PASS)
        self.assertEqual(s.phase, P_OVER)
        self.assertEqual(s.end_cause, "bankruptcy")
        self.assertNotIn(2, s.winners)
        self.assertEqual(s.players[2].vp, 0)
        # P0: 1 commercial + 1 repossessed res = 2 buildings + majorities
        self.assertGreater(s.players[0].vp, 0)

    def test_multiple_defaulters_one_bankruptcy(self):
        s = self._end_with_default()
        s.turn_order = [1, 2, 0]
        s.unable = {0, 2}
        s.players[1].money = 0
        engine._resolve_round_end(s)
        self.assertEqual(s.bankrupt_pid, 2)   # earliest in turn order
        self.assertIn(0, s.bailed_out)
        self.assertFalse(s.players[0].bankrupt)
        self.assertEqual(s.players[0].money, 0)

    def test_scoring_majorities_and_state_subsidy(self):
        s = bare_state(3)
        for i in range(2):
            s.cities[0].sections[RESIDENTIAL].append(
                Building(Card(i, RESIDENTIAL, 2, 1), 0))
        s.cities[0].sections[COMMERCIAL].append(
            Building(Card(5, COMMERCIAL, 2, 1), 1))
        for p in s.players:
            p.money = 50
        collect_income(s)   # places subsidy markers used by scoring
        pay_interest(s)
        s.round = CFG.max_rounds
        engine._resolve_round_end(s)
        self.assertEqual(s.phase, P_OVER)
        self.assertEqual(s.end_cause, "rounds")
        p0 = s.players[0]
        # 2 buildings + city-0 majority(3) + state-subsidy section win
        # (residential is NOT strict-fewest anywhere... compute simply: vp>=5)
        self.assertGreaterEqual(p0.vp, 5)
        self.assertEqual(s.winners, [0])


class TestLoanRuling(unittest.TestCase):
    def test_bids_honored_when_markers_run_out(self):
        s = fresh(3, seed=2)
        engine._take_loan_markers(s, s.markers_left() - 2)  # 2 markers remain
        order = list(s.turn_order)
        p5, p6, p0 = order[-1], order[-2], order[-3]  # reverse bid order
        apply_action(s, ("bid", 5))
        apply_action(s, ("bid", 6))
        apply_action(s, ("bid", 0))
        apply_action(s, PASS)   # p0 (lowest) passes: no loans
        apply_action(s, PASS)   # p5 passes: only 2 markers, but 5 full loans
        apply_action(s, PASS)   # p6 passes: track already dry, 6 full loans
        self.assertEqual(s.markers_left(), 0)
        self.assertEqual(s.players[p5].loans, 1 + 5)
        self.assertEqual(s.players[p5].money, 10 + 50)
        self.assertEqual(s.players[p6].loans, 1 + 6)
        self.assertEqual(s.players[p6].money, 10 + 60)
        # empty track = max rate, and the game ends this round
        self.assertEqual(s.current_rate(), 6)
        while s.phase == P_BUY:
            apply_action(s, PASS)
        self.assertEqual(s.phase, P_OVER)
        self.assertIn(s.end_cause, ("loans_exhausted", "bankruptcy"))


class TestRuleVariants(unittest.TestCase):
    def test_uninverted_initial_bid_order(self):
        cfg = CFG.with_changes(initial_bids_inverted=False)
        s = new_game(cfg, 3, seed=2)
        self.assertEqual(decision_player(s), s.turn_order[0])

    def test_immediate_pass_variant(self):
        cfg = CFG.with_changes(compulsory_initial_bids=False)
        s = new_game(cfg, 3, seed=2)
        first = decision_player(s)
        self.assertIn(PASS, legal_actions(s))
        apply_action(s, PASS)                     # pass straight out
        p = s.players[first]
        self.assertEqual((p.loans, p.money), (1, 10))   # starting loans only
        self.assertEqual(s.next_order[-1], first)       # last turn-order spot
        # remaining two players place and the auction proceeds normally
        apply_action(s, ("bid", 3))
        apply_action(s, ("bid", 1))
        self.assertEqual(s.bids[decision_player(s)], 1)  # lowest is asked

    def test_bankruptcy_pick_most_loans(self):
        cfg = CFG.with_changes(bankruptcy_pick="most_loans")
        s = new_game(cfg, 3, seed=7)
        s.turn_order = [0, 1, 2]
        s.players[0].loans, s.players[2].loans = 2, 9
        s.unable = {0, 2}
        s.players[1].money = 0
        engine._resolve_round_end(s)
        self.assertEqual(s.bankrupt_pid, 2)   # biggest debtor, not earliest


class TestSnapshotsAndProjections(unittest.TestCase):
    def test_rate_after(self):
        s = fresh(4)                            # 4 starting markers removed
        self.assertEqual(s.rate_after(0), s.current_rate())
        self.assertEqual(s.rate_after(6), 1)    # row 1 exactly exhausted
        self.assertEqual(s.rate_after(7), 2)    # first row-2 space uncovered
        self.assertEqual(s.rate_after(999), 6)  # whole track uncovered

    def test_score_snapshot_and_exclude(self):
        s = bare_state(3)
        for i in range(2):
            s.cities[0].sections[RESIDENTIAL].append(
                Building(Card(i, RESIDENTIAL, 2, 1), 0))
        s.cities[0].sections[COMMERCIAL].append(
            Building(Card(9, COMMERCIAL, 2, 1), 1))
        snap = engine.score_snapshot(s)
        # P0: 2 buildings + 3vp city-0 majority; P1: 1 building; P2: nothing
        self.assertEqual(snap, {0: 5, 1: 1, 2: 0})
        # previewing P0's bankruptcy hands the majority to P1
        self.assertEqual(engine.score_snapshot(s, exclude=0), {1: 4, 2: 0})


class TestEndConditions(unittest.TestCase):
    def test_loan_track_exhaustion_ends_game(self):
        s = fresh(4, seed=11)
        # drain the whole track mid-game, then finish the round
        engine._take_loan_markers(s, 50)
        for p in s.players:
            p.money = 1000
        s.unable = set()
        engine._resolve_round_end(s)
        self.assertEqual(s.phase, P_OVER)
        self.assertEqual(s.end_cause, "loans_exhausted")

    def test_game_never_exceeds_max_rounds(self):
        for seed in range(5):
            agents = [RandomAgent(seed=seed * 10 + i) for i in range(4)]
            s = run_game(CFG, agents, seed=seed)
            self.assertLessEqual(s.round, CFG.max_rounds)
            self.assertEqual(s.phase, P_OVER)


class TestFullGames(unittest.TestCase):
    def test_random_games_complete_all_player_counts(self):
        for n in (3, 4, 5):
            for seed in range(8):
                agents = [RandomAgent(seed=seed * 10 + i) for i in range(n)]
                s = run_game(CFG, agents, seed=seed)
                self.assertEqual(s.phase, P_OVER)
                self.assertIn(s.end_cause,
                              ("bankruptcy", "loans_exhausted", "rounds"))
                for p in s.players:
                    self.assertGreaterEqual(p.money, 0)
                    self.assertGreaterEqual(p.vp, 0)
                if not all(p.bankrupt for p in s.players):
                    self.assertTrue(s.winners)

    def test_determinism(self):
        def play(seed):
            agents = [RandomAgent(seed=100 + i) for i in range(4)]
            s = run_game(CFG, agents, seed=seed)
            return (s.end_cause, [p.vp for p in s.players],
                    [p.money for p in s.players], s.winners)
        self.assertEqual(play(42), play(42))

    def test_heuristic_and_mc_agents_play_legally(self):
        agents = [HeuristicAgent(seed=1),
                  MonteCarloAgent(rollouts=2, max_actions=4, seed=2),
                  RandomAgent(seed=3),
                  HeuristicAgent(HeuristicParams(loan_appetite=2.0,
                                                 demand_aware=True), seed=4)]
        s = run_game(CFG, agents, seed=9)
        self.assertEqual(s.phase, P_OVER)
        # market snapshots recorded once per completed buy phase
        self.assertEqual(len(s.round_stats), s.round)

    def test_series_and_summary(self):
        records = run_series(CFG, ["greedy", "random"], 4, 6, base_seed=0)
        self.assertEqual(len(records), 6)
        text = summarize(records)
        self.assertIn("win rate by agent", text)


if __name__ == "__main__":
    unittest.main()
