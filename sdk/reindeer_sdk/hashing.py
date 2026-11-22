"""FNV-1a 64-bit state hash. Port of engine/core/hash.ts."""

from __future__ import annotations

import struct

_FNV_OFFSET = 0xCBF29CE484222325
_FNV_PRIME = 0x100000001B3
_MASK = 0xFFFFFFFFFFFFFFFF


class StateHasher:
    def __init__(self) -> None:
        self.h = _FNV_OFFSET

    def _bytes(self, data: bytes) -> None:
        h = self.h
        for b in data:
            h = ((h ^ b) * _FNV_PRIME) & _MASK
        self.h = h

    def f64(self, x: float) -> "StateHasher":
        # Normalise -0.0 to +0.0, like the TypeScript engine.
        self._bytes(struct.pack("<d", 0.0 if x == 0 else float(x)))
        return self

    def i32(self, x: int) -> "StateHasher":
        self._bytes(struct.pack("<i", int(x)))
        return self

    def hex(self) -> str:
        return format(self.h, "016x")
