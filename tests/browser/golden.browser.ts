/**
 * Golden traces inside real browsers: bundle the engine plus the corpus, run it
 * in each browser engine, and require every hash to match.
 * Usage: npx tsx tests/browser/golden.browser.ts [chromium firefox webkit]
 */

import * as esbuild from 'esbuild';
import { readdirSync, readFileSync } from 'node:fs';
import { chromium, firefox, webkit, type BrowserType } from 'playwright';

const corpus = readdirSync('engine/golden/corpus')
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({ name: f, replay: JSON.parse(readFileSync(`engine/golden/corpus/${f}`, 'utf8')) }));
const tracks = Object.fromEntries(
  ['practice-1', 'practice-2', 'practice-3'].map((id) => [id, JSON.parse(readFileSync(`tracks/${id}.json`, 'utf8'))]),
);

const bundle = await esbuild.build({
  stdin: {
    contents: `import { checkCorpus } from './engine/golden/check.ts';
      window.__golden = (c, t) => checkCorpus(c, t);`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  write: false,
});
const code = bundle.outputFiles[0].text;

const wanted = process.argv.slice(2);
const engines: [string, BrowserType][] = (
  [
    ['chromium', chromium],
    ['firefox', firefox],
    ['webkit', webkit],
  ] as [string, BrowserType][]
).filter(([n]) => (wanted.length ? wanted.includes(n) : n !== 'webkit'));

let failed = false;
for (const [name, type] of engines) {
  let browser;
  try {
    browser = await type.launch();
  } catch (e) {
    console.log(`✗ ${name}: could not launch (${(e as Error).message.split('\n')[0]})`);
    failed = true;
    continue;
  }
  const page = await browser.newPage();
  await page.addScriptTag({ content: code });
  const report = (await page.evaluate(
    ([c, t]) => (window as unknown as { __golden: (a: unknown, b: unknown) => { ok: boolean; failures: number; lines: string[] } }).__golden(c, t),
    [corpus, tracks] as const,
  )) as { ok: boolean; failures: number; lines: string[] };
  const version = browser.version();
  await browser.close();
  if (report.ok) console.log(`✓ ${name} ${version}: all ${corpus.length} golden traces match`);
  else {
    failed = true;
    console.log(`✗ ${name} ${version}: ${report.failures} failed`);
    report.lines.filter((l) => l.startsWith('✗')).forEach((l) => console.log(`    ${l}`));
  }
}
process.exit(failed ? 1 : 0);
