import { describe, expect, it } from 'vitest';
import { decodePng, differingPixels } from '../../scripts/png-pixels.mjs';
import {
  pngOf,
  rampPixels,
  withChangedPixels,
  type Filter,
} from '../png-fixture';

/**
 * The baseline decoder (#678): plain Node, no package. A capture decides what
 * to commit by how many pixels differ, so a decoder that read one filter wrong
 * would read a changed page as quiet, or a quiet one as changed.
 */
describe('decodePng reads the pixels an encoder wrote', () => {
  // A ramp, so no two neighbours are equal and every filter predicts from
  // values that differ: a filter undone wrongly cannot land on the right byte
  // by accident.
  const width = 5;
  const height = 4;
  const pixels = rampPixels(width, height);

  it.each([0, 1, 2, 3, 4] as const)(
    'undoes filter %i on every row',
    (filter: Filter) => {
      const decoded = decodePng(
        pngOf({
          width,
          height,
          pixels,
          filters: [filter, filter, filter, filter],
        }),
      );
      expect(decoded).toEqual({
        width,
        height,
        channels: 3,
        pixels: Buffer.from(pixels),
      });
    },
  );

  it('undoes a different filter on each row, each predicting from the row above', () => {
    expect(
      decodePng(pngOf({ width, height, pixels, filters: [4, 3, 2, 1] })).pixels,
    ).toEqual(Buffer.from(pixels));
  });

  it('reads four channels from an RGBA image', () => {
    const rgba = Uint8Array.from(
      { length: 2 * 2 * 4 },
      (_, index) => index * 9,
    );
    expect(
      decodePng(
        pngOf({
          width: 2,
          height: 2,
          channels: 4,
          pixels: rgba,
          filters: [1, 4],
        }),
      ),
    ).toEqual({ width: 2, height: 2, channels: 4, pixels: Buffer.from(rgba) });
  });

  it('refuses a file that is not a PNG', () => {
    expect(() => decodePng(Buffer.from('not a png'))).toThrow(
      'not a PNG: the first eight bytes are not the PNG signature',
    );
  });

  it.each([
    ['a 16-bit image', { depth: 16 }, 'depth 16, colour type 2, interlace 0'],
    [
      'an interlaced image',
      { interlace: 1 },
      'depth 8, colour type 2, interlace 1',
    ],
  ] as const)('refuses %s rather than misread it', (_name, options, said) => {
    expect(() =>
      decodePng(
        pngOf({
          width: 1,
          height: 1,
          pixels: Uint8Array.of(1, 2, 3),
          ...options,
        }),
      ),
    ).toThrow(
      `unsupported PNG (${said}): baselines are 8-bit RGB or RGBA, not interlaced`,
    );
  });
});

describe('differingPixels counts the pixels two renders disagree on', () => {
  const width = 10;
  const height = 10;
  const pixels = rampPixels(width, height);
  const render = (bytes: Uint8Array) =>
    decodePng(pngOf({ width, height, pixels: bytes }));

  it('reads 0 for a render against itself', () => {
    expect(differingPixels(render(pixels), render(pixels))).toBe(0);
  });

  it('counts a pixel moved by one step in one channel', () => {
    expect(
      differingPixels(render(pixels), render(withChangedPixels(pixels, 1))),
    ).toBe(1);
  });

  it('counts each changed pixel once, however many channels moved', () => {
    const changed = Uint8Array.from(pixels);
    changed[0] = (changed[0] ?? 0) ^ 1;
    changed[1] = (changed[1] ?? 0) ^ 1;
    changed[2] = (changed[2] ?? 0) ^ 1;
    expect(differingPixels(render(pixels), render(changed))).toBe(1);
  });

  it('counts every pixel when all of them moved', () => {
    expect(
      differingPixels(render(pixels), render(withChangedPixels(pixels, 100))),
    ).toBe(100);
  });

  it('answers undefined for two renders of different sizes, which no count describes', () => {
    const wider = decodePng(
      pngOf({ width: 11, height: 10, pixels: rampPixels(11, 10) }),
    );
    expect(differingPixels(render(pixels), wider)).toBeUndefined();
  });

  it('compares an RGB render with an RGBA one as opaque', () => {
    const rgba = new Uint8Array(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) {
      rgba.set(pixels.subarray(pixel * 3, pixel * 3 + 3), pixel * 4);
      rgba[pixel * 4 + 3] = 255;
    }
    rgba[3] = 254;
    expect(
      differingPixels(
        render(pixels),
        decodePng(pngOf({ width, height, channels: 4, pixels: rgba })),
      ),
    ).toBe(1);
  });
});
