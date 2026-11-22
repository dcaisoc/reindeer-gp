# %% [markdown]
# # 03 · Learning to drive with no laps at all: neuroevolution
#
# [![Open in Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/dcaisoc/reindeer-gp/blob/main/notebooks/03-neuroevolution.ipynb)
#
# This is a **Santa**-level starting point. Instead of copying a human, we **evolve** networks:
#
# 1. make a population of random networks;
# 2. race each one and give it a **fitness** score;
# 3. keep the best, make mutated copies, repeat.
#
# No gradients, no laps: just survival of the fastest sleigh. It takes about two minutes to run.

# %%
import importlib.util, subprocess, sys
if importlib.util.find_spec("reindeer_sdk") is None:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "git+https://github.com/dcaisoc/reindeer-gp#subdirectory=sdk"], check=True)

import time
import numpy as np
import matplotlib.pyplot as plt
import reindeer_sdk as rgp
from reindeer_sdk.bot import CompiledBot
from reindeer_sdk.quant import quantise

# %% [markdown]
# ## A network as a list of numbers
#
# Evolution works on a flat vector of weights. These helpers turn a vector into a bot file and back.
# The network is small on purpose (8 → 12 → 2, 134 numbers), so evolution can search it quickly.

# %%
INPUTS = [f"ray{i}" for i in range(7)] + ["speed"]
SIZES = [len(INPUTS), 12, 2]
SHAPES = [(SIZES[i + 1], SIZES[i]) for i in range(len(SIZES) - 1)]
N_PARAMS = sum(o * i + o for o, i in SHAPES)

def to_bot(vec, name="evolved"):
    layers, k = [], 0
    for li, (o, i) in enumerate(SHAPES):
        w = vec[k:k + o * i].reshape(o, i); k += o * i
        b = vec[k:k + o]; k += o
        layers.append((w, b, "tanh"))
    return rgp.bot_from_layers(INPUTS, layers, name, method="neuroevolution", trainer="notebook-03")

print(N_PARAMS, "numbers per network")

# %% [markdown]
# ## Fitness: what "good driving" means
#
# This is the most important design decision in the notebook. Ours rewards **progress first**
# (100 points per checkpoint), then **speed** once it finishes, and punishes wall hits.
# To keep evolution quick, each race stops after 40 seconds. Try changing it!

# %%
TRACKS = [rgp.load_track(t) for t in ["practice-1", "practice-2"]]
GEOS = [rgp.TrackGeometry(t) for t in TRACKS]
CFG = rgp.make_config(timeoutTicks=40 * 60)

def race(bot, track, geo):
    g = rgp.ReindeerGame(track, CFG, geo)
    cb = CompiledBot(bot)
    act = (0, 0)
    while not g.is_done():
        if g.tick % 3 == 0:
            s, t = cb.forward(g.observe().to_inputs(INPUTS))
            act = (quantise(s), quantise(t))
        g.step(act)
    return g

def fitness(vec):
    bot = to_bot(vec)
    total = 0.0
    for track, geo in zip(TRACKS, GEOS):
        g = race(bot, track, geo)
        total += 100 * len(g.events.splits) - 20 * g.penalties
        if g.finished:
            total += 1000 - 10 * (g.tick / 60)
    return total

# %% [markdown]
# ## Evolve
#
# Each generation keeps the 6 best networks (the *elite*) and fills the rest with mutated copies of them.
# The mutation size shrinks over time, from exploring to fine-tuning.

# %%
rng = np.random.default_rng(0)
POP, ELITE, GENERATIONS = 24, 6, 12
population = [rng.normal(0, 0.5, N_PARAMS) for _ in range(POP)]
best_per_gen, start = [], time.time()
for gen in range(GENERATIONS):
    scores = np.array([fitness(v) for v in population])
    order = np.argsort(-scores)
    elite = [population[i] for i in order[:ELITE]]
    best_per_gen.append(scores[order[0]])
    print(f"generation {gen + 1:2d}: best fitness {scores[order[0]]:7.1f}, median {np.median(scores):7.1f}  ({time.time() - start:.0f} s)")
    sigma = 0.3 * (1 - gen / GENERATIONS) + 0.03
    population = elite + [elite[rng.integers(ELITE)] + rng.normal(0, sigma, N_PARAMS) for _ in range(POP - ELITE)]
best = elite[0]

plt.plot(range(1, GENERATIONS + 1), best_per_gen, marker="o")
plt.xlabel("generation"); plt.ylabel("best fitness"); plt.show()

# %% [markdown]
# ## How good is it, officially?
#
# `evaluate_bot` races with the real 2-minute limit on every track, exactly like the leaderboard.
# Practice-3 was never used during evolution: a fair test of whether it learned to *drive* or just
# learned two tracks.

# %%
bot = to_bot(best, name="Evolved sleigh")
for t in rgp.TRACK_IDS:
    r = rgp.evaluate_bot(rgp.load_track(t), bot).result
    print(f"{t:<12} " + (f"{r['score']:.2f} s ({r['penalties']} penalties)" if r["valid"] else f"did not finish ({r['ticks'] / 60:.0f} s)"))
rgp.save_bot(bot, "evolved-bot.json")
rgp.render_replay(rgp.evaluate_bot(rgp.load_track("practice-3"), bot)); plt.show()

# %% [markdown]
# ## Where to go from here
#
# - **More generations / bigger population:** slower, usually better. Let it run while you have lunch.
# - **Start from imitation:** use the weights of a bot from notebook 01 as generation zero (match the sizes).
# - **A better fitness:** reward distance along the track between checkpoints; punish slow laps harder.
# - **Proper reinforcement learning:** `reindeer_sdk.env.SleighEnv` is a Gymnasium-style environment
#   (reset/step) for PPO, SAC and friends, and `rgp.VecSleighEnv` races many sleighs in one batch. Export with `rgp.bot_from_layers` or `rgp.from_torch`.
# - Whatever you build, submit it with `reindeer submit evolved-bot.json`.
