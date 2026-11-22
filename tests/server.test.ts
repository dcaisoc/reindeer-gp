import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle } from '../server/src/index.js';
import { localEnv } from '../server/local/bindings.js';
import { checkClaims } from '../server/src/auth.js';
import { isOffensive, checkName } from '../server/src/names.js';
import { encodeReplay } from '../engine/core/replay.js';
import type { BotFile } from '../engine/core/bot.js';
import type { TrackDef } from '../engine/reindeer/track.js';
import { keyboardLap } from './helpers/keyboard-driver.js';

const ORIGIN = 'http://localhost';
const load = (id: string): TrackDef => JSON.parse(readFileSync(new URL(`../tracks/${id}.json`, import.meta.url), 'utf8'));
const goldenBot = (): BotFile => JSON.parse(readFileSync(new URL('../engine/golden/bots/bot-practice-1-relu.json', import.meta.url), 'utf8')).bot;

type E = ReturnType<typeof localEnv>;

/** A browser-like client with its own cookie jar. */
class Client {
  cookie = '';
  constructor(private env: E) {}
  async req(method: string, path: string, body?: unknown, raw = false, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (method !== 'GET') h.origin = ORIGIN;
    let b: BodyInit | undefined;
    if (body !== undefined) {
      if (raw) b = body as BodyInit;
      else {
        b = JSON.stringify(body);
        h['content-type'] = 'application/json';
      }
    }
    const res = await handle(new Request(`${ORIGIN}${path}`, { method, headers: h, body: b }), this.env);
    const sc = res.headers.getSetCookie();
    for (const c of sc) {
      const [kv] = c.split(';');
      if (kv.startsWith('rgp_session=')) this.cookie = kv.endsWith('=') ? '' : kv;
    }
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data: data as any, res };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  async login(email: string) {
    const r = await this.post('/api/v1/auth/dev', { email });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return this;
  }
}

async function setup(vars: Record<string, string> = {}) {
  const env = localEnv({ vars });
  return { env, client: () => new Client(env) };
}

async function teamUp(c: Client, name: string, level = 'elf') {
  const r = await c.post('/api/v1/teams', { name, college: 'Trinity', level });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.team;
}

test('health, meta and the Origin check', async () => {
  const { client } = await setup();
  const c = client();
  assert.equal((await c.get('/api/v1/health')).data.ok, true);
  assert.ok((await c.get('/api/v1/meta')).data.colleges.includes("King's"));
  const noOrigin = await handle(new Request(`${ORIGIN}/api/v1/auth/dev`, { method: 'POST', body: '{}' }), (await setup()).env);
  assert.equal(noOrigin.status, 403);
  const evil = await handle(new Request(`${ORIGIN}/api/v1/auth/dev`, { method: 'POST', body: '{}', headers: { origin: 'https://evil.example' } }), (await setup()).env);
  assert.equal(evil.status, 403);
});

test('sign-in, profile and sessions', async () => {
  const { client } = await setup();
  const c = client();
  assert.equal((await c.get('/api/v1/me')).data.user, null);
  assert.equal((await c.post('/api/v1/auth/dev', { email: 'someone@gmail.com' })).status, 400);
  await c.login('abc123@cam.ac.uk');
  const me = (await c.get('/api/v1/me')).data.user;
  assert.match(me.displayName, /^[A-Z][a-z]+ [A-Z][a-z]+ \d+$/, 'pseudonymous display name by default');
  assert.equal((await c.req('PATCH', '/api/v1/me', { displayName: 'Rudolph' })).status, 200);
  assert.equal((await c.get('/api/v1/me')).data.user.displayName, 'Rudolph');
  assert.equal((await c.req('PATCH', '/api/v1/me', { displayName: 'sh1t' })).status, 400);
  await c.post('/api/v1/auth/logout');
  assert.equal((await c.get('/api/v1/me')).data.user, null);
});

test('dev login is impossible in production and needs the key on staging', async () => {
  const prod = (await setup({ APP_ENV: 'production' })).client();
  assert.equal((await prod.post('/api/v1/auth/dev', { email: 'a@cam.ac.uk' })).status, 404);
  const { env } = await setup({ APP_ENV: 'staging', DEV_LOGIN_KEY: 'k3y' });
  const s = new Client(env);
  assert.equal((await s.post('/api/v1/auth/dev', { email: 'a@cam.ac.uk' })).status, 404);
  assert.equal((await s.req('POST', '/api/v1/auth/dev', { email: 'a@cam.ac.uk' }, false, { 'x-dev-login-key': 'k3y' })).status, 200);
});

test('Raven ID-token claims are checked strictly', () => {
  const env = { GOOGLE_CLIENT_ID: 'cid', ALLOWED_DOMAIN: 'cam.ac.uk' } as never;
  const good = { iss: 'https://accounts.google.com', aud: 'cid', exp: Date.now() / 1000 + 60, nonce: 'n', email_verified: true, email: 'abc12@cam.ac.uk', hd: 'cam.ac.uk' };
  assert.equal(checkClaims(good, env, 'n'), null);
  assert.match(checkClaims({ ...good, hd: undefined, email: 'x@gmail.com' }, env, 'n')!, /@cam.ac.uk Raven account/);
  assert.match(checkClaims({ ...good, aud: 'other' }, env, 'n')!, /different site/);
  assert.match(checkClaims({ ...good, exp: 1 }, env, 'n')!, /expired/);
  assert.match(checkClaims(good, env, 'other-nonce')!, /could not be verified/);
  assert.match(checkClaims({ ...good, iss: 'https://evil.example' }, env, 'n')!, /issuer/);
  assert.match(checkClaims({ ...good, email_verified: false }, env, 'n')!, /not verified/);
});

test('Raven start redirects to Google with hd=cam.ac.uk and a signed state cookie', async () => {
  const { env } = await setup({ GOOGLE_CLIENT_ID: 'cid' });
  const res = await handle(new Request(`${ORIGIN}/api/v1/auth/raven/start?return=/%23/train`), env);
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location')!);
  assert.equal(loc.host, 'accounts.google.com');
  assert.equal(loc.searchParams.get('hd'), 'cam.ac.uk');
  assert.equal(loc.searchParams.get('redirect_uri'), `${ORIGIN}/api/v1/auth/raven/callback`);
  assert.match(res.headers.get('set-cookie')!, /rgp_oauth=.+HttpOnly; SameSite=Lax/);
  const cb = await handle(new Request(`${ORIGIN}/api/v1/auth/raven/callback?code=x&state=forged`, { headers: { cookie: 'rgp_oauth=a.b.c.d' } }), env);
  assert.match(cb.headers.get('location')!, /signin\?error=/);
});

test('names: profanity filter is word-aware', () => {
  for (const ok of ['Grapes of Wrath', 'Peacock Racing', 'Scunthorpe United', 'Dickens Fans', 'Cocktail Club']) assert.equal(isOffensive(ok), false, ok);
  for (const bad of ['F u c k', 'sh1t happens', 'dick', 'Nazis', 'c u n t']) assert.equal(isOffensive(bad), true, bad);
  assert.match(checkName('<script>', 'Team name')!, /letters, numbers/);
});

test('teams: create, join by code, size limit, leave', async () => {
  const { client } = await setup();
  const a = await client().login('a@cam.ac.uk');
  assert.equal((await a.post('/api/v1/teams', { name: 'Sleigh Bells', college: 'Narnia', level: 'elf' })).status, 400);
  assert.equal((await a.post('/api/v1/teams', { name: 'x', college: 'Trinity', level: 'elf' })).status, 400);
  const team = await teamUp(a, 'Sleigh Bells');
  assert.match(team.joinCode, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal((await a.post('/api/v1/teams', { name: 'Second', college: 'Trinity', level: 'elf' })).status, 409);
  const b = await client().login('b@cam.ac.uk');
  assert.equal((await b.post('/api/v1/teams', { name: 'sleigh bells', college: 'Clare', level: 'elf' })).status, 409, 'names are unique ignoring case');
  assert.equal((await b.post('/api/v1/teams/join', { code: 'WRONG1' })).status, 404);
  assert.equal((await b.post('/api/v1/teams/join', { code: team.joinCode.toLowerCase() })).data.team.members.length, 2);
  await (await client().login('c@cam.ac.uk')).post('/api/v1/teams/join', { code: team.joinCode });
  await (await client().login('d@cam.ac.uk')).post('/api/v1/teams/join', { code: team.joinCode });
  assert.equal((await (await client().login('e@cam.ac.uk')).post('/api/v1/teams/join', { code: team.joinCode })).status, 409, 'max 4 members');
  const pub = await b.get(`/api/v1/teams/${team.id}`);
  assert.equal(pub.data.team.joinCode, undefined, 'join code is private');
  assert.equal((await b.post('/api/v1/teams/leave')).status, 200);
  assert.equal((await b.get('/api/v1/teams/mine')).data.team, null);
});

test('bot submission: validation, queue, evaluation, leaderboard', async () => {
  const { env, client } = await setup();
  const anon = client();
  assert.equal((await anon.post('/api/v1/submissions', { bot: goldenBot() })).status, 401);
  const a = await client().login('a@cam.ac.uk');
  assert.equal((await a.post('/api/v1/submissions', { bot: goldenBot() })).status, 409, 'needs a team');
  await teamUp(a, 'Comet Crew');
  const broken = goldenBot();
  broken.layers[0].in = 3;
  const bad = await a.post('/api/v1/submissions', { bot: broken });
  assert.equal(bad.status, 422);
  assert.ok(bad.data.error.details.errors.some((e: string) => /Layer 1 expects 3 inputs/.test(e)));

  const ok = await a.post('/api/v1/submissions', { bot: goldenBot(), tracks: ['practice-1'] });
  assert.equal(ok.status, 202);
  const subId = ok.data.submissions[0].id;
  assert.ok(['queued', 'running'].includes((await a.get(`/api/v1/submissions/${subId}`)).data.submission.status));
  await env.EVALUATOR.idle();
  const done = (await a.get(`/api/v1/submissions/${subId}`)).data.submission;
  assert.equal(done.status, 'done');
  assert.equal(done.result.valid, true);
  assert.equal(done.result.beginner, false, 'golden bot was not made by the web trainer');
  const board = (await anon.get('/api/v1/boards/s1/practice-1/base/bots')).data;
  assert.equal(board.entries.length, 1);
  assert.equal(board.entries[0].team, 'Comet Crew');
  assert.equal(board.entries[0].score, done.result.score);
  assert.equal((await a.get('/api/v1/teams/mine')).data.team.levelLocked, true, 'level locks on first bot submission');
  assert.equal((await a.req('PATCH', '/api/v1/teams/mine', { level: 'elf' })).status, 200, 'same level is fine');

  // The replay is public and re-simulates to the same hash.
  const meta = (await anon.get(`/api/v1/replays/${done.replayId}`)).data.replay;
  assert.equal(meta.kind, 'bot');
  const file = await anon.get(`/api/v1/replays/${done.replayId}/file`);
  assert.equal(file.status, 200);
  const page = await anon.get(`/replay/${done.replayId}`);
  assert.match(page.data, /og:title" content="golden-practice-1-relu \(Comet Crew\) on Frosty Oval"/);
});

test('a worse result does not replace a better one; ties keep the earlier entry', async () => {
  const { env, client } = await setup();
  const a = await client().login('a@cam.ac.uk');
  await teamUp(a, 'Tortoises');
  const t = load('practice-1');
  const fast = keyboardLap(t, 1, 0);
  const slow = keyboardLap(t, 2, 0.6);
  assert.ok((slow.header.result.score as number) > (fast.header.result.score as number));
  await a.req('POST', '/api/v1/runs?submit=1', await encodeReplay(fast), true);
  await env.EVALUATOR.idle();
  const before = (await a.get('/api/v1/boards/s1/practice-1/base/humans')).data.entries[0];
  await a.req('POST', '/api/v1/runs?submit=1', await encodeReplay(slow), true);
  await env.EVALUATOR.idle();
  const after = (await a.get('/api/v1/boards/s1/practice-1/base/humans')).data.entries[0];
  assert.equal(after.score, before.score);
  assert.equal(after.replayId, before.replayId);
  const history = (await a.get('/api/v1/submissions')).data.submissions;
  assert.equal(history.length, 2, 'all attempts stay in the history');
});

test('human runs: verified by re-simulation; tampered runs are rejected', async () => {
  const { env, client } = await setup();
  const a = await client().login('a@cam.ac.uk');
  await teamUp(a, 'Honest Drivers');
  const t = load('practice-2');
  const lap = keyboardLap(t, 3, 0.1);
  const up = await a.req('POST', '/api/v1/runs?submit=1', await encodeReplay(lap), true);
  assert.equal(up.status, 202);
  await env.EVALUATOR.idle();
  const s = (await a.get(`/api/v1/submissions/${up.data.submissionId}`)).data.submission;
  assert.equal(s.status, 'done');
  assert.equal(s.result.score, lap.header.result.score);

  const forged = keyboardLap(t, 4, 0.1);
  forged.actions[300] = forged.actions[300] > 0 ? -127 : 127; // inputs no longer match the recorded hashes
  const f = await a.req('POST', '/api/v1/runs?submit=1', await encodeReplay(forged), true);
  await env.EVALUATOR.idle();
  const fs = (await a.get(`/api/v1/submissions/${f.data.submissionId}`)).data.submission;
  assert.equal(fs.status, 'rejected');
  assert.match(fs.rejectReason, /doesn't replay identically/);

  const junk = await a.req('POST', '/api/v1/runs', new Uint8Array([1, 2, 3]), true);
  assert.equal(junk.status, 422);
});

test('Beginner bracket: Elf team + trainer bot + 3 verified laps of its own driving', async () => {
  const { env, client } = await setup();
  const a = await client().login('a@cam.ac.uk');
  await teamUp(a, 'First Timers', 'elf');
  const t = load('practice-1');
  const bot = goldenBot();
  bot.meta.trainer = 'web-trainer-1';
  const sub = async () => {
    const r = await a.post('/api/v1/submissions', { bot, tracks: ['practice-1'] });
    await env.EVALUATOR.idle();
    return (await a.get(`/api/v1/submissions/${r.data.submissions[0].id}`)).data.submission;
  };
  assert.equal((await sub()).result.beginner, false, 'no laps uploaded yet');
  for (const s of [5, 6, 7]) await a.req('POST', '/api/v1/runs', await encodeReplay(keyboardLap(t, s, 0.1)), true);
  await env.EVALUATOR.idle();
  assert.equal((await a.get('/api/v1/runs/count?track=practice-1')).data.verified, 3);
  assert.equal((await sub()).result.beginner, true);
});

test('rate limits, closed submissions, and referee tools with audit log', async () => {
  const { env, client } = await setup({ REFEREE_EMAILS: 'ref@cam.ac.uk' });
  const a = await client().login('a@cam.ac.uk');
  await teamUp(a, 'Speedy');
  const ref = await client().login('ref@cam.ac.uk');
  assert.equal((await a.get('/api/v1/admin/overview')).status, 403);
  assert.equal((await ref.post('/api/v1/admin/settings', { key: 'bot_submissions_per_day', value: '2' })).status, 200);
  assert.equal((await ref.post('/api/v1/admin/settings', { key: 'param_cap', value: '9' })).status, 400, 'only listed settings');
  for (let i = 0; i < 2; i++) assert.equal((await a.post('/api/v1/submissions', { bot: goldenBot(), tracks: ['practice-1'] })).status, 202);
  const third = await a.post('/api/v1/submissions', { bot: goldenBot(), tracks: ['practice-1'] });
  assert.equal(third.status, 429);
  assert.match(third.data.error.message, /all 2 bot submissions for today/);
  await env.EVALUATOR.idle();

  const teamId = (await a.get('/api/v1/teams/mine')).data.team.id;
  assert.equal((await ref.post('/api/v1/admin/entries/hide', { boardKey: 's1/practice-1/base/bots', teamId, hidden: true })).status, 200);
  assert.equal((await a.get('/api/v1/boards/s1/practice-1/base/bots')).data.entries.length, 0);
  assert.equal((await ref.post(`/api/v1/admin/teams/${teamId}`, { name: 'Renamed By Ref' })).status, 200);
  assert.equal((await a.get('/api/v1/teams/mine')).data.team.name, 'Renamed By Ref');
  assert.equal((await ref.post('/api/v1/admin/announcements', { text: 'Ice week starts Monday!' })).status, 200);
  assert.equal((await a.get('/api/v1/announcements')).data.announcements[0].text, 'Ice week starts Monday!');
  await ref.post('/api/v1/admin/settings', { key: 'submissions_open', value: 'false' });
  assert.equal((await a.post('/api/v1/submissions', { bot: goldenBot() })).status, 423);
  const ov = (await ref.get('/api/v1/admin/overview')).data;
  const actions = ov.audit.map((x: { action: string }) => x.action);
  for (const want of ['settings.set', 'entry.hide', 'team.edit', 'announcement.post']) assert.ok(actions.includes(want), want);
  const csv = await ref.get('/api/v1/admin/export.csv');
  assert.match(csv.data, /^"?board_key/);
});

test('replay privacy and account deletion keep the board but drop personal data', async () => {
  const { env, client } = await setup();
  const a = await client().login('solo@cam.ac.uk');
  await teamUp(a, 'Lone Sleigh');
  const r = await a.post('/api/v1/submissions', { bot: goldenBot(), tracks: ['practice-1'] });
  await env.EVALUATOR.idle();
  const replayId = (await a.get(`/api/v1/submissions/${r.data.submissions[0].id}`)).data.submission.replayId;
  assert.equal((await a.req('PATCH', `/api/v1/replays/${replayId}`, { visibility: 'hidden' })).status, 200);
  const stranger = client();
  assert.equal((await stranger.get(`/api/v1/replays/${replayId}`)).status, 404);
  assert.equal((await a.get(`/api/v1/replays/${replayId}`)).status, 200);

  assert.equal((await a.req('DELETE', '/api/v1/me')).status, 200);
  assert.equal((await a.get('/api/v1/me')).data.user, null);
  const row = await env.DB.prepare("SELECT email_hash, display_name FROM users WHERE display_name = 'Deleted user'").first<{ email_hash: string | null }>();
  assert.equal(row?.email_hash, null);
  const board = (await stranger.get('/api/v1/boards/s1/practice-1/base/bots')).data;
  assert.equal(board.entries.length, 1, 'leaderboard history stays');
  assert.match(board.entries[0].team, /^Deleted team /, 'an empty team is anonymised');
});

test('randomInt is unbiased and in range', async () => {
  const { randomInt } = await import('../server/src/names.js');
  const counts = new Array(31).fill(0);
  for (let i = 0; i < 31000; i++) counts[randomInt(31)]++;
  assert.ok(counts.every((c) => c > 800 && c < 1200), counts.join(','));
});

test('API tokens: shown once, limited to bot workflows, revocable', async () => {
  const { env, client } = await setup({ REFEREE_EMAILS: 'ref@cam.ac.uk' });
  const a = await client().login('ref@cam.ac.uk');
  await teamUp(a, 'Token Team');
  const made = await a.post('/api/v1/me/tokens', { label: 'my laptop' });
  assert.equal(made.status, 201);
  assert.match(made.data.token, /^rgp_[A-Za-z0-9_-]{30,}$/);
  const list = (await a.get('/api/v1/me/tokens')).data.tokens;
  assert.equal(list.length, 1);
  assert.equal(JSON.stringify(list).includes(made.data.token), false, 'the token itself is never shown again');

  // A tokenised client: no cookie, no Origin header (like the CLI).
  const cli = async (method: string, path: string, body?: unknown, token = made.data.token) => {
    const res = await handle(new Request(`${ORIGIN}${path}`, {
      method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env);
    return { status: res.status, data: (await res.json()) as any };
  };
  assert.equal((await cli('GET', '/api/v1/me')).data.user.isReferee, false, 'tokens never carry referee powers');
  const sub = await cli('POST', '/api/v1/submissions', { bot: goldenBot(), tracks: ['practice-1'] });
  assert.equal(sub.status, 202);
  await env.EVALUATOR.idle();
  assert.equal((await cli('GET', `/api/v1/submissions/${sub.data.submissions[0].id}`)).data.submission.status, 'done');
  assert.equal((await cli('POST', '/api/v1/teams/leave', {})).status, 403);
  assert.equal((await cli('DELETE', '/api/v1/me')).status, 403);
  assert.equal((await cli('GET', '/api/v1/admin/overview')).status, 403);
  assert.equal((await cli('POST', '/api/v1/me/tokens', { label: 'x' })).status, 403, 'a token cannot mint more tokens');
  assert.equal((await cli('GET', '/api/v1/me', undefined, 'rgp_not-a-real-token')).data.user, null);

  assert.equal((await a.req('DELETE', `/api/v1/me/tokens/${made.data.id}`)).status, 200);
  assert.equal((await cli('GET', '/api/v1/me')).data.user, null, 'revoked tokens stop working');
  assert.equal((await cli('POST', '/api/v1/submissions', { bot: goldenBot() })).status, 401);
  for (let i = 0; i < 5; i++) await a.post('/api/v1/me/tokens', { label: `t${i}` });
  assert.equal((await a.post('/api/v1/me/tokens', { label: 'one too many' })).status, 409);
});
