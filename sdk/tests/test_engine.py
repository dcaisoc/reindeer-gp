"""The Python engine must reproduce the official golden traces bit for bit."""

import json
import math
from importlib import resources

import pytest

from reindeer_sdk import encode_replay, decode_replay, evaluate_bot, load_track, run_policy, simulate_replay, tuned_policy
from reindeer_sdk.fmath import fcos, fexp, fsin, ftanh
from reindeer_sdk.quant import mulberry32, quantise
from reindeer_sdk.replay import ReplayFormatError, replay_from_json

GOLDEN = resources.files("reindeer_sdk").joinpath("data", "golden")
CORPUS = sorted(GOLDEN.joinpath("corpus").iterdir(), key=lambda p: p.name)
BOTS = sorted(GOLDEN.joinpath("bots").iterdir(), key=lambda p: p.name)


@pytest.mark.parametrize("path", CORPUS, ids=lambda p: p.name)
def test_golden_replays(path):
    from reindeer_sdk.twist import course_of_replay
    rep = replay_from_json(json.loads(path.read_text("utf-8")))
    c = course_of_replay(rep)
    out = simulate_replay(c.track, rep, c.cfg)
    assert out.matches, f"diverges near tick {(out.first_mismatch + 1) * 60}"


@pytest.mark.parametrize("path", BOTS, ids=lambda p: p.name)
def test_golden_bots(path):
    g = json.loads(path.read_text("utf-8"))
    rep = evaluate_bot(g.get("twist") or g["track"], g["bot"])
    assert rep.header["hashes"] == g["hashes"]
    assert rep.header["finalHash"] == g["finalHash"]


def test_fmath_accuracy():
    for i in range(-2000, 2000):
        x = i * 0.0137
        assert abs(fsin(x) - math.sin(x)) < 1e-9
        assert abs(fcos(x) - math.cos(x)) < 1e-9
    for i in range(-400, 400):
        x = i * 0.071
        assert abs(fexp(x) / math.exp(x) - 1) < 1e-12
        assert abs(ftanh(x) - math.tanh(x)) < 1e-12


def test_mulberry32_matches_javascript():
    # First values of mulberry32(1234), as produced by engine/core/quant.ts.
    r = mulberry32(1234)
    got = [r() for _ in range(3)]
    assert got == [0.07329497812315822, 0.7034119898453355, 0.9028560190927237]


def test_quantise():
    assert [quantise(v) for v in (1, -1, 5, -5, 0, float("nan"))] == [127, -127, 127, -127, 0, 0]


def test_replay_roundtrip_and_errors():
    rep = run_policy(load_track("practice-1"), tuned_policy, {"kind": "bot", "name": "t"})
    back = decode_replay(encode_replay(rep))
    assert back.header == rep.header and back.actions == rep.actions
    assert simulate_replay(load_track("practice-1"), back).matches
    with pytest.raises(ReplayFormatError):
        decode_replay(b"nope!!")
    tampered = decode_replay(encode_replay(rep))
    tampered.actions[200] = -tampered.actions[200] or 100
    assert not simulate_replay(load_track("practice-1"), tampered).matches
