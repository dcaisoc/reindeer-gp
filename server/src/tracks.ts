import type { TrackDef } from '../../engine/reindeer/track.js';
import { TrackGeometry } from '../../engine/reindeer/sim.js';
import p1 from '../../tracks/practice-1.json';
import p2 from '../../tracks/practice-2.json';
import p3 from '../../tracks/practice-3.json';
import { SEASON } from './env.js';

/** Public tracks with leaderboards this season. The hidden final arrives in M4. */
export const TRACKS: TrackDef[] = [p1, p2, p3] as unknown as TrackDef[];
const geo = new Map<string, TrackGeometry>();

export function track(id: string): TrackDef | undefined {
  return TRACKS.find((t) => t.id === id);
}

export function geometry(t: TrackDef): TrackGeometry {
  let g = geo.get(t.id);
  if (!g) geo.set(t.id, (g = new TrackGeometry(t)));
  return g;
}

export type BoardKind = 'bots' | 'humans';

export function boardKey(trackId: string, kind: BoardKind, twist = 'base'): string {
  return `${SEASON}/${trackId}/${twist}/${kind}`;
}

export function parseBoardKey(key: string): { season: string; trackId: string; twist: string; kind: BoardKind } | null {
  const m = /^([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z0-9-]+)\/(bots|humans)$/.exec(key);
  return m ? { season: m[1], trackId: m[2], twist: m[3], kind: m[4] as BoardKind } : null;
}

export function allBoardKeys(): string[] {
  return TRACKS.flatMap((t) => [boardKey(t.id, 'bots'), boardKey(t.id, 'humans')]);
}
