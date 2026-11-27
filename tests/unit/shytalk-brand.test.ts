import { describe, expect, it } from 'vitest';
import { asComputedRgb } from '../../src/lib/shytalk-brand';

/**
 * A brand hex as the string `getComputedStyle` reports, so a spec can name
 * the brand value it expects. The guard reads the brand's own colours; this
 * is the conversion alone, each channel told apart.
 */
describe('asComputedRgb: a hex as a browser reports it', () => {
  it.each([
    ['six digits', '#1a2b3c', 'rgb(26, 43, 60)'],
    ['each channel apart', '#010203', 'rgb(1, 2, 3)'],
    ['three digits, doubled', '#0f8', 'rgb(0, 255, 136)'],
    ['upper case, no hash', 'FF0080', 'rgb(255, 0, 128)'],
  ])('%s', (_, hex, rgb) => {
    expect(asComputedRgb(hex)).toBe(rgb);
  });
});
