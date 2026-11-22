/**
 * A small, readable multi-layer perceptron trainer (mean squared error + Adam).
 * Training does not need to be bit-for-bit deterministic across machines
 * (only inference does), but it is seeded so the same data gives the same bot
 * in the same browser.
 *
 * Written to be read: if you are curious how "training" works, this is it.
 */

import { BOT_FORMAT, BOT_VERSION, type Activation, type BotFile, type BotMeta } from '../../../engine/core/bot.js';
import { mulberry32 } from '../../../engine/core/quant.js';

export interface TrainConfig {
  hidden: number[];
  activation: 'relu' | 'tanh';
  epochs: number;
  learningRate: number;
  batchSize: number;
  seed: number;
  /** Fraction of samples held out to measure generalisation (0 = none). */
  validation: number;
}

export interface Dataset {
  inputs: string[];
  /** n rows of inputs.length values. */
  x: Float64Array;
  /** n rows of 2 targets (steer, throttle) in [-1, 1]. */
  y: Float64Array;
  n: number;
}

interface Layer {
  in: number;
  out: number;
  act: Activation;
  w: Float64Array;
  b: Float64Array;
  // Adam moments
  mw: Float64Array;
  vw: Float64Array;
  mb: Float64Array;
  vb: Float64Array;
  // gradients
  gw: Float64Array;
  gb: Float64Array;
}

export interface EpochReport {
  epoch: number;
  loss: number;
  valLoss: number | null;
  /** Current weights, for the network animation. */
  weights: Float64Array[];
}

export class Trainer {
  readonly layers: Layer[];
  private rand: () => number;
  private t = 0;

  constructor(readonly inputs: string[], readonly cfg: TrainConfig) {
    this.rand = mulberry32(cfg.seed);
    const sizes = [inputs.length, ...cfg.hidden, 2];
    this.layers = [];
    for (let i = 0; i < sizes.length - 1; i++) {
      const fanIn = sizes[i];
      const out = sizes[i + 1];
      const last = i === sizes.length - 2;
      const act: Activation = last ? 'tanh' : cfg.activation;
      // He initialisation for relu, Xavier for tanh.
      const scale = act === 'relu' ? Math.sqrt(2 / fanIn) : Math.sqrt(1 / fanIn);
      const w = new Float64Array(fanIn * out);
      for (let k = 0; k < w.length; k++) w[k] = this.gauss() * scale;
      const z = () => new Float64Array(fanIn * out);
      const zb = () => new Float64Array(out);
      this.layers.push({ in: fanIn, out, act, w, b: zb(), mw: z(), vw: z(), mb: zb(), vb: zb(), gw: z(), gb: zb() });
    }
  }

  private gauss(): number {
    const u = Math.max(1e-12, this.rand());
    const v = this.rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Forward pass keeping every layer's activations (needed for backprop). */
  private forwardAll(x: Float64Array): Float64Array[] {
    const acts = [x];
    let cur = x;
    for (const l of this.layers) {
      const next = new Float64Array(l.out);
      for (let o = 0; o < l.out; o++) {
        let s = 0;
        const base = o * l.in;
        for (let i = 0; i < l.in; i++) s += l.w[base + i] * cur[i];
        s += l.b[o];
        next[o] = l.act === 'relu' ? (s > 0 ? s : 0) : l.act === 'tanh' ? Math.tanh(s) : l.act === 'sigmoid' ? 1 / (1 + Math.exp(-s)) : s;
      }
      acts.push(next);
      cur = next;
    }
    return acts;
  }

  predict(x: Float64Array): Float64Array {
    const a = this.forwardAll(x);
    return a[a.length - 1];
  }

  /** Backpropagate one sample's error, accumulating gradients. Returns its squared error. */
  private backprop(x: Float64Array, y: Float64Array, yOff: number): number {
    const acts = this.forwardAll(x);
    const out = acts[acts.length - 1];
    // dLoss/dOutput for mean squared error over the 2 outputs.
    let delta = new Float64Array(2);
    let err = 0;
    for (let k = 0; k < 2; k++) {
      const d = out[k] - y[yOff + k];
      err += d * d;
      delta[k] = d;
    }
    for (let li = this.layers.length - 1; li >= 0; li--) {
      const l = this.layers[li];
      const a = acts[li + 1];
      const prev = acts[li];
      // Through the activation function.
      for (let o = 0; o < l.out; o++) {
        const v = a[o];
        const dAct = l.act === 'relu' ? (v > 0 ? 1 : 0) : l.act === 'tanh' ? 1 - v * v : l.act === 'sigmoid' ? v * (1 - v) : 1;
        delta[o] *= dAct;
      }
      const back = new Float64Array(l.in);
      for (let o = 0; o < l.out; o++) {
        const d = delta[o];
        if (d === 0) continue;
        const base = o * l.in;
        for (let i = 0; i < l.in; i++) {
          l.gw[base + i] += d * prev[i];
          back[i] += d * l.w[base + i];
        }
        l.gb[o] += d;
      }
      delta = back;
    }
    return err / 2;
  }

  /** One Adam step using the accumulated gradients averaged over `count` samples. */
  private step(count: number): void {
    const { learningRate: lr } = this.cfg;
    const b1 = 0.9;
    const b2 = 0.999;
    const eps = 1e-8;
    this.t++;
    const c1 = 1 - Math.pow(b1, this.t);
    const c2 = 1 - Math.pow(b2, this.t);
    for (const l of this.layers) {
      const upd = (p: Float64Array, g: Float64Array, m: Float64Array, v: Float64Array) => {
        for (let k = 0; k < p.length; k++) {
          const gk = g[k] / count;
          m[k] = b1 * m[k] + (1 - b1) * gk;
          v[k] = b2 * v[k] + (1 - b2) * gk * gk;
          p[k] -= (lr * (m[k] / c1)) / (Math.sqrt(v[k] / c2) + eps);
          g[k] = 0;
        }
      };
      upd(l.w, l.gw, l.mw, l.vw);
      upd(l.b, l.gb, l.mb, l.vb);
    }
  }

  /** Mean squared error on a set of rows. */
  loss(d: Dataset, rows: Uint32Array): number {
    let s = 0;
    const dim = d.inputs.length;
    for (const r of rows) {
      const p = this.predict(d.x.subarray(r * dim, (r + 1) * dim));
      for (let k = 0; k < 2; k++) {
        const e = p[k] - d.y[r * 2 + k];
        s += e * e;
      }
    }
    return rows.length ? s / (2 * rows.length) : 0;
  }

  /** Split rows into training and validation sets (deterministically shuffled). */
  split(d: Dataset): { train: Uint32Array; val: Uint32Array } {
    const idx = Uint32Array.from({ length: d.n }, (_, i) => i);
    this.shuffle(idx);
    const nVal = Math.floor(d.n * this.cfg.validation);
    return { val: idx.slice(0, nVal), train: idx.slice(nVal) };
  }

  private shuffle(a: Uint32Array): void {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
  }

  /** Run one epoch over the training rows. Returns the average training loss. */
  epoch(d: Dataset, train: Uint32Array): number {
    this.shuffle(train);
    const dim = d.inputs.length;
    const bs = this.cfg.batchSize;
    let total = 0;
    for (let s = 0; s < train.length; s += bs) {
      const end = Math.min(train.length, s + bs);
      for (let k = s; k < end; k++) {
        const r = train[k];
        total += this.backprop(d.x.subarray(r * dim, (r + 1) * dim), d.y, r * 2);
      }
      this.step(end - s);
    }
    return total / Math.max(1, train.length);
  }

  weightsSnapshot(): Float64Array[] {
    return this.layers.map((l) => Float64Array.from(l.w));
  }

  toBotFile(meta: BotMeta): BotFile {
    return {
      format: BOT_FORMAT,
      version: BOT_VERSION,
      game: 'reindeer-gp',
      inputs: [...this.inputs],
      outputs: ['steer', 'throttle'],
      layers: this.layers.map((l) => ({
        type: 'dense' as const,
        in: l.in,
        out: l.out,
        activation: l.act,
        weights: Array.from({ length: l.out }, (_, o) => Array.from(l.w.subarray(o * l.in, (o + 1) * l.in), round)),
        bias: Array.from(l.b, round),
      })),
      meta,
    };
  }
}

/** Keep files readable: 7 significant digits is far more than a tiny net needs. */
function round(v: number): number {
  return Number(v.toPrecision(7));
}
