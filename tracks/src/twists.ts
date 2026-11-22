/**
 * Source definitions for weekly twists. `npm run tracks` writes each one to
 * tracks/twists/<id>.json; a referee uploads that file on the Referee page and
 * schedules it. Twists in this public repo are visible to anyone reading it,
 * so keep surprises (like the hidden final track) out of the repo: generate
 * them locally with `npm run tracks -- --out <folder>` and upload the file.
 */

import type { TwistConfig } from '../../engine/reindeer/twist.js';
import type { PatchDef } from './defs.js';

export interface TwistSource {
  id: string;
  twistVersion: string;
  name: string;
  description: string;
  /** Public track to start from. */
  base: string;
  difficulty?: number;
  /** Drive it the other way round. */
  reverse?: boolean;
  /** Replace the track width (metres). */
  width?: number;
  /** Replace the surface patches (positions are fractions of the lap, in the twist's own direction). */
  patches?: PatchDef[];
  config: TwistConfig;
}

export const TWISTS: TwistSource[] = [
  {
    id: 'night-oval',
    twistVersion: '1.0.0',
    name: 'Frosty Oval by Night',
    description: 'Night falls: your sleigh has only 3 short headlamp rays (−45°, 0°, 45°, 25 m). Fewer senses, same oval.',
    base: 'practice-1',
    config: { rayAnglesDeg: [-45, 0, 45], rayRange: 25 },
  },
  {
    id: 'ice-hairpins',
    twistVersion: '1.0.0',
    name: 'Pine Hairpins on Ice',
    description: 'A cold snap glazes both hairpins with ice. Brake before the ice, steer gently on it.',
    base: 'practice-2',
    patches: [
      { type: 'ice', from: 0.16, to: 0.27 },
      { type: 'ice', from: 0.38, to: 0.49 },
      { type: 'rough', from: 0.62, to: 0.7 },
    ],
    config: {},
  },
  {
    id: 'reverse-glacier',
    twistVersion: '1.0.0',
    name: 'Glacier Loop in Reverse',
    description: 'The same glacier, driven the other way round. Every corner your bot memorised now turns the opposite way.',
    base: 'practice-3',
    reverse: true,
    config: {},
  },
];
