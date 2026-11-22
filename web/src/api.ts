/** Talking to the server. Same origin, so the session cookie just works. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, raw?: BodyInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: raw ? { 'content-type': 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : {},
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'offline', "Can't reach the server. Check your connection; your laps are safe in this browser.");
  }
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? `Request failed (${res.status}).`, e.details ?? {});
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => call<T>('GET', p),
  post: <T>(p: string, b: unknown = {}) => call<T>('POST', p, b),
  patch: <T>(p: string, b: unknown) => call<T>('PATCH', p, b),
  del: <T>(p: string) => call<T>('DELETE', p),
  upload: <T>(p: string, bytes: Uint8Array | Blob) => call<T>('POST', p, undefined, bytes as BodyInit),
};

export interface Me {
  id: string;
  displayName: string;
  isReferee: boolean;
  teamId: string | null;
}

export interface MeResponse {
  user: Me | null;
  /** True when the server could not be reached (offline, or pages served without the API). */
  noServer?: boolean;
  ravenConfigured?: boolean;
  devLogin?: boolean;
}

let meCache: Promise<MeResponse> | null = null;

/** Who is signed in (cached until refreshMe()). Never throws: offline counts as signed out. */
export function getMe(): Promise<MeResponse> {
  if (!meCache) meCache = api.get<MeResponse>('/me').catch(() => ({ user: null, noServer: true }));
  return meCache;
}

export function refreshMe(): Promise<MeResponse> {
  meCache = null;
  window.dispatchEvent(new Event('rgp:me'));
  return getMe();
}

export interface TeamView {
  id: string;
  name: string;
  college: string;
  level: 'elf' | 'reindeer' | 'santa';
  levelLocked: boolean;
  members: { id: string; displayName: string; role: string }[];
  joinCode?: string;
}

export interface Submission {
  id: string;
  kind: 'bot' | 'human' | 'verify';
  trackId: string;
  boardKey: string | null;
  status: 'queued' | 'running' | 'done' | 'rejected';
  rejectReason: string | null;
  createdAt: string;
  botName: string | null;
  result: { valid: boolean; score: number | null; penalties: number; beginner: boolean } | null;
  replayId: string | null;
}

/** Poll a submission until it finishes. */
export async function waitForSubmission(id: string, onUpdate: (s: Submission) => void, timeoutMs = 120_000): Promise<Submission> {
  const start = Date.now();
  let delay = 500;
  for (;;) {
    const { submission } = await api.get<{ submission: Submission }>(`/submissions/${id}`);
    onUpdate(submission);
    if (submission.status === 'done' || submission.status === 'rejected') return submission;
    if (Date.now() - start > timeoutMs) return submission;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(3000, delay * 1.5);
  }
}

export function boardKey(trackId: string, kind: 'bots' | 'humans'): string {
  return `s1/${trackId}/base/${kind}`;
}
