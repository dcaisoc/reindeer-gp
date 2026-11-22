/**
 * Golden-trace check: re-simulate every recorded run in engine/golden/corpus
 * and require identical state hashes every 60 ticks and at the end.
 * Usage: npm run test:golden   (CI runs the same corpus in browsers and Python)
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCorpus } from './check.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const files = readdirSync(join(here, 'corpus')).filter((f) => f.endsWith('.json')).sort();
const corpus = files.map((f) => ({ name: f, replay: JSON.parse(readFileSync(join(here, 'corpus', f), 'utf8')) }));
const tracks = Object.fromEntries(
  ['practice-1', 'practice-2', 'practice-3'].map((id) => [id, JSON.parse(readFileSync(join(root, 'tracks', `${id}.json`), 'utf8'))]),
);
const report = checkCorpus(corpus, tracks);
for (const line of report.lines) console.log(line);
console.log(report.ok ? `\nAll ${corpus.length} golden traces match.` : `\n${report.failures} of ${corpus.length} golden traces FAILED.`);
process.exit(report.ok ? 0 : 1);
