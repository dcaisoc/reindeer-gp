/**
 * Uploading bots and human runs. Nothing is scored here: every upload becomes
 * a queued job, and the Evaluator re-simulates it with the canonical engine.
 */

import { isTrainerArchitecture, type BotFile } from '../../engine/core/bot.js';
import { decodeReplay, ReplayFormatError } from '../../engine/core/replay.js';
import { validateBotForEngine } from '../../engine/reindeer/bot-policy.js';
import { ENGINE_VERSION, GAME_ID } from '../../engine/reindeer/config.js';
import { getSetting } from './audit.js';
import { requireTeam } from './auth.js';
import type { Env } from './env.js';
import { HttpError, bad, json, notFound, readBody, readJson } from './http.js';
import { TRACKS, boardKey, track } from './tracks.js';
import { newId, nowIso, startOfUkDay } from './util.js';

const MAX_BOT_BYTES = 200 * 1024;
const MAX_RUN_BYTES = 64 * 1024;

/** Wake the Evaluator so it starts on the queue. */
export async function kickEvaluator(env: Env): Promise<void> {
  try {
    const stub = env.EVALUATOR.get(env.EVALUATOR.idFromName('main'));
    await stub.fetch('https://evaluator/kick', { method: 'POST' });
  } catch (e) {
    console.error('Could not wake the evaluator', e);
  }
}

async function requireOpen(env: Env): Promise<void> {
  if ((await getSetting(env, 'submissions_open', 'true')) !== 'true') {
    throw new HttpError(423, 'submissions_closed', 'Submissions are closed right now. Check the announcements.');
  }
}

/** POST /api/v1/bots/validate — check a bot without submitting it. */
export async function validateBotEndpoint(env: Env, req: Request): Promise<Response> {
  const bot = await readJson<BotFile>(req, MAX_BOT_BYTES);
  const { errors, params } = validateBotForEngine(bot);
  return json({ ok: errors.length === 0, errors, params, trainerArchitecture: errors.length ? false : isTrainerArchitecture(bot) });
}

/** POST /api/v1/submissions {bot, tracks?} — submit a bot to one or more tracks. */
export async function submitBot(env: Env, req: Request): Promise<Response> {
  const u = await requireTeam(env, req);
  await requireOpen(env);
  const body = await readJson<{ bot?: BotFile; tracks?: string[] }>(req, MAX_BOT_BYTES);
  const bot = body.bot;
  const { errors, params } = validateBotForEngine(bot);
  if (errors.length) throw new HttpError(422, 'invalid_bot', 'The bot file has problems.', { errors });
  const trackIds = body.tracks?.length ? body.tracks : TRACKS.map((t) => t.id);
  for (const id of trackIds) if (!track(id)) throw bad(`Unknown track "${id}".`);

  const limit = Number(await getSetting(env, 'bot_submissions_per_day', '20'));
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM bots WHERE team_id = ? AND created_at >= ?')
    .bind(u.team_id, startOfUkDay())
    .first<{ n: number }>();
  if ((used?.n ?? 0) >= limit) {
    throw new HttpError(429, 'rate_limited', `Your team has used all ${limit} bot submissions for today. More at midnight (UK time).`, { limit });
  }

  const botId = newId('b_');
  const now = nowIso();
  const r2Key = `bots/${botId}.json`;
  await env.BLOBS.put(r2Key, JSON.stringify(bot), { httpMetadata: { contentType: 'application/json' } });
  const subs = trackIds.map((t) => ({ id: newId('s_'), trackId: t }));
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO bots (id, team_id, user_id, name, r2_key, params, inputs_json, method, trainer, trainer_arch, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(botId, u.team_id, u.id, bot!.meta.name.trim(), r2Key, params, JSON.stringify(bot!.inputs), bot!.meta.method ?? null, bot!.meta.trainer ?? null, isTrainerArchitecture(bot!) ? 1 : 0, now),
    // The team's level locks at its first bot submission (it can still move up).
    env.DB.prepare('UPDATE teams SET level_locked_at = COALESCE(level_locked_at, ?) WHERE id = ?').bind(now, u.team_id),
    ...subs.map((s) =>
      env.DB.prepare(
        "INSERT INTO submissions (id, team_id, user_id, kind, bot_id, track_id, board_key, status, created_at) VALUES (?, ?, ?, 'bot', ?, ?, ?, 'queued', ?)",
      ).bind(s.id, u.team_id, u.id, botId, s.trackId, boardKey(s.trackId, 'bots'), now),
    ),
  ]);
  await kickEvaluator(env);
  return json({ botId, params, submissions: subs.map((s) => ({ id: s.id, trackId: s.trackId, status: 'queued' })) }, 202);
}

/**
 * POST /api/v1/runs[?submit=1] with a .rgpr body — save a human lap to the
 * account (it is verified by re-simulation) and optionally enter it on the Human board.
 */
export async function uploadRun(env: Env, req: Request): Promise<Response> {
  const u = await requireTeam(env, req);
  const submit = new URL(req.url).searchParams.get('submit') === '1';
  if (submit) await requireOpen(env);
  const bytes = await readBody(req, MAX_RUN_BYTES);
  let rep;
  try {
    rep = await decodeReplay(bytes);
  } catch (e) {
    throw new HttpError(422, 'invalid_replay', e instanceof ReplayFormatError ? e.message : 'That is not a valid replay file.');
  }
  const h = rep.header;
  if (h.game !== GAME_ID) throw new HttpError(422, 'invalid_replay', 'That replay is for a different game.');
  if (h.engineVersion.split('.')[0] !== ENGINE_VERSION.split('.')[0]) {
    throw new HttpError(422, 'invalid_replay', `That replay was made with engine ${h.engineVersion}; this server runs ${ENGINE_VERSION}.`);
  }
  if (!track(h.track.id)) throw new HttpError(422, 'invalid_replay', `Unknown track "${h.track.id}".`);
  if (h.participants[0]?.kind !== 'human' || h.ticksPerAction !== 1) throw new HttpError(422, 'invalid_replay', 'Only laps you drove yourself can be uploaded here.');
  if (rep.actions.length > 2 * 7200) throw new HttpError(422, 'invalid_replay', 'That replay is longer than the time limit.');

  const limit = Number(await getSetting(env, 'human_submissions_per_day', '200'));
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE team_id = ? AND created_at >= ?').bind(u.team_id, startOfUkDay()).first<{ n: number }>();
  if ((used?.n ?? 0) >= limit) throw new HttpError(429, 'rate_limited', `Your team has uploaded ${limit} laps today. More at midnight (UK time).`, { limit });

  const now = nowIso();
  let run = await env.DB.prepare('SELECT id FROM runs WHERE team_id = ? AND final_hash = ?').bind(u.team_id, h.finalHash).first<{ id: string }>();
  if (!run) {
    run = { id: newId('r_') };
    const key = `runs/${run.id}.rgpr`;
    await env.BLOBS.put(key, bytes, { httpMetadata: { contentType: 'application/octet-stream' } });
    await env.DB.prepare('INSERT INTO runs (id, team_id, user_id, track_id, r2_key, final_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(run.id, u.team_id, u.id, h.track.id, key, h.finalHash, now)
      .run();
  } else if (!submit) {
    return json({ runId: run.id, submissionId: null, duplicate: true });
  }
  const subId = newId('s_');
  await env.DB.prepare(
    'INSERT INTO submissions (id, team_id, user_id, kind, run_id, track_id, board_key, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, \'queued\', ?)',
  )
    .bind(subId, u.team_id, u.id, submit ? 'human' : 'verify', run.id, h.track.id, submit ? boardKey(h.track.id, 'humans') : null, now)
    .run();
  await kickEvaluator(env);
  return json({ runId: run.id, submissionId: subId }, 202);
}

interface SubRow {
  id: string;
  kind: string;
  track_id: string;
  board_key: string | null;
  status: string;
  reject_reason: string | null;
  created_at: string;
  finished_at: string | null;
  bot_name: string | null;
  valid: number | null;
  score: number | null;
  penalties: number | null;
  replay_id: string | null;
  beginner: number | null;
}

const SUB_SELECT = `SELECT s.id, s.kind, s.track_id, s.board_key, s.status, s.reject_reason, s.created_at, s.finished_at,
    b.name AS bot_name, e.valid, e.score, e.penalties, e.replay_id, e.beginner
  FROM submissions s LEFT JOIN bots b ON b.id = s.bot_id LEFT JOIN evaluations e ON e.id = s.evaluation_id`;

function subView(r: SubRow) {
  return {
    id: r.id,
    kind: r.kind,
    trackId: r.track_id,
    boardKey: r.board_key,
    status: r.status,
    rejectReason: r.reject_reason,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    botName: r.bot_name,
    result: r.valid === null ? null : { valid: !!r.valid, score: r.score, penalties: r.penalties, beginner: !!r.beginner },
    replayId: r.replay_id,
  };
}

/** GET /api/v1/submissions/:id (your team only) */
export async function getSubmission(env: Env, req: Request, id: string): Promise<Response> {
  const u = await requireTeam(env, req);
  const r = await env.DB.prepare(`${SUB_SELECT} WHERE s.id = ? AND s.team_id = ?`).bind(id, u.team_id).first<SubRow>();
  if (!r) throw notFound('That submission');
  return json({ submission: subView(r) });
}

/** GET /api/v1/submissions — your team's recent attempts (all kept, best counts). */
export async function listSubmissions(env: Env, req: Request): Promise<Response> {
  const u = await requireTeam(env, req);
  const r = await env.DB.prepare(`${SUB_SELECT} WHERE s.team_id = ? AND s.kind != 'verify' ORDER BY s.created_at DESC LIMIT 100`).bind(u.team_id).all<SubRow>();
  return json({ submissions: r.results.map(subView) });
}

/** GET /api/v1/runs/count?track=... — verified saved laps (Beginner bracket needs 3). */
export async function runCount(env: Env, req: Request): Promise<Response> {
  const u = await requireTeam(env, req);
  const t = new URL(req.url).searchParams.get('track') ?? '';
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE team_id = ? AND track_id = ? AND verified = 1').bind(u.team_id, t).first<{ n: number }>();
  return json({ trackId: t, verified: r?.n ?? 0 });
}
