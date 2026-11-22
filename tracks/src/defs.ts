/**
 * Source definitions for the public practice tracks.
 *
 * Each track is a closed loop of control points (metres, x right, y down),
 * listed in the direction of travel. `npm run tracks` smooths them into a
 * dense centreline, offsets the walls and writes tracks/<id>.json.
 * Edit here, regenerate, then run `npm run validate:tracks`.
 */

export interface PatchDef {
  type: 'ice' | 'rough';
  /** Fraction of the lap where the patch starts and ends (0..1). */
  from: number;
  to: number;
}

export interface TrackSource {
  id: string;
  trackVersion: string;
  name: string;
  difficulty: number;
  description: string;
  width: number;
  control: [number, number][];
  patches: PatchDef[];
  checkpoints: number;
  seed: number;
}

export const TRACKS: TrackSource[] = [
  {
    id: 'practice-1',
    trackVersion: '1.0.0',
    name: 'Frosty Oval',
    difficulty: 1,
    description: 'A wide, gentle oval. Learn the controls and set a clean lap.',
    width: 16,
    control: [
      [0, 0],
      [80, -6],
      [150, 0],
      [190, 40],
      [150, 84],
      [80, 90],
      [0, 84],
      [-40, 42],
    ],
    patches: [],
    checkpoints: 8,
    seed: 11,
  },
  {
    id: 'practice-2',
    trackVersion: '1.0.0',
    name: 'Pine Hairpins',
    difficulty: 2,
    description: 'Two hairpins through the pines and a rough patch that punishes running wide.',
    width: 13,
    control: [
      [0, 0],
      [90, 0],
      [160, 10],
      [190, 55],
      [160, 95],
      [115, 90],
      [95, 125],
      [125, 160],
      [170, 175],
      [165, 222],
      [90, 235],
      [15, 220],
      [-30, 175],
      [-5, 130],
      [-45, 90],
      [-40, 35],
    ],
    patches: [{ type: 'rough', from: 0.62, to: 0.7 }],
    checkpoints: 10,
    seed: 22,
  },
  {
    id: 'practice-3',
    trackVersion: '1.0.0',
    name: 'Glacier Loop',
    difficulty: 3,
    description: 'Narrow, twisty and icy. Brake before the ice, not on it.',
    width: 11,
    control: [
      [0, 0],
      [75, -12],
      [140, 0],
      [175, 35],
      [155, 70],
      [175, 105],
      [220, 115],
      [255, 155],
      [225, 200],
      [160, 190],
      [115, 210],
      [70, 250],
      [15, 240],
      [-20, 195],
      [15, 150],
      [-10, 108],
      [-55, 78],
      [-45, 28],
    ],
    patches: [
      { type: 'ice', from: 0.12, to: 0.2 },
      { type: 'ice', from: 0.47, to: 0.55 },
      { type: 'rough', from: 0.78, to: 0.83 },
    ],
    checkpoints: 12,
    seed: 33,
  },
];
