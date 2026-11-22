/**
 * FNV-1a 64-bit hash over the IEEE-754 bytes of numbers, used to fingerprint
 * engine state. Two runs that agree bit-for-bit produce the same hash; any
 * difference, however small, changes it.
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

const buf = new DataView(new ArrayBuffer(8));

export class StateHasher {
  private h = FNV_OFFSET;

  private byte(b: number): void {
    this.h = ((this.h ^ BigInt(b)) * FNV_PRIME) & MASK;
  }

  /** Hash a float64 as its 8 little-endian bytes. */
  f64(x: number): this {
    // Normalise -0 to +0 so it cannot cause spurious mismatches.
    buf.setFloat64(0, x === 0 ? 0 : x, true);
    for (let i = 0; i < 8; i++) this.byte(buf.getUint8(i));
    return this;
  }

  /** Hash a 32-bit signed integer as 4 little-endian bytes. */
  i32(x: number): this {
    buf.setInt32(0, x, true);
    for (let i = 0; i < 4; i++) this.byte(buf.getUint8(i));
    return this;
  }

  hex(): string {
    return this.h.toString(16).padStart(16, '0');
  }
}
