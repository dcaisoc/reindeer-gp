/**
 * Replay format "rgp-replay" v1.
 *
 * A replay stores INPUTS, not positions. Positions are recomputed by
 * re-simulating, so files are tiny (about 1-3 KB per lap) and any tampering
 * shows up as a hash mismatch.
 *
 * Binary layout (.rgpr):
 *   bytes 0-3   ASCII "RGPR"
 *   byte  4     format version (1)
 *   bytes 5..   zlib/deflate-compressed payload:
 *                 uint32 LE  header length N
 *                 N bytes    UTF-8 JSON header (ReplayHeader)
 *                 rest       action stream: int8 pairs (steer, throttle), one per decision
 *
 * The JSON twin (ReplayJson) has the same header plus `actions` as [[steer, throttle], ...].
 */

export const REPLAY_FORMAT = 'rgp-replay';
export const REPLAY_VERSION = 1;

export interface ReplayParticipant {
  kind: 'human' | 'bot';
  name?: string;
  teamId?: string;
  botId?: string;
  /** Driving assists used (e.g. "slow-50", "auto-throttle"). They never change physics. */
  assist?: string[];
}

export interface ReplayResult {
  valid: boolean;
  score: number | null; // null when invalid (JSON has no Infinity)
  ticks: number;
  penalties: number;
  collisions: number;
}

export interface ReplayHeader {
  format: typeof REPLAY_FORMAT;
  version: number;
  game: string;
  engineVersion: string;
  track: { id: string; version: string };
  twist: { id: string; version: string } | null;
  seed: number;
  /** How many physics ticks each recorded action is held for (1 = human at 60 Hz, 3 = bot at 20 Hz). */
  ticksPerAction: number;
  participants: ReplayParticipant[];
  result: ReplayResult;
  /** State hash every 60 ticks (index 0 = tick 60). */
  hashes: string[];
  finalHash: string;
  createdAt: string;
}

export interface Replay {
  header: ReplayHeader;
  /** Interleaved int8 pairs: [steer0, throttle0, steer1, throttle1, ...]. */
  actions: Int8Array;
}

export interface ReplayJson extends ReplayHeader {
  actions: [number, number][];
}

const MAGIC = [0x52, 0x47, 0x50, 0x52]; // "RGPR"

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const blob = new Blob([data as BlobPart]);
  const out = await new Response(blob.stream().pipeThrough(stream as TransformStream<Uint8Array, Uint8Array>)).arrayBuffer();
  return new Uint8Array(out);
}

export async function encodeReplay(r: Replay): Promise<Uint8Array> {
  const headerBytes = new TextEncoder().encode(JSON.stringify(r.header));
  const payload = new Uint8Array(4 + headerBytes.length + r.actions.length);
  new DataView(payload.buffer).setUint32(0, headerBytes.length, true);
  payload.set(headerBytes, 4);
  payload.set(new Uint8Array(r.actions.buffer, r.actions.byteOffset, r.actions.length), 4 + headerBytes.length);
  const compressed = await pipe(payload, new CompressionStream('deflate'));
  const out = new Uint8Array(5 + compressed.length);
  out.set(MAGIC, 0);
  out[4] = REPLAY_VERSION;
  out.set(compressed, 5);
  return out;
}

export class ReplayFormatError extends Error {}

export async function decodeReplay(bytes: Uint8Array): Promise<Replay> {
  if (bytes.length < 6 || MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new ReplayFormatError('Not a Reindeer Grand Prix replay file (missing RGPR header).');
  }
  if (bytes[4] !== REPLAY_VERSION) {
    throw new ReplayFormatError(`Replay format version ${bytes[4]} is not supported by this app (expects ${REPLAY_VERSION}).`);
  }
  let payload: Uint8Array;
  try {
    payload = await pipe(bytes.subarray(5), new DecompressionStream('deflate'));
  } catch {
    throw new ReplayFormatError('Replay file is corrupted (could not decompress).');
  }
  if (payload.length < 4) throw new ReplayFormatError('Replay file is truncated.');
  const n = new DataView(payload.buffer, payload.byteOffset).getUint32(0, true);
  if (4 + n > payload.length) throw new ReplayFormatError('Replay header length is wrong.');
  let header: ReplayHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(payload.subarray(4, 4 + n)));
  } catch {
    throw new ReplayFormatError('Replay header is not valid JSON.');
  }
  validateHeader(header);
  const actionBytes = payload.subarray(4 + n);
  if (actionBytes.length % 2 !== 0) throw new ReplayFormatError('Replay action stream has an odd length.');
  const actions = new Int8Array(actionBytes.length);
  actions.set(new Int8Array(actionBytes.buffer, actionBytes.byteOffset, actionBytes.length));
  return { header, actions };
}

function validateHeader(h: ReplayHeader): void {
  if (!h || h.format !== REPLAY_FORMAT) throw new ReplayFormatError('Replay header has the wrong format name.');
  if (h.version !== REPLAY_VERSION) throw new ReplayFormatError('Replay header has an unsupported version.');
  if (!h.track || typeof h.track.id !== 'string') throw new ReplayFormatError('Replay header has no track.');
  if (!Number.isInteger(h.ticksPerAction) || h.ticksPerAction < 1 || h.ticksPerAction > 60) {
    throw new ReplayFormatError('Replay header has an invalid ticksPerAction.');
  }
}

export function replayToJson(r: Replay): ReplayJson {
  const actions: [number, number][] = [];
  for (let i = 0; i < r.actions.length; i += 2) actions.push([r.actions[i], r.actions[i + 1]]);
  return { ...r.header, actions };
}

export function replayFromJson(j: ReplayJson): Replay {
  const { actions, ...header } = j;
  validateHeader(header as ReplayHeader);
  const a = new Int8Array(actions.length * 2);
  actions.forEach(([s, t], i) => {
    a[2 * i] = s;
    a[2 * i + 1] = t;
  });
  return { header: header as ReplayHeader, actions: a };
}
