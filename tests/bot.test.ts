import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileBot, forward, isTrainerArchitecture, type BotFile } from '../engine/core/bot.js';
import { evaluateBot, validateBotForEngine } from '../engine/reindeer/bot-policy.js';
import { buildDataset, canMirror } from '../web/src/train/data.js';
import { Trainer } from '../web/src/train/mlp.js';
import { keyboardLap } from './helpers/keyboard-driver.js';
import type { TrackDef } from '../engine/reindeer/track.js';

const load = (id: string): TrackDef => JSON.parse(readFileSync(new URL(`../tracks/${id}.json`, import.meta.url), 'utf8'));
const INPUTS = ['ray0', 'ray1', 'ray2', 'ray3', 'ray4', 'ray5', 'ray6', 'speed'];

function tinyBot(): BotFile {
  return {
    format: 'rgp-bot', version: 1, game: 'reindeer-gp', inputs: ['ray0', 'ray6'], outputs: ['steer', 'throttle'],
    layers: [
      { type: 'dense', in: 2, out: 3, activation: 'relu', weights: [[1, 0], [0, 1], [1, 1]], bias: [0, 0, -0.5] },
      { type: 'dense', in: 3, out: 2, activation: 'tanh', weights: [[-1, 1, 0], [0, 0, 1]], bias: [0, 0.5] },
    ],
    meta: { name: 'Tiny' },
  };
}

test('a well-formed bot validates and runs deterministically', () => {
  const v = validateBotForEngine(tinyBot());
  assert.deepEqual(v.errors, []);
  assert.equal(v.params, 2 * 3 + 3 + 3 * 2 + 2);
  const y = forward(compileBot(tinyBot()), Float64Array.from([0.2, 0.9]));
  assert.ok(Math.abs(y[0] - Math.tanh(0.7)) < 1e-12);
  assert.ok(Math.abs(y[1] - Math.tanh(0.6 + 0.5)) < 1e-12);
});

test('validator explains common mistakes in plain words', () => {
  const cases: [(b: BotFile) => void, RegExp][] = [
    [(b) => (b.inputs = ['ray0', 'radar']), /Unknown input "radar"/],
    [(b) => (b.layers[1].in = 4), /Layer 2 expects 4 inputs but layer 1 outputs 3/],
    [(b) => (b.layers[1].weights[0][0] = Number.NaN), /finite numbers/],
    [(b) => (b.layers[1].out = 3), /last layer must output 2/],
    [(b) => (b.outputs = ['throttle', 'steer']), /exactly \["steer", "throttle"\]/],
    [(b) => (b.meta.name = ''), /Give your bot a name/],
    [(b) => ((b.layers[0] as unknown as { type: string }).type = 'conv'), /only "dense" layers/],
  ];
  for (const [mutate, re] of cases) {
    const b = tinyBot();
    mutate(b);
    const errs = validateBotForEngine(b).errors;
    assert.ok(errs.some((e) => re.test(e)), `${re} not in: ${errs.join(' | ')}`);
  }
});

test('parameter cap is enforced', () => {
  const big: BotFile = {
    ...tinyBot(), inputs: INPUTS,
    layers: [
      { type: 'dense', in: 8, out: 100, activation: 'relu', weights: Array.from({ length: 100 }, () => Array(8).fill(0)), bias: Array(100).fill(0) },
      { type: 'dense', in: 100, out: 50, activation: 'relu', weights: Array.from({ length: 50 }, () => Array(100).fill(0)), bias: Array(50).fill(0) },
      { type: 'dense', in: 50, out: 2, activation: 'tanh', weights: Array.from({ length: 2 }, () => Array(50).fill(0)), bias: [0, 0] },
    ],
  };
  const errs = validateBotForEngine(big).errors;
  assert.ok(errs.some((e) => /6052 parameters; the limit is 5000/.test(e)), errs.join(' | '));
});

test('oversized weights are rejected', () => {
  const b = tinyBot();
  b.layers[0].weights[1][1] = 5000;
  assert.ok(validateBotForEngine(b).errors.some((e) => /larger than 1000/.test(e)));
});

test('trainer architecture check keeps the Beginner bracket honest', () => {
  assert.ok(isTrainerArchitecture(tinyBot()));
  const deep = tinyBot();
  deep.layers = [deep.layers[0], { ...deep.layers[0], in: 3 }, { ...deep.layers[0], in: 3 }, deep.layers[1]];
  assert.equal(isTrainerArchitecture(deep), false);
});

test('mirroring needs symmetric inputs', () => {
  assert.ok(canMirror(INPUTS, 7));
  assert.equal(canMirror(['ray0', 'ray1', 'speed'], 7), false);
});

test('imitation learning from keyboard laps produces a bot that finishes Frosty Oval', () => {
  const t = load('practice-1');
  const laps = [1, 2, 3].map((s) => ({ track: t, replay: keyboardLap(t, s, 0.15) }));
  const ds = buildDataset(laps, INPUTS);
  const tr = new Trainer(INPUTS, { hidden: [32, 32], activation: 'relu', epochs: 30, learningRate: 0.003, batchSize: 64, seed: 7, validation: 0.1 });
  const { train } = tr.split(ds);
  const first = tr.epoch(ds, train);
  let last = first;
  for (let e = 1; e < 30; e++) last = tr.epoch(ds, train);
  assert.ok(last < first * 0.8, `loss should fall: ${first} -> ${last}`);
  const bot = tr.toBotFile({ name: 'Test', method: 'imitation', trainer: 'test' });
  assert.deepEqual(validateBotForEngine(bot).errors, []);
  const r = evaluateBot(t, bot).header.result;
  assert.ok(r.valid, `bot should finish (ticks ${r.ticks}, penalties ${r.penalties})`);
});
