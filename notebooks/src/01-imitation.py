# %% [markdown]
# # 01 · Teach a network to drive like you (PyTorch)
#
# [![Open in Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/dcaisoc/reindeer-gp/blob/main/notebooks/01-imitation.ipynb)
#
# This is the **Reindeer** level: the same idea as the in-browser trainer, but in Python, so you can change anything.
#
# 1. Load your recorded laps.
# 2. Turn them into a table: *what the sensors saw* → *what you did*.
# 3. Train a small neural network (PyTorch) to copy you.
# 4. Race it on all three tracks, **with exactly the score the leaderboard will give**.
# 5. Submit it.
#
# Run each cell with **Shift+Enter**. Nothing here can break the competition, so experiment freely.

# %%
# Setup: install the Reindeer Grand Prix SDK if needed (about 20 s on Colab).
import importlib.util, subprocess, sys
if importlib.util.find_spec("reindeer_sdk") is None:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "git+https://github.com/dcaisoc/reindeer-gp#subdirectory=sdk"], check=True)

import numpy as np
import matplotlib.pyplot as plt
import reindeer_sdk as rgp
from reindeer_sdk.cli import main as reindeer

print("reindeer-sdk", rgp.__version__)
reindeer(["selftest"]);  # proves this computer scores bots exactly like the leaderboard

# %% [markdown]
# ## 1. Your laps
#
# In the web app, open **Driving data** and click **Download** on your best laps (`.rgpr` files).
# On Colab, run the next cell and upload them (or click *Cancel* to use sample laps).
# On your own computer, put them in a folder called `my-laps` next to this notebook.

# %%
from pathlib import Path
LAPS = Path("my-laps")
LAPS.mkdir(exist_ok=True)
try:
    from google.colab import files  # only exists on Colab
    for name, data in files.upload().items():
        (LAPS / name).write_bytes(data)
except ImportError:
    print("Not on Colab: copy your .rgpr files into", LAPS.resolve())

# %%
TRACK = "practice-1"
if any(LAPS.glob("*.rgpr")):
    laps = rgp.load_laps(LAPS)
    print(f"Loaded {len(laps)} of your laps.")
else:
    from reindeer_sdk.samples import sample_laps
    laps = sample_laps(TRACK, 4)
    print("No laps found, so using 4 sample laps from a simulated driver. Your own laps are better!")
for lap in laps:
    r = lap.result
    print(f"  {lap.track_id}: {r['score']:.2f} s, {r['penalties']} penalties" if r["valid"] else f"  {lap.track_id}: did not finish")

# %% [markdown]
# ## 2. From laps to a table
#
# A replay stores only your key presses. `laps_to_arrays` re-drives each lap with the official engine and,
# 20 times a second (the rate bots decide at), writes down:
#
# - **X**: the sensor readings: 7 distance rays (0 = touching a wall, 1 = 40 m or more of space) and your speed;
# - **Y**: what you did: steering and throttle, each between −1 and 1.

# %%
INPUTS = [f"ray{i}" for i in range(7)] + ["speed"]
X, Y = rgp.laps_to_arrays(laps, INPUTS)
print("X:", X.shape, "  Y:", Y.shape)
print("first moment:", dict(zip(INPUTS, X[0].round(2))), "→ steer, throttle =", Y[0].round(2))

# %%
# What does your driving look like? Steering against "how much more room is on the right than the left".
room_right = X[:, 5] - X[:, 1]
fig, ax = plt.subplots(1, 2, figsize=(11, 3.5))
ax[0].scatter(room_right, Y[:, 0], s=3, alpha=0.3)
ax[0].set_xlabel("room on the right − room on the left"); ax[0].set_ylabel("your steering")
ax[1].hist(Y[:, 1], bins=21); ax[1].set_xlabel("your throttle (−1 brake … 1 full)")
plt.tight_layout(); plt.show()

# %% [markdown]
# ## 3. Train a network
#
# Two hidden layers of 32 neurons, like the web trainer's *Recommended* setting. The final `Tanh` keeps
# outputs between −1 and 1. We hold back 15% of the moments to check the network is **learning** your
# driving rather than **memorising** it (if the orange line rises while the blue falls, it's memorising).

# %%
import torch
import torch.nn as nn

torch.manual_seed(0)
model = nn.Sequential(
    nn.Linear(len(INPUTS), 32), nn.ReLU(),
    nn.Linear(32, 32), nn.ReLU(),
    nn.Linear(32, 2), nn.Tanh(),
)
Xt = torch.tensor(X, dtype=torch.float32)
Yt = torch.tensor(Y, dtype=torch.float32)
perm = torch.randperm(len(Xt))
n_val = len(Xt) * 15 // 100
val, train = perm[:n_val], perm[n_val:]

opt = torch.optim.Adam(model.parameters(), lr=3e-3)
loss_fn = nn.MSELoss()
history = []
for epoch in range(60):
    model.train()
    for batch in train[torch.randperm(len(train))].split(64):
        opt.zero_grad()
        loss = loss_fn(model(Xt[batch]), Yt[batch])
        loss.backward()
        opt.step()
    model.eval()
    with torch.no_grad():
        history.append((loss_fn(model(Xt[train]), Yt[train]).item(), loss_fn(model(Xt[val]), Yt[val]).item()))

plt.plot([h[0] for h in history], label="error on practice moments")
plt.plot([h[1] for h in history], label="error on held-back moments")
plt.xlabel("epoch"); plt.ylabel("mean squared error"); plt.legend(); plt.show()

# %% [markdown]
# ## 4. Race it
#
# `from_torch` turns the network into a bot file and checks it with the server's rules.
# `evaluate_bot` races it with the official engine: these are the times the leaderboard will show.

# %%
bot = rgp.from_torch(model, INPUTS, name="My PyTorch bot")
print(f"{rgp.count_params(bot['layers'])} parameters (limit 5,000)")
for t in rgp.TRACK_IDS:
    r = rgp.evaluate_bot(rgp.load_track(t), bot).result
    print(f"{t:<12} " + (f"{r['score']:.2f} s ({r['penalties']} penalties)" if r["valid"] else "did not finish"))
rgp.save_bot(bot, "my-bot.json")

# %%
# Where does it slow down, and where does it hit walls? (red crosses)
rep = rgp.evaluate_bot(rgp.load_track(TRACK), bot)
rgp.render_replay(rep); plt.show()
# To watch it move: save the replay and open it in the web app (Driving data → Import replay files).
Path("my-bot-replay.rgpr").write_bytes(rgp.encode_replay(rep))

# %% [markdown]
# ## 5. Submit
#
# Create an **API token** on your Team page in the web app, set `SUBMIT = True`, run the cell and paste it.
# (From a terminal you can instead run `reindeer login` once, then `reindeer submit my-bot.json`.)

# %%
SUBMIT = False
if SUBMIT:
    from getpass import getpass
    from reindeer_sdk.api import Client
    client = Client(token=getpass("API token: "))
    for s in client.submit(bot):
        done = client.wait(s["id"])
        print(s["trackId"], done["status"], done.get("result"))

# %% [markdown]
# ## Things to try
#
# - **Bigger or smaller brain:** change the 32s, or add a layer. When does it stop helping?
# - **Fewer senses:** try `INPUTS = ["ray1", "ray3", "ray5", "speed"]`. What breaks first?
# - **More data:** drive laps on other tracks and train on all of them. Does it get better at tracks it never saw?
# - **Mirroring:** `rgp.laps_to_arrays(laps, INPUTS, mirror=True)` adds every moment flipped left-right.
# - **Your own loss:** penalise braking, or weight steering errors more than throttle errors.
# - Notebook **02** compares sensor choices systematically; **03** learns to drive with no laps at all.
