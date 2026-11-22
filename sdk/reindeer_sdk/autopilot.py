"""Rule-based drivers. Port of engine/reindeer/autopilot.ts."""

from __future__ import annotations

import math

from .sim import Observation


def baseline_policy(o: Observation) -> tuple[float, float]:
    """The baseline: finishes, but is deliberately not fast."""
    r = o.rays
    last = len(r) - 1
    mid = (len(r) - 1) / 2
    left = 0.0
    right = 0.0
    i = 0
    while i < mid:
        left += r[i] * (1 + i)
        i += 1
    i = last
    while i > mid:
        right += r[i] * (1 + last - i)
        i -= 1
    steer = (right - left) * 1.2
    if steer > 1:
        steer = 1.0
    if steer < -1:
        steer = -1.0
    front = r[math.floor(mid)]
    target = 0.2 + 0.55 * front
    throttle = 1.0 if o.speed < target else -0.5
    return steer, throttle


def tuned_policy(o: Observation) -> tuple[float, float]:
    """A stronger hand-written driver, to show there is headroom."""
    r = o.rays
    steer = (r[4] - r[2]) * 2.2 + (r[5] - r[1]) * 1.2 + (r[6] - r[0]) * 0.5
    if steer > 1:
        steer = 1.0
    if steer < -1:
        steer = -1.0
    look = (r[2] + r[4]) * 0.75
    if r[3] < look:
        look = r[3]
    target = 0.3 + 0.75 * look
    throttle = 1.0 if o.speed < target else -1.0 if o.speed > target + 0.08 else 0.2
    return steer, throttle
