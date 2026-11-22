"""The public tracks, bundled with the package (copied from tracks/*.json)."""

from __future__ import annotations

import json
from functools import lru_cache
from importlib import resources
from pathlib import Path
from typing import Any

TRACK_IDS = ["practice-1", "practice-2", "practice-3"]


@lru_cache(maxsize=None)
def load_track(track_id: str) -> dict[str, Any]:
    """Load a bundled track by id, e.g. load_track("practice-1")."""
    if track_id not in TRACK_IDS:
        raise ValueError(f'Unknown track "{track_id}". Available: {", ".join(TRACK_IDS)}.')
    text = resources.files("reindeer_sdk").joinpath("data", "tracks", f"{track_id}.json").read_text("utf-8")
    return json.loads(text)


def load_track_file(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text("utf-8"))


def list_tracks() -> list[dict[str, Any]]:
    return [{k: load_track(t)[k] for k in ("id", "name", "difficulty", "description")} for t in TRACK_IDS]
