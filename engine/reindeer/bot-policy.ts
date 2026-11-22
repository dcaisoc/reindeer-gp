/** Run a bot file in the Reindeer engine. */

import { compileBot, forward, validateBot, DEFAULT_LIMITS, type BotFile, type CompiledBot } from '../core/bot.js';
import type { Replay } from '../core/replay.js';
import { DEFAULT_CONFIG, type EngineConfig } from './config.js';
import { runPolicy, type Policy } from './run.js';
import { inputNames, obsToInputs, type TrackGeometry } from './sim.js';
import type { TrackDef } from './track.js';

export const BOT_TICKS_PER_ACTION = 3; // 20 Hz decisions

export function botPolicy(bot: CompiledBot): Policy {
  return (o) => {
    const y = forward(bot, obsToInputs(o, bot.inputs));
    return [y[0], y[1]];
  };
}

export function botLimits(cfg: EngineConfig = DEFAULT_CONFIG) {
  return { ...DEFAULT_LIMITS, allowedInputs: inputNames(cfg) };
}

export function validateBotForEngine(bot: unknown, cfg: EngineConfig = DEFAULT_CONFIG) {
  return validateBot(bot, botLimits(cfg));
}

/** Evaluate a (validated) bot for one lap on a track. This is exactly what the server scores. */
export function evaluateBot(
  track: TrackDef,
  bot: BotFile,
  participant: { name?: string; teamId?: string; botId?: string } = {},
  opts: { cfg?: EngineConfig; geo?: TrackGeometry; twist?: { id: string; version: string } | null } = {},
): Replay {
  const compiled = compileBot(bot);
  return runPolicy(track, botPolicy(compiled), { kind: 'bot', name: participant.name ?? bot.meta.name, teamId: participant.teamId, botId: participant.botId }, {
    cfg: opts.cfg,
    geo: opts.geo,
    twist: opts.twist,
    ticksPerAction: BOT_TICKS_PER_ACTION,
  });
}
