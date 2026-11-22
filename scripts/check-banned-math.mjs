// Fails if engine code (outside fmath.ts) calls a Math function whose result
// can differ between JavaScript engines or between JavaScript and Python.
// Allowed: abs, min, max, sqrt, floor, imul. Usage: node scripts/check-banned-math.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set(['abs', 'min', 'max', 'sqrt', 'floor', 'imul']);
const DIRS = ['engine/core', 'engine/reindeer'];
const SKIP = new Set(['engine/core/fmath.ts']);
let bad = 0;

function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts') && !SKIP.has(p)) check(p);
  }
}

function check(p) {
  readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
    for (const m of line.matchAll(/Math\.([a-zA-Z0-9]+)/g)) {
      if (!ALLOWED.has(m[1])) {
        bad++;
        console.log(`${p}:${i + 1}: Math.${m[1]} is not deterministic across platforms; use engine/core/fmath.ts`);
      }
    }
  });
}

DIRS.forEach(walk);
if (bad) process.exit(1);
console.log('Engine uses only deterministic maths.');
