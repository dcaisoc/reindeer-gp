# Python SDK

The `reindeer-sdk` package is a line-by-line Python port of the official engine. It produces **bit-identical** results to the server: `reindeer eval` shows exactly the score the leaderboard will show. It needs Python 3.10+ and numpy; PyTorch and Gymnasium are optional.

```sh
pip install "git+https://github.com/dcaisoc/reindeer-gp#subdirectory=sdk"
# with extras:  pip install "reindeer-sdk[torch] @ git+https://github.com/dcaisoc/reindeer-gp#subdirectory=sdk"
reindeer selftest     # proves your installation matches the official engine
```

## The command line

| Command | What it does |
| --- | --- |
| `reindeer tracks` | List the tracks. |
| `reindeer validate my-bot.json` | Check a bot file with the server's exact rules. |
| `reindeer eval my-bot.json [--track practice-2] [--save-replay out.rgpr] [--json]` | Race a bot locally on every track (or one). |
| `reindeer replay lap.rgpr` | Show a replay's details and verify it by re-simulating. |
| `reindeer login` | Save your API token (create one on your **Team** page in the web app). |
| `reindeer submit my-bot.json [--track practice-2]` | Submit to the leaderboard and wait for the scores. |
| `reindeer status <submission id>` | Check a submission. |
| `reindeer selftest` | Re-run the 17 golden traces and check every state hash. |

Settings: `REINDEER_TOKEN` and `REINDEER_URL` environment variables override the saved login, which lives in `~/.config/reindeer-gp/config.json` (or `REINDEER_CONFIG`).

## Weekly twists

Anywhere a track id goes, a twist id works too: `reindeer eval bot.json --track night-oval`, `rgp.evaluate_bot("night-oval", bot)`, `rgp.SleighEnv("ice-hairpins")`, `sample_laps("night-oval")`. Example twists ship with the package; live ones are downloaded from the server the first time and cached. `reindeer tracks` lists both.

```python
night = rgp.course("night-oval")            # .track, .cfg (engine settings), .twist
rgp.input_names(night.cfg)                  # ['ray0', 'ray1', 'ray2', 'speed', 'lateral', ...]
X, Y = rgp.laps_to_arrays(laps, ["ray0", "ray1", "ray2", "speed"])  # laps driven on the twist
```

## From laps to a bot in Python

```python
import reindeer_sdk as rgp

laps = rgp.load_laps("my-laps")                       # .rgpr files from Driving data → Download
INPUTS = [f"ray{i}" for i in range(7)] + ["speed"]
X, Y = rgp.laps_to_arrays(laps, INPUTS)               # sensors → (steer, throttle), at 20 Hz

# … train anything you like on X, Y, then export:
bot = rgp.from_torch(model, INPUTS, name="My bot")    # a torch.nn.Sequential of Linear + ReLU/Tanh/Sigmoid
# or: rgp.bot_from_layers(INPUTS, [(W1, b1, "relu"), (W2, b2, "tanh")], name="My bot")

print(rgp.evaluate_bot(rgp.load_track("practice-1"), bot).result)
rgp.save_bot(bot, "my-bot.json")
```

No PyTorch? `reindeer_sdk.train.train_mlp(X, Y, INPUTS, hidden=(32, 32))` is a small numpy trainer that returns a bot directly.

## Reference

**Tracks and the engine**

- `TRACK_IDS`, `list_tracks()`, `load_track(id)`: the bundled tracks.
- `ReindeerGame(track, config, geometry)`: the simulation. `step((steer, throttle))` advances one 60 Hz tick with int8 actions (−127…127); `observe()` returns an `Observation` with `rays`, `speed`, `lateral`, `surface` and `to_inputs(names)`; `is_done()`, `result()`, `state_hash()`.
- `TrackGeometry(track)`: walls, ray casting; reuse it across many races for speed.
- `DEFAULT_CONFIG`, `make_config(**overrides)`, `input_names()`, `ENGINE_VERSION`.
- `load_twist(id_or_file)`, `twist_config(twist)`, `course(id)` → `Course(track, cfg, twist)`, `bundled_twist_ids()`.

**Bots**

- `validate_bot(bot) → (errors, params)`, `count_params(layers)`, `InvalidBot`.
- `CompiledBot(bot).forward(inputs) → (steer, throttle)`.
- `evaluate_bot(track, bot) → Replay`: the official scoring run; `.result` has `valid`, `score`, `ticks`, `penalties`.
- `bot_from_layers`, `from_torch`, `load_bot`, `save_bot`, `is_trainer_architecture`.

**Replays and data**

- `load_replay`, `decode_replay`, `encode_replay`, `simulate_replay`, `Recorder`.
- `load_laps(folder)`, `laps_to_arrays(laps, inputs, mirror=False)`, `can_mirror(track)`, `extract_training_pairs`.
- `reindeer_sdk.samples.sample_laps(track_id, n)`: laps from a simulated human driver, for trying things out.
- `run_policy(track, policy)`, `baseline_policy`, `tuned_policy`: drive with any Python function of the observation.

**Reinforcement learning**

`reindeer_sdk.env.SleighEnv(track_id, inputs)` is a Gymnasium-style environment: `reset(seed) → (obs, info)` and `step(action) → (obs, reward, terminated, truncated, info)`, deciding at 20 Hz like submitted bots. Reward: +1 per checkpoint, +10 for finishing, −1 per wall hit, −0.01 per step. Shape your own reward from `info` if you prefer.

`reindeer_sdk.VecSleighEnv(tracks, inputs)` runs a batch of sleighs (for example `["practice-1", "practice-2"] * 8`): `reset() → obs[n, inputs]`, `step(actions[n, 2]) → (obs, rewards, dones, infos)`, restarting finished sleighs automatically like Stable-Baselines3's VecEnv. Expect about 10,000 decisions a second per core.

**Seeing what happened**

`render_replay(replay, "lap.png")` draws the track from above with the sleigh's path coloured by speed and wall hits marked (needs matplotlib). To watch a replay move, import the `.rgpr` file in the web app under **Driving data**.

**Talking to the server**

`reindeer_sdk.api.Client(url=None, token=None)`: `me()`, `validate(bot)`, `submit(bot, tracks=None)`, `submission(id)`, `wait(id)`, `board(track, kind="bots")`, `twists()`, `twist(id)`. Errors raise `ApiError` with a plain-English message.
