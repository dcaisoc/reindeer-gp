/**
 * The in-browser trainer: choose laps, sensors, network size and settings;
 * watch the network learn; watch the bot drive; get tips; submit.
 * Everything runs in the browser. No installs, no server round-trip to train.
 */

import { countParams, DEFAULT_LIMITS, type BotFile, compileBot } from '../../../engine/core/bot.js';
import { botPolicy, evaluateBot } from '../../../engine/reindeer/bot-policy.js';
import { DEFAULT_CONFIG } from '../../../engine/reindeer/config.js';
import { simulateReplay, type Frame } from '../../../engine/reindeer/run.js';
import { ReindeerGame } from '../../../engine/reindeer/sim.js';
import { quantise } from '../../../engine/core/quant.js';
import { api, ApiError, getMe, waitForSubmission, type Submission, boardKey } from '../api.js';
import { Renderer } from '../render.js';
import { bestLap, lapReplay, listLaps, type LapRecord } from '../store.js';
import { canMirror } from '../train/data.js';
import type { TrainConfig } from '../train/mlp.js';
import { coachingTips } from '../train/tips.js';
import { drawLossCurve, drawNetwork } from '../train/visuals.js';
import type { TrainMessage, TrainRequest } from '../train/worker.js';
import { TRACKS, geometry, getTrack } from '../tracks.js';
import { download, fmtDate, fmtTime, h, toast, type Screen } from '../ui.js';

const RAYS = DEFAULT_CONFIG.rayAnglesDeg.map((_, i) => `ray${i}`);
const RAY_LABEL = ['far left', 'left', 'ahead-left', 'ahead', 'ahead-right', 'right', 'far right'];
const NEURONS = [4, 8, 16, 32, 64];

interface Settings {
  inputs: string[];
  layers: number;
  neurons: number;
  activation: 'relu' | 'tanh';
  epochs: number;
  learningRate: number;
  mirror: boolean;
}

const RECOMMENDED: Settings = { inputs: [...RAYS, 'speed'], layers: 2, neurons: 32, activation: 'relu', epochs: 40, learningRate: 0.003, mirror: false };

const CAPTIONS = [
  'The network looks at what the sensors saw at each moment of your laps…',
  '…guesses how you steered and braked…',
  '…compares its guess with what you actually did…',
  '…and nudges every connection a tiny bit to make the difference smaller.',
  'Red connections push an output up, blue ones push it down. Thicker means stronger.',
  'Each practice round (epoch) goes through all your driving once.',
];

export function trainScreen(trackParam?: string): Screen {
  const track = getTrack(trackParam ?? '') ?? TRACKS[0];
  let settings: Settings = loadSettings();
  let laps: LapRecord[] = [];
  let worker: Worker | null = null;
  let trained: { bot: BotFile; samples: number; losses: number[]; valLosses: (number | null)[]; laps: number } | null = null;
  let disposed = false;
  let raf = 0;
  /** Same laps + same settings give the same bot; "Train again" tries a new random start. */
  let trainCount = 0;
  let watchSpeed = 1;

  // ---------- step 1: data ----------
  const trackSel = h('select', { id: 'train-track', onchange: (e: Event) => (location.hash = `#/train/${(e.target as HTMLSelectElement).value}`) },
    TRACKS.map((t) => h('option', { value: t.id, selected: t.id === track.id }, t.name)));
  const allTracksCb = h('input', { type: 'checkbox', id: 'all-tracks' });
  const dataSummary = h('div', { class: 'data-summary' });
  const lapList = h('div', { class: 'lap-pick' });

  // ---------- step 2: sensors ----------
  const fan = h('canvas', { class: 'fan', width: '220', height: '120', 'aria-hidden': 'true' });
  const sensorBoxes = [...RAYS, 'speed', 'lateral', 'surface'].map((name) => {
    const label = name.startsWith('ray') ? `Distance ${RAY_LABEL[Number(name.slice(3))]}` : name === 'speed' ? 'Speed' : name === 'lateral' ? 'Sideways slide' : 'Surface (snow / ice / rough)';
    const cb = h('input', { type: 'checkbox', 'data-name': name, onchange: () => { readInputs(); refresh(); } });
    return h('label', { class: 'check' }, cb, ` ${label}`);
  });

  // ---------- step 3: brain size ----------
  const layersSel = h('select', { id: 'layers', onchange: () => { settings.layers = Number(layersSel.value); refresh(); } },
    h('option', { value: '1' }, '1 hidden layer'), h('option', { value: '2' }, '2 hidden layers'));
  const neuronsSel = h('select', { id: 'neurons', onchange: () => { settings.neurons = Number(neuronsSel.value); refresh(); } },
    NEURONS.map((n) => h('option', { value: String(n) }, `${n} neurons each`)));
  const actSel = h('select', { id: 'activation', onchange: () => { settings.activation = actSel.value as 'relu'; refresh(); } },
    h('option', { value: 'relu' }, 'ReLU (straight lines, fast to learn)'), h('option', { value: 'tanh' }, 'tanh (smooth curves)'));
  const paramInfo = h('p', { class: 'param-info' });
  const netCanvas = h('canvas', { class: 'net', 'aria-label': 'Diagram of your network' });

  // ---------- step 4: practice ----------
  const epochsIn = h('input', { type: 'range', min: '5', max: '150', step: '5', id: 'epochs', oninput: () => { settings.epochs = Number(epochsIn.value); refresh(); } });
  const epochsOut = h('output', { for: 'epochs' });
  const lrSel = h('select', { id: 'lr', onchange: () => { settings.learningRate = Number(lrSel.value); refresh(); } },
    [0.0003, 0.001, 0.003, 0.01, 0.03].map((v) => h('option', { value: String(v) }, v === 0.003 ? `${v} (recommended)` : String(v))));
  const mirrorCb = h('input', { type: 'checkbox', id: 'mirror', onchange: () => { settings.mirror = mirrorCb.checked; refresh(); } });
  const mirrorNote = h('span', { class: 'muted small' });
  const advanced = h('details', { class: 'advanced' },
    h('summary', {}, 'Advanced'),
    h('label', { class: 'check' }, mirrorCb, ' Mirror my laps (flip left and right) '), mirrorNote,
    h('p', { class: 'muted small' }, 'Mirroring turns every left bend you drove into a right bend and vice versa, doubling your data. It helps on tracks with more bends one way than the other, but your bot may become a bit less precise on the real track.'),
  );

  const nameIn = h('input', { type: 'text', id: 'bot-name', maxlength: '60', value: 'My first bot' });
  const recommendBtn = h('button', { class: 'btn', onclick: () => { settings = { ...RECOMMENDED, inputs: [...RECOMMENDED.inputs] }; applySettings(); refresh(); } }, 'Use Recommended settings');
  const trainBtn = h('button', { class: 'btn btn-primary big', onclick: () => startTraining() }, 'Train my bot');

  // ---------- training + results ----------
  const lossCanvas = h('canvas', { class: 'loss', 'aria-label': 'Training error over time' });
  const caption = h('p', { class: 'caption', 'aria-live': 'polite' });
  const progress = h('progress', { max: '100', value: '0' });
  const trainingPanel = h('section', { class: 'card training', hidden: true },
    h('h2', {}, 'Training'),
    progress, caption,
    h('div', { class: 'two-col' },
      h('figure', {}, lossCanvas, h('figcaption', {}, h('span', { class: 'key red' }), ' error on your laps  ', h('span', { class: 'key blue dashed' }), ' error on held-back moments (lower is better)')),
      h('figure', {}, h('canvas', { class: 'net live' }), h('figcaption', {}, 'Your network, changing as it learns')),
    ),
  );
  const liveNet = trainingPanel.querySelector('canvas.net.live') as HTMLCanvasElement;

  const watchCanvas = h('canvas', { class: 'game watch', 'aria-label': 'Your bot driving' });
  const watchStatus = h('div', { class: 'watch-status' });
  const tipsEl = h('div', { class: 'tips' });
  const submitEl = h('div', { class: 'submit-area' });
  const resultPanel = h('section', { class: 'card result', hidden: true },
    h('h2', {}, 'Watch your bot drive'),
    h('p', { class: 'muted' }, 'This is exactly what the leaderboard will score: same engine, same network, same start. The faint sleigh is your best lap.'),
    h('div', { class: 'watch-wrap' }, watchCanvas, watchStatus),
    h('div', { class: 'actions' },
      h('span', { class: 'seg', role: 'group', 'aria-label': 'Playback speed' },
        h('button', { class: 'btn small toggle', 'aria-pressed': 'true', 'data-speed': '1', onclick: (e: Event) => setSpeed(1, e) }, '1×'),
        h('button', { class: 'btn small toggle', 'aria-pressed': 'false', 'data-speed': '4', onclick: (e: Event) => setSpeed(4, e) }, '4×'),
        h('button', { class: 'btn small', onclick: () => (watchSpeed = Infinity) }, 'Skip to the end')),
      h('button', { class: 'btn', onclick: () => watch() }, 'Watch again'),
      h('button', { class: 'btn', onclick: () => trained && download(new TextEncoder().encode(JSON.stringify(trained.bot, null, 1)), `${slug(trained.bot.meta.name)}.bot.json`) }, 'Download bot file'),
    ),
    h('h2', {}, 'Coach’s tips'), tipsEl,
    h('h2', {}, 'Race it on the leaderboard'), submitEl,
  );

  const el = h('main', { class: 'page train' },
    h('h1', {}, 'Teach a bot to drive like you'),
    h('p', { class: 'lead' }, 'Your bot is a small neural network. It learns by copying your driving: for every moment of your laps, it sees what the sensors saw and tries to do what you did.'),
    h('section', { class: 'card' },
      h('h2', {}, h('span', { class: 'step' }, '1'), ' Choose your driving data'),
      h('div', { class: 'toolbar' }, h('label', { for: 'train-track' }, 'Track '), trackSel,
        h('label', { class: 'check' }, allTracksCb, ' also use laps from other tracks')),
      dataSummary, lapList,
    ),
    h('section', { class: 'card' },
      h('h2', {}, h('span', { class: 'step' }, '2'), ' What can your bot sense?'),
      h('div', { class: 'two-col' }, h('div', { class: 'sensor-list' }, sensorBoxes), fan),
      h('p', { class: 'muted small' }, 'Each distance sensor reports how far the nearest wall is in that direction (0 = touching, 1 = 40 m or more). Fewer sensors make a harder but more interesting challenge.'),
    ),
    h('section', { class: 'card' },
      h('h2', {}, h('span', { class: 'step' }, '3'), ' How big is its brain?'),
      h('div', { class: 'toolbar' }, layersSel, neuronsSel, actSel),
      paramInfo, netCanvas,
    ),
    h('section', { class: 'card' },
      h('h2', {}, h('span', { class: 'step' }, '4'), ' How should it practise?'),
      h('div', { class: 'toolbar' },
        h('label', { for: 'epochs' }, 'Practice rounds (epochs) '), epochsIn, epochsOut,
        h('label', { for: 'lr' }, ' Learning rate '), lrSel),
      h('p', { class: 'muted small' }, 'More rounds = more practice (but it can start memorising). The learning rate is how big each nudge is: too big and it overshoots, too small and it learns slowly.'),
      advanced,
    ),
    h('div', { class: 'train-go' }, h('label', { for: 'bot-name' }, 'Bot name '), nameIn, recommendBtn, trainBtn),
    trainingPanel,
    resultPanel,
  );

  function loadSettings(): Settings {
    try {
      const s = JSON.parse(localStorage.getItem('rgp.trainer') ?? 'null');
      if (s && Array.isArray(s.inputs)) return { ...RECOMMENDED, ...s };
    } catch {
      /* ignore */
    }
    return { ...RECOMMENDED, inputs: [...RECOMMENDED.inputs] };
  }
  function saveSettings(): void {
    try {
      localStorage.setItem('rgp.trainer', JSON.stringify(settings));
    } catch {
      /* private mode */
    }
  }

  function applySettings(): void {
    for (const lbl of sensorBoxes) {
      const cb = lbl.querySelector('input')!;
      const n = cb.dataset.name!;
      cb.checked = n === 'surface' ? settings.inputs.includes('surf_snow') : settings.inputs.includes(n);
    }
    layersSel.value = String(settings.layers);
    neuronsSel.value = String(settings.neurons);
    actSel.value = settings.activation;
    epochsIn.value = String(settings.epochs);
    lrSel.value = String(settings.learningRate);
    mirrorCb.checked = settings.mirror;
  }

  function readInputs(): void {
    const names: string[] = [];
    for (const lbl of sensorBoxes) {
      const cb = lbl.querySelector('input')!;
      if (!cb.checked) continue;
      const n = cb.dataset.name!;
      if (n === 'surface') names.push('surf_snow', 'surf_ice', 'surf_rough');
      else names.push(n);
    }
    // Keep canonical order: rays, speed, lateral, surfaces.
    const order = [...RAYS, 'speed', 'lateral', 'surf_snow', 'surf_ice', 'surf_rough'];
    settings.inputs = order.filter((n) => names.includes(n));
  }

  function hidden(): number[] {
    return Array.from({ length: settings.layers }, () => settings.neurons);
  }

  function selectedLaps(): LapRecord[] {
    return laps.filter((l) => l.useForTraining && l.kind === 'human' && (allTracksCb.checked || l.trackId === track.id));
  }

  function refresh(): void {
    saveSettings();
    const sizes = [settings.inputs.length, ...hidden(), 2];
    const params = countParams(sizes.slice(0, -1).map((n, i) => ({ in: n, out: sizes[i + 1] })));
    const over = params > DEFAULT_LIMITS.paramCap;
    paramInfo.replaceChildren(
      `Your network has `, h('strong', {}, params.toLocaleString()), ` connections and biases to tune (the limit is ${DEFAULT_LIMITS.paramCap.toLocaleString()}).`,
      over ? h('strong', { class: 'error-text' }, ' Too big: use fewer neurons.') : '',
    );
    epochsOut.textContent = String(settings.epochs);
    const mirrorable = canMirror(settings.inputs, RAYS.length);
    mirrorCb.disabled = !mirrorable;
    mirrorNote.textContent = mirrorable ? '' : '(needs matching left and right sensors)';
    const sel = selectedLaps();
    const seconds = sel.reduce((s, l) => s + l.result.ticks / 60, 0);
    const moments = Math.round(seconds * 20) * (settings.mirror && mirrorable ? 2 : 1);
    dataSummary.replaceChildren(
      h('p', {}, h('strong', {}, `${sel.length} lap${sel.length === 1 ? '' : 's'}`), ` selected: about ${moments.toLocaleString()} moments to learn from.`,
        sel.length < 3 ? h('span', { class: 'warn-text' }, ' Aim for at least 3 clean laps.') : ''),
    );
    trainBtn.toggleAttribute('disabled', over || sel.length === 0 || settings.inputs.length === 0 || !!worker);
    drawNetwork(netCanvas, sizes, null, settings.inputs.map(shortName));
    drawFan();
  }

  function drawFan(): void {
    const ctx = fan.getContext('2d')!;
    ctx.clearRect(0, 0, 220, 120);
    const cx = 110;
    const cy = 108;
    DEFAULT_CONFIG.rayAnglesDeg.forEach((deg, i) => {
      const on = settings.inputs.includes(`ray${i}`);
      const a = (deg - 90) * (Math.PI / 180);
      ctx.strokeStyle = on ? '#1f8a5b' : '#c9d3de';
      ctx.lineWidth = on ? 3 : 1.5;
      ctx.setLineDash(on ? [] : [4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * 95, cy + Math.sin(a) * 95);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.fillStyle = '#b20d27';
    ctx.fillRect(cx - 8, cy - 12, 16, 22);
  }

  async function loadLaps(): Promise<void> {
    laps = (await listLaps()).filter((l) => l.kind === 'human');
    const here = laps.filter((l) => allTracksCb.checked || l.trackId === track.id);
    if (!here.length) {
      lapList.replaceChildren(h('p', {}, 'No laps on this track yet. ', h('a', { class: 'btn btn-primary', href: `#/drive/${track.id}` }, `Drive ${track.name}`)));
    } else {
      lapList.replaceChildren(
        h('p', { class: 'muted small' }, 'Tick the laps to learn from. Clean laps teach best; untick laps where you crashed.'),
        h('ul', { class: 'pick-list' },
          here.slice(0, 40).map((l) => {
            const cb = h('input', { type: 'checkbox', checked: l.useForTraining, onchange: async () => {
              l.useForTraining = cb.checked;
              const { updateLap } = await import('../store.js');
              await updateLap(l.id, { useForTraining: cb.checked });
              refresh();
            } });
            return h('li', {}, h('label', { class: 'check' }, cb,
              ` ${getTrack(l.trackId)?.name ?? l.trackId} · ${l.result.valid ? `${fmtTime(l.result.score)} s` : 'did not finish'} · ${l.result.collisions} wall hit${l.result.collisions === 1 ? '' : 's'} · ${fmtDate(l.createdAt)}`));
          }),
        ),
      );
    }
    refresh();
  }
  allTracksCb.addEventListener('change', () => loadLaps());

  function startTraining(): void {
    const sel = selectedLaps();
    if (!sel.length || worker) return;
    trainingPanel.hidden = false;
    resultPanel.hidden = true;
    trainBtn.setAttribute('disabled', '');
    trainBtn.textContent = 'Training…';
    const config: TrainConfig = { hidden: hidden(), activation: settings.activation, epochs: settings.epochs, learningRate: settings.learningRate, batchSize: 64, seed: 1 + 7919 * trainCount++, validation: 0.15 };
    const losses: number[] = [];
    const vals: (number | null)[] = [];
    const sizes = [settings.inputs.length, ...config.hidden, 2];
    let capIdx = 0;
    caption.textContent = 'Getting your laps ready…';
    const capTimer = setInterval(() => (caption.textContent = CAPTIONS[capIdx++ % CAPTIONS.length]), 2600);
    worker = new Worker('train-worker.js', { type: 'module' });
    const msg: TrainRequest = {
      type: 'train',
      laps: sel.map((l) => ({ trackId: l.trackId, bytes: l.bytes })),
      inputs: settings.inputs,
      config,
      mirror: settings.mirror && canMirror(settings.inputs, RAYS.length),
      botName: nameIn.value.trim() || 'My bot',
      level: 'elf',
    };
    worker.onmessage = (ev: MessageEvent<TrainMessage>) => {
      const m = ev.data;
      if (m.type === 'epoch') {
        losses.push(m.loss);
        vals.push(m.valLoss);
        progress.value = (100 * m.epoch) / m.epochs;
        drawLossCurve(lossCanvas, losses, vals, m.epochs);
        drawNetwork(liveNet, sizes, m.weights, settings.inputs.map(shortName));
      } else if (m.type === 'done') {
        finish();
        trained = { bot: m.bot, samples: m.samples, losses, valLosses: vals, laps: sel.length };
        caption.textContent = `Done: learned from ${m.samples.toLocaleString()} moments in ${(m.ms / 1000).toFixed(1)} s.`;
        showResult();
      } else if (m.type === 'error') {
        finish();
        caption.textContent = m.message;
        toast(m.message, 'error');
      }
    };
    worker.onerror = (e) => {
      finish();
      caption.textContent = `Training failed: ${e.message}`;
    };
    worker.postMessage(msg);
    function finish(): void {
      clearInterval(capTimer);
      worker?.terminate();
      worker = null;
      trainBtn.textContent = 'Train again';
      refresh();
    }
  }

  async function showResult(): Promise<void> {
    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    await watch();
    renderSubmit();
  }

  function setSpeed(v: number, e: Event): void {
    watchSpeed = v;
    const group = (e.currentTarget as HTMLElement).parentElement!;
    group.querySelectorAll('button[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(Number((b as HTMLElement).dataset.speed) === v)));
  }

  /** Re-run the exact evaluation, animated in real time with sensors and your best lap as a ghost. */
  async function watch(): Promise<void> {
    if (!trained) return;
    cancelAnimationFrame(raf);
    if (!Number.isFinite(watchSpeed)) watchSpeed = 1;
    const bot = trained.bot;
    const geo = geometry(track);
    const rep = evaluateBot(track, bot, {}, { geo });
    const official = rep.header.result;
    const best = await bestLap(track.id);
    let ghost: Frame[] | null = null;
    if (best) ghost = simulateReplay(track, await lapReplay(best), { geo, collectFrames: true }).frames;
    const g = new ReindeerGame(track, DEFAULT_CONFIG, geo);
    const policy = botPolicy(compileBot(bot));
    const renderer = new Renderer(watchCanvas);
    renderer.setTrack(track);
    let hitsLeft = 0;
    let hitsRight = 0;
    let lastCollisions = 0;
    let act: [number, number] = [0, 0];
    let acc = 0;
    let last = performance.now();
    const step = (now: number) => {
      if (disposed) return;
      acc += Number.isFinite(watchSpeed) ? Math.min(0.1, Math.max(0, now - last) / 1000) * watchSpeed : Infinity;
      last = now;
      while (acc >= 1 / 60 && !g.isDone()) {
        if (g.tick % 3 === 0) {
          const [s, t] = policy(g.observe());
          act = [quantise(s), quantise(t)];
        }
        g.step([act]);
        if (g.collisions > lastCollisions) {
          lastCollisions = g.collisions;
          const r = g.observe().rays;
          if (Math.min(r[0], r[1], r[2]) < Math.min(r[4], r[5], r[6])) hitsLeft++;
          else hitsRight++;
        }
        acc -= 1 / 60;
      }
      const o = g.observe();
      const sleighs = [];
      if (ghost) {
        const f = ghost[Math.min(g.tick, ghost.length - 1)];
        sleighs.push({ x: f.x, y: f.y, heading: f.heading, ghost: true, label: 'You' });
      }
      sleighs.push({ x: g.x, y: g.y, heading: g.heading, label: 'Bot' });
      renderer.draw({ x: g.x + Math.cos(g.heading) * 10, y: g.y + Math.sin(g.heading) * 10 }, {
        sleighs,
        rays: { x: g.x, y: g.y, heading: g.heading, anglesDeg: DEFAULT_CONFIG.rayAnglesDeg, values: o.rays, range: DEFAULT_CONFIG.rayRange },
      });
      watchStatus.textContent = `${fmtTime(g.tick / 60)} s · wall hits ${g.collisions}`;
      if (!g.isDone()) raf = requestAnimationFrame(step);
      else {
        watchStatus.textContent = official.valid
          ? `Finished: ${fmtTime(official.score)} s (${official.penalties} penalt${official.penalties === 1 ? 'y' : 'ies'})`
          : 'Did not finish within 2 minutes';
        renderTips(official.valid, official.collisions, hitsLeft, hitsRight, official.score, best?.result.score ?? null);
      }
    };
    raf = requestAnimationFrame(step);
  }

  function renderTips(finished: boolean, collisions: number, hitsLeft: number, hitsRight: number, score: number | null, humanBest: number | null): void {
    if (!trained) return;
    const tips = coachingTips({
      finished, collisions, hitsLeft, hitsRight,
      samples: trained.samples, laps: trained.laps,
      params: countParams(trained.bot.layers), hiddenLayers: trained.bot.layers.length - 1,
      lossHistory: trained.losses, trainLoss: trained.losses[trained.losses.length - 1] ?? 0,
      valLoss: trained.valLosses[trained.valLosses.length - 1] ?? null,
      mirror: settings.mirror, canMirror: canMirror(settings.inputs, RAYS.length),
      usesSpeed: settings.inputs.includes('speed'), rays: settings.inputs.filter((n) => n.startsWith('ray')).length,
      botScore: score, humanBest,
    });
    tipsEl.replaceChildren(...tips.map((t) => h('div', { class: `tip ${t.tone}` }, h('strong', {}, t.title), h('p', {}, t.text))));
  }

  async function renderSubmit(): Promise<void> {
    const me = await getMe();
    if (!me.user) {
      submitEl.replaceChildren(h('p', {}, 'Sign in with your Raven account to put your bot on the leaderboard. Your trained bot stays here while you do.'),
        h('a', { class: 'btn btn-primary', href: '#/signin?return=train' }, 'Sign in'));
      return;
    }
    if (!me.user.teamId) {
      submitEl.replaceChildren(h('p', {}, 'Create or join a team first (a team can be just you).'), h('a', { class: 'btn btn-primary', href: '#/team' }, 'Set up your team'));
      return;
    }
    const btn = h('button', { class: 'btn btn-primary big', onclick: () => submit(btn) }, 'Submit to the leaderboard');
    submitEl.replaceChildren(
      h('p', {}, `Your bot will race all ${TRACKS.length} practice tracks on the server. Your team can submit 20 bots a day; your best time on each track counts.`),
      btn,
    );
  }

  async function submit(btn: HTMLButtonElement): Promise<void> {
    if (!trained) return;
    btn.disabled = true;
    const status = h('ul', { class: 'sub-status' });
    submitEl.append(status);
    try {
      // Upload the laps it learned from so the server can check them (needed for the Beginner bracket).
      const used = selectedLaps();
      btn.textContent = `Uploading ${used.length} training lap${used.length === 1 ? '' : 's'}…`;
      for (const l of used) await api.upload(`/runs`, l.bytes).catch(() => undefined);
      btn.textContent = 'Submitting…';
      const r = await api.post<{ submissions: { id: string; trackId: string }[] }>('/submissions', { bot: trained.bot });
      btn.textContent = 'Submitted';
      await Promise.all(
        r.submissions.map(async (s) => {
          const li = h('li', {}, `${getTrack(s.trackId)?.name}: queued`);
          status.append(li);
          const done = await waitForSubmission(s.id, (x) => (li.textContent = `${getTrack(s.trackId)?.name}: ${statusText(x)}`));
          li.replaceChildren(`${getTrack(s.trackId)?.name}: ${statusText(done)} `,
            done.replayId ? h('a', { href: `#/replay/remote/${done.replayId}` }, 'watch') : '', ' ',
            h('a', { href: `#/boards/${s.trackId}/bots` }, 'leaderboard'));
        }),
      );
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Submit to the leaderboard';
      const msg = e instanceof ApiError && e.code === 'invalid_bot' ? `${e.message} ${(e.details.errors as string[]).join(' ')}` : e instanceof Error ? e.message : String(e);
      toast(msg, 'error');
    }
  }

  applySettings();
  loadLaps();
  requestAnimationFrame(() => refresh());
  return {
    el,
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      worker?.terminate();
    },
  };
}

export function statusText(s: Submission): string {
  if (s.status === 'queued') return 'waiting in the queue…';
  if (s.status === 'running') return 'racing on the server…';
  if (s.status === 'rejected') return `rejected: ${s.rejectReason}`;
  if (!s.result?.valid) return 'did not finish';
  return `${fmtTime(s.result.score)} s${s.result.beginner ? ' (Beginner bracket)' : ''}`;
}

function shortName(n: string): string {
  if (n.startsWith('ray')) return RAY_LABEL[Number(n.slice(3))];
  if (n.startsWith('surf_')) return n.slice(5);
  return n;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bot';
}

export { boardKey };
