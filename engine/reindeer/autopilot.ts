/**
 * The baseline driver: a few lines of hand-written rules, no learning.
 * It finishes the easy tracks but is deliberately not fast, so beginners
 * always have a target to beat. It also drives the golden-trace corpus.
 */

import type { Observation } from './sim.js';

export function baselinePolicy(o: Observation): [number, number] {
  const r = o.rays;
  const last = r.length - 1;
  const mid = (r.length - 1) / 2;
  // Steer towards whichever side has more room, weighting the wider rays less.
  let left = 0;
  let right = 0;
  for (let i = 0; i < mid; i++) left += r[i] * (1 + i);
  for (let i = last; i > mid; i--) right += r[i] * (1 + last - i);
  let steer = (right - left) * 1.2;
  if (steer > 1) steer = 1;
  if (steer < -1) steer = -1;
  // Slow down when the wall ahead is close.
  const front = r[Math.floor(mid)];
  const target = 0.2 + 0.55 * front;
  const throttle = o.speed < target ? 1 : -0.5;
  return [steer, throttle];
}

/** A stronger rule-based driver, used to show there is headroom above the baseline. */
export function tunedPolicy(o: Observation): [number, number] {
  const r = o.rays;
  let steer = (r[4] - r[2]) * 2.2 + (r[5] - r[1]) * 1.2 + (r[6] - r[0]) * 0.5;
  if (steer > 1) steer = 1;
  if (steer < -1) steer = -1;
  let look = (r[2] + r[4]) * 0.75;
  if (r[3] < look) look = r[3];
  const target = 0.3 + 0.75 * look;
  const throttle = o.speed < target ? 1 : o.speed > target + 0.08 ? -1 : 0.2;
  return [steer, throttle];
}
