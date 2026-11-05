import { deflateSync } from 'node:zlib';

/**
 * A PNG built in the test process (#678): 8-bit RGB or RGBA, each row written
 * with the filter its test names, so a decoder that mishandles one filter
 * reads a wrong pixel there. The filters are the five of the PNG
 * specification, applied as an encoder would: the decoder's job is to undo
 * them.
 */
export type Filter = 0 | 1 | 2 | 3 | 4;

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

const chunk = (kind: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  // The decoder reads no CRC, so a zero one keeps this fixture free of a
  // CRC table nothing here would test.
  return Buffer.concat([
    length,
    Buffer.from(kind, 'latin1'),
    data,
    Buffer.alloc(4),
  ]);
};

/**
 * `pixels` is `height` rows of `width * channels` bytes; `filters[y]` is the
 * filter row `y` is written with (0 when the list is shorter).
 */
export const pngOf = ({
  width,
  height,
  channels = 3,
  pixels,
  filters = [],
  depth = 8,
  interlace = 0,
}: {
  width: number;
  height: number;
  channels?: 3 | 4;
  pixels: Uint8Array;
  filters?: readonly Filter[];
  depth?: number;
  interlace?: number;
}): Buffer => {
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const filter = filters[y] ?? 0;
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const at = (row: number, column: number) =>
        row < 0 || column < 0 ? 0 : (pixels[row * stride + column] ?? 0);
      const a = at(y, x - channels);
      const b = at(y - 1, x);
      const c = at(y - 1, x - channels);
      const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter] ?? 0;
      raw[y * (stride + 1) + 1 + x] = (at(y, x) - predicted) & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = channels === 4 ? 6 : 2;
  header[12] = interlace;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/** `width * height` RGB pixels whose bytes run 0, 7, 14, ... modulo 256. */
export const rampPixels = (width: number, height: number): Uint8Array =>
  Uint8Array.from(
    { length: width * height * 3 },
    (_, index) => (index * 7) & 255,
  );

/** A copy of `pixels` with the first `count` pixels' red channel moved by `step`. */
export const withChangedPixels = (
  pixels: Uint8Array,
  count: number,
  step = 1,
): Uint8Array => {
  const changed = Uint8Array.from(pixels);
  for (let pixel = 0; pixel < count; pixel++)
    changed[pixel * 3] = ((changed[pixel * 3] ?? 0) + step) & 255;
  return changed;
};
