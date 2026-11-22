/**
 * End-to-end checks for milestone M2: the full Elf journey against the real
 * Worker code (run locally in Node), in a real browser.
 *
 * Usage: npm run build && npx tsx tests/browser/m2.e2e.ts [--shots dir]
 */

import { chromium, type Page } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDevServer } from '../../server/local/dev-server.js';
import { encodeReplay } from '../../engine/core/replay.js';
import type { TrackDef } from '../../engine/reindeer/track.js';
import { keyboardLap } from '../helpers/keyboard-driver.js';

const args = process.argv.slice(2);
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
let failures = 0;
function check(ok: boolean, msg: string): void {
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures++;
}
async function shot(p: Page, name: string): Promise<void> {
  if (shotsDir) await p.screenshot({ path: `${shotsDir}/${name}.png`, fullPage: false });
}

// Four "human" laps on Frosty Oval, made by the simulated keyboard driver.
const track: TrackDef = JSON.parse(readFileSync('tracks/practice-1.json', 'utf8'));
const lapDir = mkdtempSync(join(tmpdir(), 'rgp-laps-'));
const lapFiles: string[] = [];
for (const seed of [1, 2, 3, 4]) {
  const f = join(lapDir, `lap-${seed}.rgpr`);
  writeFileSync(f, await encodeReplay(keyboardLap(track, seed, 0.15)));
  lapFiles.push(f);
}

const server = await startDevServer({ memory: true, vars: { REFEREE_EMAILS: 'ref@cam.ac.uk' } });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack}`));
page.on('console', (m) => m.type() === 'error' && !/\b(401|423)\b/.test(m.text()) && errors.push(m.text()));

try {
  // Sign in (test mode) and create a team.
  await page.goto(`${server.url}/#/signin`);
  await page.fill('#dev-email', 'elf1@cam.ac.uk');
  await page.click('.dev-login button');
  await page.waitForSelector('#team-name');
  check((await page.textContent('#account')) !== 'Sign in', 'test sign-in works and the header shows your name');
  await page.fill('#team-name', 'Sleigh Bells');
  await page.selectOption('#team-college', "King's");
  await page.click('form.card button[type=submit]');
  await page.waitForSelector('.join-code');
  const code = (await page.textContent('.join-code'))!.trim();
  check(/^[A-Z2-9]{6}$/.test(code), `team created with join code ${code}`);
  await shot(page, '10-team');

  // A teammate joins with the code.
  const mate = await (await browser.newContext({ bypassCSP: true })).newPage();
  await mate.goto(`${server.url}/#/signin`);
  await mate.fill('#dev-email', 'elf2@cam.ac.uk');
  await mate.click('.dev-login button');
  await mate.waitForSelector('#join-code');
  await mate.fill('#join-code', code.toLowerCase());
  await mate.click('text=Join team');
  await mate.waitForSelector('.join-code');
  check(((await mate.textContent('.card h2')) ?? '').includes('Sleigh Bells'), 'a teammate joins with the code');

  // Import 4 laps into Driving data.
  await page.goto(`${server.url}/#/laps`);
  await page.setInputFiles('input[type=file]', lapFiles);
  await page.waitForFunction('document.querySelectorAll(".laps-table tbody tr").length === 4', null, { timeout: 15000 });
  check(true, '4 laps imported into Driving data');

  // Train with Recommended settings.
  await page.goto(`${server.url}/#/train/practice-1`);
  await page.waitForSelector('.data-summary strong');
  check(/4 laps/.test((await page.textContent('.data-summary'))!), 'trainer sees the 4 selected laps');
  await page.click('text=Use Recommended settings');
  check(/1,410/.test((await page.textContent('.param-info'))!), 'Recommended network: 1,410 parameters shown');
  await shot(page, '11-trainer-setup');
  const t0 = Date.now();
  await page.click('text=Train my bot');
  await page.waitForSelector('.training:not([hidden])');
  await page.waitForTimeout(1200);
  await shot(page, '12-training');
  await page.waitForSelector('.result:not([hidden])', { timeout: 60000 });
  const trainSecs = (Date.now() - t0) / 1000;
  check(trainSecs < 30, `training finished in ${trainSecs.toFixed(1)} s (target under 30 s)`);
  await page.waitForTimeout(1500);
  await page.click('text=Skip to the end');
  await page.waitForFunction("/Finished|Did not finish/.test(document.querySelector('.watch-status')?.textContent ?? '')", null, { timeout: 20000 });
  const watched = (await page.textContent('.watch-status'))!;
  check(/Finished/.test(watched), `the bot drives a full lap in the browser (${watched})`);
  check((await page.locator('.tip').count()) >= 1, 'coach shows tips');
  await shot(page, '13-watch-and-tips');

  // Submit and wait for the server's verdict on all 3 tracks.
  await page.click('text=Submit to the leaderboard');
  await page.waitForFunction("document.querySelectorAll('.sub-status li').length === 3 && ![...document.querySelectorAll('.sub-status li')].some(li => /queue|racing/.test(li.textContent))", null, { timeout: 60000 });
  const statuses = await page.locator('.sub-status li').allTextContents();
  console.log(statuses.map((s) => `    ${s}`).join('\n'));
  const p1 = statuses.find((s) => s.startsWith('Frosty Oval')) ?? '';
  check(/\d+\.\d\d s/.test(p1), 'server scored the bot on Frosty Oval');
  check(/Beginner bracket/.test(p1), 'it qualifies for the Beginner bracket (Elf team, web trainer, own laps)');
  const browserTime = watched.match(/(\d+\.\d\d)/)?.[1];
  check(!!browserTime && p1.includes(browserTime), `server time matches what the browser showed (${browserTime})`);
  await shot(page, '14-submitted');

  // Leaderboard.
  await page.goto(`${server.url}/#/boards/practice-1/bots`);
  const teamRows = '.board-table tbody tr:not(.baseline-row)';
  await page.waitForSelector(teamRows);
  check((await page.textContent(teamRows))!.includes('Sleigh Bells'), 'team appears on the live Bots board');
  check((await page.locator('.board-table tr.baseline-row').count()) === 1, 'the baseline bot is shown as a reference row');
  await page.click('button[data-f=beginner]');
  check((await page.locator(teamRows).count()) === 1, 'Beginner filter shows the entry');
  await page.click('button[data-f=santa]');
  check((await page.locator(teamRows).count()) === 0, 'Santa filter hides it');
  await page.click('button[data-f=all]');
  await shot(page, '15-board');

  // A second browser sees a new Human-board entry appear without refreshing.
  const watcher = await (await browser.newContext({ bypassCSP: true })).newPage();
  await watcher.goto(`${server.url}/#/boards/practice-1/humans`);
  await watcher.waitForSelector('.empty');
  await page.goto(`${server.url}/#/laps`);
  await page.locator('text=Submit to Human board').first().click();
  await page.waitForFunction("[...document.querySelectorAll('button')].some(b => /On the board/.test(b.textContent))", null, { timeout: 30000 });
  check(true, 'a lap is submitted to the Human board and verified by the server');
  await watcher.waitForSelector('.board-table tbody tr', { timeout: 15000 });
  check(true, 'a second browser shows the new entry within 15 s, without a refresh');

  // Replay permalink + link preview page.
  await page.goto(`${server.url}/#/boards/practice-1/bots`);
  await page.waitForSelector('.board-table tbody tr:not(.baseline-row)');
  const href = await page.locator('.board-table tbody tr:not(.baseline-row) a:has-text("Watch")').first().getAttribute('href');
  const replayId = href!.split('/').pop()!;
  const anon = await (await browser.newContext({ bypassCSP: true })).newPage();
  await anon.goto(`${server.url}/replay/${replayId}`);
  await anon.waitForSelector('.viewer-controls', { timeout: 10000 });
  check(true, '/replay/<id> opens the viewer without signing in');
  const html = await (await fetch(`${server.url}/replay/${replayId}`)).text();
  check(/og:title" content="My first bot \(Sleigh Bells\) on Frosty Oval"/.test(html), 'permalink page has link-preview tags');
  await page.goto(`${server.url}/#/replay/remote/${replayId}`);
  await page.waitForSelector('text=Make private');
  await page.click('text=Make private');
  await page.waitForTimeout(300);
  const hidden = await fetch(`${server.url}/api/v1/replays/${replayId}`);
  check(hidden.status === 404, 'the owner can hide a replay from other people');
  await page.click('text=Make public');

  // Upload a bot file trained elsewhere (e.g. in a notebook).
  const goldenBot = JSON.parse(readFileSync('engine/golden/bots/bot-practice-3-tanh.json', 'utf8')).bot;
  const badBotFile = join(lapDir, 'bad-bot.json');
  writeFileSync(badBotFile, JSON.stringify({ ...goldenBot, outputs: ['steer'] }));
  const botFile = join(lapDir, 'notebook-bot.json');
  writeFileSync(botFile, JSON.stringify({ ...goldenBot, meta: { ...goldenBot.meta, name: 'Notebook bot' } }));
  await page.goto(`${server.url}/#/team`);
  await page.waitForSelector('#bot-file');
  await page.setInputFiles('#bot-file', badBotFile);
  await page.waitForSelector('text=must be exactly');
  check(true, 'uploading a broken bot file shows the validator\'s message');
  await page.setInputFiles('#bot-file', botFile);
  await page.waitForSelector('text=is a valid bot');
  await page.click('text=Submit to every track');
  await page.waitForFunction("[...document.querySelectorAll('td')].some(td => /Notebook bot/.test(td.textContent))", null, { timeout: 15000 });
  check(true, 'a bot file uploaded on the Team page is submitted');

  // Projector view.
  await page.goto(`${server.url}/#/projector/practice-1/bots`);
  await page.waitForSelector('.proj-list li');
  await shot(page, '16-projector');
  check((await page.textContent('.proj-list'))!.includes('Sleigh Bells'), 'projector view shows the board in big text');

  // Referee tools.
  const ref = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true })).newPage();
  await ref.goto(`${server.url}/#/signin`);
  await ref.fill('#dev-email', 'ref@cam.ac.uk');
  await ref.click('.dev-login button');
  await ref.waitForSelector('#team-name');
  await ref.goto(`${server.url}/#/admin`);
  await ref.waitForSelector('#ann');
  await ref.fill('#ann', 'Welcome to the Reindeer Grand Prix kickoff!');
  await ref.click('text=Post');
  await ref.waitForTimeout(400);
  await ref.click('text=Close submissions');
  await ref.waitForTimeout(400);
  await shot(ref, '17-admin');
  await page.goto(`${server.url}/#/`);
  await page.reload();
  await page.waitForSelector('#announce:not([hidden])');
  check((await page.textContent('#announce'))!.includes('kickoff'), 'referee announcement shows on every page');
  const closed = await page.evaluate(async () => (await fetch('/api/v1/submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
  check(closed === 423, 'referee can close submissions');
  const ov = await (await ref.context().request.get(`${server.url}/api/v1/admin/overview`)).json();
  check(ov.audit.some((a: { action: string }) => a.action === 'announcement.post'), 'referee actions are in the audit log');

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  failures++;
  console.log(`✗ test crashed: ${e instanceof Error ? e.stack : e}`);
  await shot(page, 'm2-crash');
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll M2 browser checks passed.');
process.exit(failures ? 1 : 0);
