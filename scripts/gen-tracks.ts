/**
 * Generate tracks/<id>.json from tracks/src/defs.ts, and weekly twists
 * tracks/twists/<id>.json from tracks/src/twists.ts.
 * Usage: npm run tracks                     (writes into the repo)
 *        npm run tracks -- --out <folder>   (twists only, e.g. a surprise you don't commit)
 *
 * This script may use any maths it likes: its OUTPUT is data, and the engines
 * only ever read that data.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKS, type TrackSource } from '../tracks/src/defs.js';
import { TWISTS, type TwistSource } from '../tracks/src/twists.js';
import type { TwistDef } from '../engine/reindeer/twist.js';
import type { Pt, TrackDef, Decoration } from '../engine/reindeer/track.js';
import { mulberry32 } from '../engine/core/quant.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPACING = 3; // metres between centreline points
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Closed centripetal-free (uniform) Catmull-Rom spline, densely sampled. */
function catmull(ctrl: Pt[], samplesPerSeg = 60): Pt[] {
  const out: Pt[] = [];
  const n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n];
    const p3 = ctrl[(i + 2) % n];
    for (let k = 0; k < samplesPerSeg; k++) {
      const t = k / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

/** Resample a closed polyline at even arc-length spacing. */
function resample(pts: Pt[], spacing: number): Pt[] {
  const n = pts.length;
  const cum = [0];
  for (let i = 1; i <= n; i++) {
    const a = pts[i - 1];
    const b = pts[i % n];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[n];
  const m = Math.round(total / spacing);
  const out: Pt[] = [];
  let j = 0;
  for (let k = 0; k < m; k++) {
    const s = (k * total) / m;
    while (cum[j + 1] < s) j++;
    const a = pts[j];
    const b = pts[(j + 1) % n];
    const t = (s - cum[j]) / (cum[j + 1] - cum[j]);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function tangents(c: Pt[]): Pt[] {
  const n = c.length;
  return c.map((_, i) => {
    const a = c[(i - 1 + n) % n];
    const b = c[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    return [dx / l, dy / l] as Pt;
  });
}

/** Offset to the driver's left (+) or right (-). Left of (tx, ty) on a y-down screen is (ty, -tx). */
function offset(c: Pt[], t: Pt[], d: number): Pt[] {
  return c.map((p, i) => [r3(p[0] + t[i][1] * d), r3(p[1] - t[i][0] * d)] as Pt);
}

function build(src: TrackSource): TrackDef {
  const centre = resample(catmull(src.control), SPACING);
  const tan = tangents(centre);
  const half = src.width / 2;
  const left = offset(centre, tan, half);
  const right = offset(centre, tan, -half);
  const n = centre.length;

  const checkpoints: [number, number, number, number][] = [];
  for (let k = 0; k < src.checkpoints; k++) {
    const i = Math.round((k * n) / src.checkpoints) % n;
    // Extend a little beyond the walls so a sleigh hugging a wall still crosses it.
    const l = offset([centre[i]], [tan[i]], half + 1)[0];
    const r = offset([centre[i]], [tan[i]], -half - 1)[0];
    checkpoints.push([l[0], l[1], r[0], r[1]]);
  }
  const sectors = [Math.round(src.checkpoints / 3), Math.round((2 * src.checkpoints) / 3)];

  const surfaces = src.patches.map((p) => {
    const i0 = Math.floor(p.from * n);
    const i1 = Math.floor(p.to * n);
    const idx: number[] = [];
    for (let i = i0; i <= i1; i++) idx.push(i % n);
    const c = idx.map((i) => centre[i]);
    const t = idx.map((i) => tan[i]);
    const outer = offset(c, t, half + 3);
    const inner = offset(c, t, -half - 3).reverse();
    return { type: p.type, polygon: [...outer, ...inner] };
  });

  const start = centre[0];
  const heading = Math.atan2(tan[0][1], tan[0][0]);
  const sx = start[0] - tan[0][0] * 6;
  const sy = start[1] - tan[0][1] * 6;

  const xs = [...left, ...right].map((p) => p[0]);
  const ys = [...left, ...right].map((p) => p[1]);
  const bounds = {
    minX: Math.floor(Math.min(...xs)),
    minY: Math.floor(Math.min(...ys)),
    maxX: Math.ceil(Math.max(...xs)),
    maxY: Math.ceil(Math.max(...ys)),
  };

  // Scatter trees and a few cabins outside the track.
  const rand = mulberry32(src.seed);
  const decorations: Decoration[] = [];
  const margin = 30;
  let attempts = 0;
  while (decorations.length < 140 && attempts < 20000) {
    attempts++;
    const x = bounds.minX - margin + rand() * (bounds.maxX - bounds.minX + 2 * margin);
    const y = bounds.minY - margin + rand() * (bounds.maxY - bounds.minY + 2 * margin);
    let dmin = Infinity;
    for (const c of centre) dmin = Math.min(dmin, Math.hypot(c[0] - x, c[1] - y));
    if (dmin < half + 5) continue;
    const type = decorations.length % 23 === 5 ? 'cabin' : decorations.length % 31 === 7 ? 'present' : 'tree';
    decorations.push({ type, x: r3(x), y: r3(y), size: r3(0.8 + rand() * 0.6) });
  }

  return {
    format: 'rgp-track',
    version: 1,
    id: src.id,
    trackVersion: src.trackVersion,
    name: src.name,
    difficulty: src.difficulty,
    description: src.description,
    width: src.width,
    centreline: centre.map((p) => [r3(p[0]), r3(p[1])] as Pt),
    walls: { left, right },
    start: { x: r3(sx), y: r3(sy), heading: r3(heading) },
    checkpoints,
    sectors,
    surfaces,
    decorations,
    bounds,
  };
}

const outIdx = process.argv.indexOf('--out');
const privateOut = outIdx > 0 ? process.argv[outIdx + 1] : null;

if (!privateOut) {
  for (const src of TRACKS) {
    const t = build(src);
    const file = join(root, 'tracks', `${t.id}.json`);
    writeFileSync(file, JSON.stringify(t) + '\n');
    const len = Math.round(t.centreline.length * SPACING);
    console.log(`${t.id}: ${t.name}, ~${len} m, ${t.centreline.length} points, ${t.checkpoints.length} checkpoints`);
  }
}

/** A twist is its base track rebuilt with changes, plus engine-config overrides. */
function buildTwist(w: TwistSource): TwistDef {
  const base = TRACKS.find((t) => t.id === w.base);
  if (!base) throw new Error(`${w.id}: unknown base track ${w.base}`);
  const control = w.reverse ? [base.control[0], ...base.control.slice(1).reverse()] : base.control;
  const patches = w.patches ?? (w.reverse ? base.patches.map((p) => ({ type: p.type, from: 1 - p.to, to: 1 - p.from })) : base.patches);
  const track = build({
    ...base,
    id: w.id,
    trackVersion: w.twistVersion,
    name: w.name,
    description: w.description,
    difficulty: w.difficulty ?? base.difficulty,
    width: w.width ?? base.width,
    control,
    patches,
  });
  return {
    format: 'rgp-twist',
    version: 1,
    id: w.id,
    twistVersion: w.twistVersion,
    name: w.name,
    description: w.description,
    baseTrack: w.base,
    track,
    config: w.config,
  };
}

const twistDir = privateOut ?? join(root, 'tracks', 'twists');
mkdirSync(twistDir, { recursive: true });
for (const w of TWISTS) {
  const t = buildTwist(w);
  writeFileSync(join(twistDir, `${t.id}.json`), JSON.stringify(t) + '\n');
  console.log(`twist ${t.id}: ${t.name} (base ${t.baseTrack}${w.reverse ? ', reversed' : ''}${Object.keys(t.config).length ? `, config ${JSON.stringify(t.config)}` : ''})`);
}
