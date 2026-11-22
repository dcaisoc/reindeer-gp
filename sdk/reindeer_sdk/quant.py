"""Action quantisation and the seeded PRNG. Port of engine/core/quant.ts."""

from __future__ import annotations

import math
from typing import Callable

_U32 = 0xFFFFFFFF


def quantise(v: float) -> int:
    """Map a value in [-1, 1] to an int in -127..127 (exactly like the engine)."""
    if v != v:  # NaN
        return 0
    c = -1.0 if v < -1 else 1.0 if v > 1 else float(v)
    return math.floor(c * 127 + 0.5)


def dequantise(q: int) -> float:
    return q / 127


def _imul(a: int, b: int) -> int:
    return (a * b) & _U32


def mulberry32(seed: int) -> Callable[[], float]:
    """Same sequence as the TypeScript mulberry32."""
    state = [seed & _U32]

    def nxt() -> float:
        a = (state[0] + 0x6D2B79F5) & _U32
        state[0] = a
        t = a
        t = _imul(t ^ (t >> 15), t | 1)
        t = (t ^ ((t + _imul(t ^ (t >> 7), t | 61)) & _U32)) & _U32
        return ((t ^ (t >> 14)) & _U32) / 4294967296

    return nxt
