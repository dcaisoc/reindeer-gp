import { DEFAULT_CONFIG, type EngineConfig } from '../../engine/reindeer/config.js';
import type { TrackDef } from '../../engine/reindeer/track.js';
import { TrackGeometry } from '../../engine/reindeer/sim.js';
import p1 from '../../tracks/practice-1.json';
import p2 from '../../tracks/practice-2.json';
import p3 from '../../tracks/practice-3.json';
import { SEASON } from './env.js';

/** Public tracks with leaderboards all season. Weekly twists live in the database (twists.ts). */
export const TRACKS: TrackDef[] = [p1, p2, p3] as unknown as TrackDef[];
const geo = new Map<string, TrackGeometry>();

export function track(id: string): TrackDef | undefined {
  return TRACKS.find((t) => t.id === id);
}

/** Wall geometry, built once per track version and shared by every simulation in this isolate. */
export function geometry(t: TrackDef): TrackGeometry {
  const k = `${t.id}@${t.trackVersion}`;
  let g = geo.get(k);
  if (!g) geo.set(k, (g = new TrackGeometry(t)));
  return g;
}

/**
 * Something you can race on: a public track, or a weekly twist (its own track
 * plus engine-config overrides). Course ids are unique across both.
 */
export interface Course {
  id: string;
  name: string;
  description: string;
  difficulty: number;
  /** The public track it belongs to; boards are grouped under it. */
  baseTrack: string;
  track: TrackDef;
  cfg: EngineConfig;
  /** What replays record; null on a public track. */
  twist: { id: string; version: string } | null;
  version: string;
  /** public: a practice track. live: a twist open for entries. ended: a past twist (boards stay). staged: not yet public. */
  status: 'public' | 'live' | 'ended' | 'staged';
}

export function publicCourse(id: string): Course | undefined {
  const t = track(id);
  return t && {
    id: t.id, name: t.name, description: t.description, difficulty: t.difficulty, baseTrack: t.id, track: t,
    cfg: DEFAULT_CONFIG, twist: null, version: t.trackVersion, status: 'public',
  };
}

export type BoardKind = 'bots' | 'humans';

export function boardKey(trackId: string, kind: BoardKind, twist = 'base'): string {
  return `${SEASON}/${trackId}/${twist}/${kind}`;
}

export function courseBoardKey(c: Course, kind: BoardKind): string {
  return boardKey(c.baseTrack, kind, c.twist ? c.id : 'base');
}

export function parseBoardKey(key: string): { season: string; trackId: string; twist: string; kind: BoardKind; courseId: string } | null {
  const m = /^([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z0-9-]+)\/(bots|humans)$/.exec(key);
  return m ? { season: m[1], trackId: m[2], twist: m[3], kind: m[4] as BoardKind, courseId: m[3] === 'base' ? m[2] : m[3] } : null;
}

/** Board keys of the public tracks (twist boards come from twists.allBoardKeys). */
export function publicBoardKeys(): string[] {
  return TRACKS.flatMap((t) => [boardKey(t.id, 'bots'), boardKey(t.id, 'humans')]);
}
