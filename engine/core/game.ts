/**
 * The generic game interface. Reindeer Grand Prix implements it with one
 * participant; Grinch vs. Elves and Snowball Arena will implement it with two.
 * Everything that is generic (replays, evaluation, leaderboards) talks to games
 * only through this interface.
 */

/** One participant's action for one tick, as quantised integers. */
export type Action = Int8Array | number[];

export interface GameResult {
  /** True if the run finished under the rules (e.g. a complete lap). */
  valid: boolean;
  /** Score where lower is better (seconds for a race). Infinity if invalid. */
  score: number;
  /** Game-specific detail, e.g. lap ticks and penalties. */
  detail: Record<string, number>;
}

export interface Game<Obs> {
  readonly gameId: string;
  readonly engineVersion: string;
  readonly participants: number;
  /** Advance one tick. actions[i] is participant i's action. */
  step(actions: Action[]): void;
  observe(participant: number): Obs;
  isDone(): boolean;
  result(): GameResult;
  /** Hex hash of the full simulation state. */
  stateHash(): string;
  readonly tick: number;
}
