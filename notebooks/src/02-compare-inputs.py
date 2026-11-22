# %% [markdown]
# # 02 · Which senses matter? (and does it work on new tracks?)
#
# [![Open in Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/dcaisoc/reindeer-gp/blob/main/notebooks/02-compare-inputs.ipynb)
#
# A small, honest experiment: train the same network with different **inputs**, and from laps on one
# track versus all tracks, then race every bot on every track. No PyTorch needed: this uses the SDK's
# little numpy trainer, so the whole notebook runs in about a minute.

# %%
import importlib.util, subprocess, sys
if importlib.util.find_spec("reindeer_sdk") is None:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "git+https://github.com/dcaisoc/reindeer-gp#subdirectory=sdk"], check=True)

import numpy as np
import matplotlib.pyplot as plt
import reindeer_sdk as rgp
from reindeer_sdk.samples import sample_laps
from reindeer_sdk.train import train_mlp

# %% [markdown]
# ## The data
#
# Swap in your own laps with `rgp.load_laps("my-laps")` if you like. Here we use sample laps so the
# experiment is repeatable: 4 laps on Frosty Oval, plus 3 on each of the other tracks.

# %%
laps_p1 = sample_laps("practice-1", 4)
laps_all = laps_p1 + sample_laps("practice-2", 3) + sample_laps("practice-3", 3)
print(len(laps_p1), "laps on practice-1;", len(laps_all), "laps on all tracks")

# %% [markdown]
# ## The experiment
#
# Each row of the results is one bot. Score = lap time + 1 s per wall hit; "DNF" means it didn't finish
# within 2 minutes. The network is always 2 × 32 neurons, trained for 40 epochs with the same seed.

# %%
RAYS = [f"ray{i}" for i in range(7)]
INPUT_SETS = {
    "3 rays + speed": ["ray1", "ray3", "ray5", "speed"],
    "5 rays + speed": RAYS[1:6] + ["speed"],
    "7 rays, no speed": RAYS,
    "7 rays + speed": RAYS + ["speed"],
    "everything": RAYS + ["speed", "lateral", "surf_snow", "surf_ice", "surf_rough"],
}

results = []
for data_name, laps in [("trained on practice-1", laps_p1), ("trained on all tracks", laps_all)]:
    for set_name, inputs in INPUT_SETS.items():
        X, Y = rgp.laps_to_arrays(laps, inputs)
        bot, hist = train_mlp(X, Y, inputs, hidden=(32, 32), epochs=40, seed=0, name=set_name)
        scores = []
        for t in rgp.TRACK_IDS:
            r = rgp.evaluate_bot(rgp.load_track(t), bot).result
            scores.append(r["score"] if r["valid"] else None)
        results.append((data_name, set_name, scores))
        print(f"{data_name:<22} {set_name:<18} " + "  ".join(f"{s:6.2f}" if s else "   DNF" for s in scores))

# %%
fig, axes = plt.subplots(1, 2, figsize=(12, 4), sharey=True)
for ax, data_name in zip(axes, ["trained on practice-1", "trained on all tracks"]):
    rows = [r for r in results if r[0] == data_name]
    x = np.arange(len(rows))
    for k, t in enumerate(rgp.TRACK_IDS):
        vals = [r[2][k] if r[2][k] else 0 for r in rows]
        ax.bar(x + (k - 1) * 0.27, vals, 0.27, label=t)
    ax.set_xticks(x, [r[1] for r in rows], rotation=30, ha="right")
    ax.set_title(data_name)
axes[0].set_ylabel("score in seconds (0 = did not finish)")
axes[1].legend()
plt.tight_layout(); plt.show()

# %% [markdown]
# ## What to look for
#
# - **Does speed help?** Without it, the bot can't tell "fast towards a wall" from "slow towards a wall".
#   Is that visible in your results, or does the extra input just make learning harder with this little data?
# - **Generalisation:** compare the two charts. Bots trained only on Frosty Oval usually fail on the twisty
#   tracks they never saw. Training on varied laps helps, which is the whole story of machine learning in one bar chart.
# - These are single runs with one seed. Change `seed=` and see how much the results move: that's noise
#   you should know about before drawing conclusions.
