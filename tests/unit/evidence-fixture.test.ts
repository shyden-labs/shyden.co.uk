import { crc32, inflateSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { evidencePageOf } from '../evidence-fixture';

/**
 * The evidence fixture's captures are images a strict decoder accepts, and
 * each reserves its box before it decodes (#363).
 *
 * The fixture fed every journey a 1x1 PNG whose compressed data failed its own
 * checksum. Chromium drew it; Firefox refused it and swapped in the alt text,
 * later under load, and with no width or height on the image that moved the
 * sign-off buttons about 50px. A click pressed on "Signed off" and released on
 * the paragraph above, so the page never heard it: one run in ten of the
 * evidence spec on firefox, reported as a store that never confirmed a write.
 */

const TITLES = ['the first journey', 'the second journey', 'the third journey'];

/** The capture tags on a fixture page: every image but the lightbox's empty one. */
const captureTags = (html: string): string[] =>
  html.match(/<img [^>]*src="data:[^"]*"[^>]*>/g) ?? [];

const CHANNELS: Readonly<Record<number, number>> = {
  0: 1,
  2: 3,
  3: 1,
  4: 2,
  6: 4,
};

/**
 * What a strict PNG decoder says about these bytes: 'decodes', or the first
 * thing it would refuse. Every chunk's CRC is checked, and the image data is
 * inflated, which checks its Adler-32, and must hold exactly one filter byte
 * plus one row of pixels per line.
 */
const pngVerdict = (bytes: Buffer): string => {
  if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    return 'not a PNG signature';
  const idat: Buffer[] = [];
  let header: { w: number; h: number; depth: number; type: number } | null =
    null;
  let at = 8;
  let last = '';
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (
      crc32(Buffer.concat([type, data])) !== bytes.readUInt32BE(at + 8 + length)
    )
      return `${type.toString('latin1')} fails its CRC`;
    last = type.toString('latin1');
    if (last === 'IHDR')
      header = {
        w: data.readUInt32BE(0),
        h: data.readUInt32BE(4),
        depth: data[8],
        type: data[9],
      };
    if (last === 'IDAT') idat.push(Buffer.from(data));
    at += 12 + length;
  }
  if (header === null) return 'no IHDR';
  if (last !== 'IEND') return 'does not end at IEND';
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(idat));
  } catch (error) {
    return `image data does not inflate: ${(error as Error).message}`;
  }
  const channels = CHANNELS[header.type];
  if (channels === undefined)
    return `colour type ${header.type} is not a PNG's`;
  const row = 1 + Math.ceil((header.w * channels * header.depth) / 8);
  return pixels.length === row * header.h
    ? 'decodes'
    : `image data holds ${pixels.length} bytes, not ${row * header.h}`;
};

const bytesOf = (tag: string): Buffer =>
  Buffer.from(
    /src="data:image\/png;base64,([^"]*)"/.exec(tag)?.[1] ?? '',
    'base64',
  );

describe("the evidence fixture's captures (#363)", () => {
  const html = () => evidencePageOf(TITLES, 'fixture-363');

  it('are PNGs a strict decoder accepts', () => {
    const tags = captureTags(html());
    expect(tags, 'one capture per journey').toHaveLength(TITLES.length);
    expect(tags.map((tag) => pngVerdict(bytesOf(tag)))).toEqual(
      TITLES.map(() => 'decodes'),
    );
  });

  it('each reserve their box before they decode, as the real build does', () => {
    const tags = captureTags(html());
    expect(tags, 'one capture per journey').toHaveLength(TITLES.length);
    expect(
      tags.map((tag) =>
        /^<img loading="lazy" width="1" height="1" src=/.test(tag),
      ),
    ).toEqual(TITLES.map(() => true));
  });

  it('the decoder check refuses the image the fixture used to ship, at both of its faults', () => {
    const shipped = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
      'base64',
    );
    expect(pngVerdict(shipped)).toBe('IDAT fails its CRC');
    // The same bytes with the chunk's CRC recomputed, so only the inflate can
    // refuse them: the compressed stream's own Adler-32 is wrong too.
    const crcMended = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAAa9DQ34AAAAASUVORK5CYII=',
      'base64',
    );
    expect(pngVerdict(crcMended)).toBe(
      'image data does not inflate: incorrect data check',
    );
  });
});
