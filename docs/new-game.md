# Adding a new game

Reindeer Grand Prix is the first of three games (Grinch vs. Elves and Snowball Arena follow). Everything generic (replays, the evaluation queue, leaderboards, accounts, teams and the bot format) talks to a game only through a small interface, so a new game is mostly a new engine folder.

## 1. Implement the `Game` interface

In `engine/<your-game>/`, implement `Game<Obs>` from [`engine/core/game.ts`](https://github.com/dcaisoc/reindeer-gp/blob/main/engine/core/game.ts):

```ts
interface Game<Obs> {
  readonly gameId: string;          // e.g. "snowball-arena"
  readonly engineVersion: string;   // semver; bump major when any state hash changes
  readonly participants: number;    // 1 for a race, 2 for head-to-head
  step(actions: Action[]): void;    // one tick; actions[i] is participant i's int8 action
  observe(participant: number): Obs;
  isDone(): boolean;
  result(): GameResult;             // {valid, score (lower is better), detail}
  stateHash(): string;              // FNV-1a 64 over the full state, via engine/core/hash.ts
  readonly tick: number;
}
```

## 2. Follow the determinism rules

The same inputs must give identical bits in the browser, the server and Python. See the header of [`engine/core/fmath.ts`](https://github.com/dcaisoc/reindeer-gp/blob/main/engine/core/fmath.ts):

- float64 only, and only `+ − × ÷` and `Math.sqrt/abs/min/max/floor/round/sign`;
- use `fsin`, `fcos`, `fexp`, `ftanh` from `fmath.ts`, never `Math.sin` and friends (`npm run lint` enforces it);
- fixed evaluation order, no iteration over unordered collections, and randomness only from the seeded `mulberry32` in `engine/core/quant.ts`;
- for two-player games, apply both players' actions in a fixed order (participant 0 first) every tick.

## 3. Add golden traces

Extend `engine/golden/generate.ts` with a dozen recorded runs that cover the rules (collisions, scoring, edge cases). `npm run test:golden` checks them in Node and CI checks them in Chromium and Firefox. When the Python port exists, `sdk/tests` checks them there too.

## 4. Port to Python

Copy the structure of `sdk/reindeer_sdk/sim.py`: a line-by-line port, same operation order, `_imul`-style helpers for 32-bit integer maths. Golden traces must match before anything else is built on it.

## 5. Wire up the platform

- **Bots:** reuse the `rgp-bot` format with a new `game` value and the game's own input names, or add a `version` 2 layer type if you truly need one.
- **Evaluation:** add a branch in `server/src/evaluate.ts` that builds your game, runs the bot(s) and records a replay. For head-to-head games, schedule matches from a cron job (see the existing `*/10` kick) and store Elo in a new table.
- **Boards:** a board key is `<season>/<track or arena>/<twist>/<kind>`, so new boards need no schema change.
- **Web:** a renderer and a drive screen in `web/src/screens/`; the replay viewer only needs a draw function per frame.

## 6. Ship it behind a switch

Add a setting (like `submissions_open`) so referees can open the new game at the announced time, and deploy to staging with the `preview` label first.
