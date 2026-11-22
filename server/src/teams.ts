/** Teams of 1-4 people, joined with a short code. */

import { requireTeam, requireUser } from './auth.js';
import { BADGES, teamBadges } from './badges.js';
import type { Env } from './env.js';
import { HttpError, bad, json, notFound, readJson } from './http.js';
import { COLLEGES, LEVELS, checkName, joinCode, type Level } from './names.js';
import { newId, nowIso } from './util.js';

const MAX_MEMBERS = 4;

interface TeamRow {
  id: string;
  name: string;
  college: string;
  level: Level;
  level_locked_at: string | null;
  join_code: string;
  hidden: number;
  created_at: string;
}

function validateFields(b: { name?: unknown; college?: unknown; level?: unknown }, partial: boolean): void {
  if (!partial || b.name !== undefined) {
    const e = checkName(b.name, 'Team name', 32);
    if (e) throw bad(e);
  }
  if (!partial || b.college !== undefined) {
    if (typeof b.college !== 'string' || !COLLEGES.includes(b.college)) throw bad('Choose your college from the list.');
  }
  if (!partial || b.level !== undefined) {
    if (!LEVELS.includes(b.level as Level)) throw bad('Level must be elf, reindeer or santa.');
  }
}

async function teamView(env: Env, team: TeamRow, includePrivate: boolean) {
  const members = await env.DB.prepare(
    'SELECT u.id, u.display_name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.joined_at',
  )
    .bind(team.id)
    .all<{ id: string; display_name: string; role: string }>();
  return {
    id: team.id,
    name: team.name,
    college: team.college,
    level: team.level,
    levelLocked: !!team.level_locked_at,
    members: members.results.map((m) => ({ id: m.id, displayName: m.display_name, role: m.role })),
    badges: await teamBadges(env, team.id),
    ...(includePrivate ? { joinCode: team.join_code } : {}),
  };
}

/** POST /api/v1/teams {name, college, level} */
export async function createTeam(env: Env, req: Request): Promise<Response> {
  const u = await requireUser(env, req);
  if (u.team_id) throw new HttpError(409, 'already_in_team', 'You are already in a team. Leave it first.');
  const b = await readJson<{ name?: string; college?: string; level?: string }>(req);
  validateFields(b, false);
  const id = newId('t_');
  const now = nowIso();
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO teams (id, name, college, level, join_code, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
        id, b.name!.trim(), b.college, b.level, joinCode(), now,
      ),
      env.DB.prepare("INSERT INTO memberships (team_id, user_id, role, joined_at) VALUES (?, ?, 'captain', ?)").bind(id, u.id, now),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE') && String(e).includes('name')) throw new HttpError(409, 'name_taken', 'That team name is taken. Try another.');
    throw e;
  }
  return myTeam(env, req);
}

/** POST /api/v1/teams/join {code} */
export async function joinTeam(env: Env, req: Request): Promise<Response> {
  const u = await requireUser(env, req);
  if (u.team_id) throw new HttpError(409, 'already_in_team', 'You are already in a team. Leave it first.');
  const { code } = await readJson<{ code?: string }>(req);
  const team = await env.DB.prepare('SELECT * FROM teams WHERE join_code = ?')
    .bind(String(code ?? '').trim().toUpperCase())
    .first<TeamRow>();
  if (!team) throw new HttpError(404, 'bad_code', 'No team has that join code. Check it with your team captain.');
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM memberships WHERE team_id = ?').bind(team.id).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_MEMBERS) throw new HttpError(409, 'team_full', `That team already has ${MAX_MEMBERS} members.`);
  await env.DB.prepare("INSERT INTO memberships (team_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").bind(team.id, u.id, nowIso()).run();
  return myTeam(env, req);
}

/** POST /api/v1/teams/leave */
export async function leaveTeam(env: Env, req: Request): Promise<Response> {
  const u = await requireTeam(env, req);
  await env.DB.prepare('DELETE FROM memberships WHERE user_id = ?').bind(u.id).run();
  const left = await env.DB.prepare('SELECT user_id FROM memberships WHERE team_id = ? ORDER BY joined_at LIMIT 1').bind(u.team_id).first<{ user_id: string }>();
  if (left) await env.DB.prepare("UPDATE memberships SET role = 'captain' WHERE team_id = ? AND user_id = ?").bind(u.team_id, left.user_id).run();
  return json({ ok: true });
}

/** GET /api/v1/teams/mine */
export async function myTeam(env: Env, req: Request): Promise<Response> {
  const u = await requireUser(env, req);
  const fresh = await env.DB.prepare('SELECT t.* FROM teams t JOIN memberships m ON m.team_id = t.id WHERE m.user_id = ?').bind(u.id).first<TeamRow>();
  if (!fresh) return json({ team: null });
  return json({ team: await teamView(env, fresh, true) });
}

/** PATCH /api/v1/teams/mine {name?, college?, level?} — level can only go up once locked. */
export async function updateTeam(env: Env, req: Request): Promise<Response> {
  const u = await requireTeam(env, req);
  const b = await readJson<{ name?: string; college?: string; level?: Level }>(req);
  validateFields(b, true);
  const team = (await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(u.team_id).first<TeamRow>())!;
  if (b.level && team.level_locked_at && LEVELS.indexOf(b.level) < LEVELS.indexOf(team.level)) {
    throw new HttpError(409, 'level_locked', 'Your level is locked after your first bot submission; you can move up but not down. Ask a referee if this is wrong.');
  }
  try {
    await env.DB.prepare('UPDATE teams SET name = ?, college = ?, level = ? WHERE id = ?')
      .bind(b.name?.trim() ?? team.name, b.college ?? team.college, b.level ?? team.level, team.id)
      .run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new HttpError(409, 'name_taken', 'That team name is taken. Try another.');
    throw e;
  }
  return myTeam(env, req);
}

/** GET /api/v1/teams/:id — public view (no join code). */
export async function getTeam(env: Env, _req: Request, id: string): Promise<Response> {
  const team = await env.DB.prepare('SELECT * FROM teams WHERE id = ? AND hidden = 0').bind(id).first<TeamRow>();
  if (!team) throw notFound('That team');
  const entries = await env.DB.prepare(
    'SELECT board_key, score, penalties, replay_id, submitted_at FROM leaderboard_entries WHERE team_id = ? AND hidden = 0 ORDER BY board_key',
  )
    .bind(id)
    .all();
  return json({ team: await teamView(env, team, false), entries: entries.results });
}

/** GET /api/v1/meta — colleges and levels for forms. */
export function meta(): Response {
  return json({ colleges: COLLEGES, levels: LEVELS, badges: BADGES }, 200, { 'cache-control': 'public, max-age=3600' });
}
