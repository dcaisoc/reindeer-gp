/**
 * Golden-trace check: re-simulate every recorded run in engine/golden/corpus
 * and require identical state hashes every 60 ticks and at the end.
 * Usage: npm run test:golden   (CI runs the same corpus in browsers and Python)
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBots, checkCorpus } from './check.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const files = readdirSync(join(here, 'corpus')).filter((f) => f.endsWith('.json')).sort();
const corpus = files.map((f) => ({ name: f, replay: JSON.parse(readFileSync(join(here, 'corpus', f), 'utf8')) }));
const tracks = Object.fromEntries(
  ['practice-1', 'practice-2', 'practice-3'].map((id) => [id, JSON.parse(readFileSync(join(root, 'tracks', `${id}.json`), 'utf8'))]),
);
const report = checkCorpus(corpus, tracks);
const botCases = readdirSync(join(here, 'bots')).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ name: f, golden: JSON.parse(readFileSync(join(here, 'bots', f), 'utf8')) }));
const bots = checkBots(botCases, tracks);
for (const line of [...report.lines, ...bots.lines]) console.log(line);
const total = corpus.length + botCases.length;
const failed = report.failures + bots.failures;
console.log(failed === 0 ? `\nAll ${total} golden traces match.` : `\n${failed} of ${total} golden traces FAILED.`);
process.exit(failed === 0 ? 0 : 1);
