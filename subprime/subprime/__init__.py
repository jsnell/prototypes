"""Subprime — a simulation framework for iterating on the board game design.

The rules engine implements the design doc; every number the doc leaves
open (card distribution, loan track layout, bid track, subsidy values,
scoring...) is a knob on `GameConfig` so design variants can be compared
by simulation. See DESIGN_NOTES.md for the list of assumptions.
"""

from .config import GameConfig
from .cards import Card, RESIDENTIAL, COMMERCIAL, INDUSTRIAL, BUILDING_TYPES
from .engine import new_game, legal_actions, apply_action, decision_player, run_game
from .agents import Agent, RandomAgent, HeuristicAgent, MonteCarloAgent, AGENT_REGISTRY
from .simulate import run_series, summarize, sweep

__all__ = [
    "GameConfig", "Card",
    "RESIDENTIAL", "COMMERCIAL", "INDUSTRIAL", "BUILDING_TYPES",
    "new_game", "legal_actions", "apply_action", "decision_player", "run_game",
    "Agent", "RandomAgent", "HeuristicAgent", "MonteCarloAgent", "AGENT_REGISTRY",
    "run_series", "summarize", "sweep",
]
