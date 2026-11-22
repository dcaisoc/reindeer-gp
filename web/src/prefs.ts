/**
 * Accessibility settings, kept in this browser: reduced motion (follows the
 * device setting unless changed) and driving assists. Assists only change how
 * the game is played (wall-clock speed, who presses the throttle), never the
 * physics, so assisted laps replay exactly; they are labelled "assisted".
 */

export interface Prefs {
  motion: 'auto' | 'reduce' | 'full';
  /** Game speed while driving: 1 = normal, 0.5 = half speed. Lap times are unaffected. */
  slow: 1 | 0.75 | 0.5;
  /** The game handles go and brake; you only steer (arrow keys still override). */
  autoThrottle: boolean;
}

const KEY = 'rgp.prefs';
const DEFAULTS: Prefs = { motion: 'auto', slow: 1, autoThrottle: false };

export function getPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (p && typeof p === 'object') return { ...DEFAULTS, ...p };
  } catch {
    /* private mode or bad JSON */
  }
  return { ...DEFAULTS };
}

export function setPrefs(change: Partial<Prefs>): Prefs {
  const next = { ...getPrefs(), ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: applies to this page only */
  }
  applyMotion();
  return next;
}

/** True if animations should be avoided (device setting, or chosen here). */
export function reducedMotion(): boolean {
  const m = getPrefs().motion;
  if (m === 'reduce') return true;
  if (m === 'full') return false;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Adds .reduce-motion to <html> so CSS can switch off transitions. */
export function applyMotion(): void {
  document.documentElement.classList.toggle('reduce-motion', reducedMotion());
}

/** The assists in use, as recorded in a replay ("slow-50", "auto-throttle"). */
export function assistTags(p = getPrefs()): string[] {
  const tags: string[] = [];
  if (p.slow < 1) tags.push(`slow-${Math.round(p.slow * 100)}`);
  if (p.autoThrottle) tags.push('auto-throttle');
  return tags;
}

/**
 * Auto-throttle: aim for a speed that suits the room ahead (from the middle
 * rays), like a cautious driver. Works with any number of rays.
 */
export function autoThrottle(rays: ArrayLike<number>, speed: number): number {
  const mid = Math.floor(rays.length / 2);
  const ahead = rays[mid];
  const side = rays.length >= 3 ? (rays[mid - 1] + rays[mid + 1]) * 0.75 : ahead;
  const target = 0.22 + 0.5 * Math.min(ahead, side);
  return speed < target ? 127 : speed > target + 0.1 ? -127 : 0;
}
