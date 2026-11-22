/**
 * File storage: an R2 bucket if one is bound as BLOBS, otherwise the D1
 * database itself (table "blobs"). Files here are small (a replay is ~3 KB,
 * a bot up to 200 KB), well within D1's 2 MB row limit.
 */

import type { D1Like, Env, R2Like, R2ObjectLike } from './env.js';

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class D1Blobs implements R2Like {
  constructor(private db: D1Like) {}

  async get(key: string): Promise<R2ObjectLike | null> {
    const r = await this.db.prepare('SELECT data_b64, content_type FROM blobs WHERE key = ?').bind(key).first<{ data_b64: string; content_type: string | null }>();
    if (!r) return null;
    const bytes = fromB64(r.data_b64);
    return {
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      httpMetadata: { contentType: r.content_type ?? undefined },
    };
  }

  async put(key: string, value: ArrayBuffer | Uint8Array | string, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown> {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value);
    await this.db
      .prepare('INSERT OR REPLACE INTO blobs (key, data_b64, content_type, created_at) VALUES (?, ?, ?, ?)')
      .bind(key, toB64(bytes), opts?.httpMetadata?.contentType ?? null, new Date().toISOString())
      .run();
    return {};
  }

  async delete(key: string): Promise<void> {
    await this.db.prepare('DELETE FROM blobs WHERE key = ?').bind(key).run();
  }
}

const cache = new WeakMap<object, R2Like>();

export function blobs(env: Env): R2Like {
  if (env.BLOBS) return env.BLOBS;
  let b = cache.get(env.DB);
  if (!b) cache.set(env.DB, (b = new D1Blobs(env.DB)));
  return b;
}
