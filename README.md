# Reindeer Grand Prix 🦌🛷

A Christmas machine-learning competition for Cambridge students. Drive a sleigh round a snowy track, record your driving, teach a small neural network to drive like you, and race it on a live leaderboard. No installation needed to play.

This repository holds the whole system: the deterministic game engine, the browser app, the tracks, and (from later milestones) the server, Python SDK and notebooks.

**Status:** milestone M1 (playable core). You can drive the three practice tracks, every lap is recorded in your browser, and you can watch replays and race your own ghost. Accounts, the in-browser trainer and leaderboards arrive in M2.

## Quick start (5 minutes)

You need [Node.js 20+](https://nodejs.org/).

```sh
git clone https://github.com/dcaisoc/reindeer-gp.git
cd reindeer-gp
make dev            # or: npm install && npm run dev
```

Open <http://localhost:8000>. Steer with ← → (or A D), go and brake with ↑ ↓ (or W S), pause with P, restart with R.

Run every check CI runs:

```sh
npm run ci                         # typecheck, unit tests, golden traces, track validator, build
npx playwright install chromium    # once
npm run test:browser               # golden traces inside a browser + end-to-end checks
```

## How it fits together

```text
 tracks/*.json ──► engine/ (TypeScript, deterministic) ──► web/ (drive, record, replay)
                         │                                    │
                         │ golden traces: same inputs ⇒       │ laps saved in IndexedDB
                         │ identical state hashes in Node,    │ as tiny .rgpr replays
                         ▼ Chromium, Firefox (and Python, M3)  ▼
                    server/ (M2: Cloudflare Workers re-simulate every submission)
```

- **One engine, everywhere.** The same TypeScript engine runs the browser game and, from M2, the server that scores submissions. A replay stores only inputs, so the server re-simulates it and gets the identical result, bit for bit. See [the determinism rules](engine/core/fmath.ts).
- **Replays are inputs, not video.** A two-minute lap is 1–3 KB. Format: [docs/formats/replay.md](docs/formats/replay.md).
- **Tracks are data.** Edit [tracks/src/defs.ts](tracks/src/defs.ts), run `npm run tracks`, then `npm run validate:tracks` and `npm run balance`. Format: [docs/formats/track.md](docs/formats/track.md).

## Repository layout

| Folder | What lives there |
| --- | --- |
| `engine/core` | Game interface, deterministic maths, state hashing, replay codec |
| `engine/reindeer` | Sleigh physics, sensors, laps and penalties, baseline driver |
| `engine/golden` | Golden-trace corpus and checker |
| `tracks/` | Track data, generator sources, validator |
| `web/` | The browser app (no framework; plain TypeScript and canvas) |
| `tests/` | Unit tests and browser tests |
| `scripts/` | Build, track generation, balance report, GitHub bootstrap |
| `docs/` | Format specs and setup notes |
| `server/`, `sdk/`, `notebooks/` | Arrive in M2 and M3 |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Small, well-described pull requests are very welcome; look for the `good first issue` label.

## Licence

Code is [MIT](LICENSE). Tutorial content (from M3) is CC BY 4.0.
