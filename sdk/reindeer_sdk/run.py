"""Running, recording and re-simulating laps. Port of engine/reindeer/run.ts."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Sequence

from .config import DEFAULT_CONFIG, ENGINE_VERSION, GAME_ID
from .quant import quantise
from .replay import REPLAY_FORMAT, REPLAY_VERSION, Replay
from .sim import Observation, ReindeerGame, TrackGeometry

HASH_EVERY = 60

#: A policy maps an observation to (steer, throttle), each in [-1, 1].
Policy = Callable[[Observation], Sequence[float]]


class Recorder:
    """Records a run as it is played, producing a replay identical to the web app's."""

    def __init__(self, track: dict[str, Any], ticks_per_action: int, participant: dict[str, Any],
                 cfg: dict[str, Any] | None = None, geo: TrackGeometry | None = None) -> None:
        self.track = track
        self.ticks_per_action = ticks_per_action
        self.participant = participant
        self.game = ReindeerGame(track, cfg or DEFAULT_CONFIG, geo)
        self._actions: list[int] = []
        self.hashes: list[str] = []
        self._held = (0, 0)

    @property
    def needs_action(self) -> bool:
        return self.game.tick % self.ticks_per_action == 0

    def tick(self, action: Sequence[int]) -> None:
        if self.game.is_done():
            return
        if self.needs_action:
            self._held = (int(action[0]), int(action[1]))
            self._actions += [self._held[0], self._held[1]]
        self.game.step(self._held)
        if self.game.tick % HASH_EVERY == 0:
            self.hashes.append(self.game.state_hash())

    def to_replay(self, seed: int = 0) -> Replay:
        r = self.game.result()
        header = {
            "format": REPLAY_FORMAT,
            "version": REPLAY_VERSION,
            "game": GAME_ID,
            "engineVersion": ENGINE_VERSION,
            "track": {"id": self.track["id"], "version": self.track["trackVersion"]},
            "twist": None,
            "seed": seed,
            "ticksPerAction": self.ticks_per_action,
            "participants": [self.participant],
            "result": {
                "valid": r["valid"],
                "score": r["score"] if r["valid"] else None,
                "ticks": r["ticks"],
                "penalties": r["penalties"],
                "collisions": r["collisions"],
            },
            "hashes": list(self.hashes),
            "finalHash": self.game.state_hash(),
            "createdAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        }
        return Replay(header, list(self._actions))


@dataclass
class Frame:
    x: float
    y: float
    heading: float
    speed: float
    touching: int


@dataclass
class SimOutcome:
    game: ReindeerGame
    hashes: list[str]
    final_hash: str
    frames: list[Frame] | None
    first_mismatch: int
    matches: bool


def simulate_replay(track: dict[str, Any], replay: Replay, cfg: dict[str, Any] | None = None,
                    geo: TrackGeometry | None = None, collect_frames: bool = False) -> SimOutcome:
    """Re-simulate a replay from its inputs and compare every recorded state hash."""
    g = ReindeerGame(track, cfg or DEFAULT_CONFIG, geo)
    tpa = replay.ticks_per_action
    frames = [_frame(g)] if collect_frames else None
    hashes: list[str] = []
    a = replay.actions
    n = len(a) // 2
    while not g.is_done():
        d = g.tick // tpa
        if d >= n:
            break
        g.step((a[2 * d], a[2 * d + 1]))
        if frames is not None:
            frames.append(_frame(g))
        if g.tick % HASH_EVERY == 0:
            hashes.append(g.state_hash())
    final = g.state_hash()
    want = replay.header["hashes"]
    first = -1
    for i in range(max(len(want), len(hashes))):
        if i >= len(want) or i >= len(hashes) or want[i] != hashes[i]:
            first = i
            break
    return SimOutcome(g, hashes, final, frames, first, first == -1 and final == replay.header["finalHash"])


def _frame(g: ReindeerGame) -> Frame:
    return Frame(g.x, g.y, g.heading, g.speed, g.touching)


def extract_training_pairs(track: dict[str, Any], replay: Replay, decision_ticks: int = 3,
                           cfg: dict[str, Any] | None = None) -> tuple[list[Observation], list[tuple[float, float]]]:
    """(observation, action) pairs at the bot decision rate (20 Hz), recomputed by re-simulation."""
    g = ReindeerGame(track, cfg or DEFAULT_CONFIG)
    tpa = replay.ticks_per_action
    a = replay.actions
    n = len(a) // 2
    obs: list[Observation] = []
    acts: list[tuple[float, float]] = []
    while not g.is_done():
        d = g.tick // tpa
        if d >= n:
            break
        act = (a[2 * d], a[2 * d + 1])
        if g.tick % decision_ticks == 0:
            obs.append(g.observe())
            acts.append((act[0] / 127, act[1] / 127))
        g.step(act)
    return obs, acts


def run_policy(track: dict[str, Any], policy: Policy, participant: dict[str, Any] | None = None,
               cfg: dict[str, Any] | None = None, ticks_per_action: int = 3,
               geo: TrackGeometry | None = None) -> Replay:
    """Run a policy for a full lap at the bot decision rate and return the replay."""
    rec = Recorder(track, ticks_per_action, participant or {"kind": "bot"}, cfg, geo)
    act = (0, 0)
    while not rec.game.is_done():
        if rec.needs_action:
            s, t = policy(rec.game.observe())
            act = (quantise(s), quantise(t))
        rec.tick(act)
    return rec.to_replay()


def score_of(replay: Replay) -> float:
    r = replay.result
    return r["score"] if r["valid"] else math.inf
