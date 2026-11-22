/**
 * Reindeer Grand Prix Worker: serves the web app (static assets), the JSON API
 * under /api/v1, shareable /replay/<id> pages, and hosts the Evaluator.
 */

import * as admin from './admin.js';
import * as auth from './auth.js';
import { getBoard, listBoards, snapshotRanks } from './boards.js';
import type { Env } from './env.js';
import { HttpError, Router, errorResponse, json, notFound } from './http.js';
import * as replays from './replays.js';
import * as subs from './submissions.js';
import * as teams from './teams.js';
import * as tokens from './tokens.js';
import { processQueue } from './evaluate.js';
import { kickEvaluator } from './submissions.js';

export { Evaluator } from './evaluator.js';

interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

function routes(env: Env, ctx?: Ctx): Router {
  const r = new Router();
  r.on('GET', '/api/v1/health', async () => json({ ok: true, env: env.APP_ENV, time: new Date().toISOString() }))
    .on('GET', '/api/v1/meta', async () => teams.meta())
    .on('GET', '/api/v1/me', (req) => auth.me(env, req))
    .on('PATCH', '/api/v1/me', (req) => auth.updateMe(env, req))
    .on('DELETE', '/api/v1/me', (req) => auth.deleteMe(env, req))
    .on('GET', '/api/v1/me/tokens', (req) => tokens.listTokens(env, req))
    .on('POST', '/api/v1/me/tokens', (req) => tokens.createToken(env, req))
    .on('DELETE', '/api/v1/me/tokens/:id', (req, p) => tokens.revokeToken(env, req, p.id))
    .on('GET', '/api/v1/auth/raven/start', (req) => auth.ravenStart(env, req))
    .on('GET', '/api/v1/auth/raven/callback', (req) => auth.ravenCallback(env, req))
    .on('POST', '/api/v1/auth/dev', (req) => auth.devLogin(env, req))
    .on('POST', '/api/v1/auth/logout', (req) => auth.logout(env, req))
    .on('GET', '/api/v1/teams/mine', (req) => teams.myTeam(env, req))
    .on('PATCH', '/api/v1/teams/mine', (req) => teams.updateTeam(env, req))
    .on('POST', '/api/v1/teams', (req) => teams.createTeam(env, req))
    .on('POST', '/api/v1/teams/join', (req) => teams.joinTeam(env, req))
    .on('POST', '/api/v1/teams/leave', (req) => teams.leaveTeam(env, req))
    .on('GET', '/api/v1/teams/:id', (req, p) => teams.getTeam(env, req, p.id))
    .on('POST', '/api/v1/bots/validate', (req) => subs.validateBotEndpoint(env, req))
    .on('POST', '/api/v1/submissions', (req) => subs.submitBot(env, req))
    .on('GET', '/api/v1/submissions', (req) => subs.listSubmissions(env, req))
    .on('GET', '/api/v1/submissions/:id', (req, p) => subs.getSubmission(env, req, p.id))
    .on('POST', '/api/v1/runs', (req) => subs.uploadRun(env, req))
    .on('GET', '/api/v1/runs/count', (req) => subs.runCount(env, req))
    .on('GET', '/api/v1/boards', () => listBoards(env))
    .on('GET', '/api/v1/boards/*', (req, p) => getBoard(env, req, p['*'], ctx))
    .on('GET', '/api/v1/replays/:id', (req, p) => replays.replayMeta(env, req, p.id))
    .on('PATCH', '/api/v1/replays/:id', (req, p) => replays.setVisibility(env, req, p.id))
    .on('GET', '/api/v1/replays/:id/file', (req, p) => replays.replayFile(env, req, p.id))
    .on('GET', '/api/v1/replays/:id/thumb.png', (req, p) => replays.thumbnail(env, req, p.id))
    .on('POST', '/api/v1/replays/:id/thumbnail', (req, p) => replays.uploadThumbnail(env, req, p.id))
    .on('GET', '/api/v1/announcements', () => admin.announcements(env))
    .on('GET', '/api/v1/admin/overview', (req) => admin.overview(env, req))
    .on('POST', '/api/v1/admin/settings', (req) => admin.setSetting(env, req))
    .on('POST', '/api/v1/admin/entries/hide', (req) => admin.hideEntry(env, req))
    .on('POST', '/api/v1/admin/teams/:id', (req, p) => admin.editTeam(env, req, p.id))
    .on('POST', '/api/v1/admin/announcements', (req) => admin.postAnnouncement(env, req))
    .on('DELETE', '/api/v1/admin/announcements/:id', (req, p) => admin.removeAnnouncement(env, req, p.id))
    .on('GET', '/api/v1/admin/export.csv', (req) => admin.exportCsv(env, req))
    .on('GET', '/replay/:id', (req, p) => replays.permalinkPage(env, req, p.id));
  return r;
}

export async function handle(req: Request, env: Env, ctx?: Ctx): Promise<Response> {
  const url = new URL(req.url);
  const isApi = url.pathname.startsWith('/api/');
  try {
    if (isApi) auth.checkOrigin(req);
    if (isApi && tokens.bearer(req)) tokens.checkTokenRoute(req);
    const m = routes(env, ctx).match(req.method, url.pathname);
    if (m) return await m.handler(req, m.params);
    if (isApi) throw notFound('That API endpoint');
    if (env.ASSETS) return env.ASSETS.fetch(req);
    throw notFound('That page');
  } catch (e) {
    if (!isApi && e instanceof HttpError && e.status === 404 && env.ASSETS) return env.ASSETS.fetch(req);
    return errorResponse(e);
  }
}

export default {
  fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    return handle(req, env, ctx);
  },

  /** Cron triggers (see wrangler.toml): daily rank snapshot, and a queue safety net. */
  async scheduled(event: { cron: string }, env: Env): Promise<void> {
    if (event.cron === '5 0 * * *') await snapshotRanks(env);
    else await kickEvaluator(env);
  },
};

export { processQueue };
