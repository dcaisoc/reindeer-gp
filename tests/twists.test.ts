import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeReplay, decodeReplay } from '../engine/core/replay.js';
import type { BotFile } from '../engine/core/bot.js';
import type { TwistDef } from '../engine/reindeer/twist.js';
import { keyboardLap } from './helpers/keyboard-driver.js';
import { setup, teamUp, type Client } from './helpers/api-client.js';

const twist = (id: string): TwistDef => JSON.parse(readFileSync(new URL(`../tracks/twists/${id}.json`, import.meta.url), 'utf8'));
const goldenBot = (): BotFile => JSON.parse(readFileSync(new URL('../engine/golden/bots/bot-practice-1-relu.json', import.meta.url), 'utf8')).bot;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A tiny 3-ray bot: it can race at night (and, with different meanings, in daylight). */
function threeRayBot(name = 'Night owl'): BotFile {
  return {
    format: 'rgp-bot', version: 1, game: 'reindeer-gp', meta: { name }, inputs: ['ray0', 'ray1', 'ray2', 'speed'], outputs: ['steer', 'throttle'],
    layers: [{ type: 'dense', in: 4, out: 2, activation: 'tanh', weights: [[-2, 0, 2, 0], [0, 1.5, 0, -1.2]], bias: [0, 0.3] }],
  };
}

async function referee(env: ReturnType<typeof setup>, email = 'ref@cam.ac.uk'): Promise<Client> {
  return env.client().login(email);
}

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

test('twists: upload is checked, hidden until live, live on schedule, announced, override, then ended', async () => {
  const s = setup({ REFEREE_EMAILS: 'ref@cam.ac.uk' });
  const ref = await referee(s);
  const player = await s.client().login('abc12@cam.ac.uk');
  await teamUp(player, 'Night Riders');

  // Only referees can upload, and bad files are explained.
  assert.equal((await player.post('/api/v1/admin/twists', twist('night-oval'))).status, 403);
  const bad = await ref.post('/api/v1/admin/twists', { ...twist('night-oval'), config: { rayAnglesDeg: [10, -10], warp: 3 } });
  assert.equal(bad.status, 422);
  assert.ok(bad.data.error.details.errors.some((e: string) => /rayAnglesDeg/.test(e)), JSON.stringify(bad.data));
  assert.ok(bad.data.error.details.errors.some((e: string) => /warp can't be changed/.test(e)));

  const up = await ref.post('/api/v1/admin/twists', twist('night-oval'));
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.equal(up.data.baseline.valid, true, 'the baseline bot finishes the twist');

  // Staged: invisible to players (no spoilers), visible to referees.
  assert.deepEqual((await player.get('/api/v1/twists')).data.twists, []);
  assert.equal((await player.get('/api/v1/twists/night-oval')).status, 404);
  assert.equal((await ref.get('/api/v1/twists/night-oval')).data.schedule.status, 'staged');
  assert.equal((await player.post('/api/v1/submissions', { bot: threeRayBot(), tracks: ['night-oval'] })).status, 400);

  // Scheduled 1.2 s ahead: not yet, then live on its own with an announcement.
  const sched = await ref.patch('/api/v1/admin/twists/night-oval', { liveFrom: iso(1200) });
  assert.equal(sched.status, 200, JSON.stringify(sched.data));
  assert.equal(sched.data.status, 'staged');
  assert.deepEqual((await player.get('/api/v1/twists')).data.twists, []);
  await sleep(1400);
  const live = (await player.get('/api/v1/twists')).data.twists;
  assert.equal(live.length, 1);
  assert.equal(live[0].status, 'live');
  assert.deepEqual(live[0].inputs.slice(0, 4), ['ray0', 'ray1', 'ray2', 'speed']);
  const ann = (await player.get('/api/v1/announcements')).data.announcements;
  assert.ok(ann.some((a: { text: string }) => a.text.startsWith('New twist live: Frosty Oval by Night')), JSON.stringify(ann));
  const full = await player.get('/api/v1/twists/night-oval');
  assert.equal(full.data.twist.track.id, 'night-oval');

  // A 7-ray bot is entered everywhere except at night; a 3-ray bot also races at night.
  const seven = await player.post('/api/v1/submissions', { bot: goldenBot() });
  assert.equal(seven.status, 202, JSON.stringify(seven.data));
  assert.deepEqual(seven.data.submissions.map((x: { trackId: string }) => x.trackId), ['practice-1', 'practice-2', 'practice-3']);
  assert.equal(seven.data.skipped[0].trackId, 'night-oval');
  assert.match(seven.data.skipped[0].reason, /ray3/);
  const three = await player.post('/api/v1/submissions', { bot: threeRayBot(), tracks: ['night-oval'] });
  assert.equal(three.status, 202, JSON.stringify(three.data));
  await s.env.EVALUATOR.idle();
  const done = (await player.get(`/api/v1/submissions/${three.data.submissions[0].id}`)).data.submission;
  assert.equal(done.status, 'done', JSON.stringify(done));

  // Its own board, with the baseline as a reference row; the replay records the twist.
  const board = (await player.get('/api/v1/boards/s1/practice-1/night-oval/bots')).data;
  assert.equal(board.trackName, 'Frosty Oval by Night');
  assert.equal(board.twist.id, 'night-oval');
  assert.equal(board.entries.length, 1);
  assert.equal(board.baseline.valid, true);
  const file = await player.req('GET', `/api/v1/replays/${board.entries[0].replayId}/file`);
  const rep = await decodeReplay(file.data);
  assert.deepEqual(rep.header.twist, { id: 'night-oval', version: '1.0.0' });
  const boards = (await player.get('/api/v1/boards')).data.boards;
  assert.ok(boards.some((b: { key: string }) => b.key === 's1/practice-1/night-oval/bots'));

  // Human laps on the twist are verified with the twist's config.
  const lap = keyboardLap(twist('night-oval').track, 1, 0, twist('night-oval'));
  const run = await player.req('POST', '/api/v1/runs?submit=1', await encodeReplay(lap), true, { 'content-type': 'application/octet-stream' });
  assert.equal(run.status, 202, JSON.stringify(run.data));
  await s.env.EVALUATOR.idle();
  assert.equal((await player.get('/api/v1/boards/s1/practice-1/night-oval/humans')).data.entries.length, 1);

  // The referee takes it down early: it ends, entries stop, boards stay.
  const off = await ref.patch('/api/v1/admin/twists/night-oval', { override: 'off' });
  assert.equal(off.data.status, 'ended');
  assert.equal((await player.get('/api/v1/twists')).data.twists[0].status, 'ended');
  const late = await player.post('/api/v1/submissions', { bot: threeRayBot(), tracks: ['night-oval'] });
  assert.equal(late.status, 400);
  assert.match(late.data.error.message, /not open/);
  assert.equal((await player.get('/api/v1/boards/s1/practice-1/night-oval/bots')).data.entries.length, 1);

  // Once it has been live it can't be replaced or deleted (boards are fixed).
  assert.equal((await ref.post('/api/v1/admin/twists', { ...twist('night-oval'), twistVersion: '1.0.1', track: { ...twist('night-oval').track, trackVersion: '1.0.1' } })).status, 409);
  assert.equal((await ref.del('/api/v1/admin/twists/night-oval')).status, 409);

  const audit = (await ref.get('/api/v1/admin/overview')).data.audit.map((a: { action: string }) => a.action);
  for (const a of ['twist.upload', 'twist.schedule', 'twist.live']) assert.ok(audit.includes(a), `${a} in audit log`);
});

test('twists: the manual override flips a scheduled twist live early, and back to the schedule', async () => {
  const s = setup({ REFEREE_EMAILS: 'ref@cam.ac.uk' });
  const ref = await referee(s);
  await ref.post('/api/v1/admin/twists', twist('reverse-glacier'));
  await ref.patch('/api/v1/admin/twists/reverse-glacier', { liveFrom: iso(7 * 24 * 3600e3), liveUntil: iso(14 * 24 * 3600e3) });
  const p = await s.client().login('xyz9@cam.ac.uk');
  assert.deepEqual((await p.get('/api/v1/twists')).data.twists, []);
  assert.equal((await ref.patch('/api/v1/admin/twists/reverse-glacier', { override: 'live' })).data.status, 'live');
  assert.equal((await p.get('/api/v1/twists')).data.twists[0].status, 'live');
  // Back to the schedule: it has been public, so it shows as ended until its slot.
  assert.equal((await ref.patch('/api/v1/admin/twists/reverse-glacier', { override: null })).data.status, 'ended');
  assert.equal((await ref.patch('/api/v1/admin/twists/reverse-glacier', { liveUntil: iso(-1000) })).status, 400, 'end before start is refused');
});

test('twists: a dry run races every team\'s latest bot privately, without touching the boards', async () => {
  const s = setup({ REFEREE_EMAILS: 'ref@cam.ac.uk' });
  const ref = await referee(s);
  const a = await s.client().login('aa1@cam.ac.uk');
  await teamUp(a, 'Sleigh Bells');
  const b = await s.client().login('bb2@cam.ac.uk');
  await teamUp(b, 'Night Owls', 'santa', "King's");
  await a.post('/api/v1/submissions', { bot: goldenBot() });
  await b.post('/api/v1/submissions', { bot: threeRayBot() });
  await s.env.EVALUATOR.idle();
  const entriesBefore = (await s.env.DB.prepare('SELECT COUNT(*) AS n FROM leaderboard_entries').first<{ n: number }>())!.n;

  await ref.post('/api/v1/admin/twists', twist('ice-hairpins'));
  const dr = await ref.post('/api/v1/admin/twists/ice-hairpins/dry-run');
  assert.equal(dr.status, 202);
  await s.env.EVALUATOR.idle();
  const row = (await ref.get('/api/v1/admin/twists')).data.twists.find((t: { id: string }) => t.id === 'ice-hairpins');
  assert.equal(row.status, 'staged');
  assert.equal(row.dryRun.status, 'done', JSON.stringify(row.dryRun));
  assert.equal(row.dryRun.results.bots.length, 2);
  assert.ok(row.dryRun.results.baseline.valid);
  assert.ok(row.dryRun.results.bots.every((x: { team: string }) => ['Sleigh Bells', 'Night Owls'].includes(x.team)));

  // Nothing public changed.
  const entriesAfter = (await s.env.DB.prepare('SELECT COUNT(*) AS n FROM leaderboard_entries').first<{ n: number }>())!.n;
  assert.equal(entriesAfter, entriesBefore);
  assert.equal((await a.get('/api/v1/boards/s1/practice-2/ice-hairpins/bots')).status, 400);
  assert.deepEqual((await a.get('/api/v1/twists')).data.twists, []);
  // A twist that never went live can be replaced and deleted.
  assert.equal((await ref.post('/api/v1/admin/twists', { ...twist('ice-hairpins'), name: 'Pine Hairpins on Ice (v2)' })).status, 200);
  assert.equal((await ref.del('/api/v1/admin/twists/ice-hairpins')).status, 200);
});
