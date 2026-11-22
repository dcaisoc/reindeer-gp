"""Replay files ("rgp-replay" v1). Port of engine/core/replay.ts.

A replay stores inputs (int8 steer/throttle pairs), not positions; positions
are recomputed by re-simulating. Layout of a .rgpr file:

    b"RGPR" + version byte (1) + zlib( uint32-LE header length + JSON header + int8 actions )
"""

from __future__ import annotations

import json
import struct
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPLAY_FORMAT = "rgp-replay"
REPLAY_VERSION = 1
_MAGIC = b"RGPR"


class ReplayFormatError(ValueError):
    pass


@dataclass
class Replay:
    header: dict[str, Any]
    #: Interleaved int8 pairs: [steer0, throttle0, steer1, throttle1, ...]
    actions: list[int] = field(default_factory=list)

    @property
    def track_id(self) -> str:
        return self.header["track"]["id"]

    @property
    def ticks_per_action(self) -> int:
        return int(self.header["ticksPerAction"])

    @property
    def result(self) -> dict[str, Any]:
        return self.header["result"]

    def pairs(self) -> list[tuple[int, int]]:
        a = self.actions
        return [(a[i], a[i + 1]) for i in range(0, len(a), 2)]


def _validate_header(h: Any) -> None:
    if not isinstance(h, dict) or h.get("format") != REPLAY_FORMAT:
        raise ReplayFormatError("Replay header has the wrong format name.")
    if h.get("version") != REPLAY_VERSION:
        raise ReplayFormatError("Replay header has an unsupported version.")
    if not isinstance(h.get("track"), dict) or not isinstance(h["track"].get("id"), str):
        raise ReplayFormatError("Replay header has no track.")
    tpa = h.get("ticksPerAction")
    if not isinstance(tpa, int) or not 1 <= tpa <= 60:
        raise ReplayFormatError("Replay header has an invalid ticksPerAction.")


def decode_replay(data: bytes) -> Replay:
    if len(data) < 6 or data[:4] != _MAGIC:
        raise ReplayFormatError("Not a Reindeer Grand Prix replay file (missing RGPR header).")
    if data[4] != REPLAY_VERSION:
        raise ReplayFormatError(f"Replay format version {data[4]} is not supported (expects {REPLAY_VERSION}).")
    try:
        payload = zlib.decompress(data[5:])
    except zlib.error as e:
        raise ReplayFormatError("Replay file is corrupted (could not decompress).") from e
    if len(payload) < 4:
        raise ReplayFormatError("Replay file is truncated.")
    (n,) = struct.unpack_from("<I", payload, 0)
    if 4 + n > len(payload):
        raise ReplayFormatError("Replay header length is wrong.")
    try:
        header = json.loads(payload[4 : 4 + n].decode("utf-8"))
    except ValueError as e:
        raise ReplayFormatError("Replay header is not valid JSON.") from e
    _validate_header(header)
    raw = payload[4 + n :]
    if len(raw) % 2:
        raise ReplayFormatError("Replay action stream has an odd length.")
    actions = list(struct.unpack(f"<{len(raw)}b", raw))
    return Replay(header, actions)


def encode_replay(r: Replay) -> bytes:
    header = json.dumps(r.header, separators=(",", ":")).encode("utf-8")
    body = struct.pack("<I", len(header)) + header + struct.pack(f"<{len(r.actions)}b", *r.actions)
    return _MAGIC + bytes([REPLAY_VERSION]) + zlib.compress(body, 9)


def load_replay(path: str | Path) -> Replay:
    """Load a .rgpr file (or the JSON twin used by the golden traces)."""
    p = Path(path)
    data = p.read_bytes()
    if data[:1] == b"{":
        return replay_from_json(json.loads(data))
    return decode_replay(data)


def replay_from_json(j: dict[str, Any]) -> Replay:
    j = dict(j)
    pairs = j.pop("actions")
    _validate_header(j)
    flat: list[int] = []
    for s, t in pairs:
        flat += [int(s), int(t)]
    return Replay(j, flat)


def replay_to_json(r: Replay) -> dict[str, Any]:
    return {**r.header, "actions": [list(p) for p in r.pairs()]}
