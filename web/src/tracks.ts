import type { TrackDef } from '../../engine/reindeer/track.js';
import { TrackGeometry } from '../../engine/reindeer/sim.js';
import { DEFAULT_CONFIG, type EngineConfig } from '../../engine/reindeer/config.js';
import { twistConfig, type TwistDef } from '../../engine/reindeer/twist.js';
import p1 from '../../tracks/practice-1.json';
import p2 from '../../tracks/practice-2.json';
import p3 from '../../tracks/practice-3.json';

export const TRACKS: TrackDef[] = [p1, p2, p3] as unknown as TrackDef[];

const geoCache = new Map<string, TrackGeometry>();

/** A track or a twist's track (twists once loaded). */
export function getTrack(id: string): TrackDef | undefined {
  return TRACKS.find((t) => t.id === id) ?? courses.get(id)?.track;
}

/**
 * Something you can race: a public track, or a weekly twist (its own track
 * plus engine-config overrides, e.g. 3 rays at night).
 */
export interface Course {
  id: string;
  name: string;
  description: string;
  difficulty: number;
  baseTrack: string;
  track: TrackDef;
  cfg: EngineConfig;
  twist: { id: string; version: string } | null;
  status: 'public' | 'live' | 'ended' | 'staged';
  liveUntil?: string | null;
}

export interface TwistSummary {
  id: string;
  version: string;
  name: string;
  description: string;
  baseTrack: string;
  live: boolean;
  status: 'live' | 'ended' | 'staged';
  liveFrom: string | null;
  liveUntil: string | null;
  inputs: string[];
  difficulty: number;
}

const courses = new Map<string, Course>();

function publicCourse(t: TrackDef): Course {
  return { id: t.id, name: t.name, description: t.description, difficulty: t.difficulty, baseTrack: t.id, track: t, cfg: DEFAULT_CONFIG, twist: null, status: 'public' };
}
for (const t of TRACKS) courses.set(t.id, publicCourse(t));

function twistCourse(d: TwistDef, status: Course['status'], liveUntil: string | null = null): Course {
  return {
    id: d.id, name: d.name, description: d.description, difficulty: d.track.difficulty, baseTrack: d.baseTrack, track: d.track,
    cfg: twistConfig(d), twist: { id: d.id, version: d.twistVersion }, status, liveUntil,
  };
}

/** The engine config a lap on this course must be simulated with (twists change it). */
export function configFor(trackId: string): EngineConfig {
  return courses.get(trackId)?.cfg ?? DEFAULT_CONFIG;
}

/** The twist a lap on this course should record in its replay. */
export function twistFor(trackId: string): { id: string; version: string } | null {
  return courses.get(trackId)?.twist ?? null;
}

/** A course already loaded (public tracks always are). */
export function getCourse(id: string): Course | undefined {
  return courses.get(id);
}

export function isPublicTrack(id: string): boolean {
  return TRACKS.some((t) => t.id === id);
}

let summaries: Promise<TwistSummary[]> | null = null;
let fetchedAt = 0;
const TWIST_LIST_TTL_MS = 30_000;

/** Public twists (live and past). Cached for 30 s, so a tab left open still sees a twist open. */
export function listTwists(force = false): Promise<TwistSummary[]> {
  if (!navigator.onLine) return Promise.resolve([]);
  if (!summaries || force || Date.now() - fetchedAt > TWIST_LIST_TTL_MS) {
    fetchedAt = Date.now();
    summaries = fetch('/api/v1/twists', { cache: force ? 'no-store' : 'default' })
      .then((r) => (r.ok ? r.json() : { twists: [] }))
      .then((d: { twists: TwistSummary[] }) => d.twists)
      .catch(() => []);
  }
  return summaries;
}

/** Load a course by id (fetching a twist's track and config from the server if needed). */
export async function ensureCourse(id: string): Promise<Course | undefined> {
  const have = courses.get(id);
  if (have) return have;
  if (!navigator.onLine) return undefined;
  try {
    const res = await fetch(`/api/v1/twists/${encodeURIComponent(id)}`);
    if (!res.ok) return undefined;
    const { twist, schedule } = (await res.json()) as { twist: TwistDef; schedule: { status: Course['status']; liveUntil: string | null } };
    const c = twistCourse(twist, schedule.status, schedule.liveUntil);
    courses.set(id, c);
    return c;
  } catch {
    return undefined;
  }
}

/** The course a replay was recorded on, from its header. */
export function ensureCourseForReplay(header: { track: { id: string }; twist: { id: string } | null }): Promise<Course | undefined> {
  return ensureCourse(header.twist?.id ?? header.track.id);
}

/** Wall geometry is built once per track and shared by every simulation. */
export function geometry(t: TrackDef): TrackGeometry {
  const k = `${t.id}@${t.trackVersion}`;
  let g = geoCache.get(k);
  if (!g) {
    g = new TrackGeometry(t);
    geoCache.set(k, g);
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
