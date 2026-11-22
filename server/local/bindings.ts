/**
 * Local stand-ins for Cloudflare bindings, so the real Worker code runs in
 * plain Node for tests and `npm run dev:server` without any Cloudflare tools.
 *   D1  -> node:sqlite (same SQLite dialect)
 *   R2  -> a Map in memory, or files in a folder
 *   Durable Object Evaluator -> processQueue() run in-process
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { D1Like, D1Statement, Env, EvaluatorNamespace, R2Like, R2ObjectLike } from '../src/env.js';
import { processQueue } from '../src/evaluate.js';

class Stmt implements D1Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private values: unknown[] = [],
  ) {}
  private prepared(): StatementSync {
    return this.db.prepare(this.sql);
  }
  private vals(): (string | number | null | Uint8Array)[] {
    return this.values.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null)));
  }
  bind(...values: unknown[]): D1Statement {
    return new Stmt(this.db, this.sql, values);
  }
  async first<T>(): Promise<T | null> {
    const r = this.prepared().get(...this.vals());
    return (r ? { ...r } : null) as T | null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.prepared().all(...this.vals()).map((r) => ({ ...r })) as T[] };
  }
  async run() {
    const r = this.prepared().run(...this.vals());
    return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  /** Used by batch(). */
  runSync(): void {
    this.prepared().run(...this.vals());
  }
}

export class LocalD1 implements D1Like {
  readonly db: DatabaseSync;
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON');
  }
  prepare(sql: string): D1Statement {
    return new Stmt(this.db, sql);
  }
  /** Like D1, a batch is one transaction: all statements succeed or none do. */
  async batch(statements: D1Statement[]): Promise<unknown[]> {
    this.db.exec('BEGIN');
    try {
      for (const s of statements) (s as Stmt).runSync();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return statements.map(() => ({}));
  }
  /** Apply every migration in order (wrangler tracks these in production). */
  migrate(dir: string): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)');
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (this.db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(f)) continue;
      this.db.exec(readFileSync(join(dir, f), 'utf8'));
      this.db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(f);
    }
  }
}

export class LocalR2 implements R2Like {
  private mem = new Map<string, { data: Uint8Array; type?: string }>();
  constructor(private dir?: string) {}
  private path(key: string): string {
    return join(this.dir!, key.replace(/\.\./g, '_'));
  }
  async get(key: string): Promise<R2ObjectLike | null> {
    let item = this.mem.get(key);
    if (!item && this.dir && existsSync(this.path(key))) item = { data: new Uint8Array(readFileSync(this.path(key))) };
    if (!item) return null;
    const data = item.data;
    return { arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, httpMetadata: { contentType: item.type } };
  }
  async put(key: string, value: ArrayBuffer | Uint8Array | string, opts?: { httpMetadata?: { contentType?: string } }) {
    const data = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Uint8Array ? Uint8Array.from(value) : new Uint8Array(value.slice(0));
    if (this.dir) {
      mkdirSync(dirname(this.path(key)), { recursive: true });
      writeFileSync(this.path(key), data);
    } else this.mem.set(key, { data, type: opts?.httpMetadata?.contentType });
    return {};
  }
  async delete(key: string) {
    this.mem.delete(key);
    if (this.dir) rmSync(this.path(key), { force: true });
  }
}

/**
 * In-process Evaluator. Like the real Durable Object, it runs one queue pass
 * at a time, after the request that woke it has been answered.
 */
export class LocalEvaluator implements EvaluatorNamespace {
  env!: Env;
  private running: Promise<void> | null = null;
  private again = false;
  /** Resolves when the queue is empty (tests await this). */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }
  idFromName(name: string) {
    return name;
  }
  get() {
    return {
      fetch: async () => {
        this.wake();
        return new Response('ok');
      },
    };
  }
  wake(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = (async () => {
      await new Promise((r) => setTimeout(r, 0));
      do {
        this.again = false;
        while (await processQueue(this.env, { deadline: Date.now() + 20_000 }));
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
  }
}

export interface LocalEnvOptions {
  dbPath?: string;
  blobDir?: string;
  vars?: Partial<Env>;
}

export function localEnv(opts: LocalEnvOptions = {}): Env & { EVALUATOR: LocalEvaluator; DB: LocalD1 } {
  const db = new LocalD1(opts.dbPath ?? ':memory:');
  db.migrate(join(dirname(new URL(import.meta.url).pathname), '..', 'migrations'));
  const evaluator = new LocalEvaluator();
  const env = {
    DB: db,
    // Like production's default, keep files in the database unless a folder is given.
    ...(opts.blobDir ? { BLOBS: new LocalR2(opts.blobDir) } : {}),
    EVALUATOR: evaluator,
    APP_ENV: 'local',
    SESSION_SECRET: 'local-dev-secret-not-for-production',
    ALLOWED_DOMAIN: 'cam.ac.uk',
    DEV_LOGIN: 'true',
    ...opts.vars,
  } as Env & { EVALUATOR: LocalEvaluator; DB: LocalD1 };
  evaluator.env = env;
  return env;
}
