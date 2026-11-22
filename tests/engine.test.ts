import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fsin, fcos, fexp, ftanh, fsigmoid, wrapAngle } from '../engine/core/fmath.js';
import { quantise, dequantise } from '../engine/core/quant.js';
import { StateHasher } from '../engine/core/hash.js';
import { decodeReplay, encodeReplay, replayFromJson, replayToJson, ReplayFormatError } from '../engine/core/replay.js';
import { ReindeerGame } from '../engine/reindeer/sim.js';
import { makeConfig } from '../engine/reindeer/config.js';
import { Recorder, extractTrainingPairs, runPolicy, simulateReplay } from '../engine/reindeer/run.js';
import { baselinePolicy, tunedPolicy } from '../engine/reindeer/autopilot.js';
import { validateTrack } from '../tracks/validate.js';
import type { TrackDef } from '../engine/reindeer/track.js';

const load = (id: string): TrackDef => JSON.parse(readFileSync(new URL(`../tracks/${id}.json`, import.meta.url), 'utf8'));
const TRACKS = ['practice-1', 'practice-2', 'practice-3'].map(load);

/** A straight corridor 10 m wide along +x, for precise wall tests. */
function corridor(): TrackDef {
  return {
    format: 'rgp-track', version: 1, id: 'corridor', trackVersion: '1.0.0', name: 'Corridor', difficulty: 0,
    description: '', width: 10,
    centreline: [[-50, 0], [1000, 0]],
    walls: { left: [[-50, -5], [1000, -5], [1000, -6], [-50, -6]], right: [[-50, 5], [-50, 6], [1000, 6], [1000, 5]] },
    start: { x: -10, y: 0, heading: 0 },
    checkpoints: [[0, -5, 0, 5], [100, -5, 100, 5], [200, -5, 200, 5]],
    sectors: [1, 2], surfaces: [], decorations: [],
    bounds: { minX: -50, minY: -6, maxX: 1000, maxY: 6 },
  };
}

test('fsin/fcos match Math within 1e-9', () => {
  for (let x = -20; x <= 20; x += 0.0137) {
    assert.ok(Math.abs(fsin(x) - Math.sin(x)) < 1e-9, `sin ${x}`);
    assert.ok(Math.abs(fcos(x) - Math.cos(x)) < 1e-9, `cos ${x}`);
  }
});

test('fexp, ftanh, fsigmoid are accurate', () => {
  for (let x = -30; x <= 30; x += 0.071) {
    assert.ok(Math.abs(fexp(x) / Math.exp(x) - 1) < 1e-12, `exp ${x}`);
    assert.ok(Math.abs(ftanh(x) - Math.tanh(x)) < 1e-12, `tanh ${x}`);
    assert.ok(Math.abs(fsigmoid(x) - 1 / (1 + Math.exp(-x))) < 1e-12, `sigmoid ${x}`);
  }
  assert.equal(ftanh(50), 1);
  assert.equal(ftanh(-50), -1);
});

test('wrapAngle stays in [-pi, pi]', () => {
  for (let x = -100; x < 100; x += 0.37) {
    const w = wrapAngle(x);
    assert.ok(w >= -Math.PI - 1e-12 && w <= Math.PI + 1e-12);
    assert.ok(Math.abs(Math.sin(w) - Math.sin(x)) < 1e-9);
  }
});

test('quantise clamps, rounds and handles NaN', () => {
  assert.equal(quantise(1), 127);
  assert.equal(quantise(-1), -127);
  assert.equal(quantise(5), 127);
  assert.equal(quantise(-5), -127);
  assert.equal(quantise(0), 0);
  assert.equal(quantise(NaN), 0);
  assert.equal(dequantise(127), 1);
});

test('state hash: -0 equals 0 and any bit change alters it', () => {
  assert.equal(new StateHasher().f64(0).hex(), new StateHasher().f64(-0).hex());
  assert.notEqual(new StateHasher().f64(1).hex(), new StateHasher().f64(1 + Number.EPSILON).hex());
});

test('replay round-trips through binary and JSON, and rejects bad files', async () => {
  const rep = runPolicy(TRACKS[0], baselinePolicy, { kind: 'bot', name: 'baseline' });
  const bytes = await encodeReplay(rep);
  assert.ok(bytes.length < 4000, `replay is ${bytes.length} bytes`);
  const back = await decodeReplay(bytes);
  assert.deepEqual(back.header, rep.header);
  assert.deepEqual(Array.from(back.actions), Array.from(rep.actions));
  assert.deepEqual(replayFromJson(replayToJson(rep)).actions, rep.actions);
  await assert.rejects(decodeReplay(new Uint8Array([1, 2, 3, 4, 5, 6])), ReplayFormatError);
  await assert.rejects(decodeReplay(bytes.slice(0, 20)), ReplayFormatError);
});

test('every practice track validates', () => {
  for (const t of TRACKS) assert.deepEqual(validateTrack(t), [], t.id);
});

test('validator explains a broken track', () => {
  const t = structuredClone(TRACKS[0]);
  t.walls.right = t.walls.left.map(([x, y]) => [x + 1, y + 1]);
  const errs = validateTrack(t);
  assert.ok(errs.some((e) => e.includes('wide')), errs.join('; '));
});

test('baseline and tuned drivers finish every track; tuned is faster', () => {
  for (const t of TRACKS) {
    const b = runPolicy(t, baselinePolicy, { kind: 'bot' }).header.result;
    const s = runPolicy(t, tunedPolicy, { kind: 'bot' }).header.result;
    assert.ok(b.valid && s.valid, t.id);
    assert.ok((s.score as number) < (b.score as number) * 0.95, `${t.id}: tuned ${s.score} vs baseline ${b.score}`);
  }
});

test('a valid lap crosses every checkpoint in order', () => {
  for (const t of TRACKS) {
    const rep = runPolicy(t, tunedPolicy, { kind: 'bot' });
    const out = simulateReplay(t, rep);
    assert.equal(out.game.events.splits.length, t.checkpoints.length, t.id);
    const s = out.game.events.splits;
    for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1]);
  }
});

test('crossing the start line at launch does not finish the lap', () => {
  const g = new ReindeerGame(TRACKS[0]);
  for (let i = 0; i < 90; i++) g.step([[0, 127]]);
  assert.equal(g.finished, 0);
  assert.equal(g.nextCp, 1);
});

test('skipping a checkpoint does not count', () => {
  const t = TRACKS[0];
  const g = new ReindeerGame(t);
  // Teleport to just before checkpoint 3 while checkpoint 1 is still due.
  const cp = t.checkpoints[3];
  const fx = cp[3] - cp[1];
  const fy = -(cp[2] - cp[0]);
  const l = Math.hypot(fx, fy);
  g.x = (cp[0] + cp[2]) / 2 - (fx / l) * 4;
  g.y = (cp[1] + cp[3]) / 2 - (fy / l) * 4;
  g.heading = Math.atan2(fy, fx);
  g.vx = (fx / l) * 10;
  g.vy = (fy / l) * 10;
  for (let i = 0; i < 60; i++) g.step([[0, 60]]);
  assert.equal(g.nextCp, 1);
  assert.equal(g.events.splits.length, 0);
});

test('one wall contact costs exactly one penalty; scraping is charged once per cooldown', () => {
  const cfg = makeConfig();
  const g = new ReindeerGame(corridor(), cfg);
  const log: { pen: number; touch: number }[] = [];
  for (let i = 0; i < 200; i++) {
    g.step([[127, 127]]); // full right into the right wall and keep pushing
    log.push({ pen: g.penalties, touch: g.touching });
  }
  const t0 = log.findIndex((l) => l.touch === 1);
  assert.ok(t0 > 0, 'sleigh should reach the wall');
  assert.equal(log[t0].pen, 1);
  assert.equal(log[t0 - 1].pen, 0);
  const cont = log.slice(t0, t0 + 31).every((l) => l.touch === 1);
  assert.ok(cont, 'sleigh should stay pressed against the wall');
  assert.equal(log[t0 + cfg.penaltyCooldownTicks - 1].pen, 1);
  assert.equal(log[t0 + cfg.penaltyCooldownTicks].pen, 2);
  assert.equal(g.collisions, 1);
});

test('a run that never finishes times out with no valid time', () => {
  const g = new ReindeerGame(TRACKS[0], makeConfig({ timeoutTicks: 120 }));
  for (let i = 0; i < 500 && !g.isDone(); i++) g.step([[0, 0]]);
  assert.equal(g.timedOut, 1);
  assert.equal(g.tick, 120);
  const r = g.result();
  assert.equal(r.valid, false);
  assert.equal(r.score, Infinity);
});

test('tampering with a replay is detected', () => {
  const t = TRACKS[1];
  const rep = runPolicy(t, baselinePolicy, { kind: 'bot' });
  assert.ok(simulateReplay(t, rep).matches);
  rep.actions[200] = rep.actions[200] > 0 ? -100 : 100;
  const out = simulateReplay(t, rep);
  assert.equal(out.matches, false);
  assert.ok(out.firstMismatch >= 0);
});

test('training pairs are sampled at 20 Hz from a 60 Hz human recording', () => {
  const t = TRACKS[0];
  const rec = new Recorder(t, 1, { kind: 'human' });
  for (let i = 0; i < 300; i++) rec.tick([0, 127]);
  const { obs, actions } = extractTrainingPairs(t, rec.toReplay());
  assert.equal(obs.length, 100);
  assert.equal(actions.length, 100);
  assert.equal(obs[0].rays.length, 7);
  assert.ok(obs.every((o) => o.rays.every((r) => r >= 0 && r <= 1)));
});

test('the same inputs always give the same hash', () => {
  const a = runPolicy(TRACKS[2], tunedPolicy, { kind: 'bot' });
  const b = runPolicy(TRACKS[2], tunedPolicy, { kind: 'bot' });
  assert.equal(a.header.finalHash, b.header.finalHash);
  assert.deepEqual(a.header.hashes, b.header.hashes);
});
