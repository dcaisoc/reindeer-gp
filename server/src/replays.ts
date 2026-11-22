/** Replay metadata, files, privacy, thumbnails and shareable /replay/<id> pages. */

import { currentUser, requireTeam } from './auth.js';
import { blobs } from './blobs.js';
import type { Env } from './env.js';
import { HttpError, bad, json, notFound, readBody, readJson } from './http.js';
import { track } from './tracks.js';

interface ReplayRow {
  id: string;
  kind: string;
  r2_key: string;
  team_id: string;
  team_name: string;
  track_id: string;
  title: string;
  score: number | null;
  visibility: string;
  thumb_key: string | null;
  created_at: string;
}

async function load(env: Env, req: Request, id: string): Promise<{ r: ReplayRow; canEdit: boolean }> {
  const r = await env.DB.prepare('SELECT p.*, t.name AS team_name FROM replays p JOIN teams t ON t.id = p.team_id WHERE p.id = ?').bind(id).first<ReplayRow>();
  if (!r) throw notFound('That replay');
  const u = await currentUser(env, req);
  const canEdit = !!u && u.team_id === r.team_id;
  if (r.visibility === 'hidden' && !canEdit && !u?.is_referee) throw notFound('That replay');
  return { r, canEdit };
}

export async function replayMeta(env: Env, req: Request, id: string): Promise<Response> {
  const { r, canEdit } = await load(env, req, id);
  return json({
    replay: {
      id: r.id, kind: r.kind, trackId: r.track_id, trackName: track(r.track_id)?.name ?? r.track_id,
      title: r.title, score: r.score, teamId: r.team_id, team: r.team_name, visibility: r.visibility,
      createdAt: r.created_at, hasThumbnail: !!r.thumb_key, canEdit,
    },
  });
}

export async function replayFile(env: Env, req: Request, id: string): Promise<Response> {
  const { r } = await load(env, req, id);
  const obj = await blobs(env).get(r.r2_key);
  if (!obj) throw notFound('That replay file');
  return new Response(await obj.arrayBuffer(), {
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${r.track_id}-${r.id}.rgpr"`,
      'cache-control': r.visibility === 'public' ? 'public, max-age=86400' : 'private, no-store',
    },
  });
}

/** PATCH /api/v1/replays/:id {visibility: "public" | "hidden"} */
export async function setVisibility(env: Env, req: Request, id: string): Promise<Response> {
  const u = await requireTeam(env, req);
  const { visibility } = await readJson<{ visibility?: string }>(req);
  if (visibility !== 'public' && visibility !== 'hidden') throw bad('visibility must be "public" or "hidden".');
  const r = await env.DB.prepare('UPDATE replays SET visibility = ? WHERE id = ? AND team_id = ?').bind(visibility, id, u.team_id).run();
  if (!r.meta.changes) throw notFound('That replay');
  return json({ ok: true });
}

/** POST /api/v1/replays/:id/thumbnail (PNG, drawn by the owner's browser) */
export async function uploadThumbnail(env: Env, req: Request, id: string): Promise<Response> {
  const u = await requireTeam(env, req);
  const row = await env.DB.prepare('SELECT id FROM replays WHERE id = ? AND team_id = ?').bind(id, u.team_id).first();
  if (!row) throw notFound('That replay');
  const png = await readBody(req, 300 * 1024);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (sig.some((b, i) => png[i] !== b)) throw new HttpError(415, 'not_png', 'Thumbnails must be PNG images.');
  const key = `thumbs/${id}.png`;
  await blobs(env).put(key, png, { httpMetadata: { contentType: 'image/png' } });
  await env.DB.prepare('UPDATE replays SET thumb_key = ? WHERE id = ?').bind(key, id).run();
  return json({ ok: true });
}

export async function thumbnail(env: Env, req: Request, id: string): Promise<Response> {
  const { r } = await load(env, req, id);
  const obj = r.thumb_key ? await blobs(env).get(r.thumb_key) : null;
  if (!obj) return new Response(null, { status: 302, headers: { location: '/og-default.png' } });
  return new Response(await obj.arrayBuffer(), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' } });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * GET /replay/:id — a tiny HTML page with link-preview tags for chat apps,
 * which sends people on to the app's replay viewer.
 */
export async function permalinkPage(env: Env, req: Request, id: string): Promise<Response> {
  const origin = new URL(req.url).origin;
  let title = 'Reindeer Grand Prix replay';
  let desc = 'Watch this lap in Reindeer Grand Prix.';
  let image = `${origin}/og-default.png`;
  try {
    const { r } = await load(env, req, id);
    title = r.title;
    desc = r.score !== null ? `${r.score.toFixed(2)} s on ${track(r.track_id)?.name ?? r.track_id}. Watch it, then race it as a ghost.` : `A run on ${track(r.track_id)?.name ?? r.track_id}.`;
    if (r.thumb_key) image = `${origin}/api/v1/replays/${encodeURIComponent(id)}/thumb.png`;
  } catch {
    /* fall through with generic text; the app shows "not found" */
  }
  const target = `/#/replay/remote/${encodeURIComponent(id)}`;
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Reindeer Grand Prix">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(`${origin}/replay/${id}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
</head><body><p><a href="${esc(target)}">Open the replay</a></p></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
}
