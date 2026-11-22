"""Turn recorded laps into training arrays (what the in-browser trainer does)."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Sequence

import numpy as np

from .replay import Replay, load_replay
from .run import extract_training_pairs
from .twist import course_of_replay


def load_laps(*paths: str | Path) -> list[Replay]:
    """Load .rgpr files. Pass files or folders (every .rgpr inside is loaded)."""
    out: list[Replay] = []
    for p in paths:
        p = Path(p)
        files = sorted(p.glob("*.rgpr")) if p.is_dir() else [p]
        for f in files:
            out.append(load_replay(f))
    if not out:
        raise FileNotFoundError(f"No .rgpr laps found in {', '.join(map(str, paths))}. Download laps from Driving data in the web app.")
    return out


def mirror_name(name: str, ray_count: int = 7) -> str:
    return f"ray{ray_count - 1 - int(name[3:])}" if name.startswith("ray") else name


def can_mirror(inputs: Sequence[str], ray_count: int = 7) -> bool:
    return all(mirror_name(n, ray_count) in inputs for n in inputs)


def laps_to_arrays(laps: Iterable[Replay], inputs: Sequence[str], *, mirror: bool = False,
                   decision_ticks: int = 3) -> tuple[np.ndarray, np.ndarray]:
    """X: one row of sensor readings per decision (20 Hz); Y: what the driver did (steer, throttle) in [-1, 1].

    With mirror=True every moment is also added flipped left-right (needs symmetric inputs).
    """
    inputs = list(inputs)
    xs: list[list[float]] = []
    ys: list[tuple[float, float]] = []
    for lap in laps:
        c = course_of_replay(lap)
        rays = len(c.cfg["rayAnglesDeg"])
        do_mirror = mirror and can_mirror(inputs, rays)
        if mirror and not do_mirror:
            raise ValueError(f"Mirroring needs matching left and right sensors (e.g. ray0 and ray{rays - 1}).")
        idx = [inputs.index(mirror_name(n, rays)) for n in inputs] if do_mirror else []
        obs, acts = extract_training_pairs(c.track, lap, decision_ticks, c.cfg)
        for o, a in zip(obs, acts):
            row = o.to_inputs(inputs)
            xs.append(row)
            ys.append(a)
            if do_mirror:
                xs.append([(-row[idx[k]] if inputs[k] == "lateral" else row[idx[k]]) for k in range(len(inputs))])
                ys.append((-a[0], a[1]))
    return np.asarray(xs, dtype=np.float64), np.asarray(ys, dtype=np.float64)
