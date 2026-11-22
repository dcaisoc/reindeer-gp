/** HTTP helpers: JSON responses, errors, body limits, a tiny router. */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const bad = (message: string, details?: Record<string, unknown>) => new HttpError(400, 'bad_request', message, details);
export const unauthenticated = () => new HttpError(401, 'unauthenticated', 'Please sign in first.');
export const forbidden = (message = 'You are not allowed to do that.') => new HttpError(403, 'forbidden', message);
export const notFound = (what = 'That') => new HttpError(404, 'not_found', `${what} was not found.`);

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...headers },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: { code: e.code, message: e.message, details: e.details } }, e.status);
  console.error(e);
  return json({ error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.', details: {} } }, 500);
}

export async function readBody(req: Request, maxBytes: number): Promise<Uint8Array> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > maxBytes) throw new HttpError(413, 'too_large', `That upload is too large (limit ${Math.round(maxBytes / 1024)} KB).`);
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length > maxBytes) throw new HttpError(413, 'too_large', `That upload is too large (limit ${Math.round(maxBytes / 1024)} KB).`);
  return buf;
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 16 * 1024): Promise<T> {
  const buf = await readBody(req, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(buf)) as T;
  } catch {
    throw bad('The request body is not valid JSON.');
  }
}

export type Handler = (req: Request, params: Record<string, string>) => Promise<Response>;

/** Minimal router: patterns like "/api/v1/teams/:id". */
export class Router {
  private routes: { method: string; parts: string[]; handler: Handler }[] = [];

  on(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
    return this;
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    const segs = path.split('/').filter(Boolean);
    let methodMismatch = false;
    for (const r of this.routes) {
      const rest = r.parts[r.parts.length - 1] === '*';
      if (!rest && r.parts.length !== segs.length) continue;
      if (rest && segs.length < r.parts.length - 1) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < r.parts.length; i++) {
        const p = r.parts[i];
        if (p === '*') {
          params['*'] = segs.slice(i).map(decodeURIComponent).join('/');
          break;
        }
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
        else if (p !== segs[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (r.method !== method) {
        methodMismatch = true;
        continue;
      }
      return { handler: r.handler, params };
    }
    if (methodMismatch) throw new HttpError(405, 'method_not_allowed', 'That method is not allowed here.');
    return null;
  }
}
