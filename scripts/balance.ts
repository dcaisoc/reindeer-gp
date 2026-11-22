/**
 * Track balance check: the baseline driver should finish every public track,
 * and a tuned driver should be clearly faster (a skill gradient).
 * Usage: npm run balance
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselinePolicy, tunedPolicy } from '../engine/reindeer/autopilot.js';
import { runPolicy, simulateReplay } from '../engine/reindeer/run.js';
import type { TrackDef } from '../engine/reindeer/track.js';
import { twistConfig, type TwistDef } from '../engine/reindeer/twist.js';
import { DEFAULT_CONFIG, type EngineConfig } from '../engine/reindeer/config.js';
import { readdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const rows: string[] = [];
const courses: [string, TrackDef, EngineConfig][] = ['practice-1', 'practice-2', 'practice-3'].map((id) => [
  id, JSON.parse(readFileSync(join(root, 'tracks', `${id}.json`), 'utf8')), DEFAULT_CONFIG,
]);
for (const f of readdirSync(join(root, 'tracks', 'twists')).filter((f) => f.endsWith('.json')).sort()) {
  const w: TwistDef = JSON.parse(readFileSync(join(root, 'tracks', 'twists', f), 'utf8'));
  courses.push([w.id, w.track, twistConfig(w)]);
}
for (const [id, t, cfg] of courses) {
  // The tuned driver reads the standard 7 rays, so it only runs where they exist.
  const pols = cfg.rayAnglesDeg.length === 7 ? ([['baseline', baselinePolicy], ['tuned', tunedPolicy]] as const) : ([['baseline', baselinePolicy]] as const);
  for (const [name, pol] of pols) {
    const t0 = performance.now();
    const rep = runPolicy(t, pol, { kind: 'bot', name }, { cfg });
    const ms = performance.now() - t0;
    const r = rep.header.result;
    const t1 = performance.now();
    simulateReplay(t, rep, { cfg });
    const verifyMs = performance.now() - t1;
    rows.push(
      `${id.padEnd(16)} ${name.padEnd(9)} ${r.valid ? 'finished' : 'DNF     '} ` +
        `time ${(r.ticks / 60).toFixed(2).padStart(6)} s  penalties ${String(r.penalties).padStart(3)}  ` +
        `score ${r.score === null ? '   —  ' : r.score.toFixed(2).padStart(6)}  run ${ms.toFixed(0)} ms, verify ${verifyMs.toFixed(0)} ms`,
    );
  }
}
console.log(rows.join('\n'));
