"""Weekly twists ("rgp-twist" v1): a full track plus engine-config overrides.

Anywhere the SDK takes a track id you can also give a twist id (or a twist
file or dict). Example twists ship with the package; live twists you haven't
got yet are downloaded from the server (public, no token needed) and cached.

    night = rgp.load_twist("night-oval")
    rgp.evaluate_bot(night, bot)             # races with 3 headlamp rays
    rgp.input_names(rgp.twist_config(night)) # ['ray0', 'ray1', 'ray2', 'speed', ...]
"""

from __future__ import annotations

import copy
import json
import os
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from pathlib import Path
from typing import Any

from .config import DEFAULT_CONFIG
from .tracks import TRACK_IDS, load_track


def twist_config(twist: dict[str, Any] | None) -> dict[str, Any]:
    """The engine config for a twist: defaults, then its overrides (surfaces merged per property)."""
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    if not twist:
        return cfg
    for k, v in (twist.get("config") or {}).items():
        if k == "surfaces":
            for s, props in v.items():
                cfg["surfaces"][s] = {**cfg["surfaces"][s], **props}
        elif k == "rayAnglesDeg":
            cfg[k] = list(v)
        else:
            cfg[k] = v
    return cfg


def bundled_twist_ids() -> list[str]:
    d = resources.files("reindeer_sdk").joinpath("data", "twists")
    return sorted(p.name[:-5] for p in d.iterdir() if p.name.endswith(".json")) if d.is_dir() else []


def _cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "reindeer-gp" / "twists"


@lru_cache(maxsize=None)
def _load_twist_id(twist_id: str) -> dict[str, Any]:
    if twist_id in bundled_twist_ids():
        return json.loads(resources.files("reindeer_sdk").joinpath("data", "twists", f"{twist_id}.json").read_text("utf-8"))
    cached = _cache_dir() / f"{twist_id}.json"
    if cached.exists():
        return json.loads(cached.read_text("utf-8"))
    from .api import ApiError, Client  # only needed for twists not bundled

    try:
        twist = Client().twist(twist_id)
    except ApiError as e:
        raise ValueError(f'Unknown twist "{twist_id}": {e}') from None
    try:
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_text(json.dumps(twist), "utf-8")
    except OSError:
        pass
    return twist


def load_twist(source: str | Path | dict[str, Any]) -> dict[str, Any]:
    """A twist from a dict, a .json file, or an id (bundled, else downloaded from the server)."""
    if isinstance(source, dict):
        twist = source
    elif isinstance(source, Path) or str(source).endswith(".json"):
        twist = json.loads(Path(source).read_text("utf-8"))
    else:
        twist = _load_twist_id(str(source))
    if twist.get("format") != "rgp-twist":
        raise ValueError("That is not a twist file (format must be \"rgp-twist\").")
    return twist


@dataclass
class Course:
    """Everything needed to race: the track, the engine config, and the twist (if any)."""

    id: str
    name: str
    track: dict[str, Any]
    cfg: dict[str, Any]
    twist: dict[str, str] | None  # {"id", "version"} as written into replays


def course(x: str | Path | dict[str, Any]) -> Course:
    """Resolve a track id, twist id, track dict or twist dict/file into a Course."""
    if isinstance(x, dict) and x.get("format") == "rgp-track":
        return Course(x["id"], x["name"], x, copy.deepcopy(DEFAULT_CONFIG), None)
    if isinstance(x, str) and x in TRACK_IDS:
        t = load_track(x)
        return Course(t["id"], t["name"], t, copy.deepcopy(DEFAULT_CONFIG), None)
    w = load_twist(x)
    return Course(w["id"], w["name"], w["track"], twist_config(w), {"id": w["id"], "version": w["twistVersion"]})


def course_of_replay(replay: Any) -> Course:
    """The course a replay was recorded on, from its header."""
    tw = replay.header.get("twist")
    if not tw:
        return course(replay.track_id)
    c = course(tw["id"])
    if c.twist and c.twist["version"] != tw["version"]:
        raise ValueError(f'Replay is for twist {tw["id"]} version {tw["version"]}, but version {c.twist["version"]} is loaded.')
    return c
