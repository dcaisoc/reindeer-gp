/**
 * Drive-yourself mode: countdown, fixed-timestep simulation, HUD, ghost,
 * always-on recording, and the post-lap summary.
 */

import { DT, DEFAULT_CONFIG, ENGINE_VERSION } from '../../../engine/reindeer/config.js';
import { Recorder, runPolicy, simulateReplay, type Frame } from '../../../engine/reindeer/run.js';
import { baselinePolicy } from '../../../engine/reindeer/autopilot.js';
import { decodeReplay, encodeReplay } from '../../../engine/core/replay.js';
import { api, getMe, waitForSubmission } from '../api.js';
import type { TrackDef } from '../../../engine/reindeer/track.js';
import { HumanInput } from '../input.js';
import { Renderer } from '../render.js';
import { bestLap, defaultUseForTraining, getLap, lapReplay, newId, qualityHint, saveLap, type LapRecord } from '../store.js';
import { geometry, getTrack, sectorTimes } from '../tracks.js';
import { download, fmtDelta, fmtTime, h, isTouchDevice, toast, type Screen } from '../ui.js';

type Phase = 'countdown' | 'running' | 'paused' | 'finished';
type GhostKind = 'best' | 'baseline' | 'off';

interface Ghost {
  kind: Exclude<GhostKind, 'off'>;
  frames: Frame[];
  splits: number[];
  label: string;
}

const COUNTDOWN_MS = 3000;
const MAX_STEPS_PER_FRAME = 6;

export function driveScreen(trackId: string, ghostLapId?: string): Screen {
  const track = getTrack(trackId);
  if (!track) throw new Error(`Unknown track "${trackId}".`);
  const geo = geometry(track);
  const cfg = DEFAULT_CONFIG;

  // ---------- DOM ----------
  const canvas = h('canvas', { class: 'game', 'aria-label': `Driving on ${track.name}` });
  const timeEl = h('div', { class: 'hud-time', 'aria-live': 'off' }, '0.00');
  const penEl = h('div', { class: 'hud-pen' }, 'Penalties 0');
  const deltaEl = h('div', { class: 'hud-delta' }, '');
  const speedEl = h('div', { class: 'hud-speed' }, '0');
  const sectorEl = h('div', { class: 'hud-sectors' });
  const bars = cfg.rayAnglesDeg.map(() => h('div', { class: 'bar' }, h('i')));
  const ghostEl = h('div', { class: 'hud-ghost' }, '');
  const countdownEl = h('div', { class: 'countdown', 'aria-live': 'assertive' });
  const pauseEl = h('div', { class: 'overlay', hidden: true });
  const summaryEl = h('div', { class: 'overlay summary', hidden: true });

  const touch = h('div', { class: 'touch-controls', 'aria-hidden': 'true' },
    h('div', { class: 'touch-left' },
      h('button', { class: 'tc', 'data-key': 'left', tabindex: '-1' }, '◀'),
      h('button', { class: 'tc', 'data-key': 'right', tabindex: '-1' }, '▶'),
    ),
    h('div', { class: 'touch-right' },
      h('button', { class: 'tc brake', 'data-key': 'down', tabindex: '-1' }, 'Brake'),
      h('button', { class: 'tc gas', 'data-key': 'up', tabindex: '-1' }, 'Go'),
    ),
  );
  if (isTouchDevice()) touch.classList.add('show');

  const hud = h('div', { class: 'hud' },
    h('div', { class: 'hud-tl' }, h('div', { class: 'hud-track' }, track.name), timeEl, penEl, deltaEl),
    h('div', { class: 'hud-tr' }, h('div', {}, speedEl, h('span', { class: 'unit' }, ' km/h')), sectorEl),
    h('div', { class: 'hud-bl' },
      h('div', { class: 'sensors', title: 'What the sleigh’s 7 distance sensors see (taller = more room)' }, bars),
      h('div', { class: 'hud-label' }, 'Sensors'),
    ),
    h('div', { class: 'hud-br' }, ghostEl, h('div', { class: 'hud-keys' }, 'P pause · R restart · G ghost · V sensors · C camera')),
  );

  const el = h('main', { class: 'drive' }, canvas, hud, countdownEl, touch, pauseEl, summaryEl);

  // ---------- state ----------
  const input = new HumanInput();
  touch.querySelectorAll<HTMLElement>('.tc').forEach((b) => input.bindButton(b, b.dataset.key as 'left'));
  let renderer: Renderer | null = null;
  let rec = newRecorder();
  let phase: Phase = 'countdown';
  let countdownStart = performance.now();
  let lastFrame = performance.now();
  let acc = 0;
  let raf = 0;
  let showRays = true;
  let ghostKind: GhostKind = 'best';
  const ghosts: Partial<Record<Exclude<GhostKind, 'off'>, Ghost>> = {};
  let disposed = false;
  /** True when racing a specific lap picked in the replay viewer (don't swap it for your best). */
  let ghostPinned = false;

  function newRecorder(): Recorder {
    return new Recorder(track!, 1, { kind: 'human', name: 'You' }, cfg, geo);
  }

  // Ghosts: a lap chosen in the replay viewer, else your best lap; plus the baseline bot.
  if (ghostLapId?.startsWith('p_')) {
    // A replay from the leaderboard or a shared link.
    loadRemoteGhost(ghostLapId).then((g) => {
      if (!g || disposed) return;
      ghosts.best = g;
      ghostKind = 'best';
      ghostPinned = true;
      updateGhostLabel();
    });
  }
  const chosen = ghostLapId && !ghostLapId.startsWith('p_') ? getLap(ghostLapId).then((l) => (l && l.trackId === track.id ? l : null)) : Promise.resolve(null);
  Promise.all([chosen, bestLap(track.id)]).then(async ([pick, b]) => {
    if (ghostPinned) return;
    const lap = pick ?? b;
    if (lap) {
      const r = await lapReplay(lap);
      const out = simulateReplay(track, r, { geo, collectFrames: true });
      const label = pick ? `Chosen lap ${fmtTime(lap.result.score)}` : `Your best ${fmtTime(lap.result.score)}`;
      ghosts.best = { kind: 'best', frames: out.frames!, splits: out.game.events.splits, label };
      if (pick) ghostPinned = true;
    } else ghostKind = 'baseline';
    updateGhostLabel();
  });
  {
    const r = runPolicy(track, baselinePolicy, { kind: 'bot', name: 'Baseline' }, { geo });
    const out = simulateReplay(track, r, { geo, collectFrames: true });
    ghosts.baseline = { kind: 'baseline', frames: out.frames!, splits: out.game.events.splits, label: `Baseline bot ${fmtTime(r.header.result.score)}` };
  }

  function activeGhost(): Ghost | null {
    return ghostKind === 'off' ? null : ghosts[ghostKind] ?? null;
  }

  function updateGhostLabel(): void {
    const g = activeGhost();
    ghostEl.textContent = g ? `Ghost: ${g.label}` : 'Ghost off';
  }

  function cycleGhost(): void {
    const order: GhostKind[] = ['best', 'baseline', 'off'];
    for (let i = 1; i <= 3; i++) {
      const k = order[(order.indexOf(ghostKind) + i) % 3];
      if (k === 'off' || ghosts[k]) {
        ghostKind = k;
        break;
      }
    }
    updateGhostLabel();
  }

  // ---------- controls ----------
  function onKey(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (phase === 'finished') {
      if (e.code === 'Enter' || e.code === 'KeyR') restart();
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    else if (e.code === 'KeyR') restart();
    else if (e.code === 'KeyG') cycleGhost();
    else if (e.code === 'KeyV') showRays = !showRays;
    else if (e.code === 'KeyC' && renderer) renderer.mode = renderer.mode === 'follow' ? 'full' : 'follow';
  }
  window.addEventListener('keydown', onKey);
  const onVis = () => {
    if (document.hidden && phase === 'running') togglePause();
  };
  document.addEventListener('visibilitychange', onVis);
  const onResize = () => renderer?.resize();
  window.addEventListener('resize', onResize);

  function togglePause(): void {
    if (phase === 'running') {
      phase = 'paused';
      pauseEl.replaceChildren(
        h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Paused' },
          h('h2', {}, 'Paused'),
          h('div', { class: 'actions' },
            h('button', { class: 'btn btn-primary', onclick: togglePause }, 'Resume'),
            h('button', { class: 'btn', onclick: restart }, 'Restart'),
            h('a', { class: 'btn', href: '#/' }, 'Back to tracks'),
          ),
        ),
      );
      pauseEl.hidden = false;
      (pauseEl.querySelector('button') as HTMLButtonElement)?.focus();
    } else if (phase === 'paused') {
      phase = 'running';
      pauseEl.hidden = true;
      lastFrame = performance.now();
      canvas.focus();
    }
  }

  function restart(): void {
    rec = newRecorder();
    input.reset();
    phase = 'countdown';
    countdownStart = performance.now();
    acc = 0;
    pauseEl.hidden = true;
    summaryEl.hidden = true;
    sectorEl.replaceChildren();
    deltaEl.textContent = '';
    if (ghostPinned) return;
    bestLap(track!.id).then(async (b) => {
      if (b && (!ghosts.best || !ghosts.best.label.endsWith(fmtTime(b.result.score)))) {
        const r = await lapReplay(b);
        const out = simulateReplay(track!, r, { geo, collectFrames: true });
        ghosts.best = { kind: 'best', frames: out.frames!, splits: out.game.events.splits, label: `Your best ${fmtTime(b.result.score)}` };
        if (ghostKind === 'baseline') ghostKind = 'best';
        updateGhostLabel();
      }
    });
  }

  // ---------- loop ----------
  function frame(now: number): void {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    if (!renderer) {
      renderer = new Renderer(canvas);
      renderer.setTrack(track!);
    }
    const g = rec.game;

    if (phase === 'countdown') {
      const left = COUNTDOWN_MS - (now - countdownStart);
      if (left <= 0) {
        phase = 'running';
        countdownEl.textContent = 'GO!';
        countdownEl.className = 'countdown go';
        setTimeout(() => {
          if (phase !== 'countdown') countdownEl.textContent = '';
        }, 600);
        lastFrame = now;
        acc = 0;
      } else {
        countdownEl.textContent = String(Math.ceil(left / 1000));
        countdownEl.className = 'countdown';
      }
    }

    if (phase === 'running') {
      acc += Math.min(0.25, Math.max(0, now - lastFrame) / 1000);
      lastFrame = now;
      let steps = 0;
      while (acc >= DT && steps < MAX_STEPS_PER_FRAME && !g.isDone()) {
        rec.tick(input.sample());
        acc -= DT;
        steps++;
        if (g.events.splits.length > sectorEl.childElementCount) onSplit();
      }
      if (steps === MAX_STEPS_PER_FRAME) acc = 0;
      if (g.isDone()) finish();
    }

    // HUD
    const obs = g.observe();
    timeEl.textContent = fmtTime(g.tick / 60);
    penEl.textContent = `Penalties ${g.penalties}${g.penalties ? ` (+${(g.penalties * cfg.penaltySeconds).toFixed(0)} s)` : ''}`;
    penEl.classList.toggle('hit', g.cooldown > cfg.penaltyCooldownTicks - 20 && g.penalties > 0);
    speedEl.textContent = String(Math.round(Math.abs(g.speed) * 3.6));
    bars.forEach((b, i) => {
      const v = obs.rays[i];
      const bar = b.firstChild as HTMLElement;
      bar.style.height = `${Math.round(v * 100)}%`;
      bar.style.background = v < 0.25 ? '#c8102e' : v < 0.5 ? '#e8b931' : '#1f8a5b';
    });

    // Draw
    const ghost = activeGhost();
    const sleighs = [];
    if (ghost) {
      const f = ghost.frames[Math.min(g.tick, ghost.frames.length - 1)];
      sleighs.push({ x: f.x, y: f.y, heading: f.heading, ghost: true, label: ghost.kind === 'best' ? 'Best' : 'Baseline' });
    }
    sleighs.push({ x: g.x, y: g.y, heading: g.heading });
    renderer.draw(
      { x: g.x + Math.cos(g.heading) * 12, y: g.y + Math.sin(g.heading) * 12 },
      {
        sleighs,
        rays: showRays ? { x: g.x, y: g.y, heading: g.heading, anglesDeg: cfg.rayAnglesDeg, values: obs.rays, range: cfg.rayRange } : null,
      },
      phase === 'countdown' && now - countdownStart < 50,
    );
  }

  function onSplit(): void {
    const g = rec.game;
    const i = g.events.splits.length - 1;
    const t = g.events.splits[i] / 60;
    const ghost = activeGhost();
    const chip = h('span', { class: 'chip' }, `CP${i + 1 === track!.checkpoints.length ? ' finish' : ` ${i + 1}`}`);
    if (ghost && ghost.splits[i] !== undefined) {
      const d = t - ghost.splits[i] / 60;
      deltaEl.textContent = `${fmtDelta(d)} vs ${ghost.kind === 'best' ? 'your best' : 'baseline'}`;
      deltaEl.className = `hud-delta ${d <= 0 ? 'ahead' : 'behind'}`;
      chip.classList.add(d <= 0 ? 'ahead' : 'behind');
    }
    sectorEl.append(chip);
  }

  async function finish(): Promise<void> {
    phase = 'finished';
    const replay = rec.toReplay();
    const bytes = await encodeReplay(replay);
    const previousBest = await bestLap(track!.id);
    const lap: LapRecord = {
      id: newId(),
      trackId: track!.id,
      trackVersion: track!.trackVersion,
      engineVersion: ENGINE_VERSION,
      createdAt: replay.header.createdAt,
      kind: 'human',
      name: 'You',
      result: replay.header.result,
      bytes,
      useForTraining: defaultUseForTraining(replay.header.result),
    };
    await saveLap(lap);
    if (disposed) return;
    showSummary(lap, previousBest, rec.game.events.splits, bytes);
  }

  function showSummary(lap: LapRecord, prevBest: LapRecord | null, splits: number[], bytes: Uint8Array): void {
    const r = lap.result;
    const isBest = r.valid && (!prevBest || (r.score as number) < (prevBest.result.score as number));
    const mini = h('canvas', { class: 'summary-map', 'aria-label': 'Your path, coloured by speed' });
    const mySectors = sectorTimes(track!, splits);
    const ghost = ghosts.best && prevBest ? ghosts.best : null;
    const refSectors = ghost ? sectorTimes(track!, ghost.splits) : null;
    const hint = qualityHint(lap, prevBest);
    const rows = mySectors.map((s, i) =>
      h('tr', {},
        h('th', { scope: 'row' }, `Sector ${i + 1}`),
        h('td', {}, fmtTime(s)),
        h('td', {}, refSectors ? fmtTime(refSectors[i]) : '—'),
        h('td', { class: s !== null && refSectors?.[i] != null && Math.abs(s - (refSectors[i] as number)) >= 0.005 ? (s < (refSectors[i] as number) ? 'ahead' : 'behind') : '' },
          s !== null && refSectors?.[i] != null ? fmtDelta(s - (refSectors[i] as number)) : ''),
      ),
    );
    summaryEl.replaceChildren(
      h('div', { class: 'panel wide', role: 'dialog', 'aria-label': 'Lap summary' },
        h('h2', {}, r.valid ? (isBest ? 'New personal best!' : 'Lap complete') : 'Out of time'),
        h('div', { class: 'summary-grid' },
          h('div', {},
            h('dl', { class: 'figures' },
              h('div', {}, h('dt', {}, 'Score'), h('dd', { class: 'big' }, r.valid ? fmtTime(r.score) : '—')),
              h('div', {}, h('dt', {}, 'Lap time'), h('dd', {}, fmtTime(r.ticks / 60))),
              h('div', {}, h('dt', {}, 'Penalties'), h('dd', {}, r.penalties ? `${r.penalties} (+${(r.penalties * cfg.penaltySeconds).toFixed(0)} s)` : '0')),
              h('div', {}, h('dt', {}, 'Wall hits'), h('dd', {}, String(r.collisions))),
            ),
            h('table', { class: 'sectors' },
              h('thead', {}, h('tr', {}, h('th', {}), h('th', { scope: 'col' }, 'You'), h('th', { scope: 'col' }, 'Best'), h('th', { scope: 'col' }, 'Δ'))),
              h('tbody', {}, rows),
            ),
            hint ? h('p', { class: 'hint' }, hint) : h('p', { class: 'hint good' }, r.valid ? 'Clean lap: great training data for your bot.' : ''),
            h('p', { class: 'muted small' }, 'Saved in this browser. It works offline; saving to your account comes later.'),
          ),
          h('figure', {}, mini, h('figcaption', {}, h('span', { class: 'legend' }), ' slow → fast')),
        ),
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn-primary', onclick: restart }, 'Drive again (Enter)'),
          h('a', { class: 'btn', href: `#/replay/lap/${lap.id}` }, 'Watch replay'),
          r.valid ? h('button', { class: 'btn', onclick: (e: Event) => submitHumanLap(lap, e.currentTarget as HTMLButtonElement) }, 'Submit to Human board') : null,
          h('a', { class: 'btn', href: `#/train/${track!.id}` }, 'Train a bot'),
          h('a', { class: 'btn', href: `#/laps/${track!.id}` }, 'Driving data'),
          h('button', { class: 'btn', onclick: () => download(bytes, `${track!.id}-${fmtTime(r.score ?? r.ticks / 60)}.rgpr`) }, 'Download'),
        ),
      ),
    );
    summaryEl.hidden = false;
    (summaryEl.querySelector('.btn-primary') as HTMLElement)?.focus();
    requestAnimationFrame(() => drawMiniMap(mini, track!, lap));
  }

  // Read-only hook for automated browser tests: only present with ?debug in the URL.
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as Record<string, unknown>).__rgp = { game: () => rec.game, phase: () => phase };
  }

  raf = requestAnimationFrame(frame);
  canvas.tabIndex = 0;
  setTimeout(() => canvas.focus(), 0);

  return {
    el,
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      input.dispose();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
    },
  };
}

async function loadRemoteGhost(id: string): Promise<Ghost | null> {
  try {
    const { replay: meta } = await api.get<{ replay: { title: string; score: number | null; trackId: string } }>(`/replays/${encodeURIComponent(id)}`);
    const res = await fetch(`/api/v1/replays/${encodeURIComponent(id)}/file`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const track = getTrack(meta.trackId);
    if (!track) return null;
    const rep = await decodeReplay(new Uint8Array(await res.arrayBuffer()));
    const out = simulateReplay(track, rep, { geo: geometry(track), collectFrames: true });
    return { kind: 'best', frames: out.frames!, splits: out.game.events.splits, label: `${meta.title.split(' on ')[0]} ${fmtTime(meta.score)}` };
  } catch {
    toast('Could not load that ghost.', 'error');
    return null;
  }
}

/** Upload a lap to the Human board and report the server's verdict. */
export async function submitHumanLap(lap: LapRecord, btn: HTMLButtonElement): Promise<void> {
  const me = await getMe();
  if (!me.user) {
    location.hash = '#/signin?return=laps';
    return;
  }
  if (!me.user.teamId) {
    location.hash = '#/team';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Uploading…';
  try {
    const r = await api.upload<{ submissionId: string }>('/runs?submit=1', lap.bytes);
    const s = await waitForSubmission(r.submissionId, (x) => (btn.textContent = x.status === 'queued' ? 'Queued…' : 'Checking…'));
    btn.textContent = s.status === 'done' ? (s.result?.valid ? `On the board: ${fmtTime(s.result.score)} s` : 'Checked (did not finish)') : 'Rejected';
    if (s.status === 'rejected') toast(s.rejectReason ?? 'Rejected.', 'error');
    window.dispatchEvent(new Event('rgp:submitted'));
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Submit to Human board';
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}

async function drawMiniMap(canvas: HTMLCanvasElement, track: TrackDef, lap: LapRecord): Promise<void> {
  const r = new Renderer(canvas);
  r.mode = 'full';
  r.setTrack(track);
  const out = simulateReplay(track, await lapReplay(lap), { geo: geometry(track), collectFrames: true });
  const frames = out.frames!;
  const hits = out.game.events.collisionTicks.map((t) => frames[t]).filter(Boolean);
  r.draw({ x: 0, y: 0 }, { sleighs: [], trace: frames, collisions: hits });
}
