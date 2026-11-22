"""A Gymnasium-style environment for reinforcement learning.

Works with or without the `gymnasium` package installed: if it is installed,
SleighEnv is a real gymnasium.Env with Box spaces; otherwise it has the same
reset()/step() API. Each step is one bot decision (3 physics ticks, 20 Hz),
exactly as bots are evaluated on the server.

The reward is a simple starting point you are encouraged to change:
    +1 for each checkpoint, +10 for finishing, -1 per wall penalty,
    -0.01 per decision (so faster is better).
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np

from .bot import BOT_TICKS_PER_ACTION
from .config import DEFAULT_CONFIG, input_names
from .quant import quantise
from .sim import ReindeerGame, TrackGeometry
from .twist import course

try:  # optional dependency
    import gymnasium as _gym
    from gymnasium import spaces as _spaces

    _Base: Any = _gym.Env
except ImportError:  # pragma: no cover - exercised when gymnasium is absent
    _gym = None
    _spaces = None
    _Base = object

DEFAULT_INPUTS = [f"ray{i}" for i in range(7)] + ["speed"]


class SleighEnv(_Base):  # type: ignore[misc]
    metadata = {"render_modes": []}

    def __init__(self, track: str | dict[str, Any] = "practice-1", inputs: Sequence[str] = DEFAULT_INPUTS,
                 cfg: dict[str, Any] | None = None) -> None:
        c = course(track)
        self.track = c.track
        self.cfg = cfg or c.cfg
        allowed = input_names(self.cfg)
        for n in inputs:
            if n not in allowed:
                raise ValueError(f'Unknown input "{n}". Available: {", ".join(allowed)}.')
        self.inputs = list(inputs)
        self.geo = TrackGeometry(self.track)
        self.game = ReindeerGame(self.track, self.cfg, self.geo)
        if _spaces is not None:
            self.observation_space = _spaces.Box(low=-1.0, high=1.0, shape=(len(self.inputs),), dtype=np.float64)
            self.action_space = _spaces.Box(low=-1.0, high=1.0, shape=(2,), dtype=np.float64)

    def _obs(self) -> np.ndarray:
        return np.asarray(self.game.observe().to_inputs(self.inputs), dtype=np.float64)

    def reset(self, *, seed: int | None = None, options: dict[str, Any] | None = None) -> tuple[np.ndarray, dict[str, Any]]:
        if _gym is not None:
            super().reset(seed=seed)
        self.game = ReindeerGame(self.track, self.cfg, self.geo)
        return self._obs(), {}

    def step(self, action: Sequence[float]) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        """action = (steer, throttle) in [-1, 1]. Returns obs, reward, terminated, truncated, info."""
        g = self.game
        a = (quantise(float(action[0])), quantise(float(action[1])))
        cps = len(g.events.splits)
        pens = g.penalties
        for _ in range(BOT_TICKS_PER_ACTION):
            g.step(a)
            if g.is_done():
                break
        reward = 1.0 * (len(g.events.splits) - cps) - 1.0 * (g.penalties - pens) - 0.01
        if g.finished:
            reward += 10.0
        info = {"tick": g.tick, "penalties": g.penalties, "checkpoints": len(g.events.splits)}
        if g.is_done():
            info["result"] = g.result()
        return self._obs(), reward, bool(g.finished), bool(g.timed_out), info
