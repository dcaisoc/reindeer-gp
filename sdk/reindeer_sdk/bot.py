"""Bot files ("rgp-bot" v1): validation and deterministic inference.

Port of engine/core/bot.ts and engine/reindeer/bot-policy.ts. The server scores
bots with the TypeScript version; this one gives bit-identical results, so
`reindeer eval` shows exactly the score the leaderboard will show.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Sequence

from .config import DEFAULT_CONFIG, input_names
from .fmath import fsigmoid, ftanh
from .quant import mulberry32
from .replay import Replay
from .run import Policy, run_policy
from .sim import Observation, TrackGeometry

BOT_FORMAT = "rgp-bot"
BOT_VERSION = 1
ACTIVATIONS = ["relu", "tanh", "sigmoid", "linear"]
PARAM_CAP = 5000
MAX_INPUTS = 16
MAX_LAYERS = 6
MAX_WEIGHT = 1000
BOT_TICKS_PER_ACTION = 3  # 20 Hz decisions


class InvalidBot(ValueError):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("The bot file has problems:\n  - " + "\n  - ".join(errors))
        self.errors = errors


def _is_int(x: Any) -> bool:
    return isinstance(x, int) and not isinstance(x, bool)


def _is_num(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def count_params(layers: Sequence[dict[str, Any]]) -> int:
    return sum(l["in"] * l["out"] + l["out"] for l in layers)


def validate_bot(bot: Any, *, param_cap: int = PARAM_CAP, allowed_inputs: Sequence[str] | None = None) -> tuple[list[str], int]:
    """Check a bot file. Returns (errors, params); no errors means the server will accept it."""
    allowed = list(allowed_inputs or input_names(DEFAULT_CONFIG))
    e: list[str] = []
    if not isinstance(bot, dict):
        return ["The bot file is not a JSON object."], 0
    b = bot
    if b.get("format") != BOT_FORMAT:
        e.append(f'"format" must be "{BOT_FORMAT}".')
    if b.get("version") != BOT_VERSION:
        e.append(f'"version" must be {BOT_VERSION} (this server reads version {BOT_VERSION} bots).')
    if b.get("game") != "reindeer-gp":
        e.append('"game" must be "reindeer-gp".')
    meta = b.get("meta")
    if not isinstance(meta, dict) or not isinstance(meta.get("name"), str) or not meta["name"].strip():
        e.append("Give your bot a name in meta.name.")
    elif len(meta["name"]) > 60:
        e.append("meta.name must be at most 60 characters.")

    inputs = b.get("inputs") if isinstance(b.get("inputs"), list) else None
    if not inputs:
        e.append('"inputs" must list at least one sensor name, e.g. ["ray0", ..., "speed"].')
    else:
        if len(inputs) > MAX_INPUTS:
            e.append(f"Too many inputs: {len(inputs)} (the limit is {MAX_INPUTS}).")
        seen: set[str] = set()
        for n in inputs:
            if not isinstance(n, str) or n not in allowed:
                e.append(f'Unknown input "{n}". Available here: {", ".join(allowed)}.')
            elif n in seen:
                e.append(f'Input "{n}" is listed twice.')
            if isinstance(n, str):
                seen.add(n)
    outs = b.get("outputs")
    if not isinstance(outs, list) or outs != ["steer", "throttle"]:
        e.append('"outputs" must be exactly ["steer", "throttle"].')

    layers = b.get("layers") if isinstance(b.get("layers"), list) else None
    params = 0
    if not layers:
        e.append("The network needs at least one layer.")
    else:
        if len(layers) > MAX_LAYERS:
            e.append(f"Too many layers: {len(layers)} (the limit is {MAX_LAYERS}).")
        prev_out = len(inputs) if inputs else -1
        for i, l in enumerate(layers):
            n = i + 1
            if not isinstance(l, dict) or l.get("type") != "dense":
                e.append(f'Layer {n}: only "dense" layers are supported in version 1.')
                continue
            li, lo = l.get("in"), l.get("out")
            if not _is_int(li) or not _is_int(lo) or li < 1 or lo < 1 or li > 512 or lo > 512:
                e.append(f'Layer {n}: "in" and "out" must be whole numbers between 1 and 512.')
                continue
            if prev_out >= 0 and li != prev_out:
                e.append(f"Layer 1 expects {li} inputs but the bot lists {prev_out} inputs." if i == 0
                         else f"Layer {n} expects {li} inputs but layer {i} outputs {prev_out}.")
            prev_out = lo
            if l.get("activation") not in ACTIVATIONS:
                e.append(f"Layer {n}: activation must be one of {', '.join(ACTIVATIONS)}.")
            params += li * lo + lo
            w = l.get("weights")
            if not isinstance(w, list) or len(w) != lo or any(not isinstance(r, list) or len(r) != li for r in w):
                e.append(f'Layer {n}: "weights" must be {lo} rows of {li} numbers.')
            elif any(not _is_num(x) for r in w for x in r):
                e.append(f"Layer {n}: weights must all be finite numbers (no NaN or Infinity).")
            elif any(abs(x) > MAX_WEIGHT for r in w for x in r):
                e.append(f"Layer {n}: a weight is larger than {MAX_WEIGHT} in size.")
            bias = l.get("bias")
            if not isinstance(bias, list) or len(bias) != lo:
                e.append(f'Layer {n}: "bias" must have {lo} numbers.')
            elif any(not _is_num(x) for x in bias):
                e.append(f"Layer {n}: biases must all be finite numbers.")
            elif any(abs(x) > MAX_WEIGHT for x in bias):
                e.append(f"Layer {n}: a bias is larger than {MAX_WEIGHT} in size.")
        if prev_out != 2:
            e.append(f"The last layer must output 2 numbers (steer, throttle), not {prev_out}.")
        if params > param_cap:
            e.append(f"The network has {params} parameters; the limit is {param_cap}. Use fewer or smaller layers.")

    if not e:
        cb = CompiledBot(b)
        rand = mulberry32(20261201)
        for _ in range(256):
            x = [rand() for _ in cb.inputs]
            y = cb.forward(x)
            if not _is_num(y[0]) or not _is_num(y[1]):
                e.append("The network produces NaN or Infinity for some sensor readings. Check for exploding weights.")
                break
    return e, params


class CompiledBot:
    """A bot ready to run. forward() is the deterministic inference the server uses."""

    def __init__(self, bot: dict[str, Any]) -> None:
        self.inputs: list[str] = list(bot["inputs"])
        self.layers = [(l["in"], l["out"], l["activation"], [[float(v) for v in row] for row in l["weights"]], [float(v) for v in l["bias"]])
                       for l in bot["layers"]]
        self.params = count_params(bot["layers"])
        self.meta = bot.get("meta", {})

    def forward(self, x: Sequence[float]) -> list[float]:
        cur = list(x)
        for n_in, n_out, act, w, b in self.layers:
            nxt = []
            for o in range(n_out):
                s = 0.0
                row = w[o]
                for i in range(n_in):
                    s = s + row[i] * cur[i]
                s = s + b[o]
                if act == "relu":
                    s = s if s > 0 else 0.0
                elif act == "tanh":
                    s = ftanh(s)
                elif act == "sigmoid":
                    s = fsigmoid(s)
                nxt.append(s)
            cur = nxt
        return cur

    def policy(self) -> Policy:
        names = self.inputs

        def act(o: Observation) -> tuple[float, float]:
            y = self.forward(o.to_inputs(names))
            return y[0], y[1]

        return act


def load_bot(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text("utf-8"))


def is_trainer_architecture(bot: dict[str, Any]) -> bool:
    """Could the in-browser trainer have made this? (Beginner bracket rule.)"""
    L = bot["layers"]
    if not 1 <= len(L) <= 3:
        return False
    for l in L[:-1]:
        if l["out"] > 64 or l["activation"] not in ("relu", "tanh"):
            return False
    return L[-1]["activation"] == "tanh"


def evaluate_bot(track: Any, bot: dict[str, Any], *, check: bool = True,
                 cfg: dict[str, Any] | None = None, geo: TrackGeometry | None = None) -> Replay:
    """Race a bot for one lap, exactly as the server does. Returns the replay (result in .result).

    `track` is a track id, a twist id, or a loaded track or twist (twists bring their own config).
    """
    from .twist import course

    c = course(track)
    cfg = cfg or c.cfg
    if check:
        errors, _ = validate_bot(bot, allowed_inputs=input_names(cfg))
        if errors:
            raise InvalidBot(errors)
    cb = CompiledBot(bot)
    name = (bot.get("meta") or {}).get("name", "bot")
    return run_policy(c.track, cb.policy(), {"kind": "bot", "name": name}, cfg=cfg, ticks_per_action=BOT_TICKS_PER_ACTION,
                      geo=geo, twist=c.twist)
