/**
 * Top-down canvas renderer. Drawing never touches simulation state, so it may
 * use any maths it likes (Math.cos etc. are fine here).
 */

import type { TrackDef } from '../../engine/reindeer/track.js';
import type { Frame } from '../../engine/reindeer/run.js';

export interface SleighDraw {
  x: number;
  y: number;
  heading: number;
  ghost?: boolean;
  colour?: string;
  label?: string;
}

export interface RaysDraw {
  x: number;
  y: number;
  heading: number;
  anglesDeg: number[];
  /** Normalised distances 0..1. */
  values: ArrayLike<number>;
  range: number;
}

export interface Layers {
  sleighs: SleighDraw[];
  rays?: RaysDraw | null;
  trace?: Frame[] | null;
  /** Draw the trace only up to this frame index. */
  traceUntil?: number;
  collisions?: { x: number; y: number }[];
  showCheckpoints?: boolean;
  maxSpeed?: number;
}

export type CameraMode = 'follow' | 'full';

const COL = {
  snow: '#f3f7fb',
  track: '#d3dfea',
  trackEdge: '#c2d0de',
  ice: 'rgba(120, 200, 245, 0.55)',
  rough: 'rgba(150, 120, 90, 0.45)',
  wallRed: '#c8102e',
  wallWhite: '#ffffff',
  tree: '#1f5c45',
  treeDark: '#174634',
  cabin: '#7a4a2a',
  ghost: '#2b6cb0',
};

export function speedColour(frac: number): string {
  const f = Math.max(0, Math.min(1, frac));
  // blue (slow) -> green -> yellow -> red (fast)
  const hue = 220 - 220 * f;
  return `hsl(${hue.toFixed(0)}, 85%, 45%)`;
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  private track: TrackDef | null = null;
  private ground = new Path2D();
  private leftWall = new Path2D();
  private rightWall = new Path2D();
  private surfaces: { type: string; path: Path2D }[] = [];
  private camX = 0;
  private camY = 0;
  private camReady = false;
  private w = 0;
  private h = 0;
  private dpr = 1;
  mode: CameraMode = 'follow';
  /** Metres visible across the shorter side in follow mode. */
  followSpan = 58;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  setTrack(t: TrackDef): void {
    this.track = t;
    const loop = (pts: [number, number][], p: Path2D) => {
      pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
      p.closePath();
    };
    this.ground = new Path2D();
    loop(t.walls.left, this.ground);
    loop(t.walls.right, this.ground);
    this.leftWall = new Path2D();
    loop(t.walls.left, this.leftWall);
    this.rightWall = new Path2D();
    loop(t.walls.right, this.rightWall);
    this.surfaces = t.surfaces.map((s) => {
      const p = new Path2D();
      loop(s.polygon, p);
      return { type: s.type, path: p };
    });
    this.camReady = false;
  }

  /** World-to-screen scale (pixels per metre) for the current mode. */
  private scale(): number {
    const t = this.track!;
    if (this.mode === 'full') {
      const bw = t.bounds.maxX - t.bounds.minX + 30;
      const bh = t.bounds.maxY - t.bounds.minY + 30;
      return Math.min(this.w / bw, this.h / bh);
    }
    return Math.min(this.w, this.h) / this.followSpan;
  }

  draw(focus: { x: number; y: number }, layers: Layers, snapCamera = false): void {
    const t = this.track;
    if (!t) return;
    const ctx = this.ctx;
    const s = this.scale();
    let fx = focus.x;
    let fy = focus.y;
    if (this.mode === 'full') {
      fx = (t.bounds.minX + t.bounds.maxX) / 2;
      fy = (t.bounds.minY + t.bounds.maxY) / 2;
    }
    if (!this.camReady || snapCamera || this.mode === 'full') {
      this.camX = fx;
      this.camY = fy;
      this.camReady = true;
    } else {
      this.camX += (fx - this.camX) * 0.25;
      this.camY += (fy - this.camY) * 0.25;
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COL.snow;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * (this.w / 2 - this.camX * s), this.dpr * (this.h / 2 - this.camY * s));

    // Track surface and special surfaces.
    ctx.fillStyle = COL.track;
    ctx.fill(this.ground, 'evenodd');
    for (const sf of this.surfaces) {
      ctx.save();
      ctx.clip(this.ground, 'evenodd');
      ctx.fillStyle = sf.type === 'ice' ? COL.ice : COL.rough;
      ctx.fill(sf.path);
      ctx.restore();
    }

    // Candy-cane walls.
    ctx.lineJoin = 'round';
    for (const p of [this.leftWall, this.rightWall]) {
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = COL.wallRed;
      ctx.setLineDash([]);
      ctx.stroke(p);
      ctx.strokeStyle = COL.wallWhite;
      ctx.setLineDash([1.6, 1.6]);
      ctx.stroke(p);
    }
    ctx.setLineDash([]);

    this.drawStartLine(t);
    if (layers.showCheckpoints) {
      ctx.strokeStyle = 'rgba(15, 35, 64, 0.25)';
      ctx.lineWidth = 0.3;
      ctx.setLineDash([1, 1]);
      for (const c of t.checkpoints.slice(1)) {
        ctx.beginPath();
        ctx.moveTo(c[0], c[1]);
        ctx.lineTo(c[2], c[3]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    if (layers.trace) this.drawTrace(layers.trace, layers.traceUntil ?? layers.trace.length - 1, layers.maxSpeed ?? 28, s);
    for (const c of layers.collisions ?? []) {
      ctx.strokeStyle = '#c8102e';
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 1.4, 0, Math.PI * 2);
      ctx.moveTo(c.x - 0.8, c.y - 0.8);
      ctx.lineTo(c.x + 0.8, c.y + 0.8);
      ctx.moveTo(c.x + 0.8, c.y - 0.8);
      ctx.lineTo(c.x - 0.8, c.y + 0.8);
      ctx.stroke();
    }

    this.drawDecorations(t, s);
    if (layers.rays) this.drawRays(layers.rays);
    // Ghosts first, player on top.
    for (const sl of layers.sleighs.filter((q) => q.ghost)) this.drawSleigh(sl, s);
    for (const sl of layers.sleighs.filter((q) => !q.ghost)) this.drawSleigh(sl, s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawStartLine(t: TrackDef): void {
    const ctx = this.ctx;
    const [lx, ly, rx, ry] = t.checkpoints[0];
    const len = Math.hypot(rx - lx, ry - ly);
    const ux = (rx - lx) / len;
    const uy = (ry - ly) / len;
    const fx = uy;
    const fy = -ux;
    const sq = 1;
    const n = Math.floor(len / sq);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#0f2340' : '#ffffff';
        const x = lx + ux * i * sq + fx * (j - 1) * sq;
        const y = ly + uy * i * sq + fy * (j - 1) * sq;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + ux * sq, y + uy * sq);
        ctx.lineTo(x + ux * sq + fx * sq, y + uy * sq + fy * sq);
        ctx.lineTo(x + fx * sq, y + fy * sq);
        ctx.fill();
      }
    }
  }

  private drawTrace(frames: Frame[], until: number, maxSpeed: number, s: number): void {
    const ctx = this.ctx;
    const BUCKETS = 12;
    const paths = Array.from({ length: BUCKETS }, () => new Path2D());
    const step = s < 3 ? 3 : 2;
    const last = Math.min(until, frames.length - 1);
    for (let i = step; i <= last; i += step) {
      const a = frames[i - step];
      const b = frames[i];
      const k = Math.min(BUCKETS - 1, Math.max(0, Math.floor((Math.abs(b.speed) / maxSpeed) * BUCKETS)));
      paths[k].moveTo(a.x, a.y);
      paths[k].lineTo(b.x, b.y);
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.6, 2.5 / s);
    paths.forEach((p, k) => {
      ctx.strokeStyle = speedColour((k + 0.5) / BUCKETS);
      ctx.stroke(p);
    });
  }

  private drawDecorations(t: TrackDef, s: number): void {
    const ctx = this.ctx;
    const pad = 12;
    const halfW = this.w / 2 / s + pad;
    const halfH = this.h / 2 / s + pad;
    for (const d of t.decorations) {
      if (Math.abs(d.x - this.camX) > halfW || Math.abs(d.y - this.camY) > halfH) continue;
      const z = d.size ?? 1;
      if (d.type === 'tree') {
        ctx.fillStyle = 'rgba(15, 35, 64, 0.12)';
        ctx.beginPath();
        ctx.arc(d.x + 0.6 * z, d.y + 0.6 * z, 1.9 * z, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COL.treeDark;
        star(ctx, d.x, d.y, 1.9 * z, 1.1 * z, 7);
        ctx.fillStyle = COL.tree;
        star(ctx, d.x, d.y, 1.3 * z, 0.75 * z, 7);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(d.x - 0.3 * z, d.y - 0.35 * z, 0.32 * z, 0, Math.PI * 2);
        ctx.fill();
      } else if (d.type === 'cabin') {
        ctx.fillStyle = 'rgba(15, 35, 64, 0.15)';
        ctx.fillRect(d.x - 3 + 0.8, d.y - 2.2 + 0.8, 6, 4.4);
        ctx.fillStyle = COL.cabin;
        ctx.fillRect(d.x - 3, d.y - 2.2, 6, 4.4);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(d.x - 3, d.y - 0.25, 6, 0.5);
      } else if (d.type === 'present') {
        ctx.fillStyle = '#c8102e';
        ctx.fillRect(d.x - 0.9, d.y - 0.9, 1.8, 1.8);
        ctx.fillStyle = '#e8b931';
        ctx.fillRect(d.x - 0.15, d.y - 0.9, 0.3, 1.8);
        ctx.fillRect(d.x - 0.9, d.y - 0.15, 1.8, 0.3);
      }
    }
  }

  private drawRays(r: RaysDraw): void {
    const ctx = this.ctx;
    ctx.lineWidth = 0.18;
    r.anglesDeg.forEach((deg, i) => {
      const a = r.heading + (deg * Math.PI) / 180;
      const d = r.values[i] * r.range;
      const ex = r.x + Math.cos(a) * d;
      const ey = r.y + Math.sin(a) * d;
      const near = 1 - r.values[i];
      ctx.strokeStyle = `rgba(${Math.round(40 + 200 * near)}, ${Math.round(160 - 120 * near)}, 90, 0.85)`;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(ex, ey, 0.35, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private drawSleigh(sl: SleighDraw, s: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(sl.x, sl.y);
    ctx.rotate(sl.heading);
    ctx.globalAlpha = sl.ghost ? 0.38 : 1;
    const body = sl.ghost ? sl.colour ?? COL.ghost : sl.colour ?? '#c8102e';
    // Runners.
    ctx.strokeStyle = sl.ghost ? body : '#5b6b7a';
    ctx.lineWidth = 0.18;
    ctx.beginPath();
    ctx.moveTo(-1.3, -0.85);
    ctx.lineTo(1.1, -0.85);
    ctx.quadraticCurveTo(1.5, -0.85, 1.5, -0.5);
    ctx.moveTo(-1.3, 0.85);
    ctx.lineTo(1.1, 0.85);
    ctx.quadraticCurveTo(1.5, 0.85, 1.5, 0.5);
    ctx.stroke();
    // Reindeer, ahead of the sleigh.
    ctx.fillStyle = sl.ghost ? body : '#8a5a33';
    ctx.beginPath();
    ctx.ellipse(2.5, 0, 0.75, 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(3.25, 0, 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = sl.ghost ? body : '#5a3a20';
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.moveTo(3.2, -0.15);
    ctx.lineTo(3.0, -0.55);
    ctx.lineTo(3.15, -0.7);
    ctx.moveTo(3.2, 0.15);
    ctx.lineTo(3.0, 0.55);
    ctx.lineTo(3.15, 0.7);
    ctx.moveTo(1.4, 0);
    ctx.lineTo(1.8, 0);
    ctx.stroke();
    if (!sl.ghost) {
      ctx.fillStyle = '#c8102e';
      ctx.beginPath();
      ctx.arc(3.5, 0, 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    // Sleigh body.
    ctx.fillStyle = body;
    roundRect(ctx, -1.2, -0.75, 2.5, 1.5, 0.45);
    ctx.fill();
    ctx.strokeStyle = sl.ghost ? '#ffffff' : '#e8b931';
    ctx.lineWidth = 0.14;
    ctx.stroke();
    ctx.fillStyle = sl.ghost ? 'rgba(255,255,255,0.5)' : '#7d0a1d';
    roundRect(ctx, -0.95, -0.5, 0.9, 1.0, 0.25);
    ctx.fill();
    ctx.restore();
    if (sl.label) {
      ctx.save();
      ctx.globalAlpha = sl.ghost ? 0.7 : 1;
      ctx.fillStyle = '#0f2340';
      ctx.font = `${12 / s}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(sl.label, sl.x, sl.y - 2.6);
      ctx.restore();
    }
  }
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r1: number, r2: number, n: number): void {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = (i * Math.PI) / n;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
