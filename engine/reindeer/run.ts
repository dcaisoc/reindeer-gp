/**
 * Running, recording and re-simulating laps.
 */

import { quantise } from '../core/quant.js';
import { REPLAY_FORMAT, REPLAY_VERSION, type Replay, type ReplayHeader, type ReplayParticipant } from '../core/replay.js';
import { DEFAULT_CONFIG, ENGINE_VERSION, GAME_ID, type EngineConfig } from './config.js';
import { ReindeerGame, TrackGeometry, type Observation } from './sim.js';
import type { TrackDef } from './track.js';

export const HASH_EVERY = 60;

/** Records a run as it is played, tick by tick or decision by decision. */
export class Recorder {
  readonly game: ReindeerGame;
  private actions: number[] = [];
  readonly hashes: string[] = [];
  private held: [number, number] = [0, 0];

  constructor(
    readonly track: TrackDef,
    readonly ticksPerAction: number,
    readonly participant: ReplayParticipant,
    cfg: EngineConfig = DEFAULT_CONFIG,
    geo?: TrackGeometry,
  ) {
    this.game = new ReindeerGame(track, cfg, geo);
  }

  /** Is the run waiting for a new action this tick? */
  get needsAction(): boolean {
    return this.game.tick % this.ticksPerAction === 0;
  }

  /** Advance one physics tick. `action` (already quantised) is used only when a new decision is due. */
  tick(action: [number, number]): void {
    if (this.game.isDone()) return;
    if (this.needsAction) {
      this.held = [action[0], action[1]];
      this.actions.push(action[0], action[1]);
    }
    this.game.step([this.held]);
    if (this.game.tick % HASH_EVERY === 0) this.hashes.push(this.game.stateHash());
  }

  toReplay(seed = 0): Replay {
    const r = this.game.result();
    const header: ReplayHeader = {
      format: REPLAY_FORMAT,
      version: REPLAY_VERSION,
      game: GAME_ID,
      engineVersion: ENGINE_VERSION,
      track: { id: this.track.id, version: this.track.trackVersion },
      twist: null,
      seed,
      ticksPerAction: this.ticksPerAction,
      participants: [this.participant],
      result: {
        valid: r.valid,
        score: r.valid ? r.score : null,
        ticks: r.detail.ticks,
        penalties: r.detail.penalties,
        collisions: r.detail.collisions,
      },
      hashes: [...this.hashes],
      finalHash: this.game.stateHash(),
      createdAt: new Date().toISOString(),
    };
    return { header, actions: Int8Array.from(this.actions) };
  }
}

export interface Frame {
  x: number;
  y: number;
  heading: number;
  speed: number;
  touching: number;
}

export interface SimOutcome {
  game: ReindeerGame;
  hashes: string[];
  finalHash: string;
  /** frames[0] is the start pose; frames[t] is the state after tick t. */
  frames: Frame[] | null;
  /** The first 60-tick checkpoint whose hash differs from the replay, or -1. */
  firstMismatch: number;
  matches: boolean;
}

/**
 * Re-simulate a replay from its inputs. With collectFrames the state after every
 * tick is kept for drawing (about 7,200 small objects for a 2-minute lap).
 */
export function simulateReplay(
  track: TrackDef,
  replay: Replay,
  opts: { cfg?: EngineConfig; geo?: TrackGeometry; collectFrames?: boolean } = {},
): SimOutcome {
  const g = new ReindeerGame(track, opts.cfg ?? DEFAULT_CONFIG, opts.geo);
  const tpa = replay.header.ticksPerAction;
  const frames: Frame[] | null = opts.collectFrames ? [frameOf(g)] : null;
  const hashes: string[] = [];
  const n = replay.actions.length / 2;
  const act: [number, number] = [0, 0];
  while (!g.isDone()) {
    const d = Math.floor(g.tick / tpa);
    if (d >= n) break; // ran out of inputs
    act[0] = replay.actions[2 * d];
    act[1] = replay.actions[2 * d + 1];
    g.step([act]);
    if (frames) frames.push(frameOf(g));
    if (g.tick % HASH_EVERY === 0) hashes.push(g.stateHash());
  }
  const finalHash = g.stateHash();
  let firstMismatch = -1;
  const want = replay.header.hashes;
  for (let i = 0; i < Math.max(want.length, hashes.length); i++) {
    if (want[i] !== hashes[i]) {
      firstMismatch = i;
      break;
    }
  }
  const matches = firstMismatch === -1 && finalHash === replay.header.finalHash;
  return { game: g, hashes, finalHash, frames, firstMismatch, matches };
}

function frameOf(g: ReindeerGame): Frame {
  return { x: g.x, y: g.y, heading: g.heading, speed: g.speed, touching: g.touching };
}

/**
 * (observation, action) pairs for imitation learning, sampled at the bot decision
 * rate. Observations are recomputed by re-simulation, so recordings only need inputs.
 */
export function extractTrainingPairs(
  track: TrackDef,
  replay: Replay,
  decisionTicks = 3,
  cfg: EngineConfig = DEFAULT_CONFIG,
): { obs: Observation[]; actions: [number, number][] } {
  const g = new ReindeerGame(track, cfg);
  const tpa = replay.header.ticksPerAction;
  const n = replay.actions.length / 2;
  const obs: Observation[] = [];
  const actions: [number, number][] = [];
  const act: [number, number] = [0, 0];
  while (!g.isDone()) {
    const d = Math.floor(g.tick / tpa);
    if (d >= n) break;
    act[0] = replay.actions[2 * d];
    act[1] = replay.actions[2 * d + 1];
    if (g.tick % decisionTicks === 0) {
      obs.push(g.observe());
      actions.push([act[0] / 127, act[1] / 127]);
    }
    g.step([act]);
  }
  return { obs, actions };
}

/** A policy maps an observation to (steer, throttle) in [-1, 1]. */
export type Policy = (o: Observation) => [number, number];

/** Run a policy for a full lap at the bot decision rate and return the replay. */
export function runPolicy(
  track: TrackDef,
  policy: Policy,
  participant: ReplayParticipant,
  opts: { cfg?: EngineConfig; ticksPerAction?: number; geo?: TrackGeometry } = {},
): Replay {
  const rec = new Recorder(track, opts.ticksPerAction ?? 3, participant, opts.cfg, opts.geo);
  let a: [number, number] = [0, 0];
  while (!rec.game.isDone()) {
    if (rec.needsAction) {
      const [s, t] = policy(rec.game.observe());
      a = [quantise(s), quantise(t)];
    }
    rec.tick(a);
  }
  return rec.toReplay();
}

export { ENGINE_VERSION };
