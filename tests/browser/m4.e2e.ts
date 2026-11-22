/**
 * M4 journey in a real browser against the whole system running in Node:
 * a referee uploads and schedules weekly twists, one goes live on its own at
 * the set time, another is flipped live early, a dry run stays private; players
 * see the twist, train a night-mode bot from daylight laps, race the leader's
 * ghost, earn badges and see the standings; the referee builds the digest.
 * Usage: npm run build && npx tsx tests/browser/m4.e2e.ts [--shots dir]
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
function check(ok: boolean, msg: string): void {
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures++;
}
async function shot(p: Page, name: string): Promise<void> {
  if (shotsDir) await p.screenshot({ path: `${shotsDir}/m4-${name}.png`, fullPage: true });
}

const quickBot = (name: string, inputs = ['ray1', 'ray3', 'ray5', 'speed']): BotFile => ({
  format: 'rgp-bot', version: 1, game: 'reindeer-gp', meta: { name }, inputs, outputs: ['steer', 'throttle'],
  layers: [{ type: 'dense', in: 4, out: 2, activation: 'tanh', weights: [[-4, 0, 4, 0], [0, 10.8, 0, -12]], bias: [0, 6] }],
});
const tmp = mkdtempSync(join(tmpdir(), 'rgp-m4-'));
const twistFile = (id: string) => join('tracks', 'twists', `${id}.json`);
const p1: TrackDef = JSON.parse(readFileSync('tracks/practice-1.json', 'utf8'));
const lapFiles: string[] = [];
for (const seed of [1, 2, 3]) {
  const f = join(tmp, `day-${seed}.rgpr`);
  writeFileSync(f, await encodeReplay(keyboardLap(p1, seed, 0.1)));
  lapFiles.push(f);
}

const server = await startDevServer({ memory: true, vars: { REFEREE_EMAILS: 'ref@cam.ac.uk' } });
// Two teams seeded through the API; their bots are already on the boards.
const api = new Client(server.env);
await api.post('/api/v1/auth/dev', { email: 'qq1@cam.ac.uk' });
await teamUp(api, 'Four Eyes', 'reindeer', "Queens'");
await api.post('/api/v1/submissions', { bot: quickBot('Four eyes v1') });
const rival = new Client(server.env);
await rival.post('/api/v1/auth/dev', { email: 'tt2@cam.ac.uk' });
await teamUp(rival, 'Sleigh Bells', 'elf', 'Trinity');
await rival.post('/api/v1/submissions', { bot: JSON.parse(readFileSync('engine/golden/bots/bot-practice-1-relu.json', 'utf8')).bot, tracks: ['practice-1'] });
await server.env.EVALUATOR.idle();

const browser = await chromium.launch();
const errors: string[] = [];
async function newPage(email: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack}`));
  p.on('console', (m) => m.type() === 'error' && !/\b(400|401|404|423)\b/.test(m.text()) && errors.push(m.text()));
  p.on('dialog', (d) => d.accept());
  await p.goto(`${server.url}/#/signin`);
  await p.fill('#dev-email', email);
  await p.click('.dev-login button');
  await p.waitForFunction("document.querySelector('#account')?.textContent !== 'Sign in'");
  return p;
}
const localInput = (d: Date) => {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
};

try {
  const ref = await newPage('ref@cam.ac.uk');
  const player = await newPage('qq1@cam.ac.uk');

  // Referee: upload three twists.
  await ref.goto(`${server.url}/#/admin`);
  await ref.waitForSelector('#twist-file');
  for (const id of ['night-oval', 'ice-hairpins', 'reverse-glacier']) {
    await ref.setInputFiles('#twist-file', twistFile(id));
    await ref.waitForSelector(`[data-twist="${id}"]`, { timeout: 15000 });
  }
  check((await ref.locator('.twist-admin.staged').count()) === 3, 'referee uploads three twists; all start hidden ("not public yet")');

  // Schedule night mode to open by itself in 6 seconds.
  const opens = new Date(Date.now() + 6000);
  await ref.fill('[data-twist="night-oval"] .twist-from', localInput(opens));
  await ref.click('[data-twist="night-oval"] >> text=Save schedule');
  await ref.waitForTimeout(500);
  await player.goto(`${server.url}/#/`);
  await player.waitForSelector('.tracks');
  await player.waitForTimeout(500);
  check(await player.locator('.twists').isHidden(), 'before its time, players see no twist (no spoilers)');
  await player.waitForTimeout(Math.max(0, opens.getTime() - Date.now()) + 800);
  await player.reload();
  await player.waitForSelector('.twist-card', { timeout: 10000 });
  check((await player.textContent('.twist-card h2')) === 'Frosty Oval by Night', 'at the scheduled time the twist goes live on its own (home page card)');
  await player.waitForSelector('#announce:not([hidden])');
  check((await player.textContent('#announce'))!.includes('New twist live: Frosty Oval by Night'), 'an announcement tells everyone');
  await shot(player, '01-home-twist');

  // Manual override: reverse glacier is scheduled for next week, but goes live now.
  await ref.reload();
  await ref.waitForSelector('[data-twist="reverse-glacier"]');
  await ref.fill('[data-twist="reverse-glacier"] .twist-from', localInput(new Date(Date.now() + 7 * 86400e3)));
  await ref.click('[data-twist="reverse-glacier"] >> text=Save schedule');
  await ref.waitForTimeout(400);
  await ref.click('[data-twist="reverse-glacier"] >> text=Go live now');
  await ref.waitForSelector('[data-twist="reverse-glacier"].live');
  check(true, 'the manual override flips a twist scheduled for next week live early');

  // Dry run on the still-hidden ice twist: private results, no public change.
  await ref.click('[data-twist="ice-hairpins"] >> text=Dry run');
  await server.env.EVALUATOR.idle();
  await ref.reload();
  await ref.waitForSelector('[data-twist="ice-hairpins"] details summary');
  const dry = (await ref.textContent('[data-twist="ice-hairpins"] details summary'))!;
  check(/of 2 bots finish/.test(dry), `dry run raced every team's latest bot privately (${dry.trim()})`);
  check(await ref.locator('[data-twist="ice-hairpins"].staged').isVisible(), 'the dry-run twist is still hidden from players');
  await shot(ref, '02-admin-twists');

  // Player: night-mode trainer has 3 sensors and can learn from daylight laps.
  await player.goto(`${server.url}/#/laps`);
  await player.setInputFiles('input[type=file]', lapFiles);
  await player.waitForFunction('document.querySelectorAll(".laps-table tbody tr").length === 3', null, { timeout: 15000 });
  await player.goto(`${server.url}/#/train/night-oval`);
  await player.waitForSelector('.data-summary');
  const sensorLabels = await player.locator('label.check').allTextContents();
  check(sensorLabels.filter((l) => /Distance/.test(l)).length === 3 && sensorLabels.some((l) => /left 45°/.test(l)), 'the night trainer offers exactly the 3 headlamp sensors');
  await player.check('#all-tracks');
  await player.click('text=Use Recommended settings');
  await player.waitForFunction("/3 laps/.test(document.querySelector('.data-summary')?.textContent ?? '')");
  check(/1,282/.test((await player.textContent('.param-info'))!), 'Recommended night network: 3 rays + speed → 1,282 parameters');
  await player.click('text=Train my bot');
  await player.waitForSelector('.result:not([hidden])', { timeout: 60000 });
  check(true, 'a night bot trains from daylight laps (sensors re-read with the night rays)');
  await shot(player, '03-night-trainer');

  // Put a night bot on the board through the API, then race the leader.
  await api.post('/api/v1/submissions', { bot: quickBot('Owl', ['ray0', 'ray1', 'ray2', 'speed']), tracks: ['night-oval'] });
  await server.env.EVALUATOR.idle();
  await player.goto(`${server.url}/#/boards/night-oval/bots`);
  await player.waitForSelector('.board-table tbody tr:not(.baseline-row)');
  await player.waitForSelector('.tabs a.twist-tab >> nth=1');
  check((await player.locator('.tabs a.twist-tab').count()) === 2, 'boards list both live twists as tabs');
  check((await player.locator('tr.baseline-row').count()) === 1, 'the twist board shows the baseline bot for reference');
  check((await player.textContent('.twist-note'))!.includes('Frosty Oval by Night'), 'the twist board explains the twist');
  await shot(player, '04-twist-board');
  await player.click('text=Race the leader');
  await player.waitForSelector('.hud-ghost');
  await player.waitForFunction("/Owl|Four Eyes/.test(document.querySelector('.hud-ghost')?.textContent ?? '')", null, { timeout: 10000 });
  check(true, `Race the leader loads the leader's ghost (${(await player.textContent('.hud-ghost'))!.trim()})`);
  check((await player.locator('.sensors .bar').count()) === 3, 'driving at night shows 3 sensor bars');
  check((await player.textContent('.hud-track'))!.includes('Frosty Oval by Night'), 'the HUD names the twist');

  // Ghost race on a public board, and the baseline everywhere.
  await player.goto(`${server.url}/#/boards/practice-2/bots`);
  await player.waitForSelector('tr.baseline-row');
  check(await player.locator('text=Race the leader').isVisible(), 'every board with entries has Race the leader');

  // Badges and standings.
  await player.goto(`${server.url}/#/team`);
  await player.waitForSelector('.badge-shelf li.earned');
  const earned = await player.locator('.badge-shelf li.earned .badge-name').allTextContents();
  check(['Beat the Baseline', 'Clean Lap', 'Twist Tamer'].every((b) => earned.includes(b)), `badges awarded automatically (${earned.join(', ')})`);
  check((await player.locator('.badge-shelf li.locked').count()) >= 1, 'badges still to earn are shown greyed out');
  await shot(player, '05-badges');
  await player.goto(`${server.url}/#/standings`);
  await player.waitForSelector('.formula');
  check((await player.textContent('.formula'))!.includes("best 3 teams"), 'standings page shows the formula');
  check((await player.textContent('.standings'))!.includes("Queens'"), 'college standings list the colleges');
  await shot(player, '06-standings');

  // Digest for the group chat.
  await ref.click('text=Build digest');
  await ref.waitForSelector('textarea.digest:not([hidden])');
  const md = await ref.inputValue('textarea.digest');
  check(md.startsWith('# 🦌 Reindeer Grand Prix') && md.includes('Frosty Oval by Night (bots)') && md.includes('Twists live now'), 'the referee builds a markdown digest to paste');
  await shot(ref, '07-digest');

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  check(false, `test crashed: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll M4 browser checks passed.');
process.exit(failures ? 1 : 0);
