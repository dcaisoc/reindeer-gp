/**
 * Work that needs more CPU than an API request gets (10 ms on the free plan):
 * checking an uploaded twist, the baseline bot's result per course, and dry
 * runs. All of it runs inside the Evaluator Durable Object.
 */

import type { BotFile } from '../../engine/core/bot.js';
import { baselinePolicy } from '../../engine/reindeer/autopilot.js';
import { evaluateBot, validateBotForEngine } from '../../engine/reindeer/bot-policy.js';
import { runPolicy } from '../../engine/reindeer/run.js';
import { twistConfig, type TwistDef } from '../../engine/reindeer/twist.js';
import { validateTwist } from '../../tracks/validate.js';
import { blobs } from './blobs.js';
import type { Env } from './env.js';
import { json } from './http.js';
import { geometry, type Course } from './tracks.js';
import { courseFor, liveCourses, publicTwists, twistCourse, twistDef, type TwistRow } from './twists.js';
import { nowIso } from './util.js';

export interface BaselineResult {
  valid: boolean;
  score: number | null;
  ticks: number;
  penalties: number;
}

export function runBaseline(c: Pick<Course, 'track' | 'cfg' | 'twist'>): BaselineResult {
  const r = runPolicy(c.track, baselinePolicy, { kind: 'bot', name: 'Baseline bot' }, { cfg: c.cfg, twist: c.twist, geo: geometry(c.track) }).header.result;
  return { valid: r.valid, score: r.score, ticks: r.ticks, penalties: r.penalties };
}

/** The stored baseline for a course, computing it the first time. */
export async function baselineFor(env: Env, c: Course): Promise<BaselineResult> {
  const row = await env.DB.prepare('SELECT * FROM baselines WHERE course_id = ? AND version = ?').bind(c.id, c.version)
    .first<{ valid: number; score: number | null; ticks: number; penalties: number }>();
  if (row) return { valid: !!row.valid, score: row.score, ticks: row.ticks, penalties: row.penalties };
  const b = runBaseline(c);
  await env.DB.prepare('INSERT OR REPLACE INTO baselines (course_id, version, valid, score, ticks, penalties) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(c.id, c.version, b.valid ? 1 : 0, b.score, b.ticks, b.penalties)
    .run();
  return b;
}

/** Make sure every public course (tracks, live and past twists) has its baseline stored. Returns true if one was computed. */
export async function ensureBaselines(env: Env): Promise<boolean> {
  const have = new Set((await env.DB.prepare('SELECT course_id, version FROM baselines').all<{ course_id: string; version: string }>()).results.map((b) => `${b.course_id}@${b.version}`));
  const courses: Course[] = await liveCourses(env);
  for (const r of await publicTwists(env)) if (r.status === 'ended') courses.push(twistCourse(await twistDef(env, r), 'ended'));
  let did = false;
  for (const c of courses) {
    if (have.has(`${c.id}@${c.version}`)) continue;
    await baselineFor(env, c);
    did = true;
  }
  return did;
}

interface DryRunResult {
  teamId: string;
  team: string;
  botName: string;
  valid: boolean;
  score: number | null;
  penalties: number | null;
  note: string | null;
}

/** Run the oldest queued dry run. Returns false when there is none. */
export async function processDryRun(env: Env): Promise<boolean> {
  const d = await env.DB.prepare("SELECT * FROM dry_runs WHERE status = 'queued' ORDER BY created_at LIMIT 1").first<{ id: string; twist_id: string; twist_version: string }>();
  if (!d) return false;
  const claimed = await env.DB.prepare("UPDATE dry_runs SET status = 'running' WHERE id = ? AND status = 'queued'").bind(d.id).run();
  if (!claimed.meta.changes) return true;
  try {
    const c = await courseFor(env, d.twist_id, { includeStaged: true });
    if (!c || c.version !== d.twist_version) throw new Error('The twist changed or was deleted before the dry run started. Run it again.');
    // Every team's most recent bot (hidden teams excluded), at most 300.
    const bots = await env.DB.prepare(
      `SELECT b.id, b.name, b.r2_key, t.id AS team_id, t.name AS team FROM bots b JOIN teams t ON t.id = b.team_id
        WHERE t.hidden = 0 AND b.created_at = (SELECT MAX(b2.created_at) FROM bots b2 WHERE b2.team_id = b.team_id)
        ORDER BY b.created_at DESC LIMIT 300`,
    ).all<{ id: string; name: string; r2_key: string; team_id: string; team: string }>();
    const results: DryRunResult[] = [];
    for (const b of bots.results) {
      const obj = await blobs(env).get(b.r2_key);
      const base = { teamId: b.team_id, team: b.team, botName: b.name };
      if (!obj) {
        results.push({ ...base, valid: false, score: null, penalties: null, note: 'bot file missing' });
        continue;
      }
      const file = JSON.parse(new TextDecoder().decode(await obj.arrayBuffer())) as BotFile;
      const { errors } = validateBotForEngine(file, c.cfg);
      if (errors.length) {
        results.push({ ...base, valid: false, score: null, penalties: null, note: `can't race here: ${errors[0]}` });
        continue;
      }
      const r = evaluateBot(c.track, file, {}, { cfg: c.cfg, geo: geometry(c.track), twist: c.twist }).header.result;
      results.push({ ...base, valid: r.valid, score: r.score, penalties: r.penalties, note: r.valid ? null : 'did not finish' });
    }
    results.sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity) || a.team.localeCompare(b.team));
    const baseline = runBaseline(c);
    await env.DB.prepare("UPDATE dry_runs SET status = 'done', results_json = ?, finished_at = ? WHERE id = ?")
      .bind(JSON.stringify({ baseline, bots: results }), nowIso(), d.id)
      .run();
  } catch (e) {
    console.error('dry run failed', d.id, e);
    await env.DB.prepare("UPDATE dry_runs SET status = 'failed', results_json = ?, finished_at = ? WHERE id = ?")
      .bind(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), nowIso(), d.id)
      .run();
  }
  return true;
}

/**
 * Requests the Evaluator answers directly (anything else just wakes the queue).
 * POST /twist-check with a twist file: {errors, baseline}.
 */
export async function evaluatorRequest(env: Env, req: Request): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  if (path !== '/twist-check') return null;
  const def = (await req.json()) as TwistDef;
  const errors = validateTwist(def);
  if (errors.length) return json({ errors, baseline: null });
  const c = { track: def.track, cfg: twistConfig(def), twist: { id: def.id, version: def.twistVersion } };
  return json({ errors: [], baseline: runBaseline(c) });
}

export type { TwistRow };
