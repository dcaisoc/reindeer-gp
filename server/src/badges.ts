/**
 * Badges, awarded automatically by the Evaluator when a result comes in.
 * Each team earns each badge once; the evidence (a replay id) is kept.
 */

import type { Env } from './env.js';
import { nowIso } from './util.js';

export interface BadgeDef {
  id: string;
  name: string;
  emoji: string;
  description: string;
}

export const BADGES: BadgeDef[] = [
  { id: 'first-lap', name: 'First Lap', emoji: '🛷', description: 'Drove a complete lap yourself, verified by the server.' },
  { id: 'clean-lap', name: 'Clean Lap', emoji: '✨', description: 'Finished a lap (driving or bot) without touching a single wall.' },
  { id: 'beat-baseline', name: 'Beat the Baseline', emoji: '🎯', description: 'A bot of yours finished faster than the baseline bot on the same track.' },
  { id: 'less-is-more', name: 'Less Is More', emoji: '🔭', description: 'Beat the baseline with a bot that uses 4 sensors or fewer.' },
  { id: 'twist-tamer', name: 'Twist Tamer', emoji: '🌀', description: 'A bot of yours finished a weekly twist.' },
  { id: 'grinch-slayer', name: 'Grinch Slayer', emoji: '👑', description: 'Took first place on a Bots board from another team.' },
];

export interface ResultFacts {
  teamId: string;
  kind: 'bot' | 'human';
  valid: boolean;
  score: number | null;
  collisions: number;
  replayId: string;
  onTwist: boolean;
  botInputs: number | null;
  baselineScore: number | null;
  /** On a Bots board: the leader before this result, and whether this team leads now. */
  previousLeader: string | null;
  leadsNow: boolean;
}

export function badgesFor(f: ResultFacts): string[] {
  if (!f.valid) return [];
  const out: string[] = [];
  if (f.kind === 'human') out.push('first-lap');
  if (f.collisions === 0) out.push('clean-lap');
  if (f.kind === 'bot') {
    const beat = f.baselineScore !== null && f.score !== null && f.score < f.baselineScore;
    if (beat) out.push('beat-baseline');
    if (beat && f.botInputs !== null && f.botInputs <= 4) out.push('less-is-more');
    if (f.onTwist) out.push('twist-tamer');
    if (f.leadsNow && f.previousLeader && f.previousLeader !== f.teamId) out.push('grinch-slayer');
  }
  return out;
}

export async function award(env: Env, f: ResultFacts): Promise<string[]> {
  const ids = badgesFor(f);
  const now = nowIso();
  const won: string[] = [];
  for (const id of ids) {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO badge_awards (team_id, badge_id, awarded_at, evidence) VALUES (?, ?, ?, ?)').bind(f.teamId, id, now, f.replayId).run();
    if (r.meta.changes) won.push(id);
  }
  return won;
}

export async function teamBadges(env: Env, teamId: string) {
  const r = await env.DB.prepare('SELECT badge_id, awarded_at, evidence FROM badge_awards WHERE team_id = ? ORDER BY awarded_at').bind(teamId).all<{ badge_id: string; awarded_at: string; evidence: string | null }>();
  return r.results.map((a) => ({ ...BADGES.find((b) => b.id === a.badge_id)!, awardedAt: a.awarded_at, replayId: a.evidence })).filter((b) => b.name);
}
