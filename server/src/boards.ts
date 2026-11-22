/**
 * Leaderboards. After every change the board is rebuilt into one JSON
 * snapshot, so reading a board is a single row lookup, cached at the edge
 * for 5 seconds. Browsers poll it every 10 seconds while visible.
 */

import type { Env } from './env.js';
import { bad, json } from './http.js';
import { TRACKS, allBoardKeys, boardKey, parseBoardKey, track } from './tracks.js';
import { nowIso, ukDay } from './util.js';

export interface BoardEntry {
  rank: number;
  prevRank: number | null;
  teamId: string;
  team: string;
  college: string;
  level: string;
  beginner: boolean;
  score: number;
  ticks: number;
  penalties: number;
  submittedAt: string;
  replayId: string;
}

export interface BoardSnapshot {
  boardKey: string;
  trackId: string;
  trackName: string;
  kind: 'bots' | 'humans';
  updatedAt: string;
  entries: BoardEntry[];
}

export async function rebuildBoard(env: Env, key: string): Promise<BoardSnapshot> {
  const p = parseBoardKey(key)!;
  const rows = await env.DB.prepare(
    `SELECT e.team_id, t.name, t.college, t.level, e.beginner, e.score, e.ticks, e.penalties, e.submitted_at, e.replay_id
       FROM leaderboard_entries e JOIN teams t ON t.id = e.team_id
      WHERE e.board_key = ? AND e.hidden = 0 AND t.hidden = 0
      ORDER BY e.score ASC, e.submitted_at ASC`,
  )
    .bind(key)
    .all<{ team_id: string; name: string; college: string; level: string; beginner: number; score: number; ticks: number; penalties: number; submitted_at: string; replay_id: string }>();
  const prev = await env.DB.prepare(
    'SELECT team_id, rank FROM rank_history WHERE board_key = ? AND day = (SELECT MAX(day) FROM rank_history WHERE board_key = ? AND day <= ?)',
  )
    .bind(key, key, ukDay())
    .all<{ team_id: string; rank: number }>();
  const prevRank = new Map(prev.results.map((r) => [r.team_id, r.rank]));
  const snap: BoardSnapshot = {
    boardKey: key,
    trackId: p.trackId,
    trackName: track(p.trackId)?.name ?? p.trackId,
    kind: p.kind,
    updatedAt: nowIso(),
    entries: rows.results.map((r, i) => ({
      rank: i + 1,
      prevRank: prevRank.get(r.team_id) ?? null,
      teamId: r.team_id,
      team: r.name,
      college: r.college,
      level: r.level,
      beginner: !!r.beginner,
      score: r.score,
      ticks: r.ticks,
      penalties: r.penalties,
      submittedAt: r.submitted_at,
      replayId: r.replay_id,
    })),
  };
  await env.DB.prepare(
    'INSERT INTO board_snapshots (board_key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT (board_key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at',
  )
    .bind(key, JSON.stringify(snap), snap.updatedAt)
    .run();
  return snap;
}

/** GET /api/v1/boards — the list of boards. */
export async function listBoards(env: Env): Promise<Response> {
  const counts = await env.DB.prepare('SELECT board_key, COUNT(*) AS n FROM leaderboard_entries WHERE hidden = 0 GROUP BY board_key').all<{ board_key: string; n: number }>();
  const n = new Map(counts.results.map((c) => [c.board_key, c.n]));
  const boards = TRACKS.flatMap((t) =>
    (['bots', 'humans'] as const).map((kind) => {
      const key = boardKey(t.id, kind);
      return { key, trackId: t.id, trackName: t.name, difficulty: t.difficulty, kind, entries: n.get(key) ?? 0 };
    }),
  );
  return json({ boards }, 200, { 'cache-control': 'public, max-age=10' });
}

/** GET /api/v1/boards/:season/:track/:twist/:kind */
export async function getBoard(env: Env, req: Request, key: string, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
  const p = parseBoardKey(key);
  if (!p || !track(p.trackId)) throw bad('Unknown board.');
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (cache) {
    const hit = await cache.match(req);
    if (hit) return hit;
  }
  const row = await env.DB.prepare('SELECT json FROM board_snapshots WHERE board_key = ?').bind(key).first<{ json: string }>();
  const body = row?.json ?? JSON.stringify({ boardKey: key, trackId: p.trackId, trackName: track(p.trackId)!.name, kind: p.kind, updatedAt: nowIso(), entries: [] });
  const res = new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=5' } });
  if (cache && ctx) ctx.waitUntil(cache.put(req, res.clone()));
  return res;
}

/** Daily cron just after midnight: ranks at the start of the day, so arrows show movement since then. */
export async function snapshotRanks(env: Env): Promise<void> {
  const day = ukDay();
  for (const key of allBoardKeys()) {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO rank_history (board_key, team_id, day, rank)
       SELECT board_key, team_id, ?, ROW_NUMBER() OVER (ORDER BY score ASC, submitted_at ASC)
         FROM leaderboard_entries e WHERE board_key = ? AND hidden = 0 AND (SELECT hidden FROM teams WHERE id = e.team_id) = 0`,
    )
      .bind(day, key)
      .run();
  }
}
