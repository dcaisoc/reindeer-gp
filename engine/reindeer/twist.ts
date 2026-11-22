/**
 * Weekly twists ("rgp-twist" v1): data, not code. A twist is a complete track
 * plus engine-config overrides, e.g. night mode (3 short rays), ice patches,
 * a reversed or narrower track. See docs/formats/twist.md.
 *
 * The engine needs nothing new for a twist: it simulates `twist.track` with
 * `twistConfig(twist)`. Every replay records {twist: {id, version}}.
 */

import { DEFAULT_CONFIG, type EngineConfig, type SurfaceProps } from './config.js';
import type { SurfaceType, TrackDef } from './track.js';

export interface TwistDef {
  format: 'rgp-twist';
  version: 1;
  id: string;
  twistVersion: string;
  name: string;
  description: string;
  /** The public track it is based on (for grouping boards), or any id for a brand-new track. */
  baseTrack: string;
  /** The full track to race. Its id and trackVersion equal the twist's id and twistVersion. */
  track: TrackDef;
  config: TwistConfig;
}

export type TwistConfig = Partial<Omit<EngineConfig, 'surfaces'>> & {
  surfaces?: Partial<Record<SurfaceType, Partial<SurfaceProps>>>;
};

/** The engine config for a twist: defaults, then overrides (surfaces merged per property). */
export function twistConfig(t: Pick<TwistDef, 'config'> | null | undefined): EngineConfig {
  const o = t?.config ?? {};
  const surfaces = { ...DEFAULT_CONFIG.surfaces };
  for (const k of Object.keys(o.surfaces ?? {}) as SurfaceType[]) surfaces[k] = { ...DEFAULT_CONFIG.surfaces[k], ...o.surfaces![k] };
  const { surfaces: _s, ...rest } = o;
  return { ...DEFAULT_CONFIG, ...rest, rayAnglesDeg: [...(o.rayAnglesDeg ?? DEFAULT_CONFIG.rayAnglesDeg)], surfaces };
}

/** Numeric overrides a twist may set, with allowed ranges. Anything else is rejected. */
export const TWIST_LIMITS: Record<string, [number, number]> = {
  penaltySeconds: [0, 10],
  penaltyCooldownTicks: [0, 120],
  timeoutTicks: [600, 180 * 60],
  rayRange: [5, 80],
  sleighRadius: [0.5, 2],
  maxSpeed: [8, 60],
  accel: [3, 40],
  brake: [6, 60],
  reverseAccel: [1, 15],
  maxReverse: [1, 15],
  dragLinear: [0, 1],
  dragQuad: [0, 0.1],
  turnRate: [0.8, 6],
  turnFullSpeed: [1, 12],
  highSpeedTurnLoss: [0, 0.9],
  gripRate: [1, 40],
  wallSpeedFactor: [0, 1],
  wallFriction: [0, 10],
};
const SURFACE_LIMITS: Record<keyof SurfaceProps, [number, number]> = { grip: [0.01, 5], drag: [0.1, 10], traction: [0.05, 3] };

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Check a twist's own fields and config. Track geometry is checked separately
 * by the track validator (tracks/validate.ts). Returns plain-English problems.
 */
export function validateTwistShape(t: unknown): string[] {
  const e: string[] = [];
  if (!t || typeof t !== 'object') return ['The twist file is not a JSON object.'];
  const w = t as Partial<TwistDef>;
  if (w.format !== 'rgp-twist') e.push('"format" must be "rgp-twist".');
  if (w.version !== 1) e.push('"version" must be 1.');
  if (typeof w.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(w.id)) e.push('"id" must be 2-41 lowercase letters, digits and hyphens.');
  else if (w.id === 'base' || /^practice-\d+$/.test(w.id)) e.push(`"id" can't be "${w.id}": that name is reserved.`);
  if (typeof w.twistVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(w.twistVersion)) e.push('"twistVersion" must look like 1.0.0.');
  if (typeof w.name !== 'string' || !w.name.trim() || w.name.length > 60) e.push('"name" is required (at most 60 characters).');
  if (typeof w.description !== 'string' || w.description.length > 300) e.push('"description" is required (at most 300 characters).');
  if (typeof w.baseTrack !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(w.baseTrack)) e.push('"baseTrack" must be a track id.');
  if (!w.track || typeof w.track !== 'object') e.push('"track" must be a full track.');
  else if (w.track.id !== w.id || w.track.trackVersion !== w.twistVersion) e.push('track.id and track.trackVersion must equal the twist\'s id and twistVersion.');

  const c = w.config;
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    e.push('"config" must be an object (use {} for no changes).');
    return e;
  }
  for (const [k, v] of Object.entries(c)) {
    if (k === 'rayAnglesDeg') {
      const ok = Array.isArray(v) && v.length >= 1 && v.length <= 9 && v.every((a, i) => num(a) && a >= -90 && a <= 90 && (i === 0 || a > (v as number[])[i - 1]));
      if (!ok) e.push('config.rayAnglesDeg must be 1-9 increasing angles between -90 and 90.');
    } else if (k === 'surfaces') {
      if (!v || typeof v !== 'object') {
        e.push('config.surfaces must be an object.');
        continue;
      }
      for (const [s, props] of Object.entries(v as object)) {
        if (!['snow', 'ice', 'rough'].includes(s)) {
          e.push(`config.surfaces.${s}: unknown surface (snow, ice or rough).`);
          continue;
        }
        for (const [p, x] of Object.entries((props ?? {}) as object)) {
          const lim = SURFACE_LIMITS[p as keyof SurfaceProps];
          if (!lim) e.push(`config.surfaces.${s}.${p}: unknown property (grip, drag or traction).`);
          else if (!num(x) || x < lim[0] || x > lim[1]) e.push(`config.surfaces.${s}.${p} must be between ${lim[0]} and ${lim[1]}.`);
        }
      }
    } else {
      const lim = TWIST_LIMITS[k];
      if (!lim) e.push(`config.${k} can't be changed by a twist.`);
      else if (!num(v) || v < lim[0] || v > lim[1]) e.push(`config.${k} must be between ${lim[0]} and ${lim[1]}.`);
      else if ((k === 'penaltyCooldownTicks' || k === 'timeoutTicks') && !Number.isInteger(v)) e.push(`config.${k} must be a whole number.`);
    }
  }
  return e;
}

/** What a replay needs to know about a twist. */
export function twistRef(t: TwistDef): { id: string; version: string } {
  return { id: t.id, version: t.twistVersion };
}
