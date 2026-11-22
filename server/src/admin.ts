/** Referee tools. Every change is written to the audit log. */

import { audit } from './audit.js';
import { requireReferee } from './auth.js';
import { rebuildBoard } from './boards.js';
import type { Env } from './env.js';
import { bad, json, notFound, readJson } from './http.js';
import { LEVELS, checkName } from './names.js';
import { parseBoardKey } from './tracks.js';
import { allBoardKeys } from './twists.js';
import { newId, nowIso, startOfUkDay } from './util.js';

const EDITABLE_SETTINGS: Record<string, (v: string) => boolean> = {
  submissions_open: (v) => v === 'true' || v === 'false',
  boards_frozen: (v) => v === 'true' || v === 'false',
  bot_submissions_per_day: (v) => /^\d{1,4}$/.test(v),
  human_submissions_per_day: (v) => /^\d{1,4}$/.test(v),
};

/** GET /api/v1/admin/overview */
export async function overview(env: Env, req: Request): Promise<Response> {
  await requireReferee(env, req);
  const today = startOfUkDay();
  const one = async (sql: string, ...b: unknown[]) => ((await env.DB.prepare(sql).bind(...b).first<{ n: number }>())?.n ?? 0);
  const [settings, teams, audits, announcements] = await Promise.all([
    env.DB.prepare('SELECT key, value FROM settings ORDER BY key').all<{ key: string; value: string }>(),
    env.DB.prepare(
      'SELECT t.id, t.name, t.college, t.level, t.hidden, t.created_at, (SELECT COUNT(*) FROM memberships m WHERE m.team_id = t.id) AS members FROM teams t ORDER BY t.created_at DESC LIMIT 500',
    ).all(),
    env.DB.prepare('SELECT a.*, u.display_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 50').all(),
    env.DB.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 20').all(),
  ]);
  return json({
    settings: Object.fromEntries(settings.results.map((s) => [s.key, s.value])),
    stats: {
      users: await one('SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL'),
      teams: await one('SELECT COUNT(*) AS n FROM teams'),
      submissionsToday: await one("SELECT COUNT(*) AS n FROM submissions WHERE kind != 'verify' AND created_at >= ?", today),
      queued: await one("SELECT COUNT(*) AS n FROM submissions WHERE status IN ('queued', 'running')"),
      rejectedToday: await one("SELECT COUNT(*) AS n FROM submissions WHERE status = 'rejected' AND created_at >= ?", today),
    },
    teams: teams.results,
    audit: audits.results,
    announcements: announcements.results,
  });
}

/** POST /api/v1/admin/settings {key, value} */
export async function setSetting(env: Env, req: Request): Promise<Response> {
  const u = await requireReferee(env, req);
  const { key, value } = await readJson<{ key?: string; value?: string }>(req);
  const ok = key && EDITABLE_SETTINGS[key];
  if (!ok || typeof value !== 'string' || !ok(value)) throw bad('Unknown setting or invalid value.');
  const old = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, value).run();
  await audit(env, u.id, 'settings.set', key, { from: old?.value, to: value });
  return json({ ok: true });
}

/** POST /api/v1/admin/entries/hide {boardKey, teamId, hidden} */
export async function hideEntry(env: Env, req: Request): Promise<Response> {
  const u = await requireReferee(env, req);
  const { boardKey, teamId, hidden } = await readJson<{ boardKey?: string; teamId?: string; hidden?: boolean }>(req);
  if (!boardKey || !parseBoardKey(boardKey) || !teamId) throw bad('boardKey and teamId are required.');
  const r = await env.DB.prepare('UPDATE leaderboard_entries SET hidden = ? WHERE board_key = ? AND team_id = ?').bind(hidden ? 1 : 0, boardKey, teamId).run();
  if (!r.meta.changes) throw notFound('That entry');
  await rebuildBoard(env, boardKey);
  await audit(env, u.id, hidden ? 'entry.hide' : 'entry.show', `${boardKey}#${teamId}`);
  return json({ ok: true });
}

/** POST /api/v1/admin/teams/:id {name?, hidden?, level?} */
export async function editTeam(env: Env, req: Request, id: string): Promise<Response> {
  const u = await requireReferee(env, req);
  const b = await readJson<{ name?: string; hidden?: boolean; level?: string }>(req);
  const team = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(id).first<{ name: string; hidden: number; level: string }>();
  if (!team) throw notFound('That team');
  if (b.name !== undefined) {
    const e = checkName(b.name, 'Team name', 32);
    if (e) throw bad(e);
  }
  if (b.level !== undefined && !LEVELS.includes(b.level as never)) throw bad('Unknown level.');
  await env.DB.prepare('UPDATE teams SET name = ?, hidden = ?, level = ? WHERE id = ?')
    .bind(b.name?.trim() ?? team.name, b.hidden === undefined ? team.hidden : b.hidden ? 1 : 0, b.level ?? team.level, id)
    .run();
  for (const key of await allBoardKeys(env)) await rebuildBoard(env, key);
  await audit(env, u.id, 'team.edit', id, { before: team, changes: b });
  return json({ ok: true });
}

/** POST /api/v1/admin/announcements {text} */
export async function postAnnouncement(env: Env, req: Request): Promise<Response> {
  const u = await requireReferee(env, req);
  const { text } = await readJson<{ text?: string }>(req);
  if (typeof text !== 'string' || text.trim().length < 3 || text.length > 500) throw bad('Announcements are 3-500 characters.');
  const id = newId('n_');
  await env.DB.prepare('INSERT INTO announcements (id, text, author_id, created_at) VALUES (?, ?, ?, ?)').bind(id, text.trim(), u.id, nowIso()).run();
  await audit(env, u.id, 'announcement.post', id, { text });
  return json({ id });
}

/** DELETE /api/v1/admin/announcements/:id */
export async function removeAnnouncement(env: Env, req: Request, id: string): Promise<Response> {
  const u = await requireReferee(env, req);
  await env.DB.prepare('UPDATE announcements SET active = 0 WHERE id = ?').bind(id).run();
  await audit(env, u.id, 'announcement.remove', id);
  return json({ ok: true });
}

/** GET /api/v1/announcements — public. */
export async function announcements(env: Env): Promise<Response> {
  const r = await env.DB.prepare('SELECT id, text, created_at FROM announcements WHERE active = 1 ORDER BY created_at DESC LIMIT 5').all();
  return json({ announcements: r.results }, 200, { 'cache-control': 'no-cache' });
}

/** GET /api/v1/admin/export.csv — every current leaderboard entry. */
export async function exportCsv(env: Env, req: Request): Promise<Response> {
  const u = await requireReferee(env, req);
  const r = await env.DB.prepare(
    `SELECT e.board_key, t.name AS team, t.college, t.level, e.beginner, e.score, e.penalties, e.submitted_at, e.hidden, e.replay_id
       FROM leaderboard_entries e JOIN teams t ON t.id = e.team_id ORDER BY e.board_key, e.score`,
  ).all<Record<string, unknown>>();
  const cols = ['board_key', 'team', 'college', 'level', 'beginner', 'score', 'penalties', 'submitted_at', 'hidden', 'replay_id'];
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    // Quote, and neutralise spreadsheet formulas in user-supplied text.
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  const csv = [cols.join(','), ...r.results.map((row) => cols.map((c) => cell(row[c])).join(','))].join('\n');
  await audit(env, u.id, 'export.csv', null, { rows: r.results.length });
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="reindeer-gp-results.csv"' } });
}
