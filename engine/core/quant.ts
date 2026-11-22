/**
 * Actions (steering and throttle) are stored and simulated as signed 8-bit
 * integers in -127..127. Quantising before simulation means the replay file and
 * the simulated run use exactly the same numbers.
 */

export function quantise(v: number): number {
  if (!(v === v)) return 0; // NaN -> 0
  const c = v < -1 ? -1 : v > 1 ? 1 : v;
  return Math.floor(c * 127 + 0.5);
}

export function dequantise(q: number): number {
  return q / 127;
}

/** Simple seeded PRNG (mulberry32). Integer-only, so identical in every language. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
