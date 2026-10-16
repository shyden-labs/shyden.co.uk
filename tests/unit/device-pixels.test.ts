import { describe, expect, it } from 'vitest';
import { paintedLineWidth, readsAsLineWidth } from '../device-pixels';

/**
 * A border or outline may be reported in whole device pixels (#805). The real
 * Android phone (devicePixelRatio 3.5) reported the site's 3px focus ring as
 * 2.85714px: 10.5 device pixels, painted as 10. Emulated Chrome at 2.75
 * (mobile-chrome, record run 38807621610) reported the same ring as 3. Each
 * expected value below is worked by hand from those rules, never from the
 * helper.
 */
describe('paintedLineWidth', () => {
  it('is the declared width where it is whole device pixels', () => {
    expect(paintedLineWidth(3, 1)).toBe(3);
  });

  it('is the declared width at a ratio of 2', () => {
    expect(paintedLineWidth(3, 2)).toBe(3);
  });

  it('snaps 3px down to 10 device pixels at a ratio of 3.5, the phone #805 measured', () => {
    expect(paintedLineWidth(3, 3.5)).toBeCloseTo(2.857142857, 9);
  });

  it('snaps 3px down to 7 device pixels at a ratio of 2.625', () => {
    expect(paintedLineWidth(3, 2.625)).toBeCloseTo(2.666666667, 9);
  });

  it('never paints a line thinner than one device pixel', () => {
    expect(paintedLineWidth(0.25, 2)).toBe(0.5);
  });

  it('keeps a 2px ring narrower than a 3px one at the measured ratio', () => {
    expect(paintedLineWidth(2, 3.5)).toBe(2);
  });
});

describe('readsAsLineWidth', () => {
  it('takes the snapped width the real phone reported', () => {
    expect(readsAsLineWidth(2.85714, 3, 3.5)).toBe(true);
  });

  it('takes the declared width emulated Chrome reported at 2.75', () => {
    expect(readsAsLineWidth(3, 3, 2.75)).toBe(true);
  });

  it('takes the width snapped at 2.75 too, 8 device pixels', () => {
    expect(readsAsLineWidth(2.909090909, 3, 2.75)).toBe(true);
  });

  it('refuses a 2px ring, snapped or not, at the phone ratio', () => {
    expect(readsAsLineWidth(2, 3, 3.5)).toBe(false);
  });

  it('refuses a 2px ring at a ratio of 1', () => {
    expect(readsAsLineWidth(2, 3, 1)).toBe(false);
  });

  it('refuses a 2px ring snapped at 2.75, 5 device pixels', () => {
    expect(readsAsLineWidth(1.818181818, 3, 2.75)).toBe(false);
  });
});
