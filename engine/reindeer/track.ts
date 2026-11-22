/**
 * Track format "rgp-track" v1. See docs/formats/track.md.
 *
 * Coordinates are metres in SCREEN orientation: x to the right, y DOWN.
 * Headings are radians measured from +x towards +y (clockwise on screen).
 *
 * All geometry the engine needs (walls, checkpoints, start pose) is stored
 * explicitly, so the TypeScript and Python engines read identical numbers and
 * never have to agree on how to offset a curve.
 */

export type Pt = [number, number];

export type SurfaceType = 'snow' | 'ice' | 'rough';

export interface SurfacePatch {
  type: Exclude<SurfaceType, 'snow'>;
  polygon: Pt[];
}

export interface Decoration {
  type: 'tree' | 'cabin' | 'lamp' | 'present';
  x: number;
  y: number;
  size?: number;
}

export interface TrackDef {
  format: 'rgp-track';
  version: 1;
  id: string;
  trackVersion: string;
  name: string;
  difficulty: number;
  description: string;
  /** Nominal track width in metres (informational; walls are authoritative). */
  width: number;
  /** Closed racing line, used for drawing and sectors only. */
  centreline: Pt[];
  /** Closed wall polylines. The last point connects back to the first. */
  walls: { left: Pt[]; right: Pt[] };
  start: { x: number; y: number; heading: number };
  /**
   * Ordered checkpoint lines [Lx, Ly, Rx, Ry], L on the driver's left.
   * Index 0 is the start/finish line. A lap is every checkpoint in order, then 0 again.
   */
  checkpoints: [number, number, number, number][];
  /** Checkpoint indices that end sector 1 and sector 2 (sector 3 ends at the finish). */
  sectors: number[];
  surfaces: SurfacePatch[];
  decorations: Decoration[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}
