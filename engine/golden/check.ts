/**
 * Environment-independent golden check, used by the Node runner and inside
 * browsers (tests/browser). Reports the first diverging tick on failure.
 */

import { replayFromJson, type ReplayJson } from '../core/replay.js';
import { simulateReplay } from '../reindeer/run.js';
import { evaluateBot } from '../reindeer/bot-policy.js';
import type { BotFile } from '../core/bot.js';
import type { TrackDef } from '../reindeer/track.js';
import { twistConfig, type TwistDef } from '../reindeer/twist.js';
import type { EngineConfig } from '../reindeer/config.js';

/** Resolve the track and config a replay was made on (a public track, or a twist). */
function course(header: { track: { id: string }; twist: { id: string } | null }, tracks: Record<string, TrackDef>, twists: Record<string, TwistDef>): { track?: TrackDef; cfg?: EngineConfig } {
  if (!header.twist) return { track: tracks[header.track.id] };
  const w = twists[header.twist.id];
  return w ? { track: w.track, cfg: twistConfig(w) } : {};
}

export function checkCorpus(corpus: { name: string; replay: ReplayJson }[], tracks: Record<string, TrackDef>, twists: Record<string, TwistDef> = {}) {
  const lines: string[] = [];
  let failures = 0;
  for (const { name, replay } of corpus) {
    const r = replayFromJson(replay);
    const { track, cfg } = course(r.header, tracks, twists);
    if (!track) {
      failures++;
      lines.push(`✗ ${name}: unknown track ${r.header.twist?.id ?? r.header.track.id}`);
      continue;
    }
    const out = simulateReplay(track, r, { cfg });
    if (out.matches) lines.push(`✓ ${name}`);
    else {
      failures++;
      const where = out.firstMismatch >= 0 ? `tick ${(out.firstMismatch + 1) * 60}` : 'final state';
      lines.push(`✗ ${name}: first mismatch at ${where} (got ${out.hashes[out.firstMismatch] ?? out.finalHash})`);
    }
  }
  return { ok: failures === 0, failures, lines };
}

export interface BotGolden {
  bot: BotFile;
  track: string;
  /** Set when the bot was evaluated on a twist. */
  twist?: string;
  hashes: string[];
  finalHash: string;
}

/** Evaluate each golden bot (inference + simulation) and require identical hashes. */
export function checkBots(cases: { name: string; golden: BotGolden }[], tracks: Record<string, TrackDef>, twists: Record<string, TwistDef> = {}) {
  const lines: string[] = [];
  let failures = 0;
  for (const { name, golden } of cases) {
    const w = golden.twist ? twists[golden.twist] : undefined;
    const rep = w ? evaluateBot(w.track, golden.bot, {}, { cfg: twistConfig(w), twist: { id: w.id, version: w.twistVersion } }) : evaluateBot(tracks[golden.track], golden.bot);
    const h = rep.header.hashes;
    let first = -1;
    for (let i = 0; i < Math.max(h.length, golden.hashes.length); i++) if (h[i] !== golden.hashes[i]) { first = i; break; }
    if (first === -1 && rep.header.finalHash === golden.finalHash) lines.push(`✓ ${name}`);
    else {
      failures++;
      lines.push(`✗ ${name}: bot evaluation diverges at ${first >= 0 ? `tick ${(first + 1) * 60}` : 'the final state'}`);
    }
  }
  return { ok: failures === 0, failures, lines };
}
