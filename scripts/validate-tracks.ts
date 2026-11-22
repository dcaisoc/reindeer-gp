/** Validate every tracks/*.json file. Exit code 1 on any problem. Usage: npm run validate:tracks */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTrack } from '../tracks/validate.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tracks');
let failed = false;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const t = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const errs = validateTrack(t);
  if (errs.length) {
    failed = true;
    console.log(`✗ ${f}`);
    for (const e of errs) console.log(`    ${e}`);
  } else console.log(`✓ ${f}`);
}
process.exit(failed ? 1 : 0);
