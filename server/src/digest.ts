/**
 * The weekly digest: a markdown summary of the boards to paste into the group
 * chat. Everything in it is already public, so the endpoint is too.
 * GET /api/v1/digest.md?days=7
 */

import { BADGES } from './badges.js';
import type { BoardSnapshot } from './boards.js';
import type { Env } from './env.js';
import { bad } from './http.js';
import { computeStandings } from './standings.js';
import { TRACKS, boardKey } from './tracks.js';
import { courseName, publicTwists } from './twists.js';
import { ukDay } from './util.js';

const fmt = (s: number) => `${s.toFixed(2)} s`;
const dayName = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));

export async function buildDigest(env: Env, days: number, now = new Date()): Promise<string> {
  const since = new Date(now.getTime() - days * 86400_000).toISOString();
  const sinceDay = ukDay(new Date(since));
  const twists = await publicTwists(env);
  const boards: { key: string; label: string }[] = [
    ...TRACKS.flatMap((t) => [{ key: boardKey(t.id, 'bots'), label: `${t.name} (bots)` }, { key: boardKey(t.id, 'humans'), label: `${t.name} (humans)` }]),
    ...twists.flatMap((r) => [{ key: boardKey(r.base_track, 'bots', r.id), label: `${r.name} (bots)` }, { key: boardKey(r.base_track, 'humans', r.id), label: `${r.name} (humans)` }]),
  ];
  const snaps = new Map<string, BoardSnapshot>();
  for (const b of boards) {
    const row = await env.DB.prepare('SELECT json FROM board_snapshots WHERE board_key = ?').bind(b.key).first<{ json: string }>();
    if (row) snaps.set(b.key, JSON.parse(row.json));
  }

  const out: string[] = [];
  const title = days === 7 ? 'week' : `${days} days`;
  out.push(`# 🦌 Reindeer Grand Prix: the ${title} to ${dayName(now.toISOString())}`, '');

  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM bots WHERE created_at >= ?1) AS bots,
            (SELECT COUNT(DISTINCT team_id) FROM submissions WHERE created_at >= ?1 AND kind != 'verify') AS teams,
            (SELECT COUNT(*) FROM runs WHERE created_at >= ?1 AND verified = 1) AS laps,
            (SELECT COUNT(*) FROM teams WHERE created_at >= ?1) AS newTeams`,
  ).bind(since).first<{ bots: number; teams: number; laps: number; newTeams: number }>();
  out.push(`${counts!.teams} teams entered ${counts!.bots} bots and drove ${counts!.laps} verified laps. ${counts!.newTeams} new team${counts!.newTeams === 1 ? '' : 's'} joined.`, '');

  const live = twists.filter((r) => r.status === 'live');
  if (live.length) {
    out.push('## 🌀 Twists live now', '');
    for (const r of live) out.push(`- **${r.name}**${r.live_until ? ` (until ${dayName(r.live_until)})` : ''}: ${r.description}`);
    out.push('');
  }

  out.push('## 🏆 Leaders', '');
  let anyLeader = false;
  for (const b of boards) {
    const s = snaps.get(b.key);
    const top = s?.entries[0];
    if (!top) continue;
    anyLeader = true;
    const fresh = top.submittedAt >= since ? ' 🆕' : '';
    out.push(`- ${b.label}: **${top.team}** (${top.college}) ${fmt(top.score)}${fresh}`);
  }
  if (!anyLeader) out.push('- No entries yet. Be the first!');
  out.push('');

  // New records: boards whose best time was set in this window.
  const records = boards.filter((b) => (snaps.get(b.key)?.entries[0]?.submittedAt ?? '') >= since);
  if (records.length) {
    out.push('## ⚡ New records', '');
    for (const b of records) {
      const s = snaps.get(b.key)!;
      const [first, second] = s.entries;
      const margin = second ? `, ${fmt(second.score - first.score)} ahead of ${second.team}` : '';
      out.push(`- ${b.label}: ${first.team} set ${fmt(first.score)}${margin}`);
    }
    out.push('');
  }

  // Biggest climbers since the start of the window.
  const movers: { team: string; label: string; from: number; to: number }[] = [];
  for (const b of boards) {
    const s = snaps.get(b.key);
    if (!s) continue;
    const prev = await env.DB.prepare(
      'SELECT team_id, rank FROM rank_history WHERE board_key = ? AND day = (SELECT MIN(day) FROM rank_history WHERE board_key = ? AND day >= ?)',
    ).bind(b.key, b.key, sinceDay).all<{ team_id: string; rank: number }>();
    const was = new Map(prev.results.map((p) => [p.team_id, p.rank]));
    for (const e of s.entries) {
      const from = was.get(e.teamId);
      if (from !== undefined && from > e.rank) movers.push({ team: e.team, label: b.label, from, to: e.rank });
    }
  }
  movers.sort((a, b) => b.from - b.to - (a.from - a.to));
  if (movers.length) {
    out.push('## 📈 Biggest climbers', '');
    for (const m of movers.slice(0, 5)) out.push(`- ${m.team}: ${m.label}, up ${m.from - m.to} to #${m.to}`);
    out.push('');
  }

  // The funniest crash: a finished lap with the most wall hits.
  const crash = await env.DB.prepare(
    `SELECT e.track_id, e.score, e.penalties, e.replay_id, t.name AS team FROM evaluations e
       JOIN submissions s ON s.id = e.submission_id JOIN teams t ON t.id = s.team_id
       JOIN replays r ON r.id = e.replay_id
      WHERE e.created_at >= ? AND e.valid = 1 AND e.penalties >= 3 AND t.hidden = 0 AND r.visibility = 'public'
      ORDER BY e.penalties DESC, e.created_at LIMIT 1`,
  ).bind(since).first<{ track_id: string; score: number; penalties: number; replay_id: string; team: string }>();
  if (crash) {
    out.push('## 💥 Crash of the week', '');
    out.push(`${crash.team} bounced off the walls **${crash.penalties} times** on ${await courseName(env, crash.track_id)} and still finished (${fmt(crash.score)}). Replay id: \`${crash.replay_id}\``, '');
  }

  const badges = await env.DB.prepare(
    'SELECT a.badge_id, t.name FROM badge_awards a JOIN teams t ON t.id = a.team_id WHERE a.awarded_at >= ? AND t.hidden = 0 ORDER BY a.awarded_at',
  ).bind(since).all<{ badge_id: string; name: string }>();
  if (badges.results.length) {
    out.push('## 🎖️ Badges earned', '');
    for (const def of BADGES) {
      const who = badges.results.filter((b) => b.badge_id === def.id).map((b) => b.name);
      if (!who.length) continue;
      const names = who.length > 6 ? `${who.slice(0, 6).join(', ')} and ${who.length - 6} more` : who.join(', ');
      out.push(`- ${def.emoji} ${def.name}: ${names}`);
    }
    out.push('');
  }

  const st = await computeStandings(env);
  if (st.colleges.length) {
    out.push('## 🎓 College standings', '');
    for (const c of st.colleges.slice(0, 5)) out.push(`${c.rank}. ${c.college}: ${c.points} pts`);
    out.push('');
  }
  out.push('Drive, train and race: the leaderboard is live. 🎄');
  return out.join('\n') + '\n';
}

export async function digest(env: Env, req: Request): Promise<Response> {
  const d = Number(new URL(req.url).searchParams.get('days') ?? '7');
  if (!Number.isInteger(d) || d < 1 || d > 60) throw bad('days must be a whole number from 1 to 60.');
  return new Response(await buildDigest(env, d), {
    headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=60' },
  });
}
