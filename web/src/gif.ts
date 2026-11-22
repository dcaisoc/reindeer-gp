/**
 * A small animated-GIF encoder: one shared 256-colour palette (median cut over
 * sampled pixels of all frames), LZW-compressed frames, looping forever.
 * No dependencies; fast enough for a few seconds of 480x300 replay.
 */

export interface GifFrame {
  /** RGBA pixels, width * height * 4. */
  rgba: Uint8ClampedArray;
  /** Hundredths of a second this frame stays on screen. */
  delayCs: number;
}

type RGB = [number, number, number];

/** Median-cut palette of at most `size` colours from a sample of pixels. */
export function buildPalette(frames: Uint8ClampedArray[], size = 256, maxSamples = 40_000): RGB[] {
  const total = frames.reduce((s, f) => s + f.length / 4, 0);
  const step = Math.max(1, Math.floor(total / maxSamples));
  const px: RGB[] = [];
  let k = 0;
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 4) {
      if (k++ % step === 0) px.push([f[i], f[i + 1], f[i + 2]]);
    }
  }
  let boxes: RGB[][] = [px];
  while (boxes.length < size) {
    // Split the box with the widest colour range.
    let best = -1;
    let bestRange = 0;
    let bestCh = 0;
    boxes.forEach((b, bi) => {
      if (b.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255;
        let hi = 0;
        for (const p of b) {
          if (p[ch] < lo) lo = p[ch];
          if (p[ch] > hi) hi = p[ch];
        }
        if (hi - lo > bestRange) {
          bestRange = hi - lo;
          best = bi;
          bestCh = ch;
        }
      }
    });
    if (best < 0 || bestRange === 0) break;
    const b = boxes[best].sort((p, q) => p[bestCh] - q[bestCh]);
    const mid = b.length >> 1;
    boxes = [...boxes.slice(0, best), b.slice(0, mid), b.slice(mid), ...boxes.slice(best + 1)];
  }
  return boxes.filter((b) => b.length).map((b) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    for (const p of b) {
      r += p[0];
      g += p[1];
      bl += p[2];
    }
    return [Math.round(r / b.length), Math.round(g / b.length), Math.round(bl / b.length)] as RGB;
  });
}

/** Maps colours to palette indices, caching on a 5-bit-per-channel grid. */
function indexer(palette: RGB[]): (r: number, g: number, b: number) => number {
  const cache = new Int16Array(32 * 32 * 32).fill(-1);
  return (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let idx = cache[key];
    if (idx >= 0) return idx;
    let bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const d = (p[0] - r) * (p[0] - r) * 2 + (p[1] - g) * (p[1] - g) * 4 + (p[2] - b) * (p[2] - b) * 3;
      if (d < bestD) {
        bestD = d;
        idx = i;
      }
    }
    cache[key] = idx;
    return idx;
  };
}

class Bytes {
  private buf = new Uint8Array(1 << 16);
  length = 0;
  private grow(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
  byte(b: number): void {
    this.grow(1);
    this.buf[this.length++] = b & 0xff;
  }
  word(w: number): void {
    this.byte(w);
    this.byte(w >> 8);
  }
  bytes(a: ArrayLike<number>): void {
    this.grow(a.length);
    this.buf.set(a as ArrayLike<number>, this.length);
    this.length += a.length;
  }
  str(s: string): void {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/** LZW-compress palette indices into GIF image data sub-blocks. */
export function lzw(indices: Uint8Array, minCodeSize: number, out: Bytes): void {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  const dict = new Map<number, number>();
  const block: number[] = [];
  let acc = 0;
  let nbits = 0;
  const flushBlock = () => {
    out.byte(block.length);
    out.bytes(block);
    block.length = 0;
  };
  const emit = (code: number) => {
    acc |= code << nbits;
    nbits += codeSize;
    while (nbits >= 8) {
      block.push(acc & 0xff);
      if (block.length === 255) flushBlock();
      acc >>>= 8;
      nbits -= 8;
    }
  };
  out.byte(minCodeSize);
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict.clear();
      codeSize = minCodeSize + 1;
      next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (nbits > 0) block.push(acc & 0xff);
  if (block.length) flushBlock();
  out.byte(0);
}

/** Encode frames as a looping GIF. Yields to the browser between frames when `onProgress` is given. */
export async function encodeGif(width: number, height: number, frames: GifFrame[], onProgress?: (done: number) => void): Promise<Uint8Array> {
  const palette = buildPalette(frames.map((f) => f.rgba));
  while (palette.length < 256) palette.push([0, 0, 0]);
  const toIndex = indexer(palette);
  const out = new Bytes();
  out.str('GIF89a');
  out.word(width);
  out.word(height);
  out.byte(0xf7); // global colour table, 8 bits per colour, 256 entries
  out.byte(0);
  out.byte(0);
  for (const [r, g, b] of palette) out.bytes([r, g, b]);
  // Loop forever (NETSCAPE2.0 extension).
  out.bytes([0x21, 0xff, 0x0b]);
  out.str('NETSCAPE2.0');
  out.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);
  const idx = new Uint8Array(width * height);
  for (let n = 0; n < frames.length; n++) {
    const { rgba, delayCs } = frames[n];
    for (let i = 0, p = 0; i < idx.length; i++, p += 4) idx[i] = toIndex(rgba[p], rgba[p + 1], rgba[p + 2]);
    out.bytes([0x21, 0xf9, 0x04, 0x00]);
    out.word(Math.max(2, Math.round(delayCs)));
    out.bytes([0x00, 0x00]);
    out.byte(0x2c);
    out.word(0);
    out.word(0);
    out.word(width);
    out.word(height);
    out.byte(0);
    lzw(idx, 8, out);
    if (onProgress) {
      onProgress(n + 1);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  out.byte(0x3b);
  return out.done();
}
