/**
 * Personal API tokens for the command line and notebooks. A token can only do
 * what a bot workflow needs (submit, check results); everything else, such as
 * team management, account deletion and referee tools, needs the website.
 */

import { audit } from './audit.js';
import { requireUser } from './auth.js';
import type { Env } from './env.js';
import { HttpError, bad, json, notFound, readJson } from './http.js';
import { newId, nowIso, randomToken, sha256 } from './util.js';

export const TOKEN_PREFIX = 'rgp_';
const MAX_ACTIVE = 5;

/** "METHOD /path" patterns a token may call. */
const TOKEN_ROUTES: [string, RegExp][] = [
  ['GET', /^\/api\/v1\/me$/],
  ['GET', /^\/api\/v1\/teams\/mine$/],
  ['POST', /^\/api\/v1\/bots\/validate$/],
  ['POST', /^\/api\/v1\/submissions$/],
  ['GET', /^\/api\/v1\/submissions(\/[^/]+)?$/],
  ['POST', /^\/api\/v1\/runs$/],
  ['GET', /^\/api\/v1\/runs\/count$/],
  ['GET', /^\/api\/v1\/boards(\/.*)?$/],
  ['GET', /^\/api\/v1\/twists(\/[^/]+)?$/],
  ['GET', /^\/api\/v1\/(standings|digest\.md)$/],
  ['GET', /^\/api\/v1\/replays\/[^/]+(\/file)?$/],
];

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization');
  const m = h ? /^Bearer\s+(\S+)$/i.exec(h) : null;
  return m ? m[1] : null;
}

/** Throws unless this request may be made with an API token. */
export function checkTokenRoute(req: Request): void {
  const path = new URL(req.url).pathname;
  if (!TOKEN_ROUTES.some(([m, re]) => m === req.method && re.test(path))) {
    throw new HttpError(403, 'token_not_allowed', 'API tokens can only submit bots and read results. Use the website for this.');
  }
}

export async function userIdForToken(env: Env, token: string): Promise<string | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare('SELECT id, user_id FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL').bind(hash).first<{ id: string; user_id: string }>();
  if (!row) return null;
  await env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(nowIso(), row.id).run();
  return row.user_id;
}

/** GET /api/v1/me/tokens */
export async function listTokens(env: Env, req: Request): Promise<Response> {
  const u = await requireUser(env, req);
  const r = await env.DB.prepare('SELECT id, label, created_at, last_used_at FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC')
    .bind(u.id)
    .all<{ id: string; label: string; created_at: string; last_used_at: string | null }>();
  return json({ tokens: r.results.map((t) => ({ id: t.id, label: t.label, createdAt: t.created_at, lastUsedAt: t.last_used_at })) });
}

/** POST /api/v1/me/tokens {label} — the token is shown once, never stored in plain text. */
export async function createToken(env: Env, req: Request): Promise<Response> {
  const u = await requireUser(env, req);
  const { label } = await readJson<{ label?: string }>(req);
  const l = typeof label === 'string' ? label.trim() : '';
  if (l.length < 1 || l.length > 40) throw bad('Give the token a short label (1-40 characters), e.g. "my laptop".');
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL').bind(u.id).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_ACTIVE) throw new HttpError(409, 'too_many_tokens', `You already have ${MAX_ACTIVE} tokens. Revoke one first.`);
  const token = `${TOKEN_PREFIX}${randomToken(24)}`;
  const id = newId('k_');
  await env.DB.prepare("INSERT INTO api_tokens (id, user_id, token_hash, label, scopes, created_at) VALUES (?, ?, ?, ?, 'submit', ?)")
    .bind(id, u.id, await sha256(token), l, nowIso())
    .run();
  await audit(env, u.id, 'token.create', id, { label: l });
  return json({ id, label: l, token }, 201);
}

/** DELETE /api/v1/me/tokens/:id */
export async function revokeToken(env: Env, req: Request, id: string): Promise<Response> {
  const u = await requireUser(env, req);
  const r = await env.DB.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').bind(nowIso(), id, u.id).run();
  if (!r.meta.changes) throw notFound('That token');
  await audit(env, u.id, 'token.revoke', id);
  return json({ ok: true });
}
