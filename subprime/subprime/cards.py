"""Real estate cards."""

from dataclasses import dataclass

RESIDENTIAL = "residential"
COMMERCIAL = "commercial"
INDUSTRIAL = "industrial"
BUILDING_TYPES = (RESIDENTIAL, COMMERCIAL, INDUSTRIAL)


@dataclass(frozen=True)
class Card:
    id: int
    type: str
    cost: int    # printed cost (lower right corner); actual price = cost * row multiplier
    income: int  # printed per-round income

    def short(self):
        return f"{self.type[:3].upper()}(c{self.cost}/i{self.income})"


def build_deck(distribution):
    """Build the deck from a distribution spec: iterable of
    (building_type, printed_cost, printed_income, count)."""
    deck = []
    next_id = 0
    for typ, cost, income, count in distribution:
        if typ not in BUILDING_TYPES:
            raise ValueError(f"unknown building type {typ!r}")
        for _ in range(count):
            deck.append(Card(next_id, typ, cost, income))
            next_id += 1
    return deck
