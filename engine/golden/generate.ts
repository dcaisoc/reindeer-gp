/**
 * Regenerate the golden-trace corpus. Run ONLY when an engine change is
 * intended to change results, and bump the engine major version with it.
 * Usage: npm run golden:update
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32, quantise } from '../core/quant.js';
import { replayToJson, type Replay } from '../core/replay.js';
import { baselinePolicy, tunedPolicy } from '../reindeer/autopilot.js';
import { Recorder, runPolicy } from '../reindeer/run.js';
import type { TrackDef } from '../reindeer/track.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'corpus');
mkdirSync(out, { recursive: true });

function fixed(r: Replay): Replay {
  r.header.createdAt = '2026-11-22T00:00:00.000Z';
  return r;
}

/** Record a fixed number of ticks from an action generator, human-style (60 Hz). */
function scripted(track: TrackDef, ticks: number, gen: (tick: number) => [number, number], name: string): Replay {
  const rec = new Recorder(track, 1, { kind: 'human', name });
  for (let i = 0; i < ticks && !rec.game.isDone(); i++) rec.tick(gen(i));
  return rec.toReplay();
}

const cases: [string, Replay][] = [];
for (const id of ['practice-1', 'practice-2', 'practice-3']) {
  const t: TrackDef = JSON.parse(readFileSync(join(here, '..', '..', 'tracks', `${id}.json`), 'utf8'));
  cases.push([`${id}-baseline`, runPolicy(t, baselinePolicy, { kind: 'bot', name: 'baseline' })]);
  cases.push([`${id}-tuned`, runPolicy(t, tunedPolicy, { kind: 'bot', name: 'tuned' })]);
  const rand = mulberry32(1234 + id.length);
  let s = 0;
  let th = 0;
  cases.push([
    `${id}-random`,
    scripted(t, 2400, (i) => {
      if (i % 7 === 0) {
        s = quantise(rand() * 2 - 1);
        th = quantise(rand() * 1.6 - 0.4);
      }
      return [s, th];
    }, 'random'),
  ]);
  cases.push([`${id}-wallhug`, scripted(t, 1800, () => [quantise(0.35), 127], 'wallhug')]);
  cases.push([
    `${id}-brake-reverse`,
    scripted(t, 900, (i) => (i < 240 ? [0, 127] : i < 420 ? [0, -127] : i < 700 ? [quantise(-0.6), -127] : [127, 60]), 'brake-reverse'),
  ]);
}

for (const [name, r] of cases) {
  writeFileSync(join(out, `${name}.json`), JSON.stringify(replayToJson(fixed(r))) + '\n');
  const res = r.header.result;
  console.log(`${name.padEnd(28)} ticks ${String(res.ticks).padStart(5)}  valid ${res.valid}  hash ${r.header.finalHash}`);
}
