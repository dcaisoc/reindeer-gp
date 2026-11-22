/**
 * Weekly twists: upload, schedule, go live on time (or early, by override),
 * and rehearse with a dry run. A twist's liveness is computed from the clock
 * on every request, so it opens at exactly the scheduled moment; the cron job
 * only adds the "new twist" announcement if nobody visited at that moment.
 */

import { twistConfig, type TwistDef } from '../../engine/reindeer/twist.js';
import { inputNames } from '../../engine/reindeer/sim.js';
import { audit } from './audit.js';
import { requireReferee, currentUser } from './auth.js';
import { blobs } from './blobs.js';
import type { Env } from './env.js';
import { HttpError, bad, json, notFound, readJson } from './http.js';
import { TRACKS, boardKey, publicBoardKeys, publicCourse, type Course } from './tracks.js';
import { newId, nowIso } from './util.js';

export interface TwistRow {
  id: string;
  version: string;
  base_track: string;
  name: string;
  description: string;
  r2_key: string;
  live_from: string | null;
  live_until: string | null;
  override: 'live' | 'off' | null;
  went_live_at: string | null;
  created_at: string;
  updated_at: string;
}

export function isLive(r: Pick<TwistRow, 'override' | 'live_from' | 'live_until'>, now = nowIso()): boolean {
  if (r.override === 'live') return true;
  if (r.override === 'off' || !r.live_from) return false;
  return r.live_from <= now && (!r.live_until || now < r.live_until);
}

/** Public once it has ever been live (boards and replays of past twists stay visible). */
export function statusOf(r: TwistRow, now = nowIso()): Course['status'] {
  if (isLive(r, now)) return 'live';
  return r.went_live_at ? 'ended' : 'staged';
}

const defCache = new Map<string, TwistDef>();

export async function twistDef(env: Env, r: Pick<TwistRow, 'id' | 'version' | 'r2_key'>): Promise<TwistDef> {
  const k = `${r.id}@${r.version}`;
  let d = defCache.get(k);
  if (!d) {
    const obj = await blobs(env).get(r.r2_key);
    if (!obj) throw new Error(`twist file missing: ${r.r2_key}`);
    d = JSON.parse(new TextDecoder().decode(await obj.arrayBuffer())) as TwistDef;
    defCache.set(k, d);
  }
  return d;
}

export function twistCourse(d: TwistDef, status: Course['status']): Course {
  return {
    id: d.id, name: d.name, description: d.description, difficulty: d.track.difficulty, baseTrack: d.baseTrack, track: d.track,
    cfg: twistConfig(d), twist: { id: d.id, version: d.twistVersion }, version: d.twistVersion, status,
  };
}

async function rows(env: Env): Promise<TwistRow[]> {
  return (await env.DB.prepare('SELECT * FROM twists ORDER BY COALESCE(live_from, created_at)').all<TwistRow>()).results;
}

/**
 * Record the first moment each due twist went live, and announce it. Safe to
 * call often: it does nothing when there is nothing new.
 */
export async function activateDueTwists(env: Env, all?: TwistRow[]): Promise<void> {
  const now = nowIso();
  for (const r of all ?? (await rows(env))) {
    if (r.went_live_at || !isLive(r, now)) continue;
    const claimed = await env.DB.prepare('UPDATE twists SET went_live_at = ? WHERE id = ? AND went_live_at IS NULL').bind(now, r.id).run();
    if (!claimed.meta.changes) continue;
    r.went_live_at = now;
    await env.DB.prepare('INSERT INTO announcements (id, text, author_id, active, created_at) VALUES (?, ?, ?, 1, ?)')
      .bind(newId('n_'), `New twist live: ${r.name}. ${r.description}`, 'system', now)
      .run();
    await audit(env, 'system', 'twist.live', r.id, { version: r.version, liveFrom: r.live_from, override: r.override });
  }
}

/** A course by id: a public track, or a twist that is public (live or ended). Referees also see staged twists. */
export async function courseFor(env: Env, id: string, opts: { includeStaged?: boolean } = {}): Promise<Course | null> {
  const p = publicCourse(id);
  if (p) return p;
  const r = await env.DB.prepare('SELECT * FROM twists WHERE id = ?').bind(id).first<TwistRow>();
  if (!r) return null;
  await activateDueTwists(env, [r]);
  const status = statusOf(r);
  if (status === 'staged' && !opts.includeStaged) return null;
  return twistCourse(await twistDef(env, r), status);
}

/** Every course open for entries right now: the public tracks plus live twists. */
export async function liveCourses(env: Env): Promise<Course[]> {
  const all = await rows(env);
  await activateDueTwists(env, all);
  const now = nowIso();
  const live = await Promise.all(all.filter((r) => isLive(r, now)).map(async (r) => twistCourse(await twistDef(env, r), 'live')));
  return [...TRACKS.map((t) => publicCourse(t.id)!), ...live];
}

/** Public twists (live or ended), for board lists and the daily rank snapshot. */
export async function publicTwists(env: Env): Promise<(TwistRow & { status: Course['status'] })[]> {
  const all = await rows(env);
  await activateDueTwists(env, all);
  const now = nowIso();
  return all.map((r) => ({ ...r, status: statusOf(r, now) })).filter((r) => r.status !== 'staged');
}

export async function allBoardKeys(env: Env): Promise<string[]> {
  const tw = await publicTwists(env);
  return [...publicBoardKeys(), ...tw.flatMap((r) => [boardKey(r.base_track, 'bots', r.id), boardKey(r.base_track, 'humans', r.id)])];
}

function publicView(r: TwistRow, d: TwistDef, status: Course['status']) {
  return {
    id: r.id, version: r.version, name: r.name, description: r.description, baseTrack: r.base_track,
    live: status === 'live', status, liveFrom: r.live_from, liveUntil: r.live_until, wentLiveAt: r.went_live_at,
    inputs: inputNames(twistConfig(d)), config: d.config, difficulty: d.track.difficulty,
  };
}

/** GET /api/v1/twists: public twists (live and past), without track data. */
export async function listTwists(env: Env): Promise<Response> {
  const tw = await publicTwists(env);
  const out = await Promise.all(tw.map(async (r) => publicView(r, await twistDef(env, r), r.status)));
  return json({ twists: out }, 200, { 'cache-control': 'public, max-age=15' });
}

/** GET /api/v1/twists/:id: the full twist file. Hidden until it first goes live (referees can preview). */
export async function getTwist(env: Env, req: Request, id: string): Promise<Response> {
  const u = await currentUser(env, req);
  const c = await courseFor(env, id, { includeStaged: !!u?.is_referee });
  if (!c || !c.twist) throw notFound('That twist');
  const r = (await env.DB.prepare('SELECT * FROM twists WHERE id = ?').bind(id).first<TwistRow>())!;
  const d = await twistDef(env, r);
  return json({ twist: d, schedule: publicView(r, d, c.status) }, 200, { 'cache-control': c.status === 'staged' ? 'no-store' : 'public, max-age=60' });
}

// ---------------------------------------------------------------- referees

/** Heavy checks (track validation, baseline run) happen in the Evaluator, which has CPU to spare. */
async function evaluatorCall<T>(env: Env, path: string, body: unknown): Promise<T> {
  const stub = env.EVALUATOR.get(env.EVALUATOR.idFromName('main'));
  const res = await stub.fetch(`https://evaluator${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  if (!res.ok) throw new Error(`evaluator ${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** GET /api/v1/admin/twists */
export async function adminListTwists(env: Env, req: Request): Promise<Response> {
  await requireReferee(env, req);
  const all = await rows(env);
  await activateDueTwists(env, all);
  const now = nowIso();
  const dry = await env.DB.prepare('SELECT * FROM dry_runs ORDER BY created_at').all<{
    id: string; twist_id: string; twist_version: string; status: string; results_json: string | null; created_at: string; finished_at: string | null;
  }>();
  const lastDry = new Map(dry.results.map((d) => [d.twist_id, d]));
  const base = await env.DB.prepare('SELECT * FROM baselines').all<{ course_id: string; version: string; valid: number; score: number | null }>();
  const baseline = new Map(base.results.map((b) => [`${b.course_id}@${b.version}`, b]));
  const counts = await env.DB.prepare("SELECT board_key, COUNT(*) AS n FROM leaderboard_entries GROUP BY board_key").all<{ board_key: string; n: number }>();
  const n = new Map(counts.results.map((c) => [c.board_key, c.n]));
  return json({
    now,
    twists: all.map((r) => {
      const d = lastDry.get(r.id);
      const b = baseline.get(`${r.id}@${r.version}`);
      return {
        id: r.id, version: r.version, name: r.name, description: r.description, baseTrack: r.base_track,
        liveFrom: r.live_from, liveUntil: r.live_until, override: r.override, wentLiveAt: r.went_live_at, status: statusOf(r, now),
        entries: (n.get(boardKey(r.base_track, 'bots', r.id)) ?? 0) + (n.get(boardKey(r.base_track, 'humans', r.id)) ?? 0),
        baseline: b ? { valid: !!b.valid, score: b.score } : null,
        dryRun: d ? { id: d.id, version: d.twist_version, status: d.status, createdAt: d.created_at, finishedAt: d.finished_at, results: d.results_json ? JSON.parse(d.results_json) : null } : null,
      };
    }),
  });
}

/** POST /api/v1/admin/twists (body: the twist file). Replaces a twist only while it has never been live. */
export async function uploadTwist(env: Env, req: Request): Promise<Response> {
  const u = await requireReferee(env, req);
  const def = await readJson<TwistDef>(req, 1024 * 1024);
  const check = await evaluatorCall<{ errors: string[]; baseline: { valid: boolean; score: number | null } | null }>(env, '/twist-check', def);
  if (check.errors.length) throw new HttpError(422, 'invalid_twist', 'The twist file has problems.', { errors: check.errors });
  if (publicCourse(def.id)) throw new HttpError(422, 'invalid_twist', `"${def.id}" is a public track id; pick another id.`, { errors: [] });
  const existing = await env.DB.prepare('SELECT * FROM twists WHERE id = ?').bind(def.id).first<TwistRow>();
  if (existing?.went_live_at) {
    throw new HttpError(409, 'conflict', `"${def.id}" has already been live, so its boards are fixed. Upload the change under a new id (e.g. ${def.id}-2).`);
  }
  const now = nowIso();
  const key = `twists/${def.id}@${def.twistVersion}.json`;
  await blobs(env).put(key, JSON.stringify(def), { httpMetadata: { contentType: 'application/json' } });
  if (existing) {
    await env.DB.prepare('UPDATE twists SET version = ?, base_track = ?, name = ?, description = ?, r2_key = ?, updated_at = ? WHERE id = ?')
      .bind(def.twistVersion, def.baseTrack, def.name, def.description, key, now, def.id)
      .run();
  } else {
    await env.DB.prepare(
      'INSERT INTO twists (id, version, base_track, name, description, r2_key, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(def.id, def.twistVersion, def.baseTrack, def.name, def.description, key, u.id, now, now)
      .run();
  }
  if (check.baseline) {
    const b = check.baseline as { valid: boolean; score: number | null; ticks?: number; penalties?: number };
    await env.DB.prepare('INSERT OR REPLACE INTO baselines (course_id, version, valid, score, ticks, penalties) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(def.id, def.twistVersion, b.valid ? 1 : 0, b.score, b.ticks ?? 0, b.penalties ?? 0)
      .run();
  }
  await audit(env, u.id, existing ? 'twist.replace' : 'twist.upload', def.id, { version: def.twistVersion, from: existing?.version });
  return json({ ok: true, id: def.id, version: def.twistVersion, baseline: check.baseline }, existing ? 200 : 201);
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

/** PATCH /api/v1/admin/twists/:id {liveFrom?, liveUntil?, override?} (ISO times in UTC; null clears). */
export async function scheduleTwist(env: Env, req: Request, id: string): Promise<Response> {
  const u = await requireReferee(env, req);
  const r = await env.DB.prepare('SELECT * FROM twists WHERE id = ?').bind(id).first<TwistRow>();
  if (!r) throw notFound('That twist');
  const b = await readJson<{ liveFrom?: string | null; liveUntil?: string | null; override?: 'live' | 'off' | null }>(req);
  const norm = (v: string | null | undefined, name: string): string | null | undefined => {
    if (v === undefined || v === null) return v;
    if (typeof v !== 'string' || !ISO.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${name} must be a UTC time like 2026-12-07T12:00:00Z.`);
    return new Date(v).toISOString();
  };
  const liveFrom = norm(b.liveFrom, 'liveFrom');
  const liveUntil = norm(b.liveUntil, 'liveUntil');
  if (b.override !== undefined && b.override !== null && b.override !== 'live' && b.override !== 'off') throw bad('override must be "live", "off" or null.');
  const next = {
    live_from: liveFrom === undefined ? r.live_from : liveFrom,
    live_until: liveUntil === undefined ? r.live_until : liveUntil,
    override: b.override === undefined ? r.override : b.override,
  };
  if (next.live_from && next.live_until && next.live_until <= next.live_from) throw bad('The end must be after the start.');
  await env.DB.prepare('UPDATE twists SET live_from = ?, live_until = ?, override = ?, updated_at = ? WHERE id = ?')
    .bind(next.live_from, next.live_until, next.override, nowIso(), id)
    .run();
  await audit(env, u.id, 'twist.schedule', id, {
    from: { liveFrom: r.live_from, liveUntil: r.live_until, override: r.override },
    to: { liveFrom: next.live_from, liveUntil: next.live_until, override: next.override },
  });
  await activateDueTwists(env);
  const now = nowIso();
  return json({ ok: true, status: statusOf({ ...r, ...next, went_live_at: r.went_live_at ?? (isLive(next, now) ? now : null) }, now), ...next });
}

/** DELETE /api/v1/admin/twists/:id: only a twist that has never been live. */
export async function deleteTwist(env: Env, req: Request, id: string): Promise<Response> {
  const u = await requireReferee(env, req);
  const r = await env.DB.prepare('SELECT * FROM twists WHERE id = ?').bind(id).first<TwistRow>();
  if (!r) throw notFound('That twist');
  if (r.went_live_at) throw new HttpError(409, 'conflict', 'This twist has been live, so its boards and replays are kept. Take it down instead.');
  await env.DB.batch([env.DB.prepare('DELETE FROM twists WHERE id = ?').bind(id), env.DB.prepare('DELETE FROM dry_runs WHERE twist_id = ?').bind(id)]);
  await audit(env, u.id, 'twist.delete', id, { version: r.version });
  return json({ ok: true });
}

/** POST /api/v1/admin/twists/:id/dry-run: race every team's latest bot on the twist, privately. */
export async function startDryRun(env: Env, req: Request, id: string): Promise<Response> {
  const u = await requireReferee(env, req);
  const r = await env.DB.prepare('SELECT * FROM twists WHERE id = ?').bind(id).first<TwistRow>();
  if (!r) throw notFound('That twist');
  const runId = newId('d_');
  await env.DB.prepare("INSERT INTO dry_runs (id, twist_id, twist_version, status, created_by, created_at) VALUES (?, ?, ?, 'queued', ?, ?)")
    .bind(runId, r.id, r.version, u.id, nowIso())
    .run();
  await audit(env, u.id, 'twist.dry_run', id, { version: r.version, dryRun: runId });
  const stub = env.EVALUATOR.get(env.EVALUATOR.idFromName('main'));
  await stub.fetch('https://evaluator/kick', { method: 'POST' });
  return json({ id: runId, status: 'queued' }, 202);
}

/** A course's display name without loading its file. */
export async function courseName(env: Env, id: string): Promise<string> {
  const p = publicCourse(id);
  if (p) return p.name;
  const r = await env.DB.prepare('SELECT name FROM twists WHERE id = ?').bind(id).first<{ name: string }>();
  return r?.name ?? id;
}

export { TRACKS };
