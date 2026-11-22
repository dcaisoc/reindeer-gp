/**
 * Track validator, shared by CI, the generator and (later) the server.
 * Returns human-readable problems; an empty list means the track is valid.
 */

import type { Pt, TrackDef } from '../engine/reindeer/track.js';
import { validateTwistShape } from '../engine/reindeer/twist.js';

const MIN_GAP = 6; // metres: narrowest allowed distance between left and right walls

function finite(...v: number[]): boolean {
  return v.every((x) => typeof x === 'number' && Number.isFinite(x));
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function segsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c[0], c[1], d[0], d[1], a[0], a[1]);
  const d2 = cross(c[0], c[1], d[0], d[1], b[0], b[1]);
  const d3 = cross(a[0], a[1], b[0], b[1], c[0], c[1]);
  const d4 = cross(a[0], a[1], b[0], b[1], d[0], d[1]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function pointSegDist(p: Pt, a: Pt, b: Pt): number {
  const sx = b[0] - a[0];
  const sy = b[1] - a[1];
  const l2 = sx * sx + sy * sy;
  let t = l2 > 0 ? ((p[0] - a[0]) * sx + (p[1] - a[1]) * sy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + sx * t), p[1] - (a[1] + sy * t));
}

function selfIntersections(loop: Pt[]): number {
  const n = loop.length;
  let count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the wrap
      if (segsIntersect(loop[i], loop[(i + 1) % n], loop[j], loop[(j + 1) % n])) count++;
    }
  }
  return count;
}

function minDistToLoop(p: Pt, loop: Pt[]): number {
  let d = Infinity;
  for (let i = 0; i < loop.length; i++) d = Math.min(d, pointSegDist(p, loop[i], loop[(i + 1) % loop.length]));
  return d;
}

export function validateTrack(t: TrackDef): string[] {
  const e: string[] = [];
  if (t.format !== 'rgp-track') e.push('format must be "rgp-track".');
  if (t.version !== 1) e.push('version must be 1.');
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(t.id ?? '')) e.push('id must be lowercase letters, digits and hyphens.');
  if (!/^\d+\.\d+\.\d+$/.test(t.trackVersion ?? '')) e.push('trackVersion must look like 1.0.0.');
  if (!t.name) e.push('name is required.');
  const { left, right } = t.walls ?? { left: [], right: [] };
  if (left.length < 8 || right.length < 8) {
    e.push('Each wall needs at least 8 points.');
    return e;
  }
  for (const p of [...left, ...right, ...t.centreline]) {
    if (!finite(p[0], p[1])) {
      e.push('All coordinates must be finite numbers.');
      return e;
    }
  }
  const sl = selfIntersections(left);
  const sr = selfIntersections(right);
  if (sl) e.push(`Left wall crosses itself ${sl} time(s); widen corners or reduce width.`);
  if (sr) e.push(`Right wall crosses itself ${sr} time(s); widen corners or reduce width.`);
  let between = 0;
  for (let i = 0; i < left.length; i++) {
    for (let j = 0; j < right.length; j++) {
      if (segsIntersect(left[i], left[(i + 1) % left.length], right[j], right[(j + 1) % right.length])) between++;
    }
  }
  if (between) e.push(`Left and right walls cross each other ${between} time(s).`);
  let narrowest = Infinity;
  for (const p of left) narrowest = Math.min(narrowest, minDistToLoop(p, right));
  if (narrowest < MIN_GAP) e.push(`Track is only ${narrowest.toFixed(1)} m wide somewhere; minimum is ${MIN_GAP} m.`);

  if (!Array.isArray(t.checkpoints) || t.checkpoints.length < 3) e.push('At least 3 checkpoints are required.');
  else {
    t.checkpoints.forEach((c, i) => {
      if (!finite(...c)) e.push(`Checkpoint ${i} has non-numeric coordinates.`);
      const dl = minDistToLoop([c[0], c[1]], left);
      const dr = minDistToLoop([c[2], c[3]], right);
      if (dl > 2 || dr > 2) e.push(`Checkpoint ${i} does not reach both walls (gaps ${dl.toFixed(1)} m, ${dr.toFixed(1)} m).`);
    });
  }
  if (!Array.isArray(t.sectors) || t.sectors.length !== 2 || !(t.sectors[0] > 0 && t.sectors[1] > t.sectors[0] && t.sectors[1] < t.checkpoints.length)) {
    e.push('sectors must be two increasing checkpoint indices between 1 and the last checkpoint.');
  }
  const s = t.start;
  if (!s || !finite(s.x, s.y, s.heading)) e.push('start needs numeric x, y and heading.');
  else {
    const dl = minDistToLoop([s.x, s.y], left);
    const dr = minDistToLoop([s.x, s.y], right);
    if (dl < 2 || dr < 2) e.push('Start position is too close to a wall.');
    const c0 = t.checkpoints[0];
    const fx = c0[3] - c0[1];
    const fy = -(c0[2] - c0[0]);
    const mx = (c0[0] + c0[2]) / 2;
    const my = (c0[1] + c0[3]) / 2;
    if ((mx - s.x) * fx + (my - s.y) * fy <= 0) e.push('Start position must be behind the start line.');
  }
  for (const [i, p] of (t.surfaces ?? []).entries()) {
    if (!['ice', 'rough'].includes(p.type)) e.push(`Surface ${i} has unknown type "${p.type}".`);
    if (!Array.isArray(p.polygon) || p.polygon.length < 3) e.push(`Surface ${i} needs a polygon of 3+ points.`);
  }
  const b = t.bounds;
  if (!b || !finite(b.minX, b.minY, b.maxX, b.maxY)) e.push('bounds are required.');
  else if ([...left, ...right].some((p) => p[0] < b.minX || p[0] > b.maxX || p[1] < b.minY || p[1] > b.maxY)) {
    e.push('Some wall points lie outside bounds.');
  }
  return e;
}

/** Full check of a twist file: its fields and config, then its track. */
export function validateTwist(t: unknown): string[] {
  const e = validateTwistShape(t);
  const tr = (t as { track?: TrackDef } | null)?.track;
  if (tr && typeof tr === 'object') for (const p of validateTrack(tr)) e.push(`track: ${p}`);
  return e;
}
