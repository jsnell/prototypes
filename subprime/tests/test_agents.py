"""Behavioral regression tests for the blind-playtest agent fixes:
lifeline borrowing and bankruptcy-pick-aware doomed spending. These pin
the two 'scripted AI tells' the LLM playtesters called out — marching
into a coverable default, and buying buildings the bankruptcy pick is
about to repossess.
"""

import unittest

from subprime import GameConfig
from subprime.engine import new_game, legal_actions, decision_player
from subprime.state import P_BID_INITIAL, P_BUY
from subprime.agents import HeuristicAgent, HeuristicParams

CFG = GameConfig(loan_row_rates=(2, 3, 4, 6, 8, 10))
DIGEST = dict(demand_aware=True, turn_order_value=12.0, kill_instinct=1.0,
              endgame_awareness=1.0, debt_cooldown=1.0, patience=0.5,
              cash_reserve_value=0.4)


def drowning_bidder(seed=5):
    """A bid-phase state where the decision player cannot cover this
    round's interest from cash + income — and no single position-bid loan
    covers either, only a genuine multi-loan lifeline does."""
    s = new_game(CFG, 4, seed=seed)
    s.round = 3
    for i in range(15):                    # row 2 partially emptied: rate $3
        s.loan_markers[i] = False
    pid = decision_player(s)
    p = s.players[pid]
    p.loans = 6                            # owes 6 x $3 = $18
    p.money = 2                            # no buildings -> $0 income
    return s, pid


class TestLifeline(unittest.TestCase):
    def test_lifeline_borrows_to_cover_the_bill(self):
        s, pid = drowning_bidder()
        acts = legal_actions(s)
        base = HeuristicAgent(HeuristicParams(**DIGEST))
        v2 = HeuristicAgent(HeuristicParams(**DIGEST, lifeline=True))
        self.assertFalse(base._survivable(s, pid, 0))   # default is real
        a = v2.act(s, pid, acts)
        self.assertEqual(a[0], "bid")
        d = a[1]
        # the chosen borrow actually covers: 5+d loans at the post-take
        # rate vs $16 + $10d cash
        self.assertTrue(v2._survivable(s, pid, d))

    def test_without_lifeline_agent_marches_into_default(self):
        s, pid = drowning_bidder()
        acts = legal_actions(s)
        base = HeuristicAgent(HeuristicParams(**DIGEST))
        a = base.act(s, pid, acts)
        covers = a[0] == "bid" and base._survivable(s, pid, a[1])
        self.assertFalse(covers)           # the old tell, pinned


class TestPickAwareDoomedSpending(unittest.TestCase):
    def doomed_buyer(self, other_doomed_earlier):
        """Buy-phase state where the decision player is doomed; optionally
        a player EARLIER in turn order is also doomed (takes the fall)."""
        s = new_game(CFG, 4, seed=11)
        for i in range(20):
            s.loan_markers[i] = False      # rate $6
        s.phase = P_BUY
        s.bids = {}
        pid = s.turn_order[1]              # second in turn order
        s.buy_order = [pid]
        s.buy_idx = 0
        s.buy_passed = set()
        for q in s.players:                # everyone else comfortably solvent
            q.loans = 1
            q.money = 30
        p = s.players[pid]
        p.loans = 5                        # owes $30, has $4, income $0
        p.money = 4
        if other_doomed_earlier:
            q = s.players[s.turn_order[0]]
            q.loans = 6                    # owes $36 with $4 — doomed first
            q.money = 4
        return s, pid

    def agent(self):
        return HeuristicAgent(HeuristicParams(**DIGEST, pick_aware=True))

    def test_the_pick_stops_buying(self):
        s, pid = self.doomed_buyer(other_doomed_earlier=False)
        acts = legal_actions(s)
        self.assertTrue(any(a[0] == "buy" for a in acts))
        self.assertEqual(self.agent().act(s, pid, acts), ("pass",))

    def test_shielded_defaulter_still_spends(self):
        s, pid = self.doomed_buyer(other_doomed_earlier=True)
        acts = legal_actions(s)
        a = self.agent().act(s, pid, acts)
        self.assertEqual(a[0], "buy")      # bailed out: buildings are kept


if __name__ == "__main__":
    unittest.main()
