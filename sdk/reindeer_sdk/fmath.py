"""Deterministic maths. Line-by-line port of engine/core/fmath.ts.

Python floats are IEEE-754 doubles and +, -, *, / are correctly rounded, so
these functions give bit-identical results to the TypeScript engine as long as
the order of operations is the same. Do NOT replace them with math.sin etc.
"""

from __future__ import annotations

import math

PI = 3.141592653589793
TWO_PI = 6.283185307179586
HALF_PI = 1.5707963267948966
_INV_TWO_PI = 0.15915494309189535
_LN2 = 0.6931471805599453
_INV_LN2 = 1.4426950408889634

_S3 = -1 / 6
_S5 = 1 / 120
_S7 = -1 / 5040
_S9 = 1 / 362880
_S11 = -1 / 39916800
_S13 = 1 / 6227020800

_E2 = 1 / 2
_E3 = 1 / 6
_E4 = 1 / 24
_E5 = 1 / 120
_E6 = 1 / 720
_E7 = 1 / 5040
_E8 = 1 / 40320
_E9 = 1 / 362880
_E10 = 1 / 3628800
_E11 = 1 / 39916800


def wrap_angle(x: float) -> float:
    """Reduce an angle to [-pi, pi]."""
    k = math.floor(x * _INV_TWO_PI + 0.5)
    return x - k * TWO_PI


def fsin(x: float) -> float:
    r = wrap_angle(x)
    if r > HALF_PI:
        r = PI - r
    elif r < -HALF_PI:
        r = -PI - r
    r2 = r * r
    p = _S13
    p = p * r2 + _S11
    p = p * r2 + _S9
    p = p * r2 + _S7
    p = p * r2 + _S5
    p = p * r2 + _S3
    p = p * r2 + 1
    return p * r


def fcos(x: float) -> float:
    return fsin(x + HALF_PI)


def fexp(x: float) -> float:
    if x > 40:
        x = 40.0
    if x < -40:
        x = -40.0
    k = math.floor(x * _INV_LN2 + 0.5)
    r = x - k * _LN2
    p = _E11
    p = p * r + _E10
    p = p * r + _E9
    p = p * r + _E8
    p = p * r + _E7
    p = p * r + _E6
    p = p * r + _E5
    p = p * r + _E4
    p = p * r + _E3
    p = p * r + _E2
    p = p * r + 1
    p = p * r + 1
    scale = 1.0
    if k > 0:
        for _ in range(k):
            scale = scale * 2
    else:
        for _ in range(-k):
            scale = scale * 0.5
    return p * scale


def ftanh(x: float) -> float:
    if x > 20:
        return 1.0
    if x < -20:
        return -1.0
    e = fexp(2 * x)
    return (e - 1) / (e + 1)


def fsigmoid(x: float) -> float:
    if x > 40:
        return 1.0
    if x < -40:
        return 0.0
    return 1 / (1 + fexp(-x))
