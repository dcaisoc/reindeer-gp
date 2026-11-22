/**
 * Turn recorded laps into a training set: for every bot decision (20 Hz),
 * the sensor readings the sleigh saw and what the driver did.
 */

import type { Replay } from '../../../engine/core/replay.js';
import { extractTrainingPairs } from '../../../engine/reindeer/run.js';
import { obsToInputs } from '../../../engine/reindeer/sim.js';
import type { EngineConfig } from '../../../engine/reindeer/config.js';
import type { TrackDef } from '../../../engine/reindeer/track.js';
import type { Dataset } from './mlp.js';

export interface LapSource {
  track: TrackDef;
  replay: Replay;
  /** The engine config the lap was driven with (a twist's); default otherwise. */
  cfg?: EngineConfig;
}

/** The mirror-image name of an input, or null if it has none among `inputs`. */
export function mirrorName(name: string, rayCount: number): string {
  if (name.startsWith('ray')) return `ray${rayCount - 1 - Number(name.slice(3))}`;
  return name;
}

/** Mirroring needs every ray's partner to be an input too. */
export function canMirror(inputs: string[], rayCount: number): boolean {
  return inputs.every((n) => inputs.includes(mirrorName(n, rayCount)));
}

export function buildDataset(laps: LapSource[], inputs: string[], opts: { mirror?: boolean; rayCount?: number } = {}): Dataset {
  const rayCount = opts.rayCount ?? 7;
  const mirror = !!opts.mirror && canMirror(inputs, rayCount);
  const xs: number[] = [];
  const ys: number[] = [];
  const mirroredIdx = inputs.map((n) => inputs.indexOf(mirrorName(n, rayCount)));
  for (const { track, replay, cfg } of laps) {
    const { obs, actions } = extractTrainingPairs(track, replay, 3, cfg);
    for (let i = 0; i < obs.length; i++) {
      const row = obsToInputs(obs[i], inputs);
      xs.push(...row);
      ys.push(actions[i][0], actions[i][1]);
      if (mirror) {
        for (let k = 0; k < inputs.length; k++) {
          const v = row[mirroredIdx[k]];
          xs.push(inputs[k] === 'lateral' ? -v : v);
        }
        ys.push(-actions[i][0], actions[i][1]);
      }
    }
  }
  return { inputs, x: Float64Array.from(xs), y: Float64Array.from(ys), n: ys.length / 2 };
}
