/**
 * Team and college standings, computed from the board snapshots.
 * The formula is returned with the data so the page can show it.
 */

import type { BoardSnapshot } from './boards.js';
import type { Env } from './env.js';
import { json } from './http.js';
import { TRACKS, boardKey } from './tracks.js';
import { publicTwists } from './twists.js';

export const POINTS = [10, 7, 5, 3, 2, 1];
export const COLLEGE_TEAMS_COUNTED = 3;
export const NO_COLLEGE = 'Mixed / none';

export const FORMULA = [
  `Points come from the Bots board of every public track and every weekly twist (live or finished).`,
  `On each board the top six teams score ${POINTS.join(', ')} points; ties are impossible because the earlier submission ranks higher.`,
  `Team standings: the sum of a team's points over all those boards. Ties go to the team with more first places, then more second places.`,
  `College standings: the sum of the points of the college's best ${COLLEGE_TEAMS_COUNTED} teams, so a college can't win just by entering more teams. Teams that chose "${NO_COLLEGE}" score for themselves but not for a college.`,
  `Human boards are for glory only and don't score points.`,
];

export interface TeamStanding {
  rank: number;
  teamId: string;
  team: string;
  college: string;
  level: string;
  points: number;
  places: number[];
  boards: { key: string; trackName: string; rank: number; points: number }[];
}

export async function computeStandings(env: Env) {
  const keys = [...TRACKS.map((t) => boardKey(t.id, 'bots')), ...(await publicTwists(env)).map((r) => boardKey(r.base_track, 'bots', r.id))];
  const snaps = await Promise.all(
    keys.map(async (k) => {
      const row = await env.DB.prepare('SELECT json FROM board_snapshots WHERE board_key = ?').bind(k).first<{ json: string }>();
      return row ? (JSON.parse(row.json) as BoardSnapshot) : null;
    }),
  );
  const teams = new Map<string, TeamStanding>();
  for (const snap of snaps) {
    if (!snap) continue;
    for (const e of snap.entries.slice(0, POINTS.length)) {
      let t = teams.get(e.teamId);
      if (!t) teams.set(e.teamId, (t = { rank: 0, teamId: e.teamId, team: e.team, college: e.college, level: e.level, points: 0, places: POINTS.map(() => 0), boards: [] }));
      const pts = POINTS[e.rank - 1];
      t.points += pts;
      t.places[e.rank - 1]++;
      t.boards.push({ key: snap.boardKey, trackName: snap.trackName, rank: e.rank, points: pts });
    }
  }
  const byPlaces = (a: TeamStanding, b: TeamStanding) => {
    for (let i = 0; i < POINTS.length; i++) if (a.places[i] !== b.places[i]) return b.places[i] - a.places[i];
    return a.team.localeCompare(b.team);
  };
  const teamList = [...teams.values()].sort((a, b) => b.points - a.points || byPlaces(a, b));
  teamList.forEach((t, i) => (t.rank = i + 1));

  const colleges = new Map<string, TeamStanding[]>();
  for (const t of teamList) {
    if (t.college === NO_COLLEGE) continue;
    const list = colleges.get(t.college) ?? [];
    if (list.length < COLLEGE_TEAMS_COUNTED) list.push(t);
    colleges.set(t.college, list);
  }
  const collegeList = [...colleges.entries()]
    .map(([college, ts]) => ({ college, points: ts.reduce((s, t) => s + t.points, 0), teams: ts.map((t) => ({ teamId: t.teamId, team: t.team, points: t.points })) }))
    .sort((a, b) => b.points - a.points || a.college.localeCompare(b.college))
    .map((c, i) => ({ rank: i + 1, ...c }));
  return { formula: FORMULA, boards: keys, teams: teamList, colleges: collegeList };
}

/** GET /api/v1/standings */
export async function standings(env: Env): Promise<Response> {
  return json(await computeStandings(env), 200, { 'cache-control': 'public, max-age=30' });
}
