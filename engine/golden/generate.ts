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
import { evaluateBot } from '../reindeer/bot-policy.js';
import { twistConfig, twistRef, type TwistDef } from '../reindeer/twist.js';
import type { EngineConfig } from '../reindeer/config.js';
import { readdirSync } from 'node:fs';
import { buildDataset } from '../../web/src/train/data.js';
import { Trainer } from '../../web/src/train/mlp.js';
import { keyboardLap } from '../../tests/helpers/keyboard-driver.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'corpus');
mkdirSync(out, { recursive: true });

function fixed(r: Replay): Replay {
  r.header.createdAt = '2026-11-22T00:00:00.000Z';
  return r;
}

/** Record a fixed number of ticks from an action generator, human-style (60 Hz). */
function scripted(track: TrackDef, ticks: number, gen: (tick: number) => [number, number], name: string, cfg?: EngineConfig, twist?: TwistDef): Replay {
  const rec = new Recorder(track, 1, { kind: 'human', name }, cfg);
  if (twist) rec.twist = twistRef(twist);
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

// Weekly twists: different geometry and engine config (e.g. 3 rays at night).
const twistDir = join(here, '..', '..', 'tracks', 'twists');
const twists: TwistDef[] = readdirSync(twistDir).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(join(twistDir, f), 'utf8')));
for (const w of twists) {
  const cfg = twistConfig(w);
  cases.push([`twist-${w.id}-baseline`, runPolicy(w.track, baselinePolicy, { kind: 'bot', name: 'baseline' }, { cfg, twist: twistRef(w) })]);
  const rand = mulberry32(4321 + w.id.length);
  let s = 0;
  let th = 0;
  cases.push([
    `twist-${w.id}-random`,
    scripted(w.track, 2400, (i) => {
      if (i % 9 === 0) {
        s = quantise(rand() * 2 - 1);
        th = quantise(rand() * 1.6 - 0.4);
      }
      return [s, th];
    }, 'random', cfg, w),
  ]);
}

for (const [name, r] of cases) {
  writeFileSync(join(out, `${name}.json`), JSON.stringify(replayToJson(fixed(r))) + '\n');
  const res = r.header.result;
  console.log(`${name.padEnd(28)} ticks ${String(res.ticks).padStart(5)}  valid ${res.valid}  hash ${r.header.finalHash}`);
}

// Golden bots: trained once from simulated keyboard laps, then frozen. Their
// evaluations pin down deterministic inference (dot products, tanh, relu).
const botsDir = join(here, 'bots');
mkdirSync(botsDir, { recursive: true });
const INPUTS = ['ray0', 'ray1', 'ray2', 'ray3', 'ray4', 'ray5', 'ray6', 'speed', 'lateral', 'surf_snow', 'surf_ice', 'surf_rough'];
for (const [id, act] of [['practice-1', 'relu'], ['practice-3', 'tanh']] as const) {
  const t: TrackDef = JSON.parse(readFileSync(join(here, '..', '..', 'tracks', `${id}.json`), 'utf8'));
  const laps = [1, 2, 3].map((s) => ({ track: t, replay: keyboardLap(t, s, 0.15) }));
  const ds = buildDataset(laps, INPUTS);
  const tr = new Trainer(INPUTS, { hidden: [24, 24], activation: act, epochs: 25, learningRate: 0.003, batchSize: 64, seed: 3, validation: 0 });
  const { train } = tr.split(ds);
  for (let e = 0; e < 25; e++) tr.epoch(ds, train);
  const bot = tr.toBotFile({ name: `golden-${id}-${act}`, method: 'imitation', trainer: 'golden' });
  const rep = evaluateBot(t, bot);
  const name = `bot-${id}-${act}`;
  writeFileSync(join(botsDir, `${name}.json`), JSON.stringify({ bot, track: id, hashes: rep.header.hashes, finalHash: rep.header.finalHash }) + '\n');
  const res = rep.header.result;
  console.log(`${name.padEnd(28)} ticks ${String(res.ticks).padStart(5)}  valid ${res.valid}  hash ${rep.header.finalHash}`);
}

// A golden bot on a twist: surfaces sensors on new ice, through the twist's config.
{
  const w = twists.find((t) => t.id === 'ice-hairpins')!;
  const golden = JSON.parse(readFileSync(join(botsDir, 'bot-practice-3-tanh.json'), 'utf8'));
  const rep = evaluateBot(w.track, golden.bot, {}, { cfg: twistConfig(w), twist: twistRef(w) });
  writeFileSync(join(botsDir, 'bot-twist-ice-hairpins-tanh.json'), JSON.stringify({ bot: golden.bot, track: w.id, twist: w.id, hashes: rep.header.hashes, finalHash: rep.header.finalHash }) + '\n');
  const res = rep.header.result;
  console.log(`${'bot-twist-ice-hairpins-tanh'.padEnd(28)} ticks ${String(res.ticks).padStart(5)}  valid ${res.valid}  hash ${rep.header.finalHash}`);
}
