"""Data loading, training, export, the environment and the CLI."""

import json

import numpy as np
import pytest

from reindeer_sdk import (Recorder, bot_from_layers, can_mirror, evaluate_bot, encode_replay, laps_to_arrays, load_laps,
                          load_track, quant, tuned_policy, validate_bot)
from reindeer_sdk.cli import main
from reindeer_sdk.env import SleighEnv
from reindeer_sdk.train import train_mlp

INPUTS = [f"ray{i}" for i in range(7)] + ["speed"]


def human_lap(track_id, seed):
    """A 60 Hz 'human' lap: the tuned driver with keyboard-like on/off steering and some hesitation."""
    t = load_track(track_id)
    rec = Recorder(t, 1, {"kind": "human", "name": "sim"})
    rand = quant.mulberry32(seed)
    act = (0, 0)
    while not rec.game.is_done():
        if rec.game.tick % 4 == 0 and rand() > 0.15:
            s, th = tuned_policy(rec.game.observe())
            act = (127 if s > 0.12 else -127 if s < -0.12 else 0, 127 if th > 0 else -127 if th < 0 else 0)
        rec.tick(act)
    return rec.to_replay()


@pytest.fixture(scope="module")
def lap_dir(tmp_path_factory):
    d = tmp_path_factory.mktemp("laps")
    for s in (1, 2, 3):
        (d / f"lap{s}.rgpr").write_bytes(encode_replay(human_lap("practice-1", s)))
    return d


def test_laps_to_arrays_and_mirror(lap_dir):
    laps = load_laps(lap_dir)
    assert len(laps) == 3
    X, Y = laps_to_arrays(laps, INPUTS)
    assert X.shape[1] == 8 and Y.shape[1] == 2 and len(X) == len(Y) > 1000
    assert np.all((X[:, :7] >= 0) & (X[:, :7] <= 1))
    Xm, Ym = laps_to_arrays(laps, INPUTS, mirror=True)
    assert len(Xm) == 2 * len(X)
    assert np.allclose(Xm[1, :7], Xm[0, 6::-1]) and Ym[1, 0] == -Ym[0, 0]
    assert not can_mirror(["ray0", "speed"])
    with pytest.raises(ValueError):
        laps_to_arrays(laps, ["ray0", "speed"], mirror=True)
    with pytest.raises(FileNotFoundError):
        load_laps(lap_dir / "missing-folder-xyz")


def test_numpy_trainer_learns_to_drive(lap_dir):
    X, Y = laps_to_arrays(load_laps(lap_dir), INPUTS)
    bot, hist = train_mlp(X, Y, INPUTS, hidden=(32, 32), epochs=30, seed=1, name="Test bot")
    assert hist.loss[-1] < hist.loss[0]
    assert validate_bot(bot)[0] == []
    r = evaluate_bot(load_track("practice-1"), bot).result
    assert r["valid"], r


def test_bot_from_layers_checks_shapes():
    w1 = np.zeros((4, 8))
    w2 = np.zeros((2, 4))
    bot = bot_from_layers(INPUTS, [(w1, np.zeros(4), "relu"), (w2, np.zeros(2), "tanh")], "Zero bot")
    assert bot["layers"][0]["in"] == 8 and bot["meta"]["trainer"] == "reindeer-sdk"
    with pytest.raises(Exception):
        bot_from_layers(INPUTS, [(np.zeros((4, 7)), np.zeros(4), "relu"), (w2, np.zeros(2), "tanh")], "Bad")


def test_validator_messages_match_the_server():
    bot = bot_from_layers(INPUTS, [(np.zeros((3, 8)), np.zeros(3), "relu"), (np.zeros((2, 3)), np.zeros(2), "tanh")], "x")
    bot["layers"][1]["in"] = 4
    bot["inputs"][0] = "radar"
    errs = validate_bot(bot)[0]
    assert any(e.startswith('Unknown input "radar". Available here: ray0, ray1') for e in errs)
    assert "Layer 2 expects 4 inputs but layer 1 outputs 3." in errs


def test_env_runs_a_lap():
    env = SleighEnv("practice-1")
    obs, _ = env.reset()
    assert obs.shape == (8,)
    total, done, info = 0.0, False, {}
    while not done:
        o = env.game.observe()
        obs, r, term, trunc, info = env.step(tuned_policy(o))
        total += r
        done = term or trunc
    assert term and info["result"]["valid"] and info["checkpoints"] == 8
    assert total > 10


def test_cli(tmp_path, capsys):
    bot = bot_from_layers(INPUTS, [(np.zeros((4, 8)), np.zeros(4), "relu"), (np.zeros((2, 4)), [0, 0.5], "tanh")], "Cruiser")
    f = tmp_path / "bot.json"
    f.write_text(json.dumps(bot))
    assert main(["validate", str(f)]) == 0
    assert main(["eval", str(f), "--track", "practice-1", "--json"]) == 0
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert out[0]["track"] == "practice-1" and out[0]["ticks"] == 7200  # goes straight at half throttle: times out
    assert main(["selftest"]) == 0
    bad = tmp_path / "bad.json"
    bad.write_text("{}")
    assert main(["validate", str(bad)]) == 1
