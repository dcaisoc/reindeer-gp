/** A browser-like API client with its own cookie jar, talking to the real Worker in-process. */

import assert from 'node:assert/strict';
import { handle } from '../../server/src/index.js';
import { localEnv } from '../../server/local/bindings.js';

export const ORIGIN = 'http://localhost';
export type E = ReturnType<typeof localEnv>;

export class Client {
  cookie = '';
  constructor(private env: E) {}
  async req(method: string, path: string, body?: unknown, raw = false, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (method !== 'GET') h.origin = ORIGIN;
    let b: BodyInit | undefined;
    if (body !== undefined) {
      if (raw) b = body as BodyInit;
      else {
        b = JSON.stringify(body);
        h['content-type'] = 'application/json';
      }
    }
    const res = await handle(new Request(`${ORIGIN}${path}`, { method, headers: h, body: b }), this.env);
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      if (kv.startsWith('rgp_session=')) this.cookie = kv.endsWith('=') ? '' : kv;
    }
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : type.startsWith('application/octet-stream') ? new Uint8Array(await res.arrayBuffer()) : await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, data: data as any, res };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  patch = (p: string, b: unknown) => this.req('PATCH', p, b);
  del = (p: string) => this.req('DELETE', p);
  async login(email: string) {
    const r = await this.post('/api/v1/auth/dev', { email });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return this;
  }
}

export function setup(vars: Record<string, string> = {}) {
  const env = localEnv({ vars });
  return { env, client: () => new Client(env) };
}

export async function teamUp(c: Client, name: string, level = 'elf', college = 'Trinity') {
  const r = await c.post('/api/v1/teams', { name, college, level });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.team;
}
