/**
 * Engine configuration. Every value here can be overridden per season or per
 * weekly twist. Changing a default changes golden-trace hashes, so it is an
 * engine major-version change.
 */

import type { SurfaceType } from './track.js';

export const ENGINE_VERSION = '1.0.0';
export const GAME_ID = 'reindeer-gp';

export const TICK_HZ = 60;
export const DT = 1 / 60;

export interface SurfaceProps {
  /** How strongly sideways sliding is cancelled (1 = normal snow). */
  grip: number;
  /** Multiplier on rolling and air drag. */
  drag: number;
  /** Multiplier on acceleration and braking force. */
  traction: number;
}

export interface EngineConfig {
  penaltySeconds: number;
  penaltyCooldownTicks: number;
  timeoutTicks: number;
  /** Ray angles in degrees relative to the heading; negative = left. */
  rayAnglesDeg: number[];
  rayRange: number;
  sleighRadius: number;
  maxSpeed: number;
  accel: number;
  brake: number;
  reverseAccel: number;
  maxReverse: number;
  dragLinear: number;
  dragQuad: number;
  turnRate: number;
  turnFullSpeed: number;
  highSpeedTurnLoss: number;
  gripRate: number;
  wallSpeedFactor: number;
  wallFriction: number;
  surfaces: Record<SurfaceType, SurfaceProps>;
}

export const DEFAULT_CONFIG: EngineConfig = {
  penaltySeconds: 1.0,
  penaltyCooldownTicks: 30,
  timeoutTicks: 120 * 60,
  rayAnglesDeg: [-60, -40, -20, 0, 20, 40, 60],
  rayRange: 40,
  sleighRadius: 1.0,
  maxSpeed: 28,
  accel: 12,
  brake: 24,
  reverseAccel: 5,
  maxReverse: 6,
  dragLinear: 0.1,
  dragQuad: 0.012,
  turnRate: 2.6,
  turnFullSpeed: 4,
  highSpeedTurnLoss: 0.45,
  gripRate: 10,
  wallSpeedFactor: 0.5,
  wallFriction: 2,
  surfaces: {
    snow: { grip: 1, drag: 1, traction: 1 },
    ice: { grip: 0.12, drag: 0.6, traction: 0.45 },
    rough: { grip: 1.2, drag: 4, traction: 0.8 },
  },
};

export function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return { ...DEFAULT_CONFIG, ...overrides, surfaces: { ...DEFAULT_CONFIG.surfaces, ...(overrides.surfaces ?? {}) } };
}
