/**
 * The Evaluator Durable Object. There is exactly one ("main"), so jobs run
 * one at a time in order. Each wake-up (an alarm) may use up to 30 s of CPU,
 * which is plenty: one lap takes about 10-60 ms.
 */

import type { Env } from './env.js';
import { processQueue } from './evaluate.js';

interface DurableObjectStateLike {
  storage: {
    getAlarm(): Promise<number | null>;
    setAlarm(time: number): Promise<void>;
  };
}

export class Evaluator {
  constructor(
    private state: DurableObjectStateLike,
    private env: Env,
  ) {}

  /** Any request just makes sure an alarm is due soon. */
  async fetch(_req: Request): Promise<Response> {
    if ((await this.state.storage.getAlarm()) === null) await this.state.storage.setAlarm(Date.now());
    return new Response('ok');
  }

  async alarm(): Promise<void> {
    const more = await processQueue(this.env, { deadline: Date.now() + 20_000 });
    if (more) await this.state.storage.setAlarm(Date.now() + 50);
  }
}
