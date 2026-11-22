/**
 * Replay viewer: play, pause, speed 0.25x-4x, scrub, camera modes, sensor rays,
 * speed-coloured trace, collision markers, sector splits and up to 3 ghosts.
 * Replays store inputs only; the viewer re-simulates them and flags any
 * replay that no longer matches this engine.
 */

import { decodeReplay, type Replay } from '../../../engine/core/replay.js';
import { ENGINE_VERSION, type EngineConfig } from '../../../engine/reindeer/config.js';
import { runPolicy, simulateReplay, type Frame } from '../../../engine/reindeer/run.js';
import { baselinePolicy } from '../../../engine/reindeer/autopilot.js';
import { fcos, fsin } from '../../../engine/core/fmath.js';
import type { TrackDef } from '../../../engine/reindeer/track.js';
import { Renderer, type SleighDraw } from '../render.js';
import { getLap, lapReplay, listLaps, type LapRecord } from '../store.js';
import { ensureCourse, ensureCourseForReplay, geometry, sectorTimes } from '../tracks.js';
import { download, fmtDate, fmtDelta, fmtTime, h, toast, type Screen } from '../ui.js';
import { api } from '../api.js';
import { exportGif, exportVideo, videoMime } from '../clip.js';

const GHOST_COLOURS = ['#2b6cb0', '#6b46c1', '#2f855a'];
const SPEEDS = [0.25, 0.5, 1, 2, 4];

interface Loaded {
  title: string;
  track: TrackDef;
  /** Engine config of the course (a twist's, or the default). */
  cfg: EngineConfig;
  replay: Replay;
  bytes: Uint8Array | null;
  lapId?: string;
  remote?: { id: string; canEdit: boolean; visibility: string; hasThumbnail: boolean };
}

interface RemoteMeta {
  id: string;
  trackId: string;
  title: string;
  score: number | null;
  team: string;
  visibility: string;
  hasThumbnail: boolean;
  canEdit: boolean;
}

interface Sim {
  frames: Frame[];
  splits: number[];
  collisions: number[];
  matches: boolean;
  firstMismatch: number;
}

/** A replay opened from a file is kept here so #/replay/file can show it. */
let fileReplay: Loaded | null = null;

export function replayScreen(kind?: string, id?: string): Screen {
  const el = h('main', { class: 'viewer' }, h('p', { class: 'page' }, 'Loading replay…'));
  let inner: Screen | null = null;
  let disposed = false;
  load(kind, id)
    .then((l) => {
      if (disposed) return;
      inner = viewer(l);
      el.replaceWith(inner.el);
    })
    .catch((e) => {
      el.replaceChildren(
        h('div', { class: 'page' },
          h('h1', {}, 'Replay not found'),
          h('p', {}, e instanceof Error ? e.message : String(e)),
          h('p', {}, h('a', { href: '#/laps' }, 'Go to your driving data'), ' or load a replay file:'),
          fileButton(),
        ),
      );
    });
  return {
    el,
    dispose: () => {
      disposed = true;
      inner?.dispose?.();
    },
  };
}

async function load(kind?: string, id?: string): Promise<Loaded> {
  if (kind === 'lap' && id) {
    const lap = await getLap(id);
    if (!lap) throw new Error('That lap is not saved in this browser.');
    const c = await ensureCourse(lap.trackId);
    if (!c) throw new Error(`Unknown track "${lap.trackId}".`);
    return { title: `${lap.name === 'You' ? 'Your' : `${lap.name}'s`} lap · ${fmtDate(lap.createdAt)}`, track: c.track, cfg: c.cfg, replay: await lapReplay(lap), bytes: lap.bytes, lapId: lap.id };
  }
  if (kind === 'baseline' && id) {
    const c = await ensureCourse(id);
    if (!c) throw new Error(`Unknown track "${id}".`);
    const replay = runPolicy(c.track, baselinePolicy, { kind: 'bot', name: 'Baseline bot' }, { geo: geometry(c.track), cfg: c.cfg, twist: c.twist });
    return { title: c.twist ? `Baseline bot · ${c.name}` : 'Baseline bot', track: c.track, cfg: c.cfg, replay, bytes: null };
  }
  if (kind === 'remote' && id) {
    const { replay: meta } = await api.get<{ replay: RemoteMeta }>(`/replays/${encodeURIComponent(id)}`);
    const res = await fetch(`/api/v1/replays/${encodeURIComponent(id)}/file`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Could not download that replay.');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const replay = await decodeReplay(bytes);
    const c = await ensureCourseForReplay(replay.header);
    if (!c) throw new Error(`Unknown track "${meta.trackId}".`);
    return {
      title: meta.title, track: c.track, cfg: c.cfg, replay, bytes,
      remote: { id: meta.id, canEdit: meta.canEdit, visibility: meta.visibility, hasThumbnail: meta.hasThumbnail },
    };
  }
  if (kind === 'file' && fileReplay) return fileReplay;
  throw new Error('Nothing to show. Pick a lap from your driving data, or load a replay file.');
}

async function openFile(file: File): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const replay = await decodeReplay(bytes);
    const c = await ensureCourseForReplay(replay.header);
    if (!c) throw new Error(`This replay is for "${replay.header.twist?.id ?? replay.header.track.id}", which this app does not have (a twist that isn't live yet?).`);
    fileReplay = { title: `${replay.header.participants[0]?.name ?? 'Replay'} · ${file.name}`, track: c.track, cfg: c.cfg, replay, bytes };
    if (location.hash === '#/replay/file') window.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = '#/replay/file';
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}

function fileButton(): HTMLElement {
  const input = h('input', { type: 'file', accept: '.rgpr', hidden: true, onchange: (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) openFile(f);
  } });
  return h('span', {}, h('button', { class: 'btn', onclick: () => input.click() }, 'Load replay file…'), input);
}

function simulate(track: TrackDef, replay: Replay, cfg: EngineConfig): Sim {
  const out = simulateReplay(track, replay, { geo: geometry(track), cfg, collectFrames: true });
  return {
    frames: out.frames!,
    splits: out.game.events.splits,
    collisions: out.game.events.collisionTicks,
    matches: out.matches,
    firstMismatch: out.firstMismatch,
  };
}

function viewer(main: Loaded): Screen {
  const { track } = main;
  const geo = geometry(track);
  const cfg = main.cfg;
  const primary = simulate(track, main.replay, cfg);
  const last = primary.frames.length - 1;
  const ghosts: { lap: LapRecord; sim: Sim; colour: string }[] = [];

  let tick = 0;
  let playing = true;
  let speed = 1;
  let showRays = true;
  let showTrace = true;
  let showCps = false;
  let lastNow = performance.now();
  let raf = 0;
  let renderer: Renderer | null = null;

  const canvas = h('canvas', { class: 'game', 'aria-label': `Replay on ${track.name}` });
  const timeEl = h('span', { class: 'v-time' }, '0.00');
  const scrub = h('input', { type: 'range', min: '0', max: String(last), value: '0', step: '1', 'aria-label': 'Replay position', class: 'scrub' });
  const playBtn = h('button', { class: 'btn', 'aria-label': 'Pause' }, '❚❚');
  const speedSel = h('select', { 'aria-label': 'Playback speed' }, SPEEDS.map((s) => h('option', { value: String(s), selected: s === 1 }, `${s}×`)));
  const camBtn = h('button', { class: 'btn toggle', 'aria-pressed': 'true' }, 'Follow cam');
  const raysBtn = h('button', { class: 'btn toggle', 'aria-pressed': 'true' }, 'Sensors');
  const traceBtn = h('button', { class: 'btn toggle', 'aria-pressed': 'true' }, 'Trace');
  const cpBtn = h('button', { class: 'btn toggle', 'aria-pressed': 'false' }, 'Checkpoints');
  const sectorsEl = h('div');
  const ghostList = h('div', { class: 'ghost-list' });
  const divergeSec = primary.firstMismatch < 0 ? last / 60 : primary.firstMismatch + 1;
  const banner = primary.matches
    ? null
    : h('div', { class: 'banner error', role: 'alert' },
        `This replay doesn't match engine ${ENGINE_VERSION}: it diverges near ${fmtTime(divergeSec)} s. ` +
          'It may come from another engine version or have been edited.');

  const r = main.replay.header.result;
  const side = h('aside', { class: 'viewer-side' },
    h('h1', {}, main.title),
    h('p', { class: 'muted' }, `${track.name} · engine ${main.replay.header.engineVersion}`),
    h('dl', { class: 'figures' },
      h('div', {}, h('dt', {}, 'Score'), h('dd', { class: 'big' }, r.valid ? fmtTime(r.score) : 'DNF')),
      h('div', {}, h('dt', {}, 'Penalties'), h('dd', {}, String(r.penalties))),
      h('div', {}, h('dt', {}, 'Wall hits'), h('dd', {}, String(r.collisions))),
    ),
    h('h2', {}, 'Sectors'),
    sectorsEl,
    h('h2', {}, 'Compare with ghosts'),
    h('p', { class: 'muted small' }, 'Overlay up to 3 of your laps on this track.'),
    ghostList,
    h('div', { class: 'actions' },
      main.lapId || main.remote
        ? h('a', { class: 'btn btn-primary', href: `#/drive/${track.id}/${main.lapId ?? main.remote!.id}` }, 'Race this ghost')
        : h('a', { class: 'btn btn-primary', href: `#/drive/${track.id}` }, 'Drive this track'),
      main.remote ? h('button', { class: 'btn', onclick: () => share() }, 'Share link') : null,
      main.remote?.canEdit ? visibilityButton() : null,
      main.bytes ? h('button', { class: 'btn', onclick: () => download(main.bytes!, `${track.id}-replay.rgpr`) }, 'Download') : null,
      fileButton(),
    ),
    clipPanel(),
  );

  const stage = h('div', { class: 'viewer-stage' }, canvas, banner);
  const controls = h('div', { class: 'viewer-controls' },
    h('button', { class: 'btn', 'aria-label': 'Restart', onclick: () => seek(0) }, '⏮'),
    playBtn, timeEl, scrub, speedSel, camBtn, raysBtn, traceBtn, cpBtn,
  );
  const el = h('main', { class: 'viewer' }, stage, side, controls);

  /** "Export clip": a few seconds from the current moment, as a GIF (anywhere) or a video (where supported). */
  function clipPanel(): HTMLElement {
    const len = h('select', { id: 'clip-len', 'aria-label': 'Clip length' }, [3, 5, 8, 12].map((n) => h('option', { value: String(n), selected: n === 5 }, `${n} s`))) as HTMLSelectElement;
    const status = h('p', { class: 'muted small clip-status', 'aria-live': 'polite' });
    const vmime = videoMime();
    let busy = false;
    const src = () => ({ track, frames: primary.frames, collisions: primary.collisions, title: main.title });
    const name = (ext: string) => `${track.id}-${slugify(main.title)}-${Math.floor(tick / 60)}s.${ext}`;
    const run = async (kind: 'gif' | 'video', btn: HTMLButtonElement) => {
      if (busy) return;
      busy = true;
      btn.disabled = true;
      const wasPlaying = playing;
      setPlaying(false);
      try {
        const opts = { startTick: Math.floor(tick), seconds: Number(len.value), onProgress: (t: string) => (status.textContent = t) };
        if (kind === 'gif') {
          const bytes = await exportGif(src(), opts);
          download(bytes, name('gif'));
          status.textContent = `GIF ready (${Math.round(bytes.length / 1024)} KB): check your downloads.`;
        } else {
          const { blob, ext } = await exportVideo(src(), opts);
          download(new Uint8Array(await blob.arrayBuffer()), name(ext));
          status.textContent = `Video ready (${Math.round(blob.size / 1024)} KB): check your downloads.`;
        }
      } catch (e) {
        status.textContent = e instanceof Error ? e.message : String(e);
      } finally {
        busy = false;
        btn.disabled = false;
        if (wasPlaying) setPlaying(true);
      }
    };
    const gifBtn = h('button', { class: 'btn', onclick: () => run('gif', gifBtn as HTMLButtonElement) }, 'Make GIF') as HTMLButtonElement;
    const vidBtn = vmime ? (h('button', { class: 'btn', onclick: () => run('video', vidBtn as HTMLButtonElement) }, `Make video (${vmime.includes('mp4') ? 'MP4' : 'WebM'})`) as HTMLButtonElement) : null;
    return h('section', { class: 'clip-export', 'aria-label': 'Export a clip' },
      h('h2', {}, 'Export a clip'),
      h('p', { class: 'muted small' }, 'A short clip starting where the replay is now: pause on your best moment (or worst crash) first.'),
      h('div', { class: 'actions' }, len, gifBtn, vidBtn),
      status);
  }

  async function share(): Promise<void> {
    const r = main.remote!;
    const url = `${location.origin}/replay/${r.id}`;
    if (r.canEdit && !r.hasThumbnail) {
      // Draw a preview picture of the whole lap for chat apps (owner only, once).
      try {
        const png = await thumbnailPng(track, primary.frames);
        await api.upload(`/replays/${r.id}/thumbnail`, png);
        r.hasThumbnail = true;
      } catch {
        /* the link still works with the default picture */
      }
    }
    try {
      if (navigator.share) await navigator.share({ title: main.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Link copied. Paste it into your group chat.');
      }
    } catch {
      toast(url);
    }
  }

  function visibilityButton(): HTMLElement {
    const r = main.remote!;
    const btn = h('button', { class: 'btn' }, r.visibility === 'public' ? 'Make private' : 'Make public');
    btn.addEventListener('click', async () => {
      const next = r.visibility === 'public' ? 'hidden' : 'public';
      try {
        await api.patch(`/replays/${r.id}`, { visibility: next });
        r.visibility = next;
        btn.textContent = next === 'public' ? 'Make private' : 'Make public';
        toast(next === 'public' ? 'Anyone with the link can watch this replay.' : 'Only your team can watch this replay now.');
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
      }
    });
    return btn;
  }

  function setPlaying(p: boolean): void {
    playing = p;
    if (playing && tick >= last) tick = 0;
    playBtn.textContent = playing ? '❚❚' : '▶';
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    lastNow = performance.now();
  }
  function seek(t: number): void {
    tick = Math.max(0, Math.min(last, t));
    scrub.value = String(Math.floor(tick));
  }
  function toggle(btn: HTMLElement, on: boolean): boolean {
    btn.setAttribute('aria-pressed', String(on));
    return on;
  }
  playBtn.addEventListener('click', () => setPlaying(!playing));
  scrub.addEventListener('input', () => {
    tick = Number(scrub.value);
    setPlaying(false);
  });
  speedSel.addEventListener('change', () => (speed = Number(speedSel.value)));
  camBtn.addEventListener('click', () => {
    if (!renderer) return;
    renderer.mode = renderer.mode === 'follow' ? 'full' : 'follow';
    camBtn.textContent = renderer.mode === 'follow' ? 'Follow cam' : 'Whole track';
  });
  raysBtn.addEventListener('click', () => (showRays = toggle(raysBtn, !showRays)));
  traceBtn.addEventListener('click', () => (showTrace = toggle(traceBtn, !showTrace)));
  cpBtn.addEventListener('click', () => (showCps = toggle(cpBtn, !showCps)));

  function onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'SELECT' || tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
    if (e.code === 'Space') {
      e.preventDefault();
      setPlaying(!playing);
    } else if (e.code === 'ArrowRight' && tag !== 'INPUT') seek(tick + 60);
    else if (e.code === 'ArrowLeft' && tag !== 'INPUT') seek(tick - 60);
    else if (e.code === 'Home') seek(0);
    else if (e.code === 'KeyC') camBtn.click();
    else if (e.code === 'KeyV') raysBtn.click();
    else if (e.code === 'KeyT') traceBtn.click();
  }
  window.addEventListener('keydown', onKey);
  const onResize = () => renderer?.resize();
  window.addEventListener('resize', onResize);

  // Drag and drop a replay file anywhere on the viewer.
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.classList.add('dragging');
  });
  el.addEventListener('dragleave', () => el.classList.remove('dragging'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('dragging');
    const f = e.dataTransfer?.files?.[0];
    if (f) openFile(f);
  });

  function renderSectors(): void {
    const mine = sectorTimes(track, primary.splits);
    const cols = ghosts.map((g) => sectorTimes(track, g.sim.splits));
    sectorsEl.replaceChildren(
      h('table', { class: 'sectors' },
        h('thead', {}, h('tr', {}, h('th', {}), h('th', { scope: 'col' }, 'This'),
          ghosts.map((g, i) => h('th', { scope: 'col' }, h('span', { class: 'swatch', style: `background:${g.colour}` }), ` ${i + 1}`)))),
        h('tbody', {}, mine.map((s, i) =>
          h('tr', {}, h('th', { scope: 'row' }, `S${i + 1}`), h('td', {}, fmtTime(s)),
            cols.map((c) => {
              const v = c[i];
              const d = s !== null && v !== null ? v - s : null;
              return h('td', { class: d === null || Math.abs(d) < 0.005 ? '' : d > 0 ? 'behind' : 'ahead', title: 'Ghost minus this lap' }, d === null ? '—' : fmtDelta(d));
            }),
          ))),
      ),
    );
  }

  async function renderGhostPicker(): Promise<void> {
    const laps = (await listLaps(track.id)).filter((l) => l.id !== main.lapId).slice(0, 30);
    if (!laps.length) {
      ghostList.replaceChildren(h('p', { class: 'muted small' }, 'No other laps on this track yet.'));
      return;
    }
    ghostList.replaceChildren(
      ...laps.map((lap) => {
        const cb = h('input', { type: 'checkbox', id: `g-${lap.id}` });
        cb.addEventListener('change', async () => {
          if (cb.checked) {
            if (ghosts.length >= 3) {
              cb.checked = false;
              toast('Up to 3 ghosts at once.');
              return;
            }
            const used = new Set(ghosts.map((g) => g.colour));
            const colour = GHOST_COLOURS.find((c) => !used.has(c))!;
            ghosts.push({ lap, sim: simulate(track, await lapReplay(lap), cfg), colour });
          } else {
            const i = ghosts.findIndex((g) => g.lap.id === lap.id);
            if (i >= 0) ghosts.splice(i, 1);
          }
          renderSectors();
        });
        return h('label', { class: 'ghost-item', for: `g-${lap.id}` }, cb,
          ` ${lap.result.valid ? fmtTime(lap.result.score) : 'DNF'} · ${fmtDate(lap.createdAt)}`);
      }),
    );
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (!renderer) {
      renderer = new Renderer(canvas);
      renderer.setTrack(track);
    }
    if (playing) {
      // rAF timestamps can be slightly earlier than performance.now() taken in a click handler.
      tick = Math.max(0, tick + (Math.max(0, now - lastNow) / 1000) * 60 * speed);
      if (tick >= last) {
        tick = last;
        setPlaying(false);
      }
      scrub.value = String(Math.floor(tick));
    }
    lastNow = now;
    const i = Math.max(0, Math.min(last, Math.floor(tick)));
    const f = primary.frames[i];
    timeEl.textContent = `${fmtTime(i / 60)} / ${fmtTime(last / 60)}`;
    const sleighs: SleighDraw[] = ghosts.map((g) => {
      const gf = g.sim.frames[Math.min(i, g.sim.frames.length - 1)];
      return { x: gf.x, y: gf.y, heading: gf.heading, ghost: true, colour: g.colour };
    });
    sleighs.push({ x: f.x, y: f.y, heading: f.heading });
    let rays = null;
    if (showRays) {
      const values = cfg.rayAnglesDeg.map((d) => {
        const a = f.heading + (d * Math.PI) / 180;
        return geo.castRay(f.x, f.y, fcos(a), fsin(a), cfg.rayRange) / cfg.rayRange;
      });
      rays = { x: f.x, y: f.y, heading: f.heading, anglesDeg: cfg.rayAnglesDeg, values, range: cfg.rayRange };
    }
    renderer.draw(
      { x: f.x + Math.cos(f.heading) * 10, y: f.y + Math.sin(f.heading) * 10 },
      {
        sleighs,
        rays,
        trace: showTrace ? primary.frames : null,
        traceUntil: i,
        collisions: primary.collisions.filter((t) => t <= i).map((t) => primary.frames[t]),
        showCheckpoints: showCps,
      },
    );
  }

  renderSectors();
  renderGhostPicker();
  raf = requestAnimationFrame(frame);
  return {
    el,
    dispose: () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    },
  };
}

/** A 1200x630 picture of the whole lap (the size chat apps expect for previews). */
async function thumbnailPng(track: TrackDef, frames: Frame[]): Promise<Blob> {
  const holder = h('div', { style: 'position:fixed;left:-99999px;top:0;width:1200px;height:630px' });
  const c = h('canvas', { style: 'width:1200px;height:630px' });
  holder.append(c);
  document.body.append(holder);
  try {
    const r = new Renderer(c);
    r.mode = 'full';
    r.setTrack(track);
    const f = frames[frames.length - 1];
    r.draw({ x: 0, y: 0 }, { sleighs: [{ x: f.x, y: f.y, heading: f.heading }], trace: frames });
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(15, 35, 64, 0.85)';
    ctx.fillRect(0, c.height - 70 * (c.height / 630), c.width, 70 * (c.height / 630));
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${30 * (c.height / 630)}px system-ui, sans-serif`;
    ctx.fillText(`Reindeer Grand Prix · ${track.name}`, 24 * (c.width / 1200), c.height - 25 * (c.height / 630));
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('no png'))), 'image/png'));
  } finally {
    holder.remove();
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'replay';
}
