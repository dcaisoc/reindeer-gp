import type { Env } from './env.js';
import { newId, nowIso } from './util.js';

/** Record an action in the audit log (referee actions, account deletions). */
export async function audit(env: Env, actorId: string, action: string, target: string | null, details: Record<string, unknown> = {}): Promise<void> {
  await env.DB.prepare('INSERT INTO audit_log (id, actor_id, action, target, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(newId('a_'), actorId, action, target, JSON.stringify(details), nowIso())
    .run();
}

export async function getSetting(env: Env, key: string, fallback: string): Promise<string> {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return r?.value ?? fallback;
}
