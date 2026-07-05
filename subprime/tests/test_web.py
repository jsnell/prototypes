"""Web session layer: full games driven through the human-facing API."""

import json
import random
import unittest

from subprime.web import new_session, human_act
from subprime.engine import IllegalAction


class TestWebSession(unittest.TestCase):
    def test_full_game_json_roundtrip(self):
        rng = random.Random(1)
        view = new_session(("digest", "shark", "greedy"), seed=5)
        steps = 0
        while not view["over"]:
            self.assertTrue(view["humanTurn"])
            self.assertTrue(view["legal"])
            json.dumps(view)                  # everything serializable
            view = human_act(rng.choice(view["legal"]))
            steps += 1
            self.assertLess(steps, 500)
        json.dumps(view)
        self.assertIn(view["endCause"], ("bankruptcy", "loans_exhausted",
                                         "rounds"))
        self.assertEqual(len(view["players"]), 4)

    def test_illegal_action_rejected(self):
        view = new_session(("greedy", "greedy", "greedy"), seed=6)
        self.assertTrue(view["humanTurn"])
        with self.assertRaises(IllegalAction):
            human_act(["buy", 0, 0, 0] if view["phase"].startswith("bid")
                      else ["bid", 99])

    def test_doc_rates_option(self):
        view = new_session(("greedy",) * 3, seed=7, steep=False)
        rates = [row["rate"] for row in view["loanTrack"]]
        self.assertEqual(rates, [1, 2, 3, 4, 5, 6])
        view = new_session(("greedy",) * 3, seed=7, steep=True)
        rates = [row["rate"] for row in view["loanTrack"]]
        self.assertEqual(rates, [1, 2, 3, 5, 7, 9])


if __name__ == "__main__":
    unittest.main()
