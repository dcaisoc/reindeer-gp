"""Draw a replay: the track from above, with the sleigh's path coloured by speed.

Needs matplotlib (`pip install matplotlib`; Colab has it). Example:

    rgp.render_replay(rgp.load_replay("lap.rgpr"), "lap.png")
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .replay import Replay
from .run import simulate_replay
from .tracks import load_track

SURFACE_COLOURS = {"ice": "#bfe3f5", "rough": "#d9c7a6", "snow": "#ffffff"}


def render_replay(replay: Replay, path: str | Path | None = None, *, track: dict[str, Any] | None = None,
                  ax: Any = None, title: str | None = None) -> Any:
    """Plot a replay. Saves a PNG if `path` is given; returns the matplotlib Axes."""
    try:
        import matplotlib.pyplot as plt
        from matplotlib.collections import LineCollection
    except ImportError as e:  # pragma: no cover
        raise ImportError("render_replay needs matplotlib: pip install matplotlib") from e

    track = track or load_track(replay.track_id)
    out = simulate_replay(track, replay, collect_frames=True)
    frames = out.frames or []

    own_fig = ax is None
    if own_fig:
        _, ax = plt.subplots(figsize=(7, 7))
    ax.set_facecolor("#eef3f7")
    for s in track.get("surfaces") or []:
        xs, ys = zip(*s["polygon"])
        ax.fill(xs, ys, color=SURFACE_COLOURS.get(s["type"], "#ddd"), zorder=1)
    for side in ("left", "right"):
        loop = track["walls"][side]
        xs, ys = zip(*(loop + loop[:1]))
        ax.plot(xs, ys, color="#28323c", lw=1.5, zorder=3)
    for i, (x1, y1, x2, y2) in enumerate(track["checkpoints"]):
        ax.plot([x1, x2], [y1, y2], color="#c0392b" if i == 0 else "#9aa5b1", lw=2 if i == 0 else 0.8, zorder=2)

    if len(frames) > 1:
        pts = [(f.x, f.y) for f in frames]
        segs = [[pts[i], pts[i + 1]] for i in range(len(pts) - 1)]
        speeds = [abs(f.speed) for f in frames[1:]]
        lc = LineCollection(segs, cmap="plasma", linewidths=2.2, zorder=4)
        lc.set_array(speeds)
        ax.add_collection(lc)
        hits = [(f.x, f.y) for prev, f in zip(frames, frames[1:]) if f.touching and not prev.touching]
        if hits:
            hx, hy = zip(*hits)
            ax.scatter(hx, hy, marker="x", color="#e74c3c", s=40, zorder=5, label="wall hit")
            ax.legend(loc="upper right")
        cb = ax.figure.colorbar(lc, ax=ax, fraction=0.04, pad=0.02)
        cb.set_label("speed (m/s)")

    r = out.game.result()
    if title is None:
        parts = replay.header.get("participants") or [{}]
        name = parts[0].get("name") or ("Your lap" if parts[0].get("kind") == "human" else "Replay")
        title = f"{name} on {track['name']}: " + (f"{r['score']:.2f} s, {r['penalties']} penalties" if r["valid"] else "did not finish")
    ax.set_title(title)
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])
    if path is not None:
        ax.figure.savefig(path, dpi=120, bbox_inches="tight")
        if own_fig:
            plt.close(ax.figure)
    return ax
