#!/usr/bin/env node
// Helpers for the restore drill (.github/workflows/restore.yml); tested in tests/restore.test.ts.
//
//   node scripts/d1-restore.mjs drop-sql <tables.json> [backup.sql]   SQL that drops every table, children first
//        (keeps d1_migrations if the backup doesn't recreate it, so deploys stay in step)
//   node scripts/d1-restore.mjs counts <backup.sql>           rows per table in a backup (JSON)
//   node scripts/d1-restore.mjs compare <counts.json> <live.json>   exit 1 if any table's rows differ
//
// <tables.json> and <live.json> are `wrangler d1 execute --json` outputs (or plain arrays of rows).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Rows from wrangler's --json output ([{results: [...]}]) or a plain array. */
export function rowsOf(json) {
  const v = typeof json === 'string' ? JSON.parse(json) : json;
  if (Array.isArray(v) && v.length && v[0] && Array.isArray(v[0].results)) return v.flatMap((r) => r.results);
  return Array.isArray(v) ? v : [];
}

/** DROP statements in an order foreign keys allow: tables that reference others go first. */
export function dropSql(tables, backupSql = null) {
  if (backupSql !== null && !/CREATE TABLE\s+(IF NOT EXISTS\s+)?"?d1_migrations"?/i.test(backupSql)) tables = tables.filter((t) => t.name !== 'd1_migrations');
  const names = new Set(tables.map((t) => t.name));
  const refs = new Map(tables.map((t) => [t.name, new Set([...String(t.sql ?? '').matchAll(/REFERENCES\s+"?([A-Za-z0-9_]+)"?/gi)].map((m) => m[1]).filter((n) => names.has(n) && n !== t.name))]));
  const order = [];
  const done = new Set();
  // Drop a table only once nothing left still references it.
  while (done.size < names.size) {
    const ready = [...names].filter((n) => !done.has(n) && ![...names].some((o) => !done.has(o) && o !== n && refs.get(o).has(n)));
    if (!ready.length) throw new Error(`circular foreign keys among: ${[...names].filter((n) => !done.has(n)).join(', ')}`);
    for (const n of ready.sort()) {
      order.push(n);
      done.add(n);
    }
  }
  return ['PRAGMA defer_foreign_keys = on;', ...order.map((n) => `DROP TABLE IF EXISTS "${n}";`)].join('\n') + '\n';
}

/** Rows per table in a SQL dump (counts INSERT statements). */
export function countInserts(sql) {
  const counts = {};
  for (const m of sql.matchAll(/^INSERT INTO\s+"?([A-Za-z0-9_]+)"?/gm)) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  return counts;
}

/** Differences between expected counts and live `SELECT name, n` rows. */
export function compareCounts(expected, live) {
  const got = Object.fromEntries(live.map((r) => [r.name, Number(r.n)]));
  return Object.entries(expected).filter(([t, n]) => got[t] !== n).map(([t, n]) => `${t}: backup has ${n} rows, database has ${got[t] ?? 'no table'}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'drop-sql') process.stdout.write(dropSql(rowsOf(readFileSync(a, 'utf8')), b ? readFileSync(b, 'utf8') : null));
  else if (cmd === 'counts') process.stdout.write(JSON.stringify(countInserts(readFileSync(a, 'utf8')), null, 1) + '\n');
  else if (cmd === 'compare') {
    const diff = compareCounts(JSON.parse(readFileSync(a, 'utf8')), rowsOf(readFileSync(b, 'utf8')));
    for (const d of diff) console.log(`✗ ${d}`);
    if (!diff.length) console.log('✓ every table has the same number of rows as the backup');
    process.exit(diff.length ? 1 : 0);
  } else {
    console.error('usage: d1-restore.mjs drop-sql <tables.json> | counts <backup.sql> | compare <counts.json> <live.json>');
    process.exit(2);
  }
}
