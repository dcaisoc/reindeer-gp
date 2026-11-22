/**
 * M5 journey: accessibility audit of every page (WCAG AA contrast, keyboard
 * reachability, names), a keyboard-only route, reduced motion, the driving
 * assists, and exporting a replay as a GIF.
 * Usage: npm run build && npx tsx tests/browser/m5.e2e.ts [--shots dir] [--audit-only]
 */

import { chromium, type Page } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDevServer } from '../../server/local/dev-server.js';
import { encodeReplay } from '../../engine/core/replay.js';
import type { BotFile } from '../../engine/core/bot.js';
import type { TrackDef } from '../../engine/reindeer/track.js';
import { keyboardLap } from '../helpers/keyboard-driver.js';
import { Client, teamUp } from '../helpers/api-client.js';

const args = process.argv.slice(2);
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
let failures = 0;
function check(ok: boolean, msg: string, detail: string[] = []): void {
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) {
    failures++;
    for (const d of detail.slice(0, 25)) console.log(`      ${d}`);
  }
}
async function shot(p: Page, name: string): Promise<void> {
  if (shotsDir) await p.screenshot({ path: `${shotsDir}/m5-${name}.png`, fullPage: true });
}
const AUDIT = readFileSync(new URL('./a11y-audit.js', import.meta.url), 'utf8');

const quickBot = (name: string, inputs = ['ray1', 'ray3', 'ray5', 'speed']): BotFile => ({
  format: 'rgp-bot', version: 1, game: 'reindeer-gp', meta: { name }, inputs, outputs: ['steer', 'throttle'],
  layers: [{ type: 'dense', in: 4, out: 2, activation: 'tanh', weights: [[-4, 0, 4, 0], [0, 10.8, 0, -12]], bias: [0, 6] }],
});

const server = await startDevServer({ memory: true, vars: { REFEREE_EMAILS: 'ref@cam.ac.uk' } });
const api = new Client(server.env);
await api.post('/api/v1/auth/dev', { email: 'qq1@cam.ac.uk' });
const team = await teamUp(api, 'Four Eyes', 'reindeer', "Queens'");
await api.post('/api/v1/submissions', { bot: quickBot('Four eyes v1') });
const ref = new Client(server.env);
await ref.post('/api/v1/auth/dev', { email: 'ref@cam.ac.uk' });
await ref.post('/api/v1/admin/twists', JSON.parse(readFileSync('tracks/twists/night-oval.json', 'utf8')));
await ref.patch('/api/v1/admin/twists/night-oval', { override: 'live' });
await api.post('/api/v1/submissions', { bot: quickBot('Owl', ['ray0', 'ray1', 'ray2', 'speed']), tracks: ['night-oval'] });
const p1: TrackDef = JSON.parse(readFileSync('tracks/practice-1.json', 'utf8'));
const lap = keyboardLap(p1, 1, 0.1);
await api.req('POST', '/api/v1/runs?submit=1', await encodeReplay(lap), true, { 'content-type': 'application/octet-stream' });
await server.env.EVALUATOR.idle();
const tmp = mkdtempSync(join(tmpdir(), 'rgp-m5-'));
const lapFile = join(tmp, 'lap.rgpr');
writeFileSync(lapFile, await encodeReplay(lap));
const replayId = (await api.get('/api/v1/boards/s1/practice-1/base/bots')).data.entries[0].replayId;

const browser = await chromium.launch();
const errors: string[] = [];
async function newPage(email: string | null, opts: { reducedMotion?: 'reduce' | 'no-preference' } = {}): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true, acceptDownloads: true, reducedMotion: opts.reducedMotion ?? 'no-preference' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack}`));
  p.on('console', (m) => m.type() === 'error' && !/\b(400|401|404|423)\b/.test(m.text()) && errors.push(m.text()));
  p.on('dialog', (d) => d.accept());
  if (email) {
    await p.goto(`${server.url}/#/signin`);
    await p.fill('#dev-email', email);
    await p.click('.dev-login button');
    await p.waitForFunction("document.querySelector('#account')?.textContent !== 'Sign in'");
  }
  return p;
}

async function audit(p: Page, route: string, ready: string): Promise<void> {
  await p.goto(`${server.url}/${route}`);
  await p.waitForSelector(ready, { timeout: 15000 });
  await p.waitForTimeout(400);
  const problems = (await p.evaluate(AUDIT)) as string[];
  check(problems.length === 0, `accessibility audit: ${route} (contrast AA, keyboard, names)`, problems);
}

try {
  // ---------- 1. Audit every page (signed in as a player, a referee, and signed out) ----------
  const player = await newPage('qq1@cam.ac.uk');
  await player.goto(`${server.url}/#/laps`);
  await player.setInputFiles('input[type=file]', [lapFile]);
  await player.waitForSelector('.laps-table tbody tr');
  const pages: [string, string][] = [
    ['#/', '.twist-card'],
    ['#/laps', '.laps-table'],
    ['#/train/practice-1', '.data-summary strong'],
    ['#/train/night-oval', '.data-summary'],
    ['#/boards/practice-1/bots', '.board-table tbody tr'],
    ['#/boards/practice-1/humans', '.board-table tbody tr'],
    ['#/boards/night-oval/bots', '.board-table tbody tr'],
    ['#/standings', '.formula'],
    ['#/team', '.badge-shelf'],
    [`#/teams/${team.id}`, '.badge-shelf'],
    [`#/replay/remote/${replayId}`, '.viewer-controls'],
    ['#/replay/baseline/practice-2', '.viewer-controls'],
    ['#/settings', 'fieldset'],
    ['#/projector/practice-1/bots', '.proj-list li'],
  ];
  for (const [route, ready] of pages) await audit(player, route, ready);
  const referee = await newPage('ref@cam.ac.uk');
  await audit(referee, '#/admin', '.twist-admin');
  const anon = await newPage(null);
  await audit(anon, '#/signin', '#dev-email');

  if (!args.includes('--audit-only')) {
    // ---------- 2. Keyboard only: nav → leaderboards → filter → replay → play/pause ----------
    const kb = await newPage('qq1@cam.ac.uk');
    await kb.goto(`${server.url}/#/`);
    await kb.waitForSelector('.tracks');
    const tabTo = async (pred: string, max = 60): Promise<boolean> => {
      for (let i = 0; i < max; i++) {
        await kb.keyboard.press('Tab');
        if (await kb.evaluate(pred)) return true;
      }
      return false;
    };
    const focusVisible = "(() => { const e = document.activeElement; const cs = getComputedStyle(e); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2; })()";
    check(await tabTo("document.activeElement?.textContent === 'Leaderboards'"), 'Tab reaches the Leaderboards link');
    check(await kb.evaluate(focusVisible), 'the focused control has a visible focus ring');
    await kb.keyboard.press('Enter');
    await kb.waitForSelector('.board-table tbody tr');
    check(await tabTo("document.activeElement?.dataset?.f === 'beginner'"), 'Tab reaches the Beginner filter');
    await kb.keyboard.press('Space');
    check((await kb.getAttribute('button[data-f=beginner]', 'aria-pressed')) === 'true', 'Space switches the filter');
    await kb.keyboard.press('Space');
    await kb.goto(`${server.url}/#/boards/practice-1/bots`);
    await kb.waitForSelector('.board-table tbody tr:not(.baseline-row)');
    check(await tabTo("document.activeElement?.textContent === 'Watch' && document.activeElement.closest('tr:not(.baseline-row)') !== null"), 'Tab reaches a Watch link on the board');
    await kb.keyboard.press('Enter');
    await kb.waitForSelector('.viewer-controls');
    await kb.waitForTimeout(500);
    const t1 = await kb.textContent('.viewer-controls');
    await kb.keyboard.press('Space');
    await kb.waitForTimeout(600);
    const t2 = await kb.textContent('.viewer-controls');
    await kb.waitForTimeout(600);
    const t3 = await kb.textContent('.viewer-controls');
    check(t1 !== t2 && t2 === t3, 'Space pauses the replay (time stops moving)');
    check(await tabTo("document.activeElement?.textContent === 'Make GIF'"), 'Tab reaches Make GIF in the replay viewer');
    const [dl] = await Promise.all([kb.waitForEvent('download', { timeout: 60000 }), kb.keyboard.press('Enter')]);
    const gifPath = join(tmp, 'clip.gif');
    await dl.saveAs(gifPath);
    const gif = readFileSync(gifPath);
    check(gif.subarray(0, 6).toString() === 'GIF89a' && gif.length > 10_000, `a replay exports as a GIF (${dl.suggestedFilename()}, ${Math.round(gif.length / 1024)} KB)`);
    await shot(kb, '01-replay-export');
    // Settings by keyboard.
    await kb.goto(`${server.url}/#/settings`);
    await kb.waitForSelector('fieldset');
    // Radio groups: Tab lands on the chosen option, arrow keys change it.
    check(await tabTo("document.activeElement?.name === 'motion'"), 'Tab reaches the motion setting');
    await kb.keyboard.press('ArrowDown');
    check(await kb.evaluate("document.documentElement.classList.contains('reduce-motion')"), 'Reduce motion can be switched on from the keyboard');

    // ---------- 3. Reduced motion (device setting) ----------
    const calm = await newPage(null, { reducedMotion: 'reduce' });
    await calm.goto(`${server.url}/#/replay/baseline/practice-1`);
    await calm.waitForSelector('.viewer-controls');
    const a = await calm.textContent('.viewer-controls');
    await calm.waitForTimeout(800);
    check(a === (await calm.textContent('.viewer-controls')), 'with reduced motion, replays wait for Play instead of autoplaying');
    check(await calm.evaluate("document.documentElement.classList.contains('reduce-motion')"), 'the device setting is followed');
    check(await calm.evaluate("getComputedStyle(document.querySelector('.toast') ?? document.body).transitionDuration.split(',').every((d) => parseFloat(d) === 0)"), 'transitions are switched off');

    // ---------- 4. Driving assists ----------
    const assisted = await newPage(null);
    await assisted.goto(`${server.url}/#/settings`);
    await assisted.waitForSelector('fieldset');
    await assisted.check('input[name=slow][value="0.5"]');
    await assisted.check('#pref-auto');
    await assisted.goto(`${server.url}/#/drive/practice-1`);
    await assisted.waitForSelector('.hud-assist');
    check((await assisted.textContent('.hud-assist'))!.includes('50% speed') && (await assisted.textContent('.hud-assist'))!.includes('auto-throttle'), 'the HUD shows the active assists');
    await assisted.waitForTimeout(3300); // countdown
    const g0 = Number(await assisted.textContent('.hud-time'));
    const w0 = Date.now();
    await assisted.waitForTimeout(2000);
    const g1 = Number(await assisted.textContent('.hud-time'));
    const rate = (g1 - g0) / ((Date.now() - w0) / 1000);
    check(rate > 0.35 && rate < 0.65, `slow mode runs the game at half speed (${rate.toFixed(2)} game seconds per second)`);
    check(Number(await assisted.textContent('.hud-speed')) > 5, 'auto-throttle drives forward with no keys pressed');
    await shot(assisted, '02-assists');
  }
  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  check(false, `test crashed: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll M5 browser checks passed.');
process.exit(failures ? 1 : 0);
