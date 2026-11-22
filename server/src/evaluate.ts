/**
 * The evaluation queue. Runs inside the Evaluator Durable Object (30 s of CPU
 * per wake-up, even on Cloudflare's free plan) and directly in local tests.
 * Every leaderboard result is produced here, by the canonical engine.
 */

import type { BotFile } from '../../engine/core/bot.js';
import { blobs } from './blobs.js';
import { decodeReplay, encodeReplay } from '../../engine/core/replay.js';
import { evaluateBot, validateBotForEngine } from '../../engine/reindeer/bot-policy.js';
import { ENGINE_VERSION } from '../../engine/reindeer/config.js';
import { simulateReplay } from '../../engine/reindeer/run.js';
import { getSetting } from './audit.js';
import { rebuildBoard } from './boards.js';
import type { Env } from './env.js';
import { award } from './badges.js';
import { baselineFor, ensureBaselines, processDryRun } from './heavy.js';
import { geometry, type Course } from './tracks.js';
import { courseFor } from './twists.js';
import { newId, nowIso } from './util.js';

const STALE_MS = 2 * 60_000;

interface Job {
  id: string;
  team_id: string;
  kind: 'bot' | 'human' | 'verify';
  bot_id: string | null;
  run_id: string | null;
  track_id: string;
  board_key: string | null;
  created_at: string;
}

class Rejection extends Error {}

/**
 * Process queued jobs until the queue is empty or the deadline passes.
 * Returns true if work remains.
 */
export async function processQueue(env: Env, opts: { deadline: number }): Promise<boolean> {
  // Jobs stuck in "running" (e.g. a crash mid-way) go back to the queue.
  await env.DB.prepare("UPDATE submissions SET status = 'queued' WHERE status = 'running' AND started_at < ?")
    .bind(new Date(Date.now() - STALE_MS).toISOString())
    .run();
  for (;;) {
    if (Date.now() > opts.deadline) return true;
    const job = await env.DB.prepare("SELECT * FROM submissions WHERE status = 'queued' ORDER BY created_at LIMIT 1").first<Job>();
    if (!job) {
      // Leaderboard work first; then referee dry runs and missing baselines, one at a time.
      if (await processDryRun(env)) continue;
      if (await ensureBaselines(env)) continue;
      return false;
    }
    const claimed = await env.DB.prepare("UPDATE submissions SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'").bind(nowIso(), job.id).run();
    if (!claimed.meta.changes) continue;
    try {
      if (job.kind === 'bot') await runBot(env, job);
      else await runHuman(env, job);
    } catch (e) {
      const reason = e instanceof Rejection ? e.message : 'The server hit an error while evaluating this. A referee has been notified; please try again later.';
      if (!(e instanceof Rejection)) console.error('evaluation failed', job.id, e);
      await env.DB.prepare("UPDATE submissions SET status = 'rejected', reject_reason = ?, finished_at = ? WHERE id = ?").bind(reason, nowIso(), job.id).run();
    }
  }
}

async function courseOrReject(env: Env, id: string): Promise<Course> {
  const c = await courseFor(env, id);
  if (!c) throw new Rejection(`Unknown track "${id}".`);
  return c;
}

async function runBot(env: Env, job: Job): Promise<void> {
  const c = await courseOrReject(env, job.track_id);
  const t = c.track;
  const bot = await env.DB.prepare('SELECT b.*, t.name AS team_name, t.level FROM bots b JOIN teams t ON t.id = b.team_id WHERE b.id = ?')
    .bind(job.bot_id)
    .first<{ id: string; name: string; r2_key: string; trainer: string | null; trainer_arch: number; team_name: string; level: string }>();
  if (!bot) throw new Rejection('The bot file is missing.');
  const obj = await blobs(env).get(bot.r2_key);
  if (!obj) throw new Rejection('The bot file is missing.');
  const file = JSON.parse(new TextDecoder().decode(await obj.arrayBuffer())) as BotFile;
  const { errors } = validateBotForEngine(file, c.cfg);
  if (errors.length) throw new Rejection(`This bot can't race on ${c.name}: ${errors[0]}`);
  const replay = evaluateBot(t, file, { name: `${bot.team_name}: ${bot.name}`, teamId: job.team_id, botId: bot.id }, { geo: geometry(t), cfg: c.cfg, twist: c.twist });

  // Beginner bracket: Elf team, trainer-shaped network made by the web trainer,
  // and at least 3 verified laps of the team's own driving on this track.
  let beginner = 0;
  if (bot.level === 'elf' && bot.trainer_arch === 1 && (bot.trainer ?? '').startsWith('web-trainer')) {
    const laps = await env.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE team_id = ? AND track_id = ? AND verified = 1')
      .bind(job.team_id, job.track_id)
      .first<{ n: number }>();
    beginner = (laps?.n ?? 0) >= 3 ? 1 : 0;
  }
  const replayId = newId('p_');
  const key = `replays/${replayId}.rgpr`;
  await blobs(env).put(key, await encodeReplay(replay), { httpMetadata: { contentType: 'application/octet-stream' } });
  const r = replay.header.result;
  await record(env, job, {
    replayId,
    r2Key: key,
    kind: 'bot',
    title: `${bot.name} (${bot.team_name}) on ${c.name}`,
    finalHash: replay.header.finalHash,
    trackVersion: t.trackVersion,
    twistId: c.twist?.id ?? null,
    course: c,
    botInputs: file.inputs.length,
    valid: r.valid,
    score: r.score,
    ticks: r.ticks,
    penalties: r.penalties,
    collisions: r.collisions,
    beginner,
  });
}

async function runHuman(env: Env, job: Job): Promise<void> {
  const c = await courseOrReject(env, job.track_id);
  const t = c.track;
  const run = await env.DB.prepare('SELECT r.*, tm.name AS team_name, tm.level FROM runs r JOIN teams tm ON tm.id = r.team_id WHERE r.id = ?')
    .bind(job.run_id)
    .first<{ id: string; r2_key: string; team_name: string; level: string }>();
  const obj = run ? await blobs(env).get(run.r2_key) : null;
  if (!run || !obj) throw new Rejection('The uploaded lap is missing.');
  const bytes = new Uint8Array(await obj.arrayBuffer());
  const replay = await decodeReplay(bytes);
  if ((replay.header.twist?.id ?? null) !== (c.twist?.id ?? null) || (c.twist && replay.header.twist!.version !== c.twist.version)) {
    throw new Rejection(`This lap was driven on a different version of ${c.name}, so it can't be counted.`);
  }
  const out = simulateReplay(t, replay, { geo: geometry(t), cfg: c.cfg });
  if (!out.matches) {
    throw new Rejection("This lap doesn't replay identically on the server, so it can't be counted. It may come from an older version of the game.");
  }
  const g = out.game;
  const res = g.result();
  await env.DB.prepare('UPDATE runs SET verified = 1, valid = ?, score = ? WHERE id = ?')
    .bind(res.valid ? 1 : 0, res.valid ? res.score : null, run.id)
    .run();
  if (job.kind === 'verify') {
    await env.DB.prepare("UPDATE submissions SET status = 'done', finished_at = ? WHERE id = ?").bind(nowIso(), job.id).run();
    await award(env, {
      teamId: job.team_id, kind: 'human', valid: res.valid, score: res.valid ? res.score : null, collisions: g.collisions, replayId: run.id,
      onTwist: !!c.twist, botInputs: null, baselineScore: null, previousLeader: null, leadsNow: false,
    });
    return;
  }
  await record(env, job, {
    replayId: newId('p_'),
    r2Key: run.r2_key,
    kind: 'human',
    title: `${run.team_name} driving ${c.name}`,
    finalHash: out.finalHash,
    trackVersion: t.trackVersion,
    twistId: c.twist?.id ?? null,
    course: c,
    botInputs: null,
    valid: res.valid,
    score: res.valid ? res.score : null,
    ticks: g.tick,
    penalties: g.penalties,
    collisions: g.collisions,
    beginner: run.level === 'elf' ? 1 : 0,
  });
}

interface Outcome {
  replayId: string;
  r2Key: string;
  kind: 'bot' | 'human';
  title: string;
  finalHash: string;
  trackVersion: string;
  twistId: string | null;
  course: Course;
  botInputs: number | null;
  valid: boolean;
  score: number | null;
  ticks: number;
  penalties: number;
  collisions: number;
  beginner: number;
}

/** Store the replay and evaluation, update the team's best on the board, mark the job done. */
async function record(env: Env, job: Job, o: Outcome): Promise<void> {
  const now = nowIso();
  const evalId = newId('e_');
  const stmts = [
    env.DB.prepare('INSERT INTO replays (id, kind, r2_key, team_id, track_id, title, score, final_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(
      o.replayId, o.kind, o.r2Key, job.team_id, job.track_id, o.title, o.valid ? o.score : null, o.finalHash, now,
    ),
    env.DB.prepare(
      'INSERT INTO evaluations (id, submission_id, engine_version, track_id, track_version, twist_id, valid, score, ticks, penalties, collisions, replay_id, beginner, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(evalId, job.id, ENGINE_VERSION, job.track_id, o.trackVersion, o.twistId, o.valid ? 1 : 0, o.valid ? o.score : null, o.ticks, o.penalties, o.collisions, o.replayId, o.beginner, now),
    env.DB.prepare("UPDATE submissions SET status = 'done', evaluation_id = ?, finished_at = ? WHERE id = ?").bind(evalId, now, job.id),
  ];
  await env.DB.batch(stmts);

  const frozen = (await getSetting(env, 'boards_frozen', 'false')) === 'true';
  const leaderOf = async (key: string) =>
    (await env.DB.prepare(
      'SELECT e.team_id FROM leaderboard_entries e JOIN teams t ON t.id = e.team_id WHERE e.board_key = ? AND e.hidden = 0 AND t.hidden = 0 ORDER BY e.score, e.submitted_at LIMIT 1',
    ).bind(key).first<{ team_id: string }>())?.team_id ?? null;
  let previousLeader: string | null = null;
  let leadsNow = false;
  if (o.valid && job.board_key && !frozen) {
    previousLeader = await leaderOf(job.board_key);
    const cur = await env.DB.prepare('SELECT score FROM leaderboard_entries WHERE board_key = ? AND team_id = ?').bind(job.board_key, job.team_id).first<{ score: number }>();
    // Strictly better only: on a tie, the earlier submission keeps its place.
    if (!cur || o.score! < cur.score) {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO leaderboard_entries (board_key, team_id, evaluation_id, replay_id, score, ticks, penalties, beginner, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (board_key, team_id) DO UPDATE SET evaluation_id = excluded.evaluation_id, replay_id = excluded.replay_id,
             score = excluded.score, ticks = excluded.ticks, penalties = excluded.penalties, beginner = excluded.beginner, submitted_at = excluded.submitted_at`,
        ).bind(job.board_key, job.team_id, evalId, o.replayId, o.score, o.ticks, o.penalties, o.beginner, job.created_at),
        env.DB.prepare('UPDATE replays SET keep = 1 WHERE id = ?').bind(o.replayId),
      ]);
      const snap = await rebuildBoard(env, job.board_key);
      leadsNow = snap.entries[0]?.teamId === job.team_id;
    }
  }
  // Badges count every valid result, on the board or not (but a frozen board can't crown a new leader).
  const baseline = o.kind === 'bot' && o.valid ? await baselineFor(env, o.course) : null;
  await award(env, {
    teamId: job.team_id, kind: o.kind, valid: o.valid, score: o.score, collisions: o.collisions, replayId: o.replayId, onTwist: !!o.course.twist,
    botInputs: o.botInputs, baselineScore: baseline?.valid ? baseline.score : null, previousLeader: o.kind === 'bot' ? previousLeader : null, leadsNow,
  });
}
