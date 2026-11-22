/**
 * Environment-independent golden check, used by the Node runner and inside
 * browsers (tests/browser). Reports the first diverging tick on failure.
 */

import { replayFromJson, type ReplayJson } from '../core/replay.js';
import { simulateReplay } from '../reindeer/run.js';
import { evaluateBot } from '../reindeer/bot-policy.js';
import type { BotFile } from '../core/bot.js';
import type { TrackDef } from '../reindeer/track.js';

export function checkCorpus(corpus: { name: string; replay: ReplayJson }[], tracks: Record<string, TrackDef>) {
  const lines: string[] = [];
  let failures = 0;
  for (const { name, replay } of corpus) {
    const r = replayFromJson(replay);
    const track = tracks[r.header.track.id];
    if (!track) {
      failures++;
      lines.push(`✗ ${name}: unknown track ${r.header.track.id}`);
      continue;
    }
    const out = simulateReplay(track, r);
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
  hashes: string[];
  finalHash: string;
}

/** Evaluate each golden bot (inference + simulation) and require identical hashes. */
export function checkBots(cases: { name: string; golden: BotGolden }[], tracks: Record<string, TrackDef>) {
  const lines: string[] = [];
  let failures = 0;
  for (const { name, golden } of cases) {
    const rep = evaluateBot(tracks[golden.track], golden.bot);
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
