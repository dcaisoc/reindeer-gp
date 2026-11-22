"""Export trained networks to the bot format the leaderboard accepts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from .bot import BOT_FORMAT, BOT_VERSION, InvalidBot, validate_bot


def bot_from_layers(inputs: Sequence[str], layers: Sequence[tuple[Any, Any, str]], name: str, *,
                    method: str = "imitation", trainer: str = "reindeer-sdk", **meta: Any) -> dict[str, Any]:
    """Build a bot file from (weights[out][in], bias[out], activation) per layer, and check it."""
    out_layers = []
    for w, b, act in layers:
        w = np.asarray(w, dtype=np.float64)
        b = np.asarray(b, dtype=np.float64).reshape(-1)
        if w.ndim != 2 or w.shape[0] != b.shape[0]:
            raise ValueError(f"Layer weights must be (out, in) and bias (out,); got {w.shape} and {b.shape}.")
        out_layers.append({
            "type": "dense", "in": int(w.shape[1]), "out": int(w.shape[0]), "activation": act,
            "weights": [[float(f"{v:.9g}") for v in row] for row in w],
            "bias": [float(f"{v:.9g}") for v in b],
        })
    bot = {
        "format": BOT_FORMAT, "version": BOT_VERSION, "game": "reindeer-gp",
        "inputs": list(inputs), "outputs": ["steer", "throttle"], "layers": out_layers,
        "meta": {"name": name, "method": method, "trainer": trainer, **meta},
    }
    errors, _ = validate_bot(bot)
    if errors:
        raise InvalidBot(errors)
    return bot


def from_torch(model: Any, inputs: Sequence[str], name: str, **meta: Any) -> dict[str, Any]:
    """Export a PyTorch nn.Sequential of Linear layers and ReLU/Tanh/Sigmoid activations.

    Example: nn.Sequential(nn.Linear(8, 32), nn.ReLU(), nn.Linear(32, 32), nn.ReLU(), nn.Linear(32, 2), nn.Tanh())
    """
    import torch.nn as nn  # imported here so the SDK works without PyTorch

    acts = {nn.ReLU: "relu", nn.Tanh: "tanh", nn.Sigmoid: "sigmoid", nn.Identity: "linear"}
    mods = list(model.children()) if isinstance(model, nn.Sequential) else [model]
    layers: list[tuple[Any, Any, str]] = []
    i = 0
    while i < len(mods):
        m = mods[i]
        if not isinstance(m, nn.Linear):
            raise ValueError(f"Unsupported layer {type(m).__name__}: use nn.Linear followed by nn.ReLU, nn.Tanh or nn.Sigmoid.")
        act = "linear"
        if i + 1 < len(mods) and type(mods[i + 1]) in acts:
            act = acts[type(mods[i + 1])]
            i += 1
        w = m.weight.detach().cpu().double().numpy()
        b = m.bias.detach().cpu().double().numpy() if m.bias is not None else np.zeros(w.shape[0])
        layers.append((w, b, act))
        i += 1
    return bot_from_layers(inputs, layers, name, **meta)


def save_bot(bot: dict[str, Any], path: str | Path) -> Path:
    p = Path(path)
    p.write_text(json.dumps(bot, indent=1), "utf-8")
    return p
