/**
 * Local lap storage in IndexedDB. Every finished run is saved here the moment
 * it ends, so nothing is lost if the network drops. Saving to an account
 * arrives in M2.
 */

import { decodeReplay, type Replay, type ReplayResult } from '../../engine/core/replay.js';

export interface LapRecord {
  id: string;
  trackId: string;
  trackVersion: string;
  engineVersion: string;
  createdAt: string;
  kind: 'human' | 'bot';
  name: string;
  result: ReplayResult;
  /** Encoded .rgpr bytes. */
  bytes: Uint8Array;
  useForTraining: boolean;
  /** True if this lap was imported from a file rather than driven here. */
  imported?: boolean;
}

const DB = 'reindeer-gp';
const STORE = 'laps';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('trackId', 'trackId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(r.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export function newId(): string {
  const t = Date.now().toString(36);
  const r = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join('');
  return `${t}-${r}`;
}

export const saveLap = (lap: LapRecord) => tx('readwrite', (s) => s.put(lap)).then(() => lap);
export const getLap = (id: string) => tx<LapRecord | undefined>('readonly', (s) => s.get(id));
export const deleteLap = (id: string) => tx('readwrite', (s) => s.delete(id)).then(() => undefined);

export async function listLaps(trackId?: string): Promise<LapRecord[]> {
  const all = await tx<LapRecord[]>('readonly', (s) => (trackId ? s.index('trackId').getAll(trackId) : s.getAll()));
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function updateLap(id: string, patch: Partial<LapRecord>): Promise<void> {
  const lap = await getLap(id);
  if (lap) await saveLap({ ...lap, ...patch });
}

/** The fastest valid human lap on a track, or null. */
export async function bestLap(trackId: string): Promise<LapRecord | null> {
  const laps = (await listLaps(trackId)).filter((l) => l.result.valid && l.kind === 'human' && l.result.score !== null);
  laps.sort((a, b) => (a.result.score as number) - (b.result.score as number));
  return laps[0] ?? null;
}

export async function lapReplay(lap: LapRecord): Promise<Replay> {
  return decodeReplay(lap.bytes);
}

/** Plain-language advice about whether a lap is good training data. */
export function qualityHint(lap: LapRecord, best: LapRecord | null): string | null {
  const r = lap.result;
  if (!r.valid) return "This run didn't finish a lap, so it won't teach your bot the whole track.";
  if (r.collisions >= 3) return `You hit the wall ${r.collisions} times in this lap. Consider leaving it out of training.`;
  if (best && best.id !== lap.id && best.result.score && r.score && r.score > best.result.score * 1.5) {
    return 'Much slower than your best. Fine to keep if it was smooth, but your bot will copy the slow bits too.';
  }
  return null;
}

/** Sensible default: use clean, finished laps for training. */
export function defaultUseForTraining(r: ReplayResult): boolean {
  return r.valid && r.collisions < 3;
}
