#!/usr/bin/env node
/**
 * Load test: N simulated players arrive over a few minutes (the "kickoff
 * stampede"). Each signs in (test sign-in), creates a team, looks at the
 * boards, submits a bot, waits for its result and watches the board until its
 * entry appears, polling like a real browser tab. Passes when there are no
 * errors and every entry shows on its board within 30 s of being scored.
 *
 * Staging (needs DEV_LOGIN_KEY, the staging test sign-in secret):
 *   DEV_LOGIN_KEY=... node scripts/loadtest.mjs --url https://reindeer-gp-staging.<you>.workers.dev --users 200 --minutes 5
 * Locally (whole system in-process): npm run loadtest:local
 *
 * It creates real accounts and teams named "Load Test …". Afterwards, run the
 * restore drill onto staging (docs/runbook.md), which resets staging, or pass --cleanup.
 */

const BOARD_LAG_LIMIT_S = 30;
const SUBMIT_TIMEOUT_S = 240;

function quantiles(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN);
  return { n: s.length, p50: q(0.5), p95: q(0.95), max: s.length ? s[s.length - 1] : NaN };
}

/** A small, valid 4-sensor bot; each player gets slightly different weights. */
function botFor(i, rand) {
  const j = () => (rand() - 0.5) * 0.4;
  return {
    format: 'rgp-bot', version: 1, game: 'reindeer-gp', meta: { name: `Load bot ${i}`, method: 'load-test' },
    inputs: ['ray1', 'ray3', 'ray5', 'speed'], outputs: ['steer', 'throttle'],
    layers: [{ type: 'dense', in: 4, out: 2, activation: 'tanh', weights: [[-4 + j(), 0, 4 + j(), 0], [0, 10.8 + j(), 0, -12 + j()]], bias: [0, 6 + j()] }],
  };
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the load test. `fetchImpl(url, init)` lets tests run it against the
 * in-process server. Returns {ok, report (markdown), stats}.
 */
export async function runLoadTest({ url, users = 200, minutes = 5, devKey = '', fetchImpl = fetch, cleanup = false, log = console.log, runId = Date.now().toString(36).slice(-5) }) {
  const origin = new URL(url).origin;
  const stats = { requests: 0, errors: [], latency: {}, scored: [], onBoard: [], boardLag: [] };
  const rand = mulberry32(12345);

  async function call(jar, method, path, body, label) {
    const headers = { origin, accept: 'application/json' };
    if (jar.cookie) headers.cookie = jar.cookie;
    if (devKey) headers['x-dev-login-key'] = devKey;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const t0 = performance.now();
    let res;
    try {
      res = await fetchImpl(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      stats.requests++;
      stats.errors.push(`${label}: network error (${e.message})`);
      return null;
    }
    const ms = performance.now() - t0;
    stats.requests++;
    (stats.latency[label] ??= []).push(ms);
    const sc = res.headers.get('set-cookie');
    if (sc && sc.startsWith('rgp_session=')) jar.cookie = sc.split(';')[0];
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      stats.errors.push(`${label}: HTTP ${res.status} ${typeof data === 'object' && data?.error ? data.error.message : String(text).slice(0, 120)}`);
      return null;
    }
    return data;
  }

  async function player(i) {
    const jar = {};
    const n = String(i).padStart(3, '0');
    if (!(await call(jar, 'POST', '/api/v1/auth/dev', { email: `lt${runId}u${n}@cam.ac.uk` }, 'sign in'))) return;
    const colleges = ['Trinity', "King's", "Queens'", 'Girton', 'Churchill', 'Mixed / none'];
    const team = await call(jar, 'POST', '/api/v1/teams', { name: `Load Test ${runId} ${n}`, college: colleges[i % colleges.length], level: ['elf', 'reindeer', 'santa'][i % 3] }, 'create team');
    if (!team) return;
    await call(jar, 'GET', '/api/v1/boards', undefined, 'list boards');
    const sub = await call(jar, 'POST', '/api/v1/submissions', { bot: botFor(i, rand) }, 'submit bot');
    if (!sub) return;
    const submittedAt = Date.now();
    // Wait for every evaluation, polling like the web app (every 2-3 s).
    const done = new Map();
    while (done.size < sub.submissions.length && Date.now() - submittedAt < SUBMIT_TIMEOUT_S * 1000) {
      await sleep(2000 + rand() * 1000);
      for (const s of sub.submissions) {
        if (done.has(s.id)) continue;
        const r = await call(jar, 'GET', `/api/v1/submissions/${s.id}`, undefined, 'submission status');
        if (r && (r.submission.status === 'done' || r.submission.status === 'rejected')) {
          done.set(s.id, { ...r.submission, at: Date.now() });
          if (r.submission.status === 'rejected') stats.errors.push(`submission rejected: ${r.submission.rejectReason}`);
          else stats.scored.push((Date.now() - submittedAt) / 1000);
        }
      }
    }
    if (done.size < sub.submissions.length) {
      stats.errors.push(`player ${n}: not all submissions finished within ${SUBMIT_TIMEOUT_S} s`);
      return;
    }
    // Watch the boards until this team's entries appear (every 3 s, as a browser polls every 10 s).
    for (const s of done.values()) {
      if (!s.result?.valid || !s.boardKey) continue;
      const t0 = s.at;
      let seen = false;
      while (!seen && Date.now() - t0 < 2 * BOARD_LAG_LIMIT_S * 1000) {
        const b = await call(jar, 'GET', `/api/v1/boards/${s.boardKey}`, undefined, 'read board');
        seen = !!b?.entries?.some((e) => e.teamId === team.team.id && Math.abs(e.score - s.result.score) < 1e-6) || (b?.entries?.some((e) => e.teamId === team.team.id) ?? false);
        if (!seen) await sleep(3000);
      }
      const lag = (Date.now() - t0) / 1000;
      stats.boardLag.push(lag);
      stats.onBoard.push((Date.now() - submittedAt) / 1000);
      if (!seen) stats.errors.push(`player ${n}: entry not on ${s.boardKey} after ${lag.toFixed(0)} s`);
    }
    if (cleanup) await call(jar, 'DELETE', '/api/v1/me', undefined, 'delete account');
  }

  log(`Load test: ${users} players arriving over ${minutes} min against ${origin} (run ${runId})`);
  const started = Date.now();
  const tasks = [];
  for (let i = 0; i < users; i++) {
    const at = started + (i / users) * minutes * 60_000;
    tasks.push(sleep(Math.max(0, at - Date.now())).then(() => player(i)));
    if ((i + 1) % 50 === 0) log(`  ${i + 1} players scheduled`);
  }
  await Promise.all(tasks);
  const took = (Date.now() - started) / 1000;

  const lag = quantiles(stats.boardLag);
  const scored = quantiles(stats.scored);
  const ok = stats.errors.length === 0 && lag.n > 0 && lag.max <= BOARD_LAG_LIMIT_S;
  const fmt = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
  const rows = Object.entries(stats.latency).map(([k, v]) => {
    const q = quantiles(v);
    return `| ${k} | ${q.n} | ${fmt(q.p50)} | ${fmt(q.p95)} | ${fmt(q.max)} |`;
  });
  const report = [
    `### Load test ${ok ? 'passed ✅' : 'FAILED ❌'}`,
    '',
    `${users} players over ${minutes} min against ${origin}; ${stats.requests} requests in ${fmt(took)} s.`,
    '',
    `- Errors: **${stats.errors.length}**`,
    `- Submission to scored (s): p50 ${fmt(scored.p50)}, p95 ${fmt(scored.p95)}, max ${fmt(scored.max)} (${scored.n} evaluations)`,
    `- Scored to visible on its board (s): p50 ${fmt(lag.p50)}, p95 ${fmt(lag.p95)}, max ${fmt(lag.max)} (limit ${BOARD_LAG_LIMIT_S} s)`,
    '',
    '| Request | Count | p50 ms | p95 ms | max ms |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    ...(stats.errors.length ? ['', '**Errors (first 20):**', ...stats.errors.slice(0, 20).map((e) => `- ${e}`)] : []),
  ].join('\n');
  return { ok, report, stats };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
  const url = opt('--url', process.env.REINDEER_URL);
  if (!url) {
    console.error('usage: DEV_LOGIN_KEY=... node scripts/loadtest.mjs --url <staging url> [--users 200] [--minutes 5] [--cleanup]');
    process.exit(2);
  }
  if (/reindeer-gp\.[a-z0-9-]+\.workers\.dev/.test(url) && !args.includes('--i-mean-production')) {
    console.error('That looks like production. Load-test staging instead (test sign-in is switched off in production anyway).');
    process.exit(2);
  }
  const { ok, report } = await runLoadTest({
    url, users: Number(opt('--users', '200')), minutes: Number(opt('--minutes', '5')), devKey: process.env.DEV_LOGIN_KEY ?? '', cleanup: args.includes('--cleanup'),
  });
  console.log(`\n${report}`);
  if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
  process.exit(ok ? 0 : 1);
}
