/**
 * Reindeer Grand Prix simulation: one sleigh, one lap.
 *
 * Determinism rules (see engine/core/fmath.ts): float64 only, no Math.* except
 * abs/min/max/sqrt/floor, fixed iteration order, no clock, no randomness.
 * The Python port in sdk/ mirrors this file line by line.
 */

import { fcos, fsin, wrapAngle, PI } from '../core/fmath.js';
import { StateHasher } from '../core/hash.js';
import type { Action, Game, GameResult } from '../core/game.js';
import { DT, ENGINE_VERSION, GAME_ID, type EngineConfig, DEFAULT_CONFIG, type SurfaceProps } from './config.js';
import type { SurfaceType, TrackDef } from './track.js';

const CELL = 8;

export interface Observation {
  /** Normalised wall distances (0..1), left to right. */
  rays: Float64Array;
  /** Forward speed / maxSpeed. */
  speed: number;
  /** Sideways speed / maxSpeed (positive = sliding right). */
  lateral: number;
  surface: SurfaceType;
}

/** Names usable as bot inputs, in canonical order. */
export function inputNames(cfg: EngineConfig): string[] {
  const n = cfg.rayAnglesDeg.map((_, i) => `ray${i}`);
  return [...n, 'speed', 'lateral', 'surf_snow', 'surf_ice', 'surf_rough'];
}

/** Flatten an observation into the named inputs a bot asked for. */
export function obsToInputs(o: Observation, names: string[]): Float64Array {
  const out = new Float64Array(names.length);
  for (let i = 0; i < names.length; i++) {
    const k = names[i];
    if (k.startsWith('ray')) out[i] = o.rays[Number(k.slice(3))];
    else if (k === 'speed') out[i] = o.speed;
    else if (k === 'lateral') out[i] = o.lateral;
    else if (k === 'surf_snow') out[i] = o.surface === 'snow' ? 1 : 0;
    else if (k === 'surf_ice') out[i] = o.surface === 'ice' ? 1 : 0;
    else if (k === 'surf_rough') out[i] = o.surface === 'rough' ? 1 : 0;
    else throw new Error(`Unknown input "${k}"`);
  }
  return out;
}

/** Precomputed static geometry for a track: wall segments in a uniform grid. */
export class TrackGeometry {
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  readonly bx: Float64Array;
  readonly by: Float64Array;
  readonly n: number;
  readonly gx0: number;
  readonly gy0: number;
  readonly cols: number;
  readonly rows: number;
  /** cells[cy*cols+cx] = segment ids, ascending. */
  readonly cells: Int32Array[];
  private stamp: Int32Array;
  private stampId = 0;

  constructor(readonly track: TrackDef) {
    const segs: number[][] = [];
    for (const loop of [track.walls.left, track.walls.right]) {
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        segs.push([a[0], a[1], b[0], b[1]]);
      }
    }
    this.n = segs.length;
    this.ax = new Float64Array(segs.map((s) => s[0]));
    this.ay = new Float64Array(segs.map((s) => s[1]));
    this.bx = new Float64Array(segs.map((s) => s[2]));
    this.by = new Float64Array(segs.map((s) => s[3]));
    const pad = 64;
    this.gx0 = Math.floor((track.bounds.minX - pad) / CELL) * CELL;
    this.gy0 = Math.floor((track.bounds.minY - pad) / CELL) * CELL;
    this.cols = Math.floor((track.bounds.maxX + pad - this.gx0) / CELL) + 1;
    this.rows = Math.floor((track.bounds.maxY + pad - this.gy0) / CELL) + 1;
    const lists: number[][] = Array.from({ length: this.cols * this.rows }, () => []);
    for (let i = 0; i < this.n; i++) {
      const [c0, r0, c1, r1] = this.cellRange(
        Math.min(this.ax[i], this.bx[i]),
        Math.min(this.ay[i], this.by[i]),
        Math.max(this.ax[i], this.bx[i]),
        Math.max(this.ay[i], this.by[i]),
      );
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) lists[r * this.cols + c].push(i);
    }
    this.cells = lists.map((l) => Int32Array.from(l));
    this.stamp = new Int32Array(this.n);
  }

  cellRange(x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
    let c0 = Math.floor((x0 - this.gx0) / CELL);
    let r0 = Math.floor((y0 - this.gy0) / CELL);
    let c1 = Math.floor((x1 - this.gx0) / CELL);
    let r1 = Math.floor((y1 - this.gy0) / CELL);
    if (c0 < 0) c0 = 0;
    if (r0 < 0) r0 = 0;
    if (c1 > this.cols - 1) c1 = this.cols - 1;
    if (r1 > this.rows - 1) r1 = this.rows - 1;
    return [c0, r0, c1, r1];
  }

  /** Call fn(segmentId) once for every segment in cells overlapping the box, in a fixed order. */
  forEachInBox(x0: number, y0: number, x1: number, y1: number, fn: (i: number) => void): void {
    this.stampId++;
    const [c0, r0, c1, r1] = this.cellRange(x0, y0, x1, y1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const list = this.cells[r * this.cols + c];
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          if (this.stamp[i] === this.stampId) continue;
          this.stamp[i] = this.stampId;
          fn(i);
        }
      }
    }
  }

  /** Distance along a ray to the nearest wall, capped at range. */
  castRay(ox: number, oy: number, dx: number, dy: number, range: number): number {
    const ex = ox + dx * range;
    const ey = oy + dy * range;
    let best = range;
    this.forEachInBox(Math.min(ox, ex), Math.min(oy, ey), Math.max(ox, ex), Math.max(oy, ey), (i) => {
      const sx = this.bx[i] - this.ax[i];
      const sy = this.by[i] - this.ay[i];
      const denom = dx * sy - dy * sx;
      if (denom > -1e-12 && denom < 1e-12) return;
      const qx = this.ax[i] - ox;
      const qy = this.ay[i] - oy;
      const t = (qx * sy - qy * sx) / denom;
      const s = (qx * dy - qy * dx) / denom;
      if (t >= 0 && s >= 0 && s <= 1 && t < best) best = t;
    });
    return best;
  }
}

/** Point-in-polygon by ray crossing (even-odd rule). */
function insidePolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (yi > y !== yj > y) {
      const xCross = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (x < xCross) inside = !inside;
    }
  }
  return inside;
}

/** True if segment p->q crosses segment a->b (touching counts). */
function segmentsCross(px: number, py: number, qx: number, qy: number, ax: number, ay: number, bx: number, by: number): boolean {
  const d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const d2 = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
  if ((d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0)) return false;
  const d3 = (qx - px) * (ay - py) - (qy - py) * (ax - px);
  const d4 = (qx - px) * (by - py) - (qy - py) * (bx - px);
  if ((d3 > 0 && d4 > 0) || (d3 < 0 && d4 < 0)) return false;
  if (d1 === 0 && d2 === 0) return false; // collinear: ignore
  return true;
}

export interface LapEvents {
  /** Tick at which each checkpoint (1..n-1) and the finish (index 0 -> stored last) was crossed. */
  splits: number[];
  /** Ticks at which a new wall contact began. */
  collisionTicks: number[];
}

export class ReindeerGame implements Game<Observation> {
  readonly gameId = GAME_ID;
  readonly engineVersion = ENGINE_VERSION;
  readonly participants = 1;
  readonly geo: TrackGeometry;
  readonly cfg: EngineConfig;

  // ---- state (everything here goes into the hash) ----
  x: number;
  y: number;
  heading: number;
  vx = 0;
  vy = 0;
  tick = 0;
  nextCp: number;
  penalties = 0;
  collisions = 0;
  cooldown = 0;
  touching = 0;
  finished = 0;
  timedOut = 0;
  // ---- derived / bookkeeping (not hashed) ----
  readonly events: LapEvents = { splits: [], collisionTicks: [] };
  private rayAngles: Float64Array;
  private obsCache: Observation | null = null;

  constructor(readonly track: TrackDef, cfg: EngineConfig = DEFAULT_CONFIG, geo?: TrackGeometry) {
    this.cfg = cfg;
    this.geo = geo ?? new TrackGeometry(track);
    this.x = track.start.x;
    this.y = track.start.y;
    this.heading = track.start.heading;
    this.nextCp = track.checkpoints.length > 1 ? 1 : 0;
    this.rayAngles = new Float64Array(cfg.rayAnglesDeg.map((d) => (d * PI) / 180));
  }

  surfaceAt(x: number, y: number): SurfaceType {
    let s: SurfaceType = 'snow';
    for (const p of this.track.surfaces) if (insidePolygon(x, y, p.polygon)) s = p.type;
    return s;
  }

  /** Forward speed in m/s (negative when reversing). */
  get speed(): number {
    return this.vx * fcos(this.heading) + this.vy * fsin(this.heading);
  }

  isDone(): boolean {
    return this.finished === 1 || this.timedOut === 1;
  }

  step(actions: Action[]): void {
    if (this.isDone()) return;
    const cfg = this.cfg;
    const a = actions[0];
    const steer = a[0] / 127;
    const thr = a[1] / 127;
    const surf: SurfaceProps = cfg.surfaces[this.surfaceAt(this.x, this.y)];

    const c = fcos(this.heading);
    const s = fsin(this.heading);
    let v = this.vx * c + this.vy * s;
    const u = -this.vx * s + this.vy * c;

    // Longitudinal force.
    let force: number;
    if (thr >= 0) force = thr * cfg.accel * surf.traction;
    else if (v > 0.5) force = thr * cfg.brake * surf.traction;
    else force = thr * cfg.reverseAccel * surf.traction;
    const absV0 = v < 0 ? -v : v;
    const drag = (cfg.dragLinear * v + cfg.dragQuad * v * absV0) * surf.drag;
    const vBefore = v;
    v = v + (force - drag) * DT;
    if (thr < 0 && vBefore > 0.5 && v < 0) v = 0; // braking stops, it does not reverse
    if (v < -cfg.maxReverse) v = -cfg.maxReverse;
    if (thr === 0 && v > -0.05 && v < 0.05) v = 0;

    // Steering: turn rate grows with speed up to turnFullSpeed, then falls off at top speed.
    const absV = v < 0 ? -v : v;
    let g = absV < cfg.turnFullSpeed ? absV / cfg.turnFullSpeed : 1;
    const frac = absV < cfg.maxSpeed ? absV / cfg.maxSpeed : 1;
    g = g * (1 - cfg.highSpeedTurnLoss * frac);
    const dir = v >= 0 ? 1 : -1;
    this.heading = wrapAngle(this.heading + steer * cfg.turnRate * g * dir * DT);

    // Velocity keeps its world direction while the sleigh rotates; grip then removes sideways slide.
    let vx = v * c - u * s;
    let vy = v * s + u * c;
    const c2 = fcos(this.heading);
    const s2 = fsin(this.heading);
    const v2 = vx * c2 + vy * s2;
    let u2 = -vx * s2 + vy * c2;
    let k = 1 - surf.grip * cfg.gripRate * DT;
    if (k < 0) k = 0;
    u2 = u2 * k;
    vx = v2 * c2 - u2 * s2;
    vy = v2 * s2 + u2 * c2;

    const px = this.x;
    const py = this.y;
    let x = px + vx * DT;
    let y = py + vy * DT;

    // Walls: find the closest wall point within the sleigh radius.
    const r = cfg.sleighRadius;
    let bestD2 = r * r;
    let hit = -1;
    let hx = 0;
    let hy = 0;
    const geo = this.geo;
    geo.forEachInBox(x - r, y - r, x + r, y + r, (i) => {
      const sx = geo.bx[i] - geo.ax[i];
      const sy = geo.by[i] - geo.ay[i];
      const len2 = sx * sx + sy * sy;
      let t = len2 > 0 ? ((x - geo.ax[i]) * sx + (y - geo.ay[i]) * sy) / len2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const cx = geo.ax[i] + sx * t;
      const cy = geo.ay[i] + sy * t;
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        hit = i;
        hx = cx;
        hy = cy;
      }
    });

    let touchingNow = 0;
    if (hit >= 0 && bestD2 > 1e-18) {
      touchingNow = 1;
      const d = Math.sqrt(bestD2);
      const nx = (x - hx) / d;
      const ny = (y - hy) / d;
      x = x + nx * (r - d);
      y = y + ny * (r - d);
      const vn = vx * nx + vy * ny;
      if (vn < 0) {
        vx = vx - nx * vn;
        vy = vy - ny * vn;
      }
      let f = 1 - cfg.wallFriction * DT;
      if (this.touching === 0) {
        f = f * cfg.wallSpeedFactor;
        this.collisions++;
        this.events.collisionTicks.push(this.tick + 1);
      }
      vx = vx * f;
      vy = vy * f;
      if (this.cooldown <= 0) {
        this.penalties++;
        this.cooldown = cfg.penaltyCooldownTicks;
      }
    }
    if (this.cooldown > 0) this.cooldown--;
    this.touching = touchingNow;

    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.tick++;

    // Checkpoints: only the next one in order counts, and only when crossed going forwards.
    const cp = this.track.checkpoints[this.nextCp];
    if (segmentsCross(px, py, x, y, cp[0], cp[1], cp[2], cp[3])) {
      const fx = cp[3] - cp[1];
      const fy = -(cp[2] - cp[0]);
      if ((x - px) * fx + (y - py) * fy > 0) {
        this.events.splits.push(this.tick);
        if (this.nextCp === 0) this.finished = 1;
        else this.nextCp = this.nextCp + 1 < this.track.checkpoints.length ? this.nextCp + 1 : 0;
      }
    }
    if (this.finished === 0 && this.tick >= cfg.timeoutTicks) this.timedOut = 1;
    this.obsCache = null;
  }

  observe(_participant = 0): Observation {
    if (this.obsCache) return this.obsCache;
    const cfg = this.cfg;
    const rays = new Float64Array(this.rayAngles.length);
    for (let i = 0; i < rays.length; i++) {
      const ang = this.heading + this.rayAngles[i];
      rays[i] = this.geo.castRay(this.x, this.y, fcos(ang), fsin(ang), cfg.rayRange) / cfg.rayRange;
    }
    const c = fcos(this.heading);
    const s = fsin(this.heading);
    this.obsCache = {
      rays,
      speed: (this.vx * c + this.vy * s) / cfg.maxSpeed,
      lateral: (-this.vx * s + this.vy * c) / cfg.maxSpeed,
      surface: this.surfaceAt(this.x, this.y),
    };
    return this.obsCache;
  }

  result(): GameResult {
    const valid = this.finished === 1;
    const score = valid ? this.tick / 60 + this.penalties * this.cfg.penaltySeconds : Infinity;
    return {
      valid,
      score,
      detail: { ticks: this.tick, penalties: this.penalties, collisions: this.collisions },
    };
  }

  stateHash(): string {
    return new StateHasher()
      .f64(this.x)
      .f64(this.y)
      .f64(this.heading)
      .f64(this.vx)
      .f64(this.vy)
      .i32(this.tick)
      .i32(this.nextCp)
      .i32(this.penalties)
      .i32(this.collisions)
      .i32(this.cooldown)
      .i32(this.touching)
      .i32(this.finished)
      .i32(this.timedOut)
      .hex();
  }
}
