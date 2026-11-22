import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeReplay } from '../engine/core/replay.js';
import type { BotFile } from '../engine/core/bot.js';
import type { TrackDef } from '../engine/reindeer/track.js';
import { badgesFor, type ResultFacts } from '../server/src/badges.js';
import { keyboardLap } from './helpers/keyboard-driver.js';
import { setup, teamUp } from './helpers/api-client.js';

const load = (id: string): TrackDef => JSON.parse(readFileSync(new URL(`../tracks/${id}.json`, import.meta.url), 'utf8'));
const goldenBot = (): BotFile => JSON.parse(readFileSync(new URL('../engine/golden/bots/bot-practice-1-relu.json', import.meta.url), 'utf8')).bot;

/** A hand-written 4-sensor bot: about 22 s on Frosty Oval, clean, well under the baseline's 27.5 s. */
function quickBot(name = 'Four eyes'): BotFile {
  return {
    format: 'rgp-bot', version: 1, game: 'reindeer-gp', meta: { name }, inputs: ['ray1', 'ray3', 'ray5', 'speed'], outputs: ['steer', 'throttle'],
    layers: [{ type: 'dense', in: 4, out: 2, activation: 'tanh', weights: [[-4, 0, 4, 0], [0, 12 * 0.9, 0, -12]], bias: [0, 12 * 0.5] }],
  };
}

test('badge rules', () => {
  const base: ResultFacts = {
    teamId: 't1', kind: 'bot', valid: true, score: 20, collisions: 0, replayId: 'p', onTwist: false, botInputs: 8,
    baselineScore: 25, previousLeader: null, leadsNow: false,
  };
  assert.deepEqual(badgesFor(base), ['clean-lap', 'beat-baseline']);
  assert.deepEqual(badgesFor({ ...base, botInputs: 4, collisions: 2 }), ['beat-baseline', 'less-is-more']);
  assert.deepEqual(badgesFor({ ...base, score: 30, collisions: 1, onTwist: true }), ['twist-tamer']);
  assert.deepEqual(badgesFor({ ...base, collisions: 1, leadsNow: true, previousLeader: 't2' }), ['beat-baseline', 'grinch-slayer']);
  assert.deepEqual(badgesFor({ ...base, collisions: 1, leadsNow: true, previousLeader: 't1' }), ['beat-baseline'], 'beating yourself is not slaying the Grinch');
  assert.deepEqual(badgesFor({ ...base, kind: 'human', collisions: 3 }), ['first-lap']);
  assert.deepEqual(badgesFor({ ...base, valid: false }), []);
});

test('badges are awarded automatically; standings and the digest follow the boards', async () => {
  const s = setup();
  const a = await s.client().login('aa1@cam.ac.uk');
  await teamUp(a, 'Sleigh Bells', 'elf', 'Trinity');
  const b = await s.client().login('bb2@cam.ac.uk');
  await teamUp(b, 'Four Eyes', 'reindeer', 'Trinity');
  const c = await s.client().login('cc3@cam.ac.uk');
  await teamUp(c, 'Kings Riders', 'santa', "King's");
  const d = await s.client().login('dd4@cam.ac.uk');
  await teamUp(d, 'Free Agents', 'santa', 'Mixed / none');

  // A: a saved lap of its own driving (First Lap), then the golden bot leads Frosty Oval.
  const lap = await encodeReplay(keyboardLap(load('practice-1'), 1, 0));
  assert.equal((await a.req('POST', '/api/v1/runs', lap, true, { 'content-type': 'application/octet-stream' })).status, 202);
  await a.post('/api/v1/submissions', { bot: goldenBot(), tracks: ['practice-1'] });
  await s.env.EVALUATOR.idle();
  const aBadges = (await a.get('/api/v1/teams/mine')).data.team.badges.map((x: { id: string }) => x.id);
  assert.ok(aBadges.includes('first-lap'), JSON.stringify(aBadges));
  assert.ok(!aBadges.includes('beat-baseline'), 'the golden bot (29 s) is slower than the baseline (27.5 s)');

  // B overtakes A with 4 sensors and no wall hits.
  await b.post('/api/v1/submissions', { bot: quickBot(), tracks: ['practice-1'] });
  await c.post('/api/v1/submissions', { bot: goldenBot(), tracks: ['practice-1'] });
  await d.post('/api/v1/submissions', { bot: quickBot('Free bot'), tracks: ['practice-1'] });
  await s.env.EVALUATOR.idle();
  const bTeam = (await b.get('/api/v1/teams/mine')).data.team;
  const bBadges = bTeam.badges.map((x: { id: string }) => x.id).sort();
  assert.deepEqual(bBadges, ['beat-baseline', 'clean-lap', 'grinch-slayer', 'less-is-more']);
  // Badges show on the public team page too, with a catalogue in /meta.
  assert.equal((await c.get(`/api/v1/teams/${bTeam.id}`)).data.team.badges.length, 4);
  assert.equal((await c.get('/api/v1/meta')).data.badges.length, 6);

  // The board shows the baseline as a reference.
  const board = (await a.get('/api/v1/boards/s1/practice-1/base/bots')).data;
  assert.equal(board.entries[0].team, 'Four Eyes');
  assert.ok(board.baseline.valid && Math.abs(board.baseline.score - 27.5) < 0.01, JSON.stringify(board.baseline));

  // Standings: 10/7/5/3 on Frosty Oval (the same golden bot: the earlier submission ranks higher).
  const st = (await a.get('/api/v1/standings')).data;
  const pts = Object.fromEntries(st.teams.map((t: { team: string; points: number }) => [t.team, t.points]));
  assert.deepEqual(pts, { 'Four Eyes': 10, 'Free Agents': 7, 'Sleigh Bells': 5, 'Kings Riders': 3 });
  assert.deepEqual(st.teams.map((t: { team: string }) => t.team), ['Four Eyes', 'Free Agents', 'Sleigh Bells', 'Kings Riders']);
  // Colleges: Trinity's two teams count; "Mixed / none" scores for itself only.
  assert.deepEqual(st.colleges.map((x: { college: string; points: number }) => [x.college, x.points]), [['Trinity', 15], ["King's", 3]]);
  assert.ok(st.formula.some((f: string) => /best 3 teams/.test(f)));

  // The digest is plain markdown, ready to paste.
  const dg = await a.get('/api/v1/digest.md?days=7');
  assert.equal(dg.status, 200);
  assert.match(dg.res.headers.get('content-type')!, /markdown/);
  const md: string = dg.data;
  assert.match(md, /^# 🦌 Reindeer Grand Prix: the week to /);
  assert.match(md, /Frosty Oval \(bots\): \*\*Four Eyes\*\* \(Trinity\) 22\.\d\d s 🆕/);
  assert.match(md, /## ⚡ New records/);
  assert.match(md, /👑 Grinch Slayer: Four Eyes/);
  assert.match(md, /1\. Trinity: 15 pts/);
  assert.equal((await a.get('/api/v1/digest.md?days=0')).status, 400);
});
