// Copy the tracks and golden traces into the Python package so `pip install`
// ships them. CI fails if the copies drift: run `npm run sdk:sync` after changes.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

const dest = 'sdk/reindeer_sdk/data';
rmSync(dest, { recursive: true, force: true });
for (const [from, to] of [['tracks', 'tracks'], ['tracks/twists', 'twists'], ['engine/golden/corpus', 'golden/corpus'], ['engine/golden/bots', 'golden/bots']]) {
  mkdirSync(`${dest}/${to}`, { recursive: true });
  for (const f of readdirSync(from).filter((f) => f.endsWith('.json'))) cpSync(`${from}/${f}`, `${dest}/${to}/${f}`);
}
console.log(`Copied tracks, twists and golden traces into ${dest}/`);
