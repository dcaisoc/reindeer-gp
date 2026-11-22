/**
 * Sign-in with Raven OAuth2 (Google sign-in restricted to @cam.ac.uk, see
 * https://docs.raven.cam.ac.uk/en/latest/raven-oauth2/), sessions, and account
 * deletion.
 *
 * The ID token is received directly from Google's token endpoint over TLS in
 * exchange for our client secret, so (per OpenID Connect Core 3.1.3.7) its
 * claims are checked but its signature is not re-verified.
 */

import type { Env } from './env.js';
import { HttpError, bad, forbidden, json, readJson, unauthenticated } from './http.js';
import { checkName, randomDisplayName } from './names.js';
import { b64urlDecode, hmac, newId, nowIso, randomToken, safeEqual, sha256 } from './util.js';
import { audit } from './audit.js';
import { rebuildBoard } from './boards.js';
import { allBoardKeys } from './tracks.js';

export const SESSION_COOKIE = 'rgp_session';
const STATE_COOKIE = 'rgp_oauth';
const SESSION_DAYS = 30;

export interface User {
  id: string;
  display_name: string;
  is_referee: number;
  team_id: string | null;
}

export function getCookie(req: Request, name: string): string | null {
  const c = req.headers.get('cookie') ?? '';
  for (const part of c.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function cookie(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function isSecure(req: Request): boolean {
  return new URL(req.url).protocol === 'https:';
}

/** Reject cross-site writes: browsers always send Origin on POST/PUT/PATCH/DELETE. */
export function checkOrigin(req: Request): void {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin) {
    throw new HttpError(403, 'bad_origin', 'This request did not come from the Reindeer Grand Prix site.');
  }
}

export async function currentUser(env: Env, req: Request): Promise<User | null> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.display_name, u.is_referee, m.team_id
       FROM sessions s JOIN users u ON u.id = s.user_id
       LEFT JOIN memberships m ON m.user_id = u.id
      WHERE s.id_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL`,
  )
    .bind(await sha256(token), nowIso())
    .first<User>();
  return row ?? null;
}

export async function requireUser(env: Env, req: Request): Promise<User> {
  const u = await currentUser(env, req);
  if (!u) throw unauthenticated();
  return u;
}

export async function requireTeam(env: Env, req: Request): Promise<User & { team_id: string }> {
  const u = await requireUser(env, req);
  if (!u.team_id) throw new HttpError(409, 'no_team', 'Create or join a team first.');
  return u as User & { team_id: string };
}

export async function requireReferee(env: Env, req: Request): Promise<User> {
  const u = await requireUser(env, req);
  if (!u.is_referee) throw forbidden('Only referees can do that.');
  return u;
}

function refereeEmails(env: Env): string[] {
  return (env.REFEREE_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Find or create the user for a verified email, then start a session. Returns Set-Cookie. */
async function signIn(env: Env, req: Request, email: string): Promise<string> {
  const lower = email.toLowerCase();
  const emailHash = await sha256(lower);
  const referee = refereeEmails(env).includes(lower) ? 1 : 0;
  let user = await env.DB.prepare('SELECT id FROM users WHERE email_hash = ?').bind(emailHash).first<{ id: string }>();
  if (!user) {
    user = { id: newId('u_') };
    await env.DB.prepare('INSERT INTO users (id, email_hash, display_name, is_referee, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, emailHash, randomDisplayName(), referee, nowIso())
      .run();
  } else {
    await env.DB.prepare('UPDATE users SET is_referee = ? WHERE id = ?').bind(referee, user.id).run();
  }
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), user.id, nowIso(), expires)
    .run();
  return cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400, isSecure(req));
}

function allowedDomain(env: Env): string {
  return (env.ALLOWED_DOMAIN ?? 'cam.ac.uk').toLowerCase();
}

function safeReturnPath(p: string | null): string {
  // Only same-site paths like "/#/team"; never "//evil.com" or absolute URLs.
  return p && /^\/(?!\/)[\w\-./#?=&%]*$/.test(p) ? p : '/#/team';
}

/**
 * Google client IDs look like "123456789012-abc…xyz.apps.googleusercontent.com".
 * A common copy-paste slip drops the "123456789012-" part (double-click stops at
 * the hyphen), which makes Google answer "invalid_client". Catch it here.
 */
export function clientIdProblem(id: string): string | null {
  const v = id.trim();
  if (v !== id) return 'GOOGLE_CLIENT_ID has spaces or a line break around it';
  if (!v.endsWith('.apps.googleusercontent.com')) return 'GOOGLE_CLIENT_ID should end with .apps.googleusercontent.com';
  if (!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(v)) return 'GOOGLE_CLIENT_ID should start with the project number and a hyphen, e.g. 123456789012-…';
  return null;
}

/** GET /api/v1/auth/raven/start?return=/#/team */
export async function ravenStart(env: Env, req: Request): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID) throw new HttpError(503, 'not_configured', 'Raven sign-in is not configured on this server yet.');
  const problem = clientIdProblem(env.GOOGLE_CLIENT_ID);
  if (problem) {
    console.error(`GOOGLE_CLIENT_ID is misconfigured: ${problem}`);
    return new Response(null, { status: 302, headers: { location: `/#/signin?error=${encodeURIComponent(`Raven sign-in is misconfigured on this server (${problem}). Please tell a referee.`)}` } });
  }
  const url = new URL(req.url);
  const state = randomToken(16);
  const nonce = randomToken(16);
  const ret = safeReturnPath(url.searchParams.get('return'));
  const payload = `${state}.${nonce}.${encodeURIComponent(ret)}`;
  const sig = await hmac(env.SESSION_SECRET, payload);
  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/api/v1/auth/raven/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    hd: allowedDomain(env),
    state,
    nonce,
    prompt: 'select_account',
  }).toString();
  return new Response(null, {
    status: 302,
    headers: { location: google.toString(), 'set-cookie': cookie(STATE_COOKIE, `${payload}.${sig}`, 600, isSecure(req)) },
  });
}

/** GET /api/v1/auth/raven/callback?code=...&state=... */
export async function ravenCallback(env: Env, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const fail = (msg: string) =>
    new Response(null, { status: 302, headers: { location: `/#/signin?error=${encodeURIComponent(msg)}`, 'set-cookie': cookie(STATE_COOKIE, '', 0, isSecure(req)) } });
  if (url.searchParams.get('error')) return fail('Sign-in was cancelled.');
  const raw = getCookie(req, STATE_COOKIE);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!raw || !code || !state) return fail('Sign-in expired. Please try again.');
  const parts = raw.split('.');
  if (parts.length !== 4) return fail('Sign-in expired. Please try again.');
  const [cState, cNonce, cRet, sig] = parts;
  if (!safeEqual(sig, await hmac(env.SESSION_SECRET, `${cState}.${cNonce}.${cRet}`)) || !safeEqual(cState, state)) {
    return fail('Sign-in could not be verified. Please try again.');
  }
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: `${url.origin}/api/v1/auth/raven/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return fail('Raven did not accept the sign-in. Please try again.');
  const { id_token } = (await tokenRes.json()) as { id_token?: string };
  const claims = id_token ? decodeJwtPayload(id_token) : null;
  const problem = claims ? checkClaims(claims, env, cNonce) : 'No identity was returned.';
  if (problem) return fail(problem);
  const setCookie = await signIn(env, req, String(claims!.email));
  const headers = new Headers({ location: decodeURIComponent(cRet) });
  headers.append('set-cookie', setCookie);
  headers.append('set-cookie', cookie(STATE_COOKIE, '', 0, isSecure(req)));
  return new Response(null, { status: 302, headers });
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlDecode(jwt.split('.')[1])));
  } catch {
    return null;
  }
}

/** Returns a user-facing problem, or null if the ID token's claims are acceptable. */
export function checkClaims(c: Record<string, unknown>, env: Env, nonce: string, now = Date.now()): string | null {
  const domain = allowedDomain(env);
  if (c.iss !== 'https://accounts.google.com' && c.iss !== 'accounts.google.com') return 'The identity came from an unexpected issuer.';
  if (c.aud !== env.GOOGLE_CLIENT_ID) return 'The identity was meant for a different site.';
  if (typeof c.exp !== 'number' || c.exp * 1000 < now) return 'The sign-in expired. Please try again.';
  if (c.nonce !== nonce) return 'Sign-in could not be verified. Please try again.';
  if (c.email_verified !== true) return 'Your email address is not verified.';
  const email = String(c.email ?? '').toLowerCase();
  if (c.hd !== domain || !email.endsWith(`@${domain}`)) return `Please sign in with your @${domain} Raven account.`;
  return null;
}

/** POST /api/v1/auth/dev {email}: password-less sign-in for automated tests only. */
export async function devLogin(env: Env, req: Request): Promise<Response> {
  if (env.DEV_LOGIN !== 'true' || env.APP_ENV === 'production') throw new HttpError(404, 'not_found', 'Not found.');
  // On a public staging site, also require a shared secret so nobody can sign in as someone else.
  if (env.DEV_LOGIN_KEY && !safeEqual(req.headers.get('x-dev-login-key') ?? '', env.DEV_LOGIN_KEY)) {
    throw new HttpError(404, 'not_found', 'Not found.');
  }
  const { email } = await readJson<{ email?: string }>(req);
  if (typeof email !== 'string' || !email.toLowerCase().endsWith(`@${allowedDomain(env)}`)) {
    throw bad(`Use an @${allowedDomain(env)} address.`);
  }
  return json({ ok: true }, 200, { 'set-cookie': await signIn(env, req, email) });
}

export async function logout(env: Env, req: Request): Promise<Response> {
  const token = getCookie(req, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': cookie(SESSION_COOKIE, '', 0, isSecure(req)) });
}

/** GET /api/v1/me */
export async function me(env: Env, req: Request): Promise<Response> {
  const u = await currentUser(env, req);
  if (!u) return json({ user: null, ravenConfigured: !!env.GOOGLE_CLIENT_ID, devLogin: env.DEV_LOGIN === 'true' && env.APP_ENV !== 'production' && !env.DEV_LOGIN_KEY });
  return json({ user: { id: u.id, displayName: u.display_name, isReferee: !!u.is_referee, teamId: u.team_id } });
}

/** PATCH /api/v1/me {displayName} */
export async function updateMe(env: Env, req: Request): Promise<Response> {
  const u = await requireUser(env, req);
  const { displayName } = await readJson<{ displayName?: string }>(req);
  const err = checkName(displayName, 'Display name', 32);
  if (err) throw bad(err);
  await env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(displayName!.trim(), u.id).run();
  return json({ ok: true });
}

/**
 * DELETE /api/v1/me: remove personal data. Leaderboard history stays, attached
 * to the team; a team left with no members is renamed so nobody is identifiable.
 */
export async function deleteMe(env: Env, req: Request): Promise<Response> {
  const u = await requireUser(env, req);
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id),
    env.DB.prepare('UPDATE api_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, u.id),
    env.DB.prepare('DELETE FROM memberships WHERE user_id = ?').bind(u.id),
    env.DB.prepare("UPDATE users SET email_hash = NULL, display_name = 'Deleted user', deleted_at = ? WHERE id = ?").bind(now, u.id),
  ]);
  if (u.team_id) {
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM memberships WHERE team_id = ?').bind(u.team_id).first<{ n: number }>();
    if (!left?.n) {
      await env.DB.prepare("UPDATE teams SET name = 'Deleted team ' || substr(id, -6) WHERE id = ?").bind(u.team_id).run();
      for (const key of allBoardKeys()) await rebuildBoard(env, key);
    }
  }
  await audit(env, u.id, 'account.delete', u.id);
  return json({ ok: true }, 200, { 'set-cookie': cookie(SESSION_COOKIE, '', 0, isSecure(req)) });
}
