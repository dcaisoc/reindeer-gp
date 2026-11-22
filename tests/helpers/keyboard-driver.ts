/**
 * A simulated human: reads the sensors and presses arrow keys (on/off only),
 * with the same steering ramp as the real keyboard input. Used to make
 * realistic "human" laps for trainer tests without a browser.
 */

import { Recorder } from '../../engine/reindeer/run.js';
import type { TrackDef } from '../../engine/reindeer/track.js';
import type { Replay } from '../../engine/core/replay.js';
import { mulberry32 } from '../../engine/core/quant.js';
import { DEFAULT_CONFIG } from '../../engine/reindeer/config.js';
import { twistConfig, twistRef, type TwistDef } from '../../engine/reindeer/twist.js';

/**
 * On a twist, pass it: the simulated human sees the road with the standard 7
 * rays (like a person would), while physics uses the twist's config. Rays
 * never affect physics, so the lap verifies under the twist's own config.
 */
export function keyboardLap(track: TrackDef, seed = 1, sloppiness = 0, twist?: TwistDef): Replay {
  const cfg = twist ? { ...twistConfig(twist), rayAnglesDeg: DEFAULT_CONFIG.rayAnglesDeg, rayRange: DEFAULT_CONFIG.rayRange } : DEFAULT_CONFIG;
  const rec = new Recorder(track, 1, { kind: 'human', name: 'Sim' }, cfg);
  if (twist) rec.twist = twistRef(twist);
  const rand = mulberry32(seed);
  let steer = 0;
  let left = false;
  let right = false;
  let up = false;
  let down = false;
  while (!rec.game.isDone()) {
    // A human reacts roughly every 4 ticks (~15 Hz), sometimes late.
    if (rec.game.tick % 4 === 0 && rand() >= sloppiness) {
      const o = rec.game.observe();
      const r = o.rays;
      const s = (r[4] - r[2]) * 2.2 + (r[5] - r[1]) * 1.2 + (r[6] - r[0]) * 0.5;
      right = s > 0.12;
      left = s < -0.12;
      const target = 0.25 + 0.6 * Math.min(r[3], (r[2] + r[4]) * 0.75);
      up = o.speed < target;
      down = o.speed > target + 0.12;
    }
    const tgt = (right ? 127 : 0) - (left ? 127 : 0);
    if (tgt === 0) steer = steer > 0 ? Math.max(0, steer - 18) : Math.min(0, steer + 18);
    else if (steer < tgt) steer = Math.min(tgt, steer + (steer < 0 ? 18 : 9));
    else if (steer > tgt) steer = Math.max(tgt, steer - (steer > 0 ? 18 : 9));
    rec.tick([steer, up && !down ? 127 : down && !up ? -127 : 0]);
  }
  return rec.toReplay();
}
