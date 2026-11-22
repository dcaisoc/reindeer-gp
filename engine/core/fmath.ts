/**
 * Deterministic maths for the engine.
 *
 * WHY THIS FILE EXISTS
 * IEEE-754 float64 +, -, *, / and sqrt are correctly rounded, so they give
 * identical bits in every JavaScript engine and in Python. Library functions
 * such as Math.sin, Math.exp and Math.tanh are NOT guaranteed to agree across
 * browsers, Node versions or Python's libm. The engine therefore never calls
 * them for anything that affects game state. It uses the functions below,
 * which are built only from + - * / and floor, in a fixed evaluation order.
 *
 * RULES FOR EDITING (the Python port in sdk/ must mirror every line):
 *  - Keep the exact order of operations. (a*b)+c is not the same as a*(b+c)/...
 *  - Never use Math.* except abs, min, max, sqrt, floor (see scripts/check-banned-math.mjs).
 *  - Constants are written out in full so both languages parse the same double.
 */

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
const INV_TWO_PI = 0.15915494309189535;
const LN2 = 0.6931471805599453;
const INV_LN2 = 1.4426950408889634;

// Taylor coefficients for sin on [-pi/2, pi/2] (max error about 6e-10).
const S3 = -1 / 6;
const S5 = 1 / 120;
const S7 = -1 / 5040;
const S9 = 1 / 362880;
const S11 = -1 / 39916800;
const S13 = 1 / 6227020800;

/** Reduce an angle to [-pi, pi]. */
export function wrapAngle(x: number): number {
  const k = Math.floor(x * INV_TWO_PI + 0.5);
  return x - k * TWO_PI;
}

/** Deterministic sine. */
export function fsin(x: number): number {
  let r = wrapAngle(x);
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  const r2 = r * r;
  // Horner form, innermost first.
  let p = S13;
  p = p * r2 + S11;
  p = p * r2 + S9;
  p = p * r2 + S7;
  p = p * r2 + S5;
  p = p * r2 + S3;
  p = p * r2 + 1;
  return p * r;
}

/** Deterministic cosine. */
export function fcos(x: number): number {
  return fsin(x + HALF_PI);
}

// Taylor coefficients for exp on [-ln2/2, ln2/2] (max relative error about 1e-13).
const E2 = 1 / 2;
const E3 = 1 / 6;
const E4 = 1 / 24;
const E5 = 1 / 120;
const E6 = 1 / 720;
const E7 = 1 / 5040;
const E8 = 1 / 40320;
const E9 = 1 / 362880;
const E10 = 1 / 3628800;
const E11 = 1 / 39916800;

/** Deterministic exp for x in [-40, 40] (inputs are clamped to that range). */
export function fexp(x: number): number {
  if (x > 40) x = 40;
  if (x < -40) x = -40;
  const k = Math.floor(x * INV_LN2 + 0.5);
  const r = x - k * LN2;
  let p = E11;
  p = p * r + E10;
  p = p * r + E9;
  p = p * r + E8;
  p = p * r + E7;
  p = p * r + E6;
  p = p * r + E5;
  p = p * r + E4;
  p = p * r + E3;
  p = p * r + E2;
  p = p * r + 1;
  p = p * r + 1;
  // Multiply by 2^k exactly (powers of two are exact in float64).
  let scale = 1;
  if (k > 0) for (let i = 0; i < k; i++) scale = scale * 2;
  else for (let i = 0; i < -k; i++) scale = scale * 0.5;
  return p * scale;
}

/** Deterministic tanh. */
export function ftanh(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return -1;
  const e = fexp(2 * x);
  return (e - 1) / (e + 1);
}

/** Deterministic logistic sigmoid. */
export function fsigmoid(x: number): number {
  if (x > 40) return 1;
  if (x < -40) return 0;
  return 1 / (1 + fexp(-x));
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
