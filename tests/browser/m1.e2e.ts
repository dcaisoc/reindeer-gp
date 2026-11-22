/**
 * End-to-end checks for milestone M1 in a real browser.
 * Drives laps with synthetic keyboard input (a simple controller runs inside
 * the page), then checks recording, offline saving, replays and touch controls.
 *
 * Usage: npm run build && npx tsx tests/browser/m1.e2e.ts [--shots dir] [--browser chromium|firefox]
 */

import { chromium, firefox, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { startDevServer } from '../../server/local/dev-server.js';

const args = process.argv.slice(2);
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const browserName = args.includes('--browser') ? args[args.indexOf('--browser') + 1] : 'chromium';
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

let failures = 0;
function check(ok: boolean, msg: string): void {
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures++;
}
async function shot(p: Page, name: string): Promise<void> {
  if (shotsDir) await p.screenshot({ path: `${shotsDir}/${name}.png` });
}

/** Keyboard autopilot running inside the page, steering from the sensors. */
/**
 * Keyboard autopilot running inside the page, steering from the sensors.
 * Sent as source text: tsx would otherwise inject helpers the page does not have.
 */
const DRIVER_JS = `(() => {
  const held = new Set();
  const set = (code, on) => {
    if (on === held.has(code)) return;
    if (on) held.add(code); else held.delete(code);
    window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, bubbles: true }));
  };
  window.__drv = setInterval(() => {
    const g = window.__rgp.game();
    if (g.isDone()) { ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].forEach((c) => set(c, false)); return; }
    const o = g.observe();
    const r = o.rays;
    const steer = (r[4] - r[2]) * 2.2 + (r[5] - r[1]) * 1.2 + (r[6] - r[0]) * 0.5;
    set('ArrowRight', steer > 0.12);
    set('ArrowLeft', steer < -0.12);
    const target = 0.25 + 0.6 * Math.min(r[3], (r[2] + r[4]) * 0.75);
    set('ArrowUp', o.speed < target);
    set('ArrowDown', o.speed > target + 0.12);
  }, 16);
})()`;

async function startKeyboardDriver(p: Page): Promise<void> {
  await p.evaluate(DRIVER_JS);
}

async function driveLap(p: Page, base: string, trackId: string): Promise<{ title: string; score: string }> {
  await p.goto(`${base}/?debug#/drive/${trackId}`);
  await p.waitForFunction('window.__rgp !== undefined');
  await startKeyboardDriver(p);
  await p.waitForSelector('.summary:not([hidden]) h2', { timeout: 150_000 });
  await p.evaluate('clearInterval(window.__drv)');
  const title = (await p.textContent('.summary h2')) ?? '';
  const score = (await p.textContent('.summary .figures dd.big')) ?? '';
  return { title, score };
}

const server = await startDevServer({ memory: true });
const url = server.url;
const browser = await (browserName === 'firefox' ? firefox : chromium).launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack}`));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

try {
  // Home
  await page.goto(`${url}/#/`);
  await page.waitForSelector('.track-card');
  check((await page.locator('.track-card').count()) === 3, 'home lists 3 practice tracks');
  await page.waitForTimeout(300);
  await shot(page, '01-home');

  // Countdown and HUD
  await page.goto(`${url}/?debug#/drive/practice-1`);
  await page.waitForTimeout(700);
  check(/^[123]$/.test((await page.textContent('.countdown'))?.trim() ?? ''), 'a 3-2-1 countdown shows before the start');
  await shot(page, '02-countdown');

  // Go offline, drive a full lap with the keyboard.
  await ctx.setOffline(true);
  const lap1 = await driveLap(page, url, 'practice-1').catch(async (e) => {
    await ctx.setOffline(false);
    throw e;
  });
  check(/Lap complete|personal best/i.test(lap1.title), `keyboard lap on Frosty Oval completes (${lap1.title}, score ${lap1.score})`);
  await page.waitForTimeout(500);
  await shot(page, '03-summary');
  check((await page.locator('.summary table.sectors tbody tr').count()) === 3, 'summary shows 3 sector times');
  check(await page.locator('.summary-map').isVisible(), 'summary shows the speed-coloured path');

  // Saved while offline: visible in Driving data without any network.
  await page.evaluate("location.hash = '#/laps'");
  await page.waitForSelector('.laps-table tbody tr', { timeout: 5000 });
  check((await page.locator('.laps-table tbody tr').count()) >= 1, 'lap is saved while offline and listed in Driving data');
  await ctx.setOffline(false);
  await page.reload();
  await page.waitForSelector('.laps-table tbody tr');
  check((await page.locator('.laps-table tbody tr').count()) >= 1, 'lap is still there after a page reload');
  await shot(page, '04-driving-data');

  // Second lap so the ghost of the first lap exists.
  const lap2 = await driveLap(page, url, 'practice-1');
  check(/Lap complete|personal best/i.test(lap2.title), `second lap completes (score ${lap2.score})`);
  const ghostLabel = (await page.textContent('.hud-ghost')) ?? '';
  check(/Your best/.test(ghostLabel), `ghost of your best lap was shown (${ghostLabel.trim()})`);

  // Replay viewer.
  await page.evaluate("location.hash = '#/laps'");
  await page.waitForSelector('.laps-table tbody tr');
  await page.locator('.laps-table tbody tr').first().getByRole('link', { name: 'Watch' }).click();
  await page.waitForSelector('.viewer-controls');
  check((await page.locator('.banner.error').count()) === 0, 'replay re-simulates and matches the engine (no mismatch banner)');
  await page.selectOption('.viewer-controls select', '4');
  await page.waitForTimeout(1500);
  const pos1 = Number(await page.inputValue('.scrub'));
  check(pos1 > 200, `replay plays at 4x (position ${pos1} ticks after 1.5 s)`);
  await page.locator('.ghost-item input').first().check();
  await page.waitForTimeout(200);
  check((await page.locator('.viewer-side table.sectors thead th').count()) === 3, 'a ghost can be overlaid and appears in the sector table');
  await page.locator('.scrub').fill('600');
  await page.waitForTimeout(300);
  check((await page.textContent('.v-time'))?.startsWith('10.00') ?? false, 'scrubbing jumps to 10.00 s');
  await page.click('text=Follow cam');
  await page.waitForTimeout(200);
  await shot(page, '05-replay-full');
  await page.click('text=Whole track');
  await page.keyboard.press('Space');
  await page.waitForTimeout(800);
  await shot(page, '06-replay-follow');

  // Baseline bot replay on the hardest track.
  await page.evaluate("location.hash = '#/replay/baseline/practice-3'");
  await page.waitForSelector('.viewer-controls');
  check((await page.textContent('.viewer-side h1')) === 'Baseline bot', 'baseline bot replay opens for Glacier Loop');

  // Wall hits: drive straight into a wall and count penalties.
  await page.goto(`${url}/?debug#/drive/practice-1`);
  await page.waitForFunction("window.__rgp && window.__rgp.phase() === 'running'", null, { timeout: 6000 });
  await page.keyboard.down('ArrowUp');
  await page.keyboard.down('ArrowLeft');
  await page.waitForFunction('window.__rgp.game().penalties >= 1', null, { timeout: 8000 });
  const pen = (await page.evaluate('({ p: window.__rgp.game().penalties, c: window.__rgp.game().collisions })')) as { p: number; c: number };
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('ArrowUp');
  check(pen.p >= 1 && pen.c >= 1, `hitting a wall adds a penalty (penalties ${pen.p}, contacts ${pen.c})`);
  await shot(page, '07-wall-hit');

  // Pause and restart.
  await page.keyboard.press('KeyP');
  check(await page.locator('.overlay:not(.summary):not([hidden])').isVisible(), 'P pauses with a menu');
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(200);
  check((await page.evaluate('window.__rgp.game().tick')) === 0, 'R restarts the run');

  // Phone: touch controls drive the sleigh.
  const phone = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, bypassCSP: true });
  const pp = await phone.newPage();
  await pp.goto(`${url}/?debug#/drive/practice-1`);
  check(await pp.locator('.touch-controls.show').isVisible(), 'touch controls appear on a phone');
  await pp.waitForFunction("window.__rgp && window.__rgp.phase() === 'running'", null, { timeout: 6000 });
  const gas = pp.locator('.tc.gas');
  const box = (await gas.boundingBox())!;
  await pp.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await gas.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true });
  await pp.waitForTimeout(1500);
  const sp = (await pp.evaluate('window.__rgp.game().speed')) as number;
  await gas.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true });
  check(sp > 5, `holding the on-screen Go button accelerates the sleigh (${sp.toFixed(1)} m/s)`);
  await shot(pp, '08-phone');
  await phone.close();

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  failures++;
  console.log(`✗ test crashed: ${e instanceof Error ? e.stack : e}`);
  await shot(page, 'crash');
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll M1 browser checks passed.');
process.exit(failures ? 1 : 0);
