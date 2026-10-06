import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LOCALES } from '../../src/lib/i18n';
import {
  ROOM_CAPTURE,
  ROOM_CAPTURE_PIXELS,
  roomCapturePath,
} from '../../src/lib/shytalk-showcase';
import { searched } from '../source-files';
import { floorBreach } from '../floors';

/**
 * The ShyTalk showcase ships one REAL room capture per locale (#138).
 *
 * The point of the ticket is that the Thai page shows the app in Thai, so the
 * assertion that carries the intent is DISTINCTNESS, not existence: five
 * copies of one capture under five names satisfies "five files exist" and
 * fails the ticket entirely. Distinctness is checked by content hash, because
 * counting entries is not counting content (#112, #118).
 *
 * The population is derived from `LOCALES` rather than written out, so adding
 * a sixth site locale turns this red instead of shipping a page whose phone
 * frame silently falls back to English (#24, #49, #60, #65 are all the same
 * "derive, don't list" defect).
 */

/** PNG signature, so a mis-typed file cannot be read as garbage dimensions. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A PNG's intrinsic size, read from IHDR: 8-byte signature, then a 4-byte
 * chunk length and 4-byte type, putting width and height as big-endian
 * uint32s at offsets 16 and 20.
 */
function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

type Capture = {
  locale: string;
  path: string;
  bytes: Buffer;
};

const captures: Capture[] = LOCALES.filter((locale) =>
  existsSync(roomCapturePath(locale)),
).map((locale) => ({
  locale,
  path: roomCapturePath(locale),
  bytes: readFileSync(roomCapturePath(locale)),
}));

/**
 * An upper bound on one capture's SOURCE bytes -- not the shipped bytes.
 * Astro re-encodes each capture to WebP at build time: measured 2026-09-11,
 * 169kB PNG in, 15-16kB WebP out, and only the ONE matching the visitor's
 * locale is ever requested. So this bounds what enters the repo, and the real
 * per-visit cost is roughly a tenth of it. The site shipped zero content
 * rasters before #138, which is why any bound exists at all.
 */
const MAX_CAPTURE_BYTES = 180 * 1024;

describe('the ShyTalk showcase geometry is pinned, not merely derived', () => {
  /**
   * A value asserted against the constant it was computed from is
   * tautological (#117): every guard below derives from `ROOM_CAPTURE`, so
   * moving it would move both sides together and nothing would go red. These
   * three literals are the level, pinned against the brief, and they are the
   * only place a literal appears.
   */
  it('pins the frame size and scale to the agreed values', () => {
    expect(ROOM_CAPTURE.CSS_WIDTH).toBe(280);
    expect(ROOM_CAPTURE.CSS_HEIGHT).toBe(616);
    expect(ROOM_CAPTURE.SCALE).toBe(2);
  });

  it('derives the capture size from the frame and the scale', () => {
    expect(ROOM_CAPTURE_PIXELS).toEqual({ width: 560, height: 1232 });
  });

  /**
   * The aspect is taken from the capture device (1440x3168) so nothing is
   * letterboxed or cropped. Tolerance is one CSS pixel of rounding, which is
   * what `CSS_HEIGHT` being an integer costs.
   */
  it('matches the capture device aspect to within a pixel of rounding', () => {
    const device = 1440 / 3168;
    const frame = ROOM_CAPTURE.CSS_WIDTH / ROOM_CAPTURE.CSS_HEIGHT;
    expect(Math.abs(frame - device)).toBeLessThan(1 / ROOM_CAPTURE.CSS_HEIGHT);
  });
});

describe('the ShyTalk showcase ships a real room capture per locale', () => {
  it('has a capture for every locale the site serves', () => {
    const locales = LOCALES;
    const missing = locales.filter(
      (locale) => !existsSync(roomCapturePath(locale)),
    );
    expect(searched(missing, { of: locales, what: 'site locales' })).toEqual(
      [],
    );
    expect(
      floorBreach('shytalk-showcase/locales-with-a-capture', locales.length),
    ).toBeUndefined();
  });

  it('gives every locale its OWN capture, not one file under five names', () => {
    const byDigest = new Map<string, string[]>();
    for (const capture of captures) {
      const digest = createHash('sha256').update(capture.bytes).digest('hex');
      byDigest.set(digest, [...(byDigest.get(digest) ?? []), capture.locale]);
    }
    const shared = [...byDigest.values()].filter(
      (locales) => locales.length > 1,
    );
    expect(
      searched(shared, { of: captures, what: 'room captures on disk' }),
    ).toEqual([]);
    expect(
      floorBreach('shytalk-showcase/digested-captures', captures.length),
    ).toBeUndefined();
  });

  it('authors every capture at exactly the 2x frame size, and no larger', () => {
    const wrongSize = captures
      .filter((capture) => capture.bytes.subarray(0, 8).equals(PNG_MAGIC))
      .map((capture) => ({ locale: capture.locale, ...pngSize(capture.bytes) }))
      .filter(
        (size) =>
          size.width !== ROOM_CAPTURE_PIXELS.width ||
          size.height !== ROOM_CAPTURE_PIXELS.height,
      );
    expect(
      searched(wrongSize, { of: captures, what: 'room captures on disk' }),
    ).toEqual([]);
    expect(
      floorBreach('shytalk-showcase/sized-captures', captures.length),
    ).toBeUndefined();
  });

  it('stores every capture as a PNG, so the size read above is meaningful', () => {
    const notPng = captures
      .filter((capture) => !capture.bytes.subarray(0, 8).equals(PNG_MAGIC))
      .map((capture) => capture.path);
    expect(
      searched(notPng, { of: captures, what: 'room captures on disk' }),
    ).toEqual([]);
    expect(
      floorBreach('shytalk-showcase/format-checked-captures', captures.length),
    ).toBeUndefined();
  });

  it('keeps every capture inside the per-visit weight budget', () => {
    expect(MAX_CAPTURE_BYTES).toBe(184320);
    const tooHeavy = captures
      .filter((capture) => capture.bytes.byteLength > MAX_CAPTURE_BYTES)
      .map((capture) => `${capture.locale}: ${capture.bytes.byteLength}B`);
    expect(
      searched(tooHeavy, { of: captures, what: 'room captures on disk' }),
    ).toEqual([]);
    expect(
      floorBreach('shytalk-showcase/weighed-captures', captures.length),
    ).toBeUndefined();
  });
});
