/**
 * Run the whole system locally in plain Node: the built web app (dist/) plus
 * the real Worker API, with SQLite and files under .local/.
 *
 *   npm run build && npm run dev:server        -> http://localhost:8787
 *
 * Sign in with the "test sign-in" box (DEV_LOGIN), using any @cam.ac.uk address.
 * Pass --memory to keep everything in memory (used by the browser tests).
 * Set REFEREE_EMAILS=you@cam.ac.uk to see the referee page.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { handle } from '../src/index.js';
import { localEnv } from './bindings.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.map': 'application/json',
};

export function startDevServer(opts: { port?: number; memory?: boolean; dist?: string; vars?: Record<string, string> } = {}) {
  const dist = opts.dist ?? 'dist';
  const env = localEnv(
    opts.memory ? { vars: opts.vars } : { dbPath: '.local/reindeer-gp.sqlite', vars: { REFEREE_EMAILS: process.env.REFEREE_EMAILS ?? '', ...opts.vars } },
  );
  env.ASSETS = {
    async fetch(req: Request) {
      const path = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^(\.\.[/\\])+/, '');
      const candidates = path === '/' || path === '\\' ? [join(dist, 'index.html')] : [join(dist, path), join(dist, 'index.html')];
      for (const file of candidates) {
        try {
          const body = await readFile(file);
          return new Response(body, { headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' } });
        } catch {
          /* try the SPA fallback */
        }
      }
      return new Response('not found', { status: 404 });
    },
  };
  const server = createServer(async (nreq, nres) => {
    const chunks: Buffer[] = [];
    for await (const c of nreq) chunks.push(c as Buffer);
    const url = `http://${nreq.headers.host}${nreq.url}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(nreq.headers)) if (typeof v === 'string') headers.set(k, v);
    const body = ['GET', 'HEAD'].includes(nreq.method ?? 'GET') ? undefined : Buffer.concat(chunks);
    const res = await handle(new Request(url, { method: nreq.method, headers, body }), env);
    const out: Record<string, string | string[]> = {};
    res.headers.forEach((v, k) => {
      if (k === 'set-cookie') return;
      out[k] = v;
    });
    const cookies = res.headers.getSetCookie?.() ?? [];
    if (cookies.length) out['set-cookie'] = cookies;
    nres.writeHead(res.status, out);
    nres.end(Buffer.from(await res.arrayBuffer()));
  });
  return new Promise<{ url: string; close: () => void; env: typeof env }>((resolve) =>
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const a = server.address();
      const port = typeof a === 'object' && a ? a.port : opts.port;
      resolve({ url: `http://localhost:${port}`, close: () => server.close(), env });
    }),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startDevServer({ port: Number(process.env.PORT ?? 8787), memory: process.argv.includes('--memory') });
  console.log(`Reindeer Grand Prix (local server) at ${s.url}`);
}
