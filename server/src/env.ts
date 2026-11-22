/**
 * The bindings and settings a Worker receives. The same shapes are provided by
 * Cloudflare in production and by server/local/ when running in plain Node, so
 * every part of the server can be tested without Cloudflare tooling.
 */

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
}
export interface D1RunResult {
  meta: { changes: number; last_row_id: number };
}
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1RunResult>;
}
export interface D1Like {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
}

export interface R2ObjectLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
}
export interface R2Like {
  get(key: string): Promise<R2ObjectLike | null>;
  put(key: string, value: ArrayBuffer | Uint8Array | string, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(key: string): Promise<void>;
}

/** Just enough of a Durable Object namespace to wake the Evaluator. */
export interface EvaluatorNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
}

export interface AssetsLike {
  fetch(req: Request): Promise<Response>;
}

export interface Env {
  DB: D1Like;
  BLOBS: R2Like;
  EVALUATOR: EvaluatorNamespace;
  ASSETS?: AssetsLike;
  /** "production", "staging" or "local". */
  APP_ENV: string;
  /** Google OAuth client for Raven OAuth2. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Random secret used to sign the short-lived sign-in state cookie. */
  SESSION_SECRET: string;
  /** Email domain allowed to sign in (default cam.ac.uk). */
  ALLOWED_DOMAIN?: string;
  /** Comma-separated referee emails. */
  REFEREE_EMAILS?: string;
  /** "true" enables a password-less sign-in for automated tests. Refused when APP_ENV is production. */
  DEV_LOGIN?: string;
  /** If set, test sign-in also needs this value in an x-dev-login-key header (use on staging). */
  DEV_LOGIN_KEY?: string;
}

export const SEASON = 's1';
