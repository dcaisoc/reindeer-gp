/**
 * Export a few seconds of a replay as an animated GIF (works everywhere) or a
 * video (WebM/MP4 via MediaRecorder, where the browser supports it). Frames
 * are drawn off-screen at a fixed size, so the clip looks the same on any screen.
 */

import type { Frame } from '../../engine/reindeer/run.js';
import type { TrackDef } from '../../engine/reindeer/track.js';
import { encodeGif, type GifFrame } from './gif.js';
import { Renderer } from './render.js';
import { fmtTime, h } from './ui.js';

export interface ClipSource {
  track: TrackDef;
  frames: Frame[];
  collisions: number[];
  title: string;
}

export interface ClipOptions {
  startTick: number;
  seconds: number;
  /** Width in pixels; height follows a 16:10 ratio. */
  width?: number;
  fps?: number;
  onProgress?: (text: string) => void;
}

/** Draw one clip frame at `tick` onto the renderer's canvas, with a caption bar. */
function drawFrame(r: Renderer, src: ClipSource, tick: number, w: number, hgt: number): void {
  const i = Math.max(0, Math.min(src.frames.length - 1, Math.round(tick)));
  const f = src.frames[i];
  r.draw(
    { x: f.x + Math.cos(f.heading) * 10, y: f.y + Math.sin(f.heading) * 10 },
    {
      sleighs: [{ x: f.x, y: f.y, heading: f.heading }],
      trace: src.frames,
      traceUntil: i,
      collisions: src.collisions.filter((t) => t <= i).map((t) => src.frames[t]),
    },
  );
  const ctx = r.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const bar = Math.round(hgt * 0.11);
  ctx.fillStyle = 'rgba(15, 35, 64, 0.85)';
  ctx.fillRect(0, hgt - bar, w, bar);
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${Math.round(bar * 0.45)}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(src.title.slice(0, 60), Math.round(bar * 0.35), hgt - bar / 2);
  const t = `${fmtTime(i / 60)} s`;
  ctx.fillText(t, w - ctx.measureText(t).width - Math.round(bar * 0.35), hgt - bar / 2);
}

function offscreen(w: number, hgt: number): { canvas: HTMLCanvasElement; remove: () => void } {
  const holder = h('div', { style: `position:fixed;left:-99999px;top:0;width:${w}px;height:${hgt}px`, 'aria-hidden': 'true' });
  const canvas = h('canvas', { style: `width:${w}px;height:${hgt}px` }) as HTMLCanvasElement;
  holder.append(canvas);
  document.body.append(holder);
  return { canvas, remove: () => holder.remove() };
}

/** The ticks a clip covers, clamped to the replay. */
export function clipTicks(totalFrames: number, startTick: number, seconds: number, fps: number): number[] {
  const last = totalFrames - 1;
  const start = Math.max(0, Math.min(startTick, Math.max(0, last - seconds * 60)));
  const end = Math.min(last, start + seconds * 60);
  const step = 60 / fps;
  const out: number[] = [];
  for (let t = start; t <= end; t += step) out.push(t);
  return out;
}

export async function exportGif(src: ClipSource, o: ClipOptions): Promise<Uint8Array> {
  const w = o.width ?? 480;
  const hgt = Math.round((w * 10) / 16);
  const fps = o.fps ?? 15;
  const { canvas, remove } = offscreen(w, hgt);
  try {
    const r = new Renderer(canvas, 1);
    r.setTrack(src.track);
    const ticks = clipTicks(src.frames.length, o.startTick, o.seconds, fps);
    const frames: GifFrame[] = [];
    // Settle the follow camera on the first frame.
    drawFrame(r, src, ticks[0], w, hgt);
    for (let n = 0; n < ticks.length; n++) {
      drawFrame(r, src, ticks[n], w, hgt);
      frames.push({ rgba: r.ctx.getImageData(0, 0, w, hgt).data, delayCs: 100 / fps });
      if (n % 10 === 0) {
        o.onProgress?.(`Drawing frames… ${Math.round((100 * n) / ticks.length)}%`);
        await new Promise((res) => setTimeout(res, 0));
      }
    }
    return await encodeGif(w, hgt, frames, (done) => o.onProgress?.(`Encoding… ${Math.round((100 * done) / frames.length)}%`));
  } finally {
    remove();
  }
}

/** Is video recording available in this browser? Returns the best MIME type, or null. */
export function videoMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  for (const t of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

/** Record the clip in real time (it takes as long as the clip). */
export async function exportVideo(src: ClipSource, o: ClipOptions): Promise<{ blob: Blob; ext: string }> {
  const mime = videoMime();
  if (!mime) throw new Error('This browser can’t record video. Make a GIF instead.');
  const w = o.width ?? 960;
  const hgt = Math.round((w * 10) / 16);
  const fps = o.fps ?? 30;
  const { canvas, remove } = offscreen(w, hgt);
  try {
    const r = new Renderer(canvas, 1);
    r.setTrack(src.track);
    const ticks = clipTicks(src.frames.length, o.startTick, o.seconds, fps);
    drawFrame(r, src, ticks[0], w, hgt);
    const stream = canvas.captureStream(fps);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((res) => (rec.onstop = () => res()));
    rec.start();
    const t0 = performance.now();
    for (let n = 0; n < ticks.length; n++) {
      drawFrame(r, src, ticks[n], w, hgt);
      o.onProgress?.(`Recording… ${Math.round((100 * n) / ticks.length)}%`);
      const due = t0 + ((n + 1) * 1000) / fps;
      await new Promise((res) => setTimeout(res, Math.max(0, due - performance.now())));
    }
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    return { blob: new Blob(chunks, { type: mime.split(';')[0] }), ext: mime.includes('mp4') ? 'mp4' : 'webm' };
  } finally {
    remove();
  }
}
