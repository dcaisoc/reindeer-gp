"""Reindeer Grand Prix SDK: the official engine in Python, plus tools to train,
evaluate and submit bots.

    from reindeer_sdk import load_track, load_laps, laps_to_arrays, evaluate_bot

Scores computed here are identical, to the tick, to the leaderboard's:
run `reindeer selftest` to check your installation.
"""

from .autopilot import baseline_policy, tuned_policy
from .bot import CompiledBot, InvalidBot, count_params, evaluate_bot, is_trainer_architecture, load_bot, validate_bot
from .config import DEFAULT_CONFIG, ENGINE_VERSION, input_names, make_config
from .data import can_mirror, laps_to_arrays, load_laps
from .export import bot_from_layers, from_torch, save_bot
from .replay import Replay, decode_replay, encode_replay, load_replay
from .run import Recorder, extract_training_pairs, run_policy, simulate_replay
from .sim import Observation, ReindeerGame, TrackGeometry
from .tracks import TRACK_IDS, list_tracks, load_track

__version__ = "0.3.0"

__all__ = [
    "CompiledBot", "DEFAULT_CONFIG", "ENGINE_VERSION", "InvalidBot", "Observation", "Recorder", "ReindeerGame", "Replay",
    "TRACK_IDS", "TrackGeometry", "baseline_policy", "bot_from_layers", "can_mirror", "count_params", "decode_replay",
    "encode_replay", "evaluate_bot", "extract_training_pairs", "from_torch", "input_names", "is_trainer_architecture",
    "laps_to_arrays", "list_tracks", "load_bot", "load_laps", "load_replay", "load_track", "make_config", "run_policy",
    "save_bot", "simulate_replay", "tuned_policy", "validate_bot", "__version__",
]
