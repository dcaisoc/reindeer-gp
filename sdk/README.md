# reindeer-sdk

The official [Reindeer Grand Prix](https://github.com/dcaisoc/reindeer-gp) engine in Python, plus tools to train, evaluate and submit bots.

```sh
pip install reindeer-sdk            # or, before the first PyPI release:
pip install "git+https://github.com/dcaisoc/reindeer-gp#subdirectory=sdk"
reindeer selftest                   # proves your machine scores exactly like the leaderboard
```

```python
from reindeer_sdk import load_laps, laps_to_arrays, evaluate_bot, load_track
from reindeer_sdk.train import train_mlp

laps = load_laps("my-laps/")                          # .rgpr files downloaded from Driving data
inputs = ["ray0", "ray1", "ray2", "ray3", "ray4", "ray5", "ray6", "speed"]
X, Y = laps_to_arrays(laps, inputs)                   # sensors -> what you did
bot, history = train_mlp(X, Y, inputs, name="My bot")  # or PyTorch + reindeer_sdk.from_torch
print(evaluate_bot(load_track("practice-1"), bot).result)
```

Command line: `reindeer tracks`, `reindeer validate bot.json`, `reindeer eval bot.json`, `reindeer login`, `reindeer submit bot.json`.

Notebooks and full documentation: <https://dcaisoc.github.io/reindeer-gp/>.
