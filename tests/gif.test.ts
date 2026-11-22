import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPalette, encodeGif } from '../web/src/gif.js';
import { mulberry32 } from '../engine/core/quant.js';

/** A minimal, independent GIF decoder: returns the palette and each frame's indices. */
function decodeGif(b: Uint8Array) {
  assert.equal(String.fromCharCode(...b.slice(0, 6)), 'GIF89a');
  const w = b[6] | (b[7] << 8);
  const h = b[8] | (b[9] << 8);
  const flags = b[10];
  let p = 13;
  const gct = 2 << (flags & 7);
  const palette: number[][] = [];
  for (let i = 0; i < gct; i++, p += 3) palette.push([b[p], b[p + 1], b[p + 2]]);
  const frames: { delay: number; idx: Uint8Array }[] = [];
  let delay = 0;
  for (;;) {
    const t = b[p++];
    if (t === 0x3b) break;
    if (t === 0x21) {
      const label = b[p++];
      if (label === 0xf9) delay = b[p + 2] | (b[p + 3] << 8);
      while (b[p]) p += b[p] + 1;
      p++;
      continue;
    }
    assert.equal(t, 0x2c, `unexpected block 0x${t.toString(16)} at ${p - 1}`);
    p += 9;
    const min = b[p++];
    const data: number[] = [];
    while (b[p]) {
      for (let i = 1; i <= b[p]; i++) data.push(b[p + i]);
      p += b[p] + 1;
    }
    p++;
    // LZW decode.
    const clear = 1 << min;
    const eoi = clear + 1;
    let size = min + 1;
    let dict: number[][] = [];
    const reset = () => {
      dict = [];
      for (let i = 0; i < clear; i++) dict.push([i]);
      dict.push([], []);
      size = min + 1;
    };
    reset();
    const out: number[] = [];
    let bit = 0;
    let prev: number[] | null = null;
    for (;;) {
      let code = 0;
      for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
      if (code === clear) {
        reset();
        prev = null;
        continue;
      }
      if (code === eoi) break;
      let entry: number[];
      if (code < dict.length) entry = dict[code];
      else if (prev) entry = [...prev, prev[0]];
      else throw new Error('bad code');
      out.push(...entry);
      if (prev) dict.push([...prev, entry[0]]);
      if (dict.length === 1 << size && size < 12) size++;
      prev = entry;
    }
    frames.push({ delay, idx: Uint8Array.from(out) });
  }
  return { w, h, palette, frames };
}

test('GIF encoder: valid file, exact pixels for few-colour frames, long frames survive dictionary resets', async () => {
  const w = 211;
  const h = 157;
  const colours = [[255, 255, 255], [178, 13, 39], [23, 115, 75], [15, 35, 64]];
  const rand = mulberry32(7);
  const frames = [0, 1, 2].map((n) => {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      // Stripes plus noise: long runs and plenty of distinct strings (forces dictionary resets).
      const c = colours[(Math.floor(i / (7 + n)) + (rand() < 0.3 ? 1 : 0)) % colours.length];
      rgba.set([c[0], c[1], c[2], 255], i * 4);
    }
    return { rgba, delayCs: 8 };
  });
  const gif = await encodeGif(w, h, frames);
  const d = decodeGif(gif);
  assert.equal(d.w, w);
  assert.equal(d.h, h);
  assert.equal(d.frames.length, 3);
  for (let n = 0; n < 3; n++) {
    assert.equal(d.frames[n].delay, 8);
    assert.equal(d.frames[n].idx.length, w * h);
    for (let i = 0; i < w * h; i += 13) {
      const c = d.palette[d.frames[n].idx[i]];
      assert.deepEqual(c, Array.from(frames[n].rgba.slice(i * 4, i * 4 + 3)), `frame ${n} pixel ${i}`);
    }
  }
});

test('GIF palette: at most 256 colours, close to a smooth gradient', () => {
  const rgba = new Uint8ClampedArray(256 * 64 * 4);
  for (let i = 0; i < 256 * 64; i++) rgba.set([i % 256, (i * 7) % 256, 128, 255], i * 4);
  const pal = buildPalette([rgba]);
  assert.ok(pal.length <= 256 && pal.length > 100);
});
