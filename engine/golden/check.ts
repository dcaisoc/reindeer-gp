/**
 * Environment-independent golden check, used by the Node runner and inside
 * browsers (tests/browser). Reports the first diverging tick on failure.
 */

import { replayFromJson, type ReplayJson } from '../core/replay.js';
import { simulateReplay } from '../reindeer/run.js';
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
