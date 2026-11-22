/**
 * Web Worker that trains the network off the main thread, so the page stays
 * smooth and can animate progress. Messages:
 *   in:  { type: 'train', laps: {trackId, bytes}[], inputs, config, mirror, botName, level }
 *   out: { type: 'data', samples }  { type: 'epoch', ... }  { type: 'done', bot, ... }  { type: 'error', message }
 */

import { decodeReplay } from '../../../engine/core/replay.js';
import type { BotFile } from '../../../engine/core/bot.js';
import { buildDataset, type LapSource } from './data.js';
import { Trainer, type TrainConfig } from './mlp.js';
import type { EngineConfig } from '../../../engine/reindeer/config.js';
import type { TrackDef } from '../../../engine/reindeer/track.js';

export interface TrainRequest {
  type: 'train';
  laps: { trackId: string; bytes: Uint8Array }[];
  /** Track and physics config of every course the laps were driven on (twists change both). */
  courses: Record<string, { track: TrackDef; cfg: EngineConfig }>;
  /** The sensors the bot will have (the selected course's rays). Rays never affect physics,
   *  so laps driven anywhere can be re-read with these, e.g. daylight laps for a night bot. */
  sensors: { rayAnglesDeg: number[]; rayRange: number };
  inputs: string[];
  config: TrainConfig;
  mirror: boolean;
  botName: string;
  level: 'elf' | 'reindeer' | 'santa';
}

export type TrainMessage =
  | { type: 'data'; samples: number; laps: number }
  | { type: 'epoch'; epoch: number; epochs: number; loss: number; valLoss: number | null; weights: Float64Array[] }
  | { type: 'done'; bot: BotFile; finalLoss: number; finalValLoss: number | null; samples: number; ms: number }
  | { type: 'error'; message: string };

const post = (m: TrainMessage) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (ev: MessageEvent<TrainRequest>) => {
  const req = ev.data;
  if (req.type !== 'train') return;
  try {
    const t0 = performance.now();
    const sources: LapSource[] = [];
    for (const l of req.laps) {
      const c = req.courses[l.trackId];
      if (!c) continue;
      const cfg = { ...c.cfg, rayAnglesDeg: req.sensors.rayAnglesDeg, rayRange: req.sensors.rayRange };
      sources.push({ track: c.track, cfg, replay: await decodeReplay(l.bytes) });
    }
    const data = buildDataset(sources, req.inputs, { mirror: req.mirror, rayCount: req.sensors.rayAnglesDeg.length });
    post({ type: 'data', samples: data.n, laps: sources.length });
    if (data.n < 20) throw new Error('There is not enough driving data. Drive a few laps first.');
    const tr = new Trainer(req.inputs, req.config);
    const { train, val } = tr.split(data);
    let loss = 0;
    let valLoss: number | null = null;
    for (let e = 1; e <= req.config.epochs; e++) {
      loss = tr.epoch(data, train);
      valLoss = val.length ? tr.loss(data, val) : null;
      post({ type: 'epoch', epoch: e, epochs: req.config.epochs, loss, valLoss, weights: tr.weightsSnapshot() });
      // Yield so messages flush and the animation can keep up.
      await new Promise((r) => setTimeout(r, 0));
    }
    const bot = tr.toBotFile({
      name: req.botName,
      level: req.level,
      method: 'imitation',
      trainer: 'web-trainer-1',
      training: {
        laps: sources.length,
        samples: data.n,
        epochs: req.config.epochs,
        learningRate: req.config.learningRate,
        hidden: req.config.hidden,
        activation: req.config.activation,
        mirror: req.mirror,
      },
    });
    post({ type: 'done', bot, finalLoss: loss, finalValLoss: valLoss, samples: data.n, ms: performance.now() - t0 });
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
