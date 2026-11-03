import { describe, expect, it } from 'vitest';
import {
  mustMove,
  planSwipe,
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
      '#go did not come into view after 11 real swipes (the point is at y 3000, the view is 800 tall)',
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
});
