import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compareCounts, countInserts, dropSql, rowsOf } from '../scripts/d1-restore.mjs';
import { encodeReplay } from '../engine/core/replay.js';
import type { TrackDef } from '../engine/reindeer/track.js';
import { keyboardLap } from './helpers/keyboard-driver.js';
import { setup, teamUp } from './helpers/api-client.js';

/** A SQL dump in the shape `wrangler d1 export` writes: schema, then one INSERT per row. */
function dump(db: DatabaseSync): string {
  const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all() as { name: string; sql: string }[];
  const out = ['PRAGMA defer_foreign_keys=TRUE;'];
  for (const t of tables) out.push(`${t.sql};`);
  const q = (v: unknown) => (v === null ? 'NULL' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  for (const t of tables) {
    for (const row of db.prepare(`SELECT * FROM "${t.name}"`).all() as Record<string, unknown>[]) {
      out.push(`INSERT INTO "${t.name}" (${Object.keys(row).map((k) => `"${k}"`).join(',')}) VALUES(${Object.values(row).map(q).join(',')});`);
    }
  }
  for (const i of db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all() as { sql: string }[]) out.push(`${i.sql};`);
  return out.join('\n') + '\n';
}

test('restore drill helpers: wipe a live database in foreign-key order, load the backup, counts match', async () => {
  // "Production": a real database with users, teams, bots, runs, boards, blobs.
  const s = setup();
  const c = await s.client().login('bk1@cam.ac.uk');
  await teamUp(c, 'Backup Bandits');
  await c.post('/api/v1/submissions', { bot: JSON.parse(readFileSync('engine/golden/bots/bot-practice-1-relu.json', 'utf8')).bot });
  const p1: TrackDef = JSON.parse(readFileSync('tracks/practice-1.json', 'utf8'));
  await c.req('POST', '/api/v1/runs?submit=1', await encodeReplay(keyboardLap(p1, 1, 0)), true, { 'content-type': 'application/octet-stream' });
  await s.env.EVALUATOR.idle();
  const prod = (s.env.DB as unknown as { db: DatabaseSync }).db;
  const backup = dump(prod);
  const expected = countInserts(backup);
  assert.ok(expected.users >= 1 && expected.leaderboard_entries >= 2 && expected.blobs >= 3, JSON.stringify(expected));

  // "Staging": a different live database with foreign keys enforced (as D1 does).
  const t = setup();
  const d = await t.client().login('other@cam.ac.uk');
  await teamUp(d, 'Staging Squad');
  const staging = (t.env.DB as unknown as { db: DatabaseSync }).db;
  staging.exec('PRAGMA foreign_keys = ON');
  const tables = staging.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all();
  // Wrangler's --json output wraps rows like this.
  const drop = dropSql(rowsOf(JSON.stringify([{ results: tables, success: true }])));
  const at = (t: string) => drop.indexOf(`"${t}"`);
  assert.ok(at('memberships') < at('teams') && at('memberships') < at('users') && at('leaderboard_entries') < at('teams'), drop);
  staging.exec(drop);
  assert.equal((staging.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get() as { n: number }).n, 0);
  staging.exec(backup);
  const live = Object.keys(expected).map((name) => ({ name, n: (staging.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n }));
  assert.deepEqual(compareCounts(expected, live), []);
  // The restored database works: the app can read the board and the team from it.
  const restored = (await t.client().get('/api/v1/boards/s1/practice-1/base/bots')).data;
  assert.equal(restored.entries[0].team, 'Backup Bandits');
  assert.deepEqual(compareCounts({ users: 99 }, live), ['users: backup has 99 rows, database has 1']);
});

test('drop order: referencing tables first, cycles reported', () => {
  const sql = dropSql([
    { name: 'teams', sql: 'CREATE TABLE teams (id TEXT)' },
    { name: 'members', sql: 'CREATE TABLE members (t TEXT REFERENCES teams(id), u TEXT REFERENCES users(id))' },
    { name: 'users', sql: 'CREATE TABLE users (id TEXT)' },
  ]);
  assert.ok(sql.indexOf('"members"') < sql.indexOf('"teams"') && sql.indexOf('"members"') < sql.indexOf('"users"'));
  assert.throws(() => dropSql([{ name: 'a', sql: 'REFERENCES b' }, { name: 'b', sql: 'REFERENCES a' }]), /circular/);
  const withMig = [{ name: 'users', sql: '' }, { name: 'd1_migrations', sql: '' }];
  assert.ok(!dropSql(withMig, 'CREATE TABLE users (id);').includes('d1_migrations'), 'kept when the backup lacks it');
  assert.ok(dropSql(withMig, 'CREATE TABLE d1_migrations (id);').includes('d1_migrations'), 'dropped when the backup restores it');
});
