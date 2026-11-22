"""Engine configuration. Must match engine/reindeer/config.ts exactly."""

from __future__ import annotations

import copy
from typing import Any

ENGINE_VERSION = "1.0.0"
GAME_ID = "reindeer-gp"
TICK_HZ = 60
DT = 1 / 60

DEFAULT_CONFIG: dict[str, Any] = {
    "penaltySeconds": 1.0,
    "penaltyCooldownTicks": 30,
    "timeoutTicks": 120 * 60,
    "rayAnglesDeg": [-60, -40, -20, 0, 20, 40, 60],
    "rayRange": 40,
    "sleighRadius": 1.0,
    "maxSpeed": 28,
    "accel": 12,
    "brake": 24,
    "reverseAccel": 5,
    "maxReverse": 6,
    "dragLinear": 0.1,
    "dragQuad": 0.012,
    "turnRate": 2.6,
    "turnFullSpeed": 4,
    "highSpeedTurnLoss": 0.45,
    "gripRate": 10,
    "wallSpeedFactor": 0.5,
    "wallFriction": 2,
    "surfaces": {
        "snow": {"grip": 1, "drag": 1, "traction": 1},
        "ice": {"grip": 0.12, "drag": 0.6, "traction": 0.45},
        "rough": {"grip": 1.2, "drag": 4, "traction": 0.8},
    },
}


def make_config(**overrides: Any) -> dict[str, Any]:
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    surfaces = overrides.pop("surfaces", None)
    cfg.update(overrides)
    if surfaces:
        cfg["surfaces"].update(surfaces)
    return cfg


def input_names(cfg: dict[str, Any] | None = None) -> list[str]:
    cfg = cfg or DEFAULT_CONFIG
    return [f"ray{i}" for i in range(len(cfg["rayAnglesDeg"]))] + ["speed", "lateral", "surf_snow", "surf_ice", "surf_rough"]
