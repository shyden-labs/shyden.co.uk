import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_HEIGHT,
  PREVIEW_IMAGES,
  PREVIEW_WIDTH,
} from '../../src/lib/preview-image';
import { decodePng } from '../device/ios/png-shrink';

/**
 * Every page's link preview is a picture of that page (#1158; Shyden's
 * ruling, 2026-11-14). The image it replaced was a single flat green
 * rectangle that every guard of its size and type would have passed, so the
 * last check counts its colours: a screenshot of a page has text, a heading
 * and a background, and a placeholder has one colour.
 */
const FEWEST_COLOURS = 32;

const distinctColours = (image: ReturnType<typeof decodePng>): number => {
  const seen = new Set<number>();
  for (let i = 0; i < image.pixels.length; i += image.channels)
    seen.add(
      (image.pixels[i] << 16) |
        (image.pixels[i + 1] << 8) |
        image.pixels[i + 2],
    );
  return seen.size;
};

describe('every page has a link preview that shows it (#1158)', () => {
  it('lists twenty-two previews: four pages in each of five languages, and privacy in two', () => {
    expect(PREVIEW_IMAGES).toHaveLength(22);
  });

  it.each(PREVIEW_IMAGES)('%s is a 1200x630 picture of the page', (image) => {
    const path = `public${image}`;
    expect(existsSync(path), `${path} is missing`).toBe(true);
    // One decode serves both checks: decoding a 1200x630 PNG twice took a
    // test past the 1 s limit on a busy machine (#1162).
    const decoded = decodePng(readFileSync(path));
    expect([decoded.width, decoded.height]).toEqual([
      PREVIEW_WIDTH,
      PREVIEW_HEIGHT,
    ]);
    expect(distinctColours(decoded)).toBeGreaterThanOrEqual(FEWEST_COLOURS);
  });

  it('the flat placeholder it replaced is gone', () => {
    expect(existsSync('public/og-default.png')).toBe(false);
  });
});
