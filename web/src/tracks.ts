import type { TrackDef } from '../../engine/reindeer/track.js';
import { TrackGeometry } from '../../engine/reindeer/sim.js';
import p1 from '../../tracks/practice-1.json';
import p2 from '../../tracks/practice-2.json';
import p3 from '../../tracks/practice-3.json';

export const TRACKS: TrackDef[] = [p1, p2, p3] as unknown as TrackDef[];

const geoCache = new Map<string, TrackGeometry>();

export function getTrack(id: string): TrackDef | undefined {
  return TRACKS.find((t) => t.id === id);
}

/** Wall geometry is built once per track and shared by every simulation. */
export function geometry(t: TrackDef): TrackGeometry {
  let g = geoCache.get(t.id);
  if (!g) {
    g = new TrackGeometry(t);
    geoCache.set(t.id, g);
  }
  return g;
}

/** Sector times in seconds (raw, without penalties) from checkpoint split ticks. */
export function sectorTimes(t: TrackDef, splits: number[]): (number | null)[] {
  const n = t.checkpoints.length;
  const at = (cp: number) => splits[cp - 1];
  const finish = splits.length === n ? splits[n - 1] : undefined;
  const [a, b] = t.sectors;
  const s1 = at(a);
  const s2 = at(b);
  return [
    s1 !== undefined ? s1 / 60 : null,
    s1 !== undefined && s2 !== undefined ? (s2 - s1) / 60 : null,
    s2 !== undefined && finish !== undefined ? (finish - s2) / 60 : null,
  ];
}
