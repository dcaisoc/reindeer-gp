"""The `reindeer` command.

    reindeer tracks                         list the tracks
    reindeer validate bot.json              check a bot file (same rules as the server)
    reindeer eval bot.json [--track ID]     race it locally: the same score the server will give
    reindeer replay lap.rgpr                show and verify a replay
    reindeer login                          save your API token (from your Team page)
    reindeer submit bot.json [--track ID]   submit to the leaderboard and wait for the result
    reindeer status SUBMISSION_ID           check a submission
    reindeer selftest                       check this installation gives the official results
"""

from __future__ import annotations

import argparse
import getpass
import json
import sys
import time
from importlib import resources
from pathlib import Path
from typing import Any

from . import __version__
from .api import ApiError, Client, save_config
from .bot import InvalidBot, evaluate_bot, load_bot, validate_bot
from .config import ENGINE_VERSION
from .replay import encode_replay, load_replay, replay_from_json
from .run import simulate_replay
from .tracks import TRACK_IDS, list_tracks, load_track


def _fmt(score: float | None) -> str:
    return "—" if score is None else f"{score:.2f} s"


def _load_bot_or_exit(path: str) -> dict[str, Any]:
    try:
        return load_bot(path)
    except FileNotFoundError:
        sys.exit(f"No such file: {path}")
    except ValueError as e:
        sys.exit(f"{path} is not valid JSON: {e}")


def cmd_tracks(_: argparse.Namespace) -> int:
    for t in list_tracks():
        print(f"{t['id']:<12} {'★' * t['difficulty']:<4} {t['name']}: {t['description']}")
    return 0


def cmd_validate(a: argparse.Namespace) -> int:
    bot = _load_bot_or_exit(a.bot)
    errors, params = validate_bot(bot)
    if errors:
        print(f"✗ {a.bot} has {len(errors)} problem{'s' * (len(errors) != 1)}:")
        for e in errors:
            print(f"  - {e}")
        return 1
    print(f"✓ {a.bot} is a valid bot: {params} parameters, inputs {', '.join(bot['inputs'])}.")
    return 0


def cmd_eval(a: argparse.Namespace) -> int:
    bot = _load_bot_or_exit(a.bot)
    tracks = TRACK_IDS if a.track == "all" else [a.track]
    results = []
    for t in tracks:
        t0 = time.time()
        try:
            rep = evaluate_bot(load_track(t), bot)
        except InvalidBot as e:
            print(f"✗ {e}")
            return 1
        r = rep.result
        results.append({"track": t, **r})
        if not a.json:
            status = _fmt(r["score"]) if r["valid"] else "did not finish"
            print(f"{t:<12} {status:<16} lap {r['ticks'] / 60:6.2f} s  penalties {r['penalties']:>2}  ({time.time() - t0:.1f}s to simulate)")
        if a.save_replay:
            base = Path(a.save_replay)
            out = base if len(tracks) == 1 else base.with_name(f"{base.stem}-{t}{base.suffix or '.rgpr'}")
            out.write_bytes(encode_replay(rep))
            if not a.json:
                print(f"             replay saved to {out} (open it in the web app's replay viewer)")
    if a.json:
        print(json.dumps(results))
    return 0


def cmd_replay(a: argparse.Namespace) -> int:
    rep = load_replay(a.file)
    h = rep.header
    out = simulate_replay(load_track(rep.track_id), rep)
    r = h["result"]
    who = (h.get("participants") or [{}])[0]
    print(f"{rep.track_id}: {who.get('kind', '?')} {who.get('name', '')}".rstrip())
    print(f"  result     {_fmt(r['score']) if r['valid'] else 'did not finish'} ({r['ticks']} ticks, {r['penalties']} penalties)")
    print(f"  engine     {h['engineVersion']} (this SDK: {ENGINE_VERSION})")
    print(f"  verified   {'yes: re-simulates identically' if out.matches else f'NO: diverges near tick {(out.first_mismatch + 1) * 60}'}")
    return 0 if out.matches else 1


def cmd_login(a: argparse.Namespace) -> int:
    url = (a.url or Client().url).rstrip("/")
    print(f"Server: {url}")
    print("Create a token on your Team page (web app → your name → API tokens), then paste it here.")
    token = getpass.getpass("Token (hidden): ").strip()
    if not token:
        return 1
    try:
        me = Client(url, token).me()
    except ApiError as e:
        sys.exit(f"✗ {e}")
    if not me:
        sys.exit("✗ That token was not accepted. Check it, or create a new one.")
    path = save_config(url, token)
    print(f"✓ Signed in as {me['displayName']}. Saved to {path}.")
    return 0


def cmd_submit(a: argparse.Namespace) -> int:
    bot = _load_bot_or_exit(a.bot)
    errors, _ = validate_bot(bot)
    if errors:
        print("✗ Not submitted, the bot file has problems:")
        for e in errors:
            print(f"  - {e}")
        return 1
    client = Client(a.url)
    try:
        subs = client.submit(bot, None if a.track == "all" else [a.track])
    except ApiError as e:
        print(f"✗ {e}")
        for err in (e.details or {}).get("errors", []):
            print(f"  - {err}")
        return 1
    print(f"Submitted to {len(subs)} track{'s' * (len(subs) != 1)}. Racing on the server…")
    failed = 0
    for s in subs:
        done = client.wait(s["id"])
        r = done.get("result")
        if done["status"] == "rejected":
            failed += 1
            print(f"  {s['trackId']:<12} rejected: {done['rejectReason']}")
        elif done["status"] != "done":
            print(f"  {s['trackId']:<12} still {done['status']} (check later: reindeer status {s['id']})")
        else:
            msg = _fmt(r["score"]) if r and r["valid"] else "did not finish"
            print(f"  {s['trackId']:<12} {msg}{'  (Beginner bracket)' if r and r.get('beginner') else ''}  {client.url}/#/replay/remote/{done['replayId']}")
    return 1 if failed else 0


def cmd_status(a: argparse.Namespace) -> int:
    try:
        s = Client(a.url).submission(a.id)
    except ApiError as e:
        sys.exit(f"✗ {e}")
    print(json.dumps(s, indent=2))
    return 0


def cmd_selftest(_: argparse.Namespace) -> int:
    """Re-run the official golden traces: proves this machine scores exactly like the server."""
    root = resources.files("reindeer_sdk").joinpath("data", "golden")
    ok = total = 0
    for f in sorted(root.joinpath("corpus").iterdir(), key=lambda p: p.name):
        rep = replay_from_json(json.loads(f.read_text("utf-8")))
        total += 1
        ok += simulate_replay(load_track(rep.track_id), rep).matches
    for f in sorted(root.joinpath("bots").iterdir(), key=lambda p: p.name):
        g = json.loads(f.read_text("utf-8"))
        rep = evaluate_bot(load_track(g["track"]), g["bot"], check=False)
        total += 1
        ok += rep.header["hashes"] == g["hashes"] and rep.header["finalHash"] == g["finalHash"]
    print(f"{'✓' if ok == total else '✗'} {ok}/{total} golden traces match the official engine {ENGINE_VERSION}.")
    return 0 if ok == total else 1


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="reindeer", description="Reindeer Grand Prix toolkit.")
    p.add_argument("--version", action="version", version=f"reindeer-sdk {__version__} (engine {ENGINE_VERSION})")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("tracks", help="list the tracks").set_defaults(fn=cmd_tracks)
    v = sub.add_parser("validate", help="check a bot file")
    v.add_argument("bot")
    v.set_defaults(fn=cmd_validate)
    e = sub.add_parser("eval", help="race a bot locally")
    e.add_argument("bot")
    e.add_argument("--track", default="all", choices=["all", *TRACK_IDS])
    e.add_argument("--save-replay", metavar="FILE.rgpr")
    e.add_argument("--json", action="store_true", help="machine-readable output")
    e.set_defaults(fn=cmd_eval)
    r = sub.add_parser("replay", help="show and verify a replay file")
    r.add_argument("file")
    r.set_defaults(fn=cmd_replay)
    lg = sub.add_parser("login", help="save your API token")
    lg.add_argument("--url")
    lg.set_defaults(fn=cmd_login)
    s = sub.add_parser("submit", help="submit a bot to the leaderboard")
    s.add_argument("bot")
    s.add_argument("--track", default="all", choices=["all", *TRACK_IDS])
    s.add_argument("--url")
    s.set_defaults(fn=cmd_submit)
    st = sub.add_parser("status", help="check a submission")
    st.add_argument("id")
    st.add_argument("--url")
    st.set_defaults(fn=cmd_status)
    sub.add_parser("selftest", help="check this installation matches the official engine").set_defaults(fn=cmd_selftest)
    args = p.parse_args(argv)
    return int(args.fn(args) or 0)


if __name__ == "__main__":
    raise SystemExit(main())
