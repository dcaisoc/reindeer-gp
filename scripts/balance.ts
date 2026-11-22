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

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const rows: string[] = [];
for (const id of ['practice-1', 'practice-2', 'practice-3']) {
  const t: TrackDef = JSON.parse(readFileSync(join(root, 'tracks', `${id}.json`), 'utf8'));
  for (const [name, pol] of [
    ['baseline', baselinePolicy],
    ['tuned', tunedPolicy],
  ] as const) {
    const t0 = performance.now();
    const rep = runPolicy(t, pol, { kind: 'bot', name });
    const ms = performance.now() - t0;
    const r = rep.header.result;
    const t1 = performance.now();
    simulateReplay(t, rep);
    const verifyMs = performance.now() - t1;
    rows.push(
      `${id.padEnd(11)} ${name.padEnd(9)} ${r.valid ? 'finished' : 'DNF     '} ` +
        `time ${(r.ticks / 60).toFixed(2).padStart(6)} s  penalties ${String(r.penalties).padStart(3)}  ` +
        `score ${r.score === null ? '   —  ' : r.score.toFixed(2).padStart(6)}  run ${ms.toFixed(0)} ms, verify ${verifyMs.toFixed(0)} ms`,
    );
  }
}
console.log(rows.join('\n'));
