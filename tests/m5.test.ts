import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeReplay, encodeReplay, ReplayFormatError } from '../engine/core/replay.js';
import type { BotFile } from '../engine/core/bot.js';
import { validateBotForEngine as validateBot } from '../engine/reindeer/bot-policy.js';
import type { TrackDef } from '../engine/reindeer/track.js';
import { mulberry32 } from '../engine/core/quant.js';
import { keyboardLap } from './helpers/keyboard-driver.js';
import { setup, teamUp } from './helpers/api-client.js';
import { blobs } from '../server/src/blobs.js';

const p1: TrackDef = JSON.parse(readFileSync(new URL('../tracks/practice-1.json', import.meta.url), 'utf8'));
const goldenBot = (): BotFile => JSON.parse(readFileSync(new URL('../engine/golden/bots/bot-practice-1-relu.json', import.meta.url), 'utf8')).bot;

test('assisted laps are labelled on the Human board', async () => {
  const s = setup();
  const c = await s.client().login('as1@cam.ac.uk');
  await teamUp(c, 'Steady Sleigh');
  const lap = keyboardLap(p1, 2, 0);
  lap.header.participants[0].assist = ['slow-50', 'auto-throttle'];
  const r = await c.req('POST', '/api/v1/runs?submit=1', await encodeReplay(lap), true, { 'content-type': 'application/octet-stream' });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  await s.env.EVALUATOR.idle();
  const board = (await c.get('/api/v1/boards/s1/practice-1/base/humans')).data;
  assert.equal(board.entries.length, 1);
  assert.equal(board.entries[0].assisted, true);
});

test('nightly integrity check: passes on honest results, catches tampering', async () => {
  const s = setup({ REFEREE_EMAILS: 'ref@cam.ac.uk' });
  const c = await s.client().login('in1@cam.ac.uk');
  await teamUp(c, 'Honest Elves');
  await c.post('/api/v1/submissions', { bot: goldenBot(), tracks: ['practice-1'] });
  await c.req('POST', '/api/v1/runs?submit=1', await encodeReplay(keyboardLap(p1, 1, 0)), true, { 'content-type': 'application/octet-stream' });
  await s.env.EVALUATOR.idle();
  const ref = await s.client().login('ref@cam.ac.uk');
  const ok = await ref.post('/api/v1/admin/verify');
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.data.checked, ok.data.mismatches], [2, 0]);
  assert.ok((await s.env.DB.prepare('SELECT verified_at FROM leaderboard_entries LIMIT 1').first<{ verified_at: string }>())!.verified_at);

  // Someone edits the database: a better score on the board, and a swapped bot file.
  await s.env.DB.prepare("UPDATE leaderboard_entries SET score = score - 5 WHERE board_key LIKE '%/humans'").run();
  const bot = (await s.env.DB.prepare('SELECT r2_key FROM bots LIMIT 1').first<{ r2_key: string }>())!;
  const evil = goldenBot();
  evil.layers[0].bias = evil.layers[0].bias.map((b) => b + 0.5);
  await blobs(s.env).put(bot.r2_key, JSON.stringify(evil));
  const bad = await ref.post('/api/v1/admin/verify');
  assert.equal(bad.data.mismatches, 2, JSON.stringify(bad.data));
  assert.ok(bad.data.details.some((d: string) => /board says/.test(d)));
  assert.ok(bad.data.details.some((d: string) => /no longer produces/.test(d)));
  const ov = (await ref.get('/api/v1/admin/overview')).data;
  assert.equal(ov.integrity.mismatches, 2);
  assert.ok(ov.audit.some((a: { action: string }) => a.action === 'integrity.mismatch'));
});

test('fuzz: the replay parser never crashes on corrupted files, only refuses them', async () => {
  const good = await encodeReplay(keyboardLap(p1, 3, 0.2));
  const rand = mulberry32(99);
  let refused = 0;
  for (let i = 0; i < 400; i++) {
    const b = new Uint8Array(good);
    const kind = i % 4;
    if (kind === 0) for (let k = 0; k < 1 + (i % 8); k++) b[Math.floor(rand() * b.length)] ^= 1 + Math.floor(rand() * 255);
    const bytes = kind === 1 ? b.slice(0, Math.floor(rand() * b.length)) : kind === 2 ? Uint8Array.from({ length: Math.floor(rand() * 300) }, () => Math.floor(rand() * 256)) : kind === 3 ? new Uint8Array([...b, ...b.slice(0, 50)]) : b;
    try {
      const r = await decodeReplay(bytes);
      // If it decodes, it must still be a well-formed replay object.
      assert.equal(typeof r.header, 'object');
      assert.ok(r.actions instanceof Int8Array || Array.isArray(r.actions));
    } catch (e) {
      assert.ok(e instanceof ReplayFormatError, `unexpected ${e instanceof Error ? e.constructor.name : typeof e}: ${e}`);
      refused++;
    }
  }
  assert.ok(refused > 300);
});

test('fuzz: the bot validator returns messages (never throws) for random mutations', () => {
  const rand = mulberry32(7);
  const base = goldenBot();
  const junk = [null, 'x', -1, 1e309, NaN, {}, [], [[1]], 3.5, true, 99999];
  for (let i = 0; i < 2000; i++) {
    const bot = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
    const path = pick([['format'], ['version'], ['inputs'], ['outputs'], ['layers'], ['meta'], ['layers', 0], ['layers', 0, 'weights'], ['layers', 0, 'bias'], ['layers', 1, 'in'], ['layers', 0, 'activation'], ['layers', 0, 'weights', 0], ['layers', 0, 'weights', 0, 3]]);
    let o: unknown = bot;
    for (let k = 0; k < path.length - 1; k++) o = (o as Record<string | number, unknown>)?.[path[k]];
    if (o && typeof o === 'object') (o as Record<string | number, unknown>)[path[path.length - 1]] = pick(junk);
    let res: { errors: string[] } | undefined;
    assert.doesNotThrow(() => (res = validateBot(bot)), `mutation ${path.join('.')}`);
    assert.ok(Array.isArray(res!.errors));
  }
});
