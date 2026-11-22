"""Sample laps for trying things out before you have your own.

They are driven by a simulated human: on/off arrow keys, the same steering
ramp as the web app's keyboard input, a reaction every ~4 ticks, and some
hesitation. Your own laps are better: your bot learns *your* driving.
"""

from __future__ import annotations

from .autopilot import tuned_policy
from .quant import mulberry32
from .replay import Replay
from .run import Recorder
from .config import DEFAULT_CONFIG
from .twist import course


def sample_lap(track_id: str = "practice-1", seed: int = 1, sloppiness: float = 0.15) -> Replay:
    """One lap on a track or twist. The simulated driver sees the whole road like a human
    (the standard 7 rays), whatever sensors the twist gives bots; rays never affect physics."""
    c = course(track_id)
    driver_cfg = {**c.cfg, "rayAnglesDeg": DEFAULT_CONFIG["rayAnglesDeg"], "rayRange": DEFAULT_CONFIG["rayRange"]}
    rec = Recorder(c.track, 1, {"kind": "human", "name": f"Sample driver {seed}"}, driver_cfg)
    rec.twist = c.twist
    rand = mulberry32(seed)
    steer = 0
    left = right = up = down = False
    while not rec.game.is_done():
        if rec.game.tick % 4 == 0 and rand() >= sloppiness:
            s, t = tuned_policy(rec.game.observe())
            right, left = s > 0.12, s < -0.12
            up, down = t > 0, t < 0
        target = (127 if right else 0) - (127 if left else 0)
        if target == 0:
            steer = max(0, steer - 18) if steer > 0 else min(0, steer + 18)
        elif steer < target:
            steer = min(target, steer + (18 if steer < 0 else 9))
        elif steer > target:
            steer = max(target, steer - (18 if steer > 0 else 9))
        rec.tick((steer, 127 if up and not down else -127 if down and not up else 0))
    return rec.to_replay()


def sample_laps(track_id: str = "practice-1", n: int = 4) -> list[Replay]:
    """n sample laps on a track (deterministic)."""
    return [sample_lap(track_id, seed) for seed in range(1, n + 1)]
