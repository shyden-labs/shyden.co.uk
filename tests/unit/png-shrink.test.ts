import { describe, expect, it } from 'vitest';
import { crc32, deflateSync } from 'node:zlib';
import { decodePng, shrinkPng } from '../device/ios/png-shrink';

/**
 * The iPhone captures are shrunk to CSS scale in-process (#1069): `sips` is a
 * macOS built-in, so on CI's Linux runner the resample never ran.
 */

type Pixel = readonly number[];

const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

/** A PNG of `rows`, each scanline written with `filter` (0-4), as an encoder may. */
const pngOf = (
  rows: readonly (readonly Pixel[])[],
  options: {
    filter?: number;
    depth?: number;
    colour?: number;
    interlace?: number;
  } = {},
): Buffer => {
  const { filter = 0, depth = 8, colour, interlace = 0 } = options;
  const channels = rows[0][0].length;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(rows[0].length, 0);
  header.writeUInt32BE(rows.length, 4);
  header.writeUInt8(depth, 8);
  header.writeUInt8(colour ?? (channels === 4 ? 6 : 2), 9);
  header.writeUInt8(interlace, 12);
  const stride = rows[0].length * channels;
  const raw = rows.map((row) => Buffer.from(row.flat()));
  const lines = raw.map((line, y) => {
    const prev = y > 0 ? raw[y - 1] : Buffer.alloc(stride);
    const out = Buffer.alloc(stride + 1);
    out[0] = filter;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      out[i + 1] = (line[i] - predictor) & 0xff;
    }
    return out;
  });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(lines))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const sizeOf = (png: Buffer) => ({
  width: png.readUInt32BE(16),
  height: png.readUInt32BE(20),
});

/** A width x height image whose every pixel says where it is. */
const gradient = (width: number, height: number, channels = 3): Pixel[][] =>
  Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      [x * 7 + y, y * 11 + x, (x * y) % 256, 255 - x]
        .slice(0, channels)
        .map((v) => v & 0xff),
    ),
  );

describe('decodePng reads the pixels back', () => {
  for (const [filter, name] of [
    'None',
    'Sub',
    'Up',
    'Average',
    'Paeth',
  ].entries())
    it(`rows written with the ${name} filter`, () => {
      const rows = gradient(5, 4);
      const image = decodePng(pngOf(rows, { filter }));
      expect(image).toMatchObject({ width: 5, height: 4, channels: 3 });
      expect([...image.pixels]).toEqual(rows.flat(2));
    });

  it('keeps the alpha channel of an RGBA capture', () => {
    const rows = gradient(3, 2, 4);
    const image = decodePng(pngOf(rows, { filter: 4 }));
    expect(image.channels).toBe(4);
    expect([...image.pixels]).toEqual(rows.flat(2));
  });

  it('refuses a file that is not a PNG', () => {
    expect(() => decodePng(Buffer.from('not a png at all'))).toThrow(
      /not a PNG/,
    );
  });

  it('refuses a PNG it cannot read, naming why', () => {
    const rows = gradient(2, 2);
    expect(() => decodePng(pngOf(rows, { depth: 16 }))).toThrow(/bit depth 16/);
    expect(() => decodePng(pngOf(rows, { colour: 3 }))).toThrow(
      /colour type 3/,
    );
    expect(() => decodePng(pngOf(rows, { interlace: 1 }))).toThrow(
      /interlaced/,
    );
  });

  it('refuses a filter byte the format does not have', () => {
    expect(() => decodePng(pngOf(gradient(2, 2), { filter: 5 }))).toThrow(
      /filter 5/,
    );
  });

  it('refuses image data shorter than its header says', () => {
    const png = pngOf(gradient(2, 2));
    png.writeUInt32BE(3, 20); // header now claims three rows
    expect(() => decodePng(png)).toThrow(/image data/);
  });
});

describe('shrinkPng', () => {
  it('fits the longest side to the limit and keeps the shape', () => {
    const shrunk = shrinkPng(pngOf(gradient(126, 273)), 91);
    expect(shrunk && sizeOf(shrunk)).toEqual({ width: 42, height: 91 });
  });

  it('averages each block of pixels it folds into one', () => {
    const rows = [
      [
        [0, 0, 0],
        [30, 60, 90],
        [200, 200, 200],
        [100, 100, 100],
      ],
      [
        [30, 60, 90],
        [0, 0, 0],
        [100, 100, 100],
        [200, 200, 200],
      ],
    ];
    const shrunk = shrinkPng(pngOf(rows), 2);
    expect(shrunk && [...decodePng(shrunk).pixels]).toEqual([
      15, 30, 45, 150, 150, 150,
    ]);
  });

  it('returns nothing when the image already fits, never enlarging it', () => {
    expect(shrinkPng(pngOf(gradient(4, 3)), 4)).toBeUndefined();
    expect(shrinkPng(pngOf(gradient(1, 1)), 912)).toBeUndefined();
  });
});
