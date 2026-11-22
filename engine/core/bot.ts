/**
 * Bot format "rgp-bot" v1: a small feed-forward network stored as JSON.
 * Weights only, never code, so the server never runs anything user-supplied.
 *
 * The SAME inference function runs in the trainer preview, the validator, the
 * server evaluation and (as a line-by-line port) the Python SDK, so "what you
 * watched is what gets scored".
 *
 * Deterministic inference rules:
 *   - float64 throughout;
 *   - each neuron: s = 0; for j in 0..in-1: s = s + w[j] * x[j]; then s = s + bias;
 *   - activations from engine/core/fmath.ts (ftanh, fsigmoid), relu = s > 0 ? s : 0;
 *   - outputs clamped to [-1, 1], then quantised to int8 like human input.
 */

import { ftanh, fsigmoid } from './fmath.js';
import { mulberry32 } from './quant.js';

export const BOT_FORMAT = 'rgp-bot';
export const BOT_VERSION = 1;

export type Activation = 'relu' | 'tanh' | 'sigmoid' | 'linear';
export const ACTIVATIONS: Activation[] = ['relu', 'tanh', 'sigmoid', 'linear'];

export interface DenseLayer {
  type: 'dense';
  in: number;
  out: number;
  activation: Activation;
  /** Row-major [out][in]. */
  weights: number[][];
  bias: number[];
}

export interface BotMeta {
  name: string;
  level?: 'elf' | 'reindeer' | 'santa';
  /** e.g. "imitation", "imitation+corrections", "neuroevolution", "rl" */
  method?: string;
  /** Which tool made it, e.g. "web-trainer-1". */
  trainer?: string;
  notes?: string;
  /** Free-form training summary (laps used, epochs...). Informational only. */
  training?: Record<string, unknown>;
}

export interface BotFile {
  format: typeof BOT_FORMAT;
  version: number;
  game: string;
  inputs: string[];
  outputs: string[];
  layers: DenseLayer[];
  meta: BotMeta;
}

export interface BotLimits {
  paramCap: number;
  maxInputs: number;
  maxLayers: number;
  maxWeight: number;
  /** Input names the current track and twist provide. */
  allowedInputs: string[];
}

export const DEFAULT_LIMITS: Omit<BotLimits, 'allowedInputs'> = {
  paramCap: 5000,
  maxInputs: 16,
  maxLayers: 6,
  maxWeight: 1000,
};

export interface CompiledLayer {
  in: number;
  out: number;
  act: Activation;
  /** Row-major weights, length out * in. */
  w: Float64Array;
  b: Float64Array;
}

export interface CompiledBot {
  inputs: string[];
  layers: CompiledLayer[];
  params: number;
}

export function countParams(layers: { in: number; out: number }[]): number {
  return layers.reduce((s, l) => s + l.in * l.out + l.out, 0);
}

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Validate a parsed bot file. Returns human-readable errors (empty = valid).
 * Messages are written for beginners: say what is wrong and what to do.
 */
export function validateBot(bot: unknown, limits: BotLimits): { errors: string[]; params: number } {
  const e: string[] = [];
  const b = bot as Partial<BotFile>;
  if (!b || typeof b !== 'object') return { errors: ['The bot file is not a JSON object.'], params: 0 };
  if (b.format !== BOT_FORMAT) e.push(`"format" must be "${BOT_FORMAT}".`);
  if (b.version !== BOT_VERSION) e.push(`"version" must be ${BOT_VERSION} (this server reads version ${BOT_VERSION} bots).`);
  if (b.game !== 'reindeer-gp') e.push('"game" must be "reindeer-gp".');
  if (!b.meta || typeof b.meta.name !== 'string' || !b.meta.name.trim()) e.push('Give your bot a name in meta.name.');
  else if (b.meta.name.length > 60) e.push('meta.name must be at most 60 characters.');

  const inputs = Array.isArray(b.inputs) ? b.inputs : null;
  if (!inputs || inputs.length === 0) e.push('"inputs" must list at least one sensor name, e.g. ["ray0", ..., "speed"].');
  else {
    if (inputs.length > limits.maxInputs) e.push(`Too many inputs: ${inputs.length} (the limit is ${limits.maxInputs}).`);
    const seen = new Set<string>();
    for (const n of inputs) {
      if (typeof n !== 'string' || !limits.allowedInputs.includes(n)) {
        e.push(`Unknown input "${n}". Available here: ${limits.allowedInputs.join(', ')}.`);
      } else if (seen.has(n)) e.push(`Input "${n}" is listed twice.`);
      seen.add(n);
    }
  }
  if (!Array.isArray(b.outputs) || b.outputs.length !== 2 || b.outputs[0] !== 'steer' || b.outputs[1] !== 'throttle') {
    e.push('"outputs" must be exactly ["steer", "throttle"].');
  }

  const layers = Array.isArray(b.layers) ? b.layers : null;
  let params = 0;
  if (!layers || layers.length === 0) e.push('The network needs at least one layer.');
  else {
    if (layers.length > limits.maxLayers) e.push(`Too many layers: ${layers.length} (the limit is ${limits.maxLayers}).`);
    let prevOut = inputs ? inputs.length : -1;
    layers.forEach((l, i) => {
      const n = i + 1;
      if (!l || l.type !== 'dense') {
        e.push(`Layer ${n}: only "dense" layers are supported in version 1.`);
        return;
      }
      if (!Number.isInteger(l.in) || !Number.isInteger(l.out) || l.in < 1 || l.out < 1 || l.in > 512 || l.out > 512) {
        e.push(`Layer ${n}: "in" and "out" must be whole numbers between 1 and 512.`);
        return;
      }
      if (prevOut >= 0 && l.in !== prevOut) {
        e.push(i === 0 ? `Layer 1 expects ${l.in} inputs but the bot lists ${prevOut} inputs.` : `Layer ${n} expects ${l.in} inputs but layer ${i} outputs ${prevOut}.`);
      }
      prevOut = l.out;
      if (!ACTIVATIONS.includes(l.activation)) e.push(`Layer ${n}: activation must be one of ${ACTIVATIONS.join(', ')}.`);
      params += l.in * l.out + l.out;
      if (!Array.isArray(l.weights) || l.weights.length !== l.out || l.weights.some((r) => !Array.isArray(r) || r.length !== l.in)) {
        e.push(`Layer ${n}: "weights" must be ${l.out} rows of ${l.in} numbers.`);
      } else if (l.weights.some((r) => r.some((w) => !isNum(w)))) e.push(`Layer ${n}: weights must all be finite numbers (no NaN or Infinity).`);
      else if (l.weights.some((r) => r.some((w) => Math.abs(w) > limits.maxWeight))) e.push(`Layer ${n}: a weight is larger than ${limits.maxWeight} in size.`);
      if (!Array.isArray(l.bias) || l.bias.length !== l.out) e.push(`Layer ${n}: "bias" must have ${l.out} numbers.`);
      else if (l.bias.some((w) => !isNum(w))) e.push(`Layer ${n}: biases must all be finite numbers.`);
      else if (l.bias.some((w) => Math.abs(w) > limits.maxWeight)) e.push(`Layer ${n}: a bias is larger than ${limits.maxWeight} in size.`);
    });
    if (prevOut !== 2) e.push(`The last layer must output 2 numbers (steer, throttle), not ${prevOut}.`);
    if (params > limits.paramCap) e.push(`The network has ${params} parameters; the limit is ${limits.paramCap}. Use fewer or smaller layers.`);
  }

  if (e.length === 0) {
    // Probe with random observations: the network must never produce NaN.
    const cb = compileBot(b as BotFile);
    const rand = mulberry32(20261201);
    const x = new Float64Array(cb.inputs.length);
    for (let k = 0; k < 256; k++) {
      for (let j = 0; j < x.length; j++) x[j] = rand();
      const y = forward(cb, x);
      if (!isNum(y[0]) || !isNum(y[1])) {
        e.push('The network produces NaN or Infinity for some sensor readings. Check for exploding weights.');
        break;
      }
    }
  }
  return { errors: e, params };
}

export function compileBot(bot: BotFile): CompiledBot {
  const layers = bot.layers.map((l) => {
    const w = new Float64Array(l.in * l.out);
    for (let o = 0; o < l.out; o++) for (let i = 0; i < l.in; i++) w[o * l.in + i] = l.weights[o][i];
    return { in: l.in, out: l.out, act: l.activation, w, b: Float64Array.from(l.bias) };
  });
  return { inputs: [...bot.inputs], layers, params: countParams(layers) };
}

function activate(s: number, act: Activation): number {
  if (act === 'relu') return s > 0 ? s : 0;
  if (act === 'tanh') return ftanh(s);
  if (act === 'sigmoid') return fsigmoid(s);
  return s;
}

/** Deterministic forward pass. Returns the raw final-layer outputs. */
export function forward(bot: CompiledBot, x: Float64Array): Float64Array {
  let cur = x;
  for (const l of bot.layers) {
    const next = new Float64Array(l.out);
    for (let o = 0; o < l.out; o++) {
      let s = 0;
      const base = o * l.in;
      for (let i = 0; i < l.in; i++) s = s + l.w[base + i] * cur[i];
      s = s + l.b[o];
      next[o] = activate(s, l.act);
    }
    cur = next;
  }
  return cur;
}

/**
 * Is this an architecture the in-browser trainer can produce? Used to keep the
 * Beginner bracket honest: at most 2 hidden layers of at most 64 neurons,
 * relu or tanh hidden activations, tanh output.
 */
export function isTrainerArchitecture(bot: BotFile): boolean {
  const L = bot.layers;
  if (L.length < 1 || L.length > 3) return false;
  for (let i = 0; i < L.length - 1; i++) {
    if (L[i].out > 64 || (L[i].activation !== 'relu' && L[i].activation !== 'tanh')) return false;
  }
  return L[L.length - 1].activation === 'tanh';
}
