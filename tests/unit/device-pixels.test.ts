import { describe, expect, it } from 'vitest';
import {
  coverGaps,
  paintedLineWidth,
  readsAsLineWidth,
  type Cover,
} from '../device-pixels';
import { searched } from '../source-files';

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

/**
 * Whether the refused-grant board covers the window to the device pixel
 * (#837). The real Android phone (ratio 3.5) measured the board, and
 * `visualViewport`, at 759.4285888671875 CSS px tall, 2658 device pixels,
 * while `innerHeight` said 759: the window's size FLOORED to a whole CSS
 * pixel. On the 2026-10-16 gauntlet the same floor cost 5/7 px
 * (309.714 -> 309), past `toBeCloseTo`'s half pixel. Every figure below is
 * that phone's, or worked by hand from it, never from the helper.
 */
const phone = (over: Partial<Cover> = {}): Cover => ({
  board: {
    width: 411.4285888671875,
    height: 759.4285888671875,
    top: 0,
    left: 0,
  },
  inner: { width: 411, height: 759 },
  visual: { width: 411.4285583496094, height: 759.4285888671875 },
  ratio: 3.5,
  ...over,
});

/**
 * A cover verdict with its population inside: every check `coverGaps` made,
 * so a judgement that quietly stopped checking cannot read as a board that
 * covers the window (#118).
 */
const expectCovers = (m: Cover) => {
  const { checked, gaps } = coverGaps(m);
  expect(searched(gaps, { of: checked, what: 'cover checks' })).toEqual([]);
};

describe('coverGaps', () => {
  it('finds none on the real phone, 2658 device pixels tall', () => {
    expectCovers(phone());
  });

  it('finds none at the gauntlet height that failed, 309.714 floored to 309', () => {
    expectCovers(
      phone({
        board: {
          width: 411.4285888671875,
          height: 309.71429443359375,
          top: 0,
          left: 0,
        },
        inner: { width: 411, height: 309 },
        visual: { width: 411.4285583496094, height: 309.71429443359375 },
      }),
    );
  });

  it('finds none in a whole-pixel emulated window at a ratio of 3', () => {
    expectCovers({
      board: { width: 390, height: 844, top: 0, left: 0 },
      inner: { width: 390, height: 844 },
      visual: { width: 390, height: 844 },
      ratio: 3,
    });
  });

  it('finds none in emulated mobile Chrome, 727 CSS px at 2.75 being 1999.25 device px', () => {
    // Measured on CI's mobile-chrome, record run 39105622181.
    expectCovers({
      board: { width: 393, height: 727, top: 0, left: 0 },
      inner: { width: 393, height: 727 },
      visual: { width: 393, height: 727 },
      ratio: 2.75,
    });
  });

  it('takes a window whose size is already whole, the floor costing nothing', () => {
    expectCovers(
      phone({
        board: { width: 411.4285888671875, height: 760, top: 0, left: 0 },
        inner: { width: 411, height: 760 },
        visual: { width: 411.4285583496094, height: 760 },
      }),
    );
  });

  it('names a board one CSS pixel short on the phone', () => {
    expect(
      coverGaps(
        phone({
          board: {
            width: 411.4285888671875,
            height: 758.4285888671875,
            top: 0,
            left: 0,
          },
        }),
      ).gaps,
    ).toEqual([
      'height: the board is 2655 device px, the viewport 2658 (ratio 3.5)',
    ]);
  });

  it('names a board one DEVICE pixel short on the phone', () => {
    expect(
      coverGaps(
        phone({
          board: {
            width: 411.4285888671875,
            height: 759.1428745814732,
            top: 0,
            left: 0,
          },
        }),
      ).gaps,
    ).toEqual([
      'height: the board is 2657 device px, the viewport 2658 (ratio 3.5)',
    ]);
  });

  it('names a board one pixel short at a ratio of 1', () => {
    expect(
      coverGaps({
        board: { width: 1280, height: 719, top: 0, left: 0 },
        inner: { width: 1280, height: 720 },
        visual: { width: 1280, height: 720 },
        ratio: 1,
      }).gaps,
    ).toEqual([
      'height: the board is 719 device px, the viewport 720 (ratio 1)',
    ]);
  });

  it('names a board one CSS pixel narrow on the phone', () => {
    expect(
      coverGaps(
        phone({
          board: {
            width: 410.4285888671875,
            height: 759.4285888671875,
            top: 0,
            left: 0,
          },
        }),
      ).gaps,
    ).toEqual([
      'width: the board is 1437 device px, the viewport 1440 (ratio 3.5)',
    ]);
  });

  it('names a full-height board pushed one pixel down', () => {
    expect(
      coverGaps(
        phone({
          board: {
            width: 411.4285888671875,
            height: 759.4285888671875,
            top: 1,
            left: 0,
          },
        }),
      ).gaps,
    ).toEqual([
      "top: the board starts 4 device px from the viewport's edge (ratio 3.5)",
    ]);
  });

  it('names a full-width board pushed one pixel left', () => {
    expect(
      coverGaps(
        phone({
          board: {
            width: 411.4285888671875,
            height: 759.4285888671875,
            top: 0,
            left: -1,
          },
        }),
      ).gaps,
    ).toEqual([
      "left: the board starts -3 device px from the viewport's edge (ratio 3.5)",
    ]);
  });

  it('refuses a visual viewport more than a CSS pixel past innerHeight', () => {
    expect(
      coverGaps(
        phone({
          board: { width: 411.4285888671875, height: 760.5, top: 0, left: 0 },
          visual: { width: 411.4285583496094, height: 760.5 },
        }),
      ).gaps,
    ).toEqual([
      "height: the visual viewport's 2662 device px is not the window's 759 floored (ratio 3.5)",
    ]);
  });

  it('refuses a visual viewport a whole CSS pixel past innerHeight', () => {
    expect(
      coverGaps(
        phone({
          board: { width: 411.4285888671875, height: 760, top: 0, left: 0 },
          visual: { width: 411.4285583496094, height: 760 },
        }),
      ).gaps,
    ).toEqual([
      "height: the visual viewport's 2660 device px is not the window's 759 floored (ratio 3.5)",
    ]);
  });

  it('refuses a visual viewport smaller than innerHeight', () => {
    expect(
      coverGaps(
        phone({
          board: {
            width: 411.4285888671875,
            height: 758.4285888671875,
            top: 0,
            left: 0,
          },
          visual: { width: 411.4285583496094, height: 758.4285888671875 },
        }),
      ).gaps,
    ).toEqual([
      "height: the visual viewport's 2655 device px is not the window's 759 floored (ratio 3.5)",
    ]);
  });

  it('refuses to judge without a visual viewport', () => {
    expect(coverGaps(phone({ visual: null })).gaps).toEqual([
      "no visualViewport, so the viewport's fractional size cannot be read",
    ]);
  });
});
