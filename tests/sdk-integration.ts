/**
 * M3 integration: the Python CLI against the real server code over HTTP.
 *   - `reindeer eval` locally, then `reindeer submit` with an API token;
 *   - the server's score must equal the local score to the tick;
 *   - the entry must appear on the leaderboard.
 * Needs the SDK installed (pip install ./sdk). Usage: npx tsx tests/sdk-integration.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDevServer } from '../server/local/dev-server.js';

const PY = process.env.PYTHON ?? 'python3';
// Async: this process also runs the server, so a blocking call would deadlock it.
const pexec = promisify(execFile);
let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures++;
};

const server = await startDevServer({ memory: true });
try {
  // Sign in (test mode), make a team and a token, as a player would on the website.
  const login = await fetch(`${server.url}/api/v1/auth/dev`, {
    method: 'POST', headers: { origin: server.url, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'santa@cam.ac.uk' }),
  });
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const post = (path: string, body: unknown) =>
    fetch(`${server.url}/api/v1${path}`, { method: 'POST', headers: { origin: server.url, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  await post('/teams', { name: 'Python Elves', college: 'Darwin', level: 'santa' });
  const { token } = (await post('/me/tokens', { label: 'integration test' })) as { token: string };
  check(token.startsWith('rgp_'), 'created an API token on the website');

  const dir = mkdtempSync(join(tmpdir(), 'rgp-sdk-'));
  const botFile = join(dir, 'bot.json');
  writeFileSync(botFile, JSON.stringify(JSON.parse(readFileSync('engine/golden/bots/bot-practice-1-relu.json', 'utf8')).bot));
  const env = { ...process.env, REINDEER_URL: server.url, REINDEER_TOKEN: token, REINDEER_CONFIG: join(dir, 'cfg.json') };
  const run = async (...args: string[]) => (await pexec(PY, ['-m', 'reindeer_sdk.cli', ...args], { env, encoding: 'utf8' })).stdout;

  const local = JSON.parse((await run('eval', botFile, '--track', 'practice-1', '--json')).trim())[0];
  check(local.valid && local.ticks > 0, `reindeer eval: ${local.score.toFixed(2)} s (${local.ticks} ticks) locally`);

  const out = await run('submit', botFile, '--track', 'practice-1');
  console.log(out.trim().split('\n').map((l) => `    ${l}`).join('\n'));
  const m = out.match(/practice-1\s+(\d+\.\d\d) s/);
  check(!!m && Number(m[1]) === Number(local.score.toFixed(2)), 'reindeer submit: the server scores it exactly as reindeer eval did');

  const board = (await (await fetch(`${server.url}/api/v1/boards/s1/practice-1/base/bots`)).json()) as { entries: { team: string; score: number; ticks: number }[] };
  const e = board.entries.find((x) => x.team === 'Python Elves');
  check(!!e && e.ticks === local.ticks && e.score === local.score, `on the leaderboard with the same ${local.ticks} ticks`);

  let refused = '';
  try {
    await pexec(PY, ['-m', 'reindeer_sdk.cli', 'submit', botFile], { env: { ...env, REINDEER_TOKEN: 'rgp_wrong' }, encoding: 'utf8' });
  } catch (err) {
    refused = String((err as { stdout?: string }).stdout ?? '');
  }
  check(/sign in|token/i.test(refused), `a wrong token is refused with a clear message (${refused.trim()})`);
} catch (e) {
  failures++;
  console.log(`✗ crashed: ${e instanceof Error ? e.stack : e}`);
} finally {
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll SDK integration checks passed.');
process.exit(failures ? 1 : 0);
