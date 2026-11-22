"""Many sleighs at once: a batched version of SleighEnv for faster training loops.

    env = VecSleighEnv(["practice-1", "night-oval"] * 4)       # 8 sleighs (tracks or twists)
    obs = env.reset()                                          # shape (8, n_inputs)
    obs, rewards, dones, infos = env.step(actions)             # actions shape (8, 2)

Finished sleighs restart on their own (the final observation is in
infos[i]["final_obs"]), as in Stable-Baselines3's VecEnv. The physics is pure
Python, so this batches the bookkeeping, not the maths: expect roughly
10,000 decisions per second per core on a laptop. For more, run several processes.
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np

from .env import DEFAULT_INPUTS, SleighEnv


class VecSleighEnv:
    def __init__(self, tracks: Sequence[str | dict[str, Any]], inputs: Sequence[str] = DEFAULT_INPUTS,
                 cfg: dict[str, Any] | None = None) -> None:
        if not tracks:
            raise ValueError("Give at least one track.")
        self.envs = [SleighEnv(t, inputs, cfg) for t in tracks]
        # Share wall geometry between sleighs on the same track (it is read-only).
        geos: dict[str, Any] = {}
        for e in self.envs:
            e.geo = geos.setdefault(e.track["id"], e.geo)
        self.num_envs = len(self.envs)
        self.inputs = list(inputs)

    def reset(self) -> np.ndarray:
        return np.stack([e.reset()[0] for e in self.envs])

    def step(self, actions: Any) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[dict[str, Any]]]:
        a = np.asarray(actions, dtype=np.float64).reshape(self.num_envs, 2)
        obs, rew, done, infos = [], np.zeros(self.num_envs), np.zeros(self.num_envs, dtype=bool), []
        for i, e in enumerate(self.envs):
            o, r, term, trunc, info = e.step(a[i])
            if term or trunc:
                info["final_obs"] = o
                o, _ = e.reset()
            obs.append(o)
            rew[i] = r
            done[i] = term or trunc
            infos.append(info)
        return np.stack(obs), rew, done, infos
