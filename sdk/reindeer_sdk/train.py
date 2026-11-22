"""A small numpy MLP trainer (mean squared error + Adam), like the web trainer.

Handy for quick experiments without PyTorch. For anything bigger, use PyTorch
and reindeer_sdk.export.from_torch().
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Sequence

import numpy as np

from .export import bot_from_layers


@dataclass
class History:
    loss: list[float] = field(default_factory=list)
    val_loss: list[float] = field(default_factory=list)


def _act(z: np.ndarray, kind: str) -> np.ndarray:
    if kind == "relu":
        return np.maximum(z, 0)
    if kind == "tanh":
        return np.tanh(z)
    if kind == "sigmoid":
        return 1 / (1 + np.exp(-z))
    return z


def _dact(a: np.ndarray, kind: str) -> np.ndarray:
    if kind == "relu":
        return (a > 0).astype(a.dtype)
    if kind == "tanh":
        return 1 - a * a
    if kind == "sigmoid":
        return a * (1 - a)
    return np.ones_like(a)


def train_mlp(X: np.ndarray, Y: np.ndarray, inputs: Sequence[str], *, hidden: Sequence[int] = (32, 32),
              activation: str = "relu", epochs: int = 40, lr: float = 0.003, batch_size: int = 64,
              validation: float = 0.15, seed: int = 0, name: str = "numpy bot",
              on_epoch: Callable[[int, float, float | None], None] | None = None) -> tuple[dict[str, Any], History]:
    """Train a feed-forward network to copy Y from X. Returns (bot file, loss history)."""
    rng = np.random.default_rng(seed)
    sizes = [X.shape[1], *hidden, 2]
    acts = [activation] * len(hidden) + ["tanh"]
    W = [rng.normal(0, np.sqrt((2 if a == "relu" else 1) / sizes[i]), (sizes[i + 1], sizes[i])) for i, a in enumerate(acts)]
    B = [np.zeros(sizes[i + 1]) for i in range(len(acts))]
    mW = [np.zeros_like(w) for w in W]
    vW = [np.zeros_like(w) for w in W]
    mB = [np.zeros_like(b) for b in B]
    vB = [np.zeros_like(b) for b in B]
    idx = rng.permutation(len(X))
    n_val = int(len(X) * validation)
    val, tr = idx[:n_val], idx[n_val:]

    def forward(x: np.ndarray) -> list[np.ndarray]:
        out = [x]
        for w, b, a in zip(W, B, acts):
            out.append(_act(out[-1] @ w.T + b, a))
        return out

    def mse(rows: np.ndarray) -> float:
        p = forward(X[rows])[-1]
        return float(np.mean((p - Y[rows]) ** 2))  # same measure as the web trainer's loss curve

    hist = History()
    t = 0
    for ep in range(1, epochs + 1):
        rng.shuffle(tr)
        for s in range(0, len(tr), batch_size):
            rows = tr[s : s + batch_size]
            outs = forward(X[rows])
            delta = (outs[-1] - Y[rows]) / len(rows)
            t += 1
            for li in range(len(W) - 1, -1, -1):
                delta = delta * _dact(outs[li + 1], acts[li])
                gW = delta.T @ outs[li]
                gB = delta.sum(0)
                delta = delta @ W[li]
                for p, g, m, v in ((W[li], gW, mW[li], vW[li]), (B[li], gB, mB[li], vB[li])):
                    m *= 0.9
                    m += 0.1 * g
                    v *= 0.999
                    v += 0.001 * g * g
                    p -= lr * (m / (1 - 0.9**t)) / (np.sqrt(v / (1 - 0.999**t)) + 1e-8)
        hist.loss.append(mse(tr))
        vl = mse(val) if n_val else None
        if vl is not None:
            hist.val_loss.append(vl)
        if on_epoch:
            on_epoch(ep, hist.loss[-1], vl)
    bot = bot_from_layers(inputs, list(zip(W, B, acts)), name, method="imitation", trainer="reindeer-sdk-numpy",
                          training={"samples": int(len(X)), "epochs": epochs, "hidden": list(hidden)})
    return bot, hist
