# Reindeer Grand Prix 🦌🛷

A Christmas machine-learning competition for Cambridge students. Drive a sleigh round a snowy track, record your driving, teach a small neural network to drive like you, and race it on a live leaderboard. No installation needed to play.

This repository holds the whole system: the deterministic game engine, the browser app, the tracks, the server, the Python SDK and the notebooks.

**Status:** milestone M3. Everything from M2 (drive, train in the browser, Raven sign-in, teams, live leaderboards) plus a [Python SDK](sdk/) with bit-identical scoring, the `reindeer` command line, API tokens, and three [Colab notebooks](notebooks/). Documentation: <https://dcaisoc.github.io/reindeer-gp/>. Going live: [docs/setup.md](docs/setup.md).

## Quick start (5 minutes)

You need [Node.js 20+](https://nodejs.org/).

```sh
git clone https://github.com/dcaisoc/reindeer-gp.git
cd reindeer-gp
make dev            # or: npm install && npm run dev
```

Open <http://localhost:8000>. This is the whole system running on your laptop (app, API, evaluation queue, leaderboards) and it rebuilds when you save. Steer with ← → (or A D), go and brake with ↑ ↓ (or W S), pause with P, restart with R.

**Signing in locally:** there is no Raven on your laptop (Google only returns sign-ins to the registered staging and production addresses). Use the *test sign-in* box with any @cam.ac.uk address; no password, nothing leaves your machine. Data is kept in `.local/` (delete it to start fresh). To see the referee page: `REFEREE_EMAILS=you@cam.ac.uk npm run dev`.

Run every check CI runs:

```sh
npm run ci                         # typecheck, unit tests, golden traces, track validator, build
npx playwright install chromium    # once
npm run test:browser               # golden traces in a browser, then the M1 and M2 end-to-end journeys
```

## How it fits together

```text
 tracks/*.json ──► engine/ (TypeScript, deterministic) ──► web/ (drive, record, replay)
                         │                                    │
                         │ golden traces: same inputs ⇒       │ laps saved in IndexedDB
                         │ identical state hashes in Node,    │ as tiny .rgpr replays
                         ▼ Chromium, Firefox and Python (sdk/)  ▼
                    server/ (one Cloudflare Worker: API + app; an Evaluator Durable Object
                             re-simulates every submission with the same engine)
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
| `web/` | The browser app (no framework; plain TypeScript and canvas), including the trainer |
| `server/` | The Worker: API, sign-in, queue, leaderboards; `server/local` runs it in plain Node |
| `tests/` | Unit tests and browser tests |
| `scripts/` | Build, track generation, balance report, GitHub bootstrap |
| `docs/` | Format specs and setup notes |
| `sdk/` | Python SDK: engine port, `reindeer` CLI, training and export tools |
| `notebooks/` | Colab notebooks (generated from `notebooks/src/*.py`) |
| `docs/` | Documentation site (MkDocs), deployed to GitHub Pages |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Small, well-described pull requests are very welcome; look for the `good first issue` label.

## Licence

Code is [MIT](LICENSE). Tutorial content (from M3) is CC BY 4.0.
