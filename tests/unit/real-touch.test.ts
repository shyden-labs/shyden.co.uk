import { describe, expect, it } from 'vitest';
import {
  CENTRE_SHARE,
  mustMove,
  planSwipe,
  planWheel,
  scrollMover,
  type Prepared,
  SPARE_SWIPES,
  swipeCeiling,
  whyNotTappable,
} from '../real-touch';

/**
 * The Android run's real-touch rules (#996): when the page must be dragged,
 * which way and how far, how many drags a point may take, and when a tap
 * cannot be made. The drags and taps themselves need the phone; these rules
 * do not.
 */

const at = (y: number, extra: Partial<Prepared> = {}): Prepared => ({
  point: { x: 200, y },
  viewTop: 0,
  viewHeight: 800,
  viewWidth: 400,
  inView: y >= 0 && y <= 800,
  hit: null,
  keyboard: false,
  ...extra,
});

describe('mustMove', () => {
  it('moves a point out of view', () => {
    expect(mustMove(at(1200))).toBe(true);
    expect(mustMove(at(-300))).toBe(true);
  });
  it('moves a point inside the top or bottom tenth of the view', () => {
    expect(mustMove(at(79))).toBe(true);
    expect(mustMove(at(721))).toBe(true);
  });
  it('leaves a point clear of both edges, middle or not', () => {
    expect(mustMove(at(80))).toBe(false);
    expect(mustMove(at(720))).toBe(false);
    expect(mustMove(at(400))).toBe(false);
  });
  it('moves a covered point, wherever it is', () => {
    expect(mustMove(at(400, { hit: 'div.bar' }))).toBe(true);
  });
  it('with no edge (off the phone), moves only a point out of view (#1004)', () => {
    expect(mustMove(at(30), 0)).toBe(false);
    expect(mustMove(at(790), 0)).toBe(false);
    expect(mustMove(at(-1), 0)).toBe(true);
    expect(mustMove(at(801), 0)).toBe(true);
  });
  it('with the centre band, moves a point within 30% of either edge (#1004)', () => {
    expect(mustMove(at(239), CENTRE_SHARE)).toBe(true);
    expect(mustMove(at(240), CENTRE_SHARE)).toBe(false);
    expect(mustMove(at(560), CENTRE_SHARE)).toBe(false);
    expect(mustMove(at(561), CENTRE_SHARE)).toBe(true);
  });
  it('reads the edges from the visual viewport offset', () => {
    expect(mustMove(at(1100, { viewTop: 1000, inView: true }))).toBe(false);
  });
});

describe('swipeCeiling', () => {
  it('allows the drags the distance needs, and six more', () => {
    // 19,422 px below the middle at 480 px a drag: 41 drags, then six.
    expect(swipeCeiling(at(19822))).toBe(41 + SPARE_SWIPES);
  });
  it('allows the spare drags alone for a point already at the middle', () => {
    expect(swipeCeiling(at(400))).toBe(SPARE_SWIPES);
  });
});

describe('planSwipe', () => {
  it('drags the finger up the page to bring content below into view, at most 60% of the view', () => {
    const { from, to } = planSwipe(at(3000));
    expect(from.x).toBe(360);
    expect(to.x).toBe(360);
    expect(from.y - to.y).toBe(480);
    expect((from.y + to.y) / 2).toBe(400);
  });
  it('drags down for content above', () => {
    const { from, to } = planSwipe(at(-1000));
    expect(to.y - from.y).toBe(480);
  });
  it('drags exactly as far as needed when that is within reach', () => {
    const { from, to } = planSwipe(at(700));
    expect(from.y - to.y).toBe(300);
  });
  it('never drags less than 40 px, which Chrome would read as a tap', () => {
    const { from, to } = planSwipe(at(410));
    expect(from.y - to.y).toBe(40);
  });
});

describe('whyNotTappable', () => {
  it('allows a point in view with nothing over it', () => {
    expect(whyNotTappable('#go', at(400), 0, 6)).toBeNull();
  });
  it('names the element and the ceiling when it never came into view', () => {
    expect(whyNotTappable('#go', at(3000), 11, 11)).toBe(
      '#go did not come into view after 11 real swipes (the point is at x 200, y 3000; the view is 400 wide, 800 tall)',
    );
  });
  it('says the page stopped moving when a swipe no longer moves it', () => {
    expect(whyNotTappable('#go', at(3000), 2, 11)).toMatch(
      /^#go did not come into view: a real swipe no longer moves it/,
    );
  });
  it('names what covers the point', () => {
    expect(
      whyNotTappable('#go', at(400, { hit: 'span#mutant-cover' }), 0, 6),
    ).toBe('#go is covered: a finger there would touch span#mutant-cover');
  });
  it('names wheel steps and a pointer when the page is moved by the wheel (#1004)', () => {
    expect(whyNotTappable('#go', at(3000), 11, 11, 'wheel')).toBe(
      '#go did not come into view after 11 real wheel steps (the point is at x 200, y 3000; the view is 400 wide, 800 tall)',
    );
    expect(whyNotTappable('#go', at(3000), 2, 11, 'wheel')).toMatch(
      /^#go did not come into view: a real wheel step no longer moves it/,
    );
    expect(
      whyNotTappable('#go', at(400, { hit: 'div.bar' }), 0, 6, 'wheel'),
    ).toBe('#go is covered: a pointer there would touch div.bar');
  });
});

describe('planWheel (#1004)', () => {
  it('turns the wheel by exactly the distance to the middle when that is within reach', () => {
    expect(planWheel(at(700))).toEqual([300]);
    expect(planWheel(at(100))).toEqual([-300]);
  });
  it('spins a far point in steps of at most 60% of the view, summing to the distance', () => {
    const steps = planWheel(at(2000));
    expect(steps).toEqual([480, 480, 480, 160]);
    expect(steps.reduce((a, b) => a + b, 0)).toBe(1600);
    expect(planWheel(at(-1000))).toEqual([-480, -480, -440]);
  });
  it('never turns less than 40 px', () => {
    expect(planWheel(at(410))).toEqual([40]);
    expect(planWheel(at(390))).toEqual([-40]);
  });
});

describe('scrollMover (#1004)', () => {
  it('drags a finger on the real phone, whatever the engine says', () => {
    expect(
      scrollMover({ realDevice: true, engine: 'chromium', touch: true }),
    ).toBe('touch');
  });
  it("drags a finger on Chromium's emulated phone, the one emulator that takes touch drags", () => {
    expect(
      scrollMover({ realDevice: false, engine: 'chromium', touch: true }),
    ).toBe('touch');
  });
  it("turns the wheel on desktop engines, and on WebKit's emulated iPhone as a marked stand-in", () => {
    expect(
      scrollMover({ realDevice: false, engine: 'chromium', touch: false }),
    ).toBe('wheel');
    expect(
      scrollMover({ realDevice: false, engine: 'firefox', touch: false }),
    ).toBe('wheel');
    expect(
      scrollMover({ realDevice: false, engine: 'webkit', touch: false }),
    ).toBe('wheel');
    expect(
      scrollMover({ realDevice: false, engine: 'webkit', touch: true }),
    ).toBe('wheel');
  });
});
