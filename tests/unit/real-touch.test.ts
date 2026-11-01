import { describe, expect, it } from 'vitest';
import {
  MAX_SWIPES,
  mustMove,
  planSwipe,
  type Prepared,
  whyNotTappable,
} from '../real-touch';

/**
 * The Android run's real-touch rules (#996): when the page must be dragged,
 * which way and how far, and when a tap cannot be made. The drags and taps
 * themselves need the phone; these rules do not.
 */

const view = { viewTop: 0, viewHeight: 800, viewWidth: 400 };
const at = (y: number, extra: Partial<Prepared> = {}): Prepared => ({
  rect: { x: 100, y, width: 200, height: 40 },
  ...view,
  inView: y >= 0 && y + 40 <= 800,
  hit: null,
  ...extra,
});

describe('mustMove', () => {
  it('moves an element out of view', () => {
    expect(mustMove(at(1200))).toBe(true);
    expect(mustMove(at(-300))).toBe(true);
  });
  it('moves an element in view whose centre is outside the middle half', () => {
    // Middle half of 800: centre between 200 and 600.
    expect(mustMove(at(150))).toBe(true); // centre 170
    expect(mustMove(at(600))).toBe(true); // centre 620
  });
  it('leaves an element whose centre is in the middle half', () => {
    expect(mustMove(at(180))).toBe(false); // centre 200, the edge
    expect(mustMove(at(580))).toBe(false); // centre 600, the edge
    expect(mustMove(at(380))).toBe(false);
  });
  it('reads the middle from the visual viewport offset', () => {
    expect(mustMove(at(1180, { viewTop: 1000, inView: true }))).toBe(false); // centre 1200 = 1000 + 200
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
    const { from, to } = planSwipe(at(680)); // centre 700, 300 below the middle
    expect(from.y - to.y).toBe(300);
  });
  it('never drags less than 40 px, which Chrome would read as a tap', () => {
    const { from, to } = planSwipe(at(390)); // centre 410, 10 below the middle
    expect(from.y - to.y).toBe(40);
  });
});

describe('whyNotTappable', () => {
  it('allows an element in view with nothing over its centre', () => {
    expect(whyNotTappable('#go', at(380), 0)).toBeNull();
  });
  it('names the element and the swipe ceiling when it never came into view', () => {
    expect(whyNotTappable('#go', at(3000), MAX_SWIPES)).toBe(
      `#go did not come into view after ${MAX_SWIPES} real swipes (its box is at y 3000, the view is 800 tall)`,
    );
  });
  it('says the page stopped moving when a swipe no longer moves it', () => {
    expect(whyNotTappable('#go', at(3000), 2)).toMatch(
      /^#go did not come into view: a real swipe no longer moves it/,
    );
  });
  it('names what covers the centre', () => {
    expect(
      whyNotTappable('#go', at(380, { hit: 'span#mutant-cover' }), 0),
    ).toBe(
      '#go is covered: a finger at its centre would touch span#mutant-cover',
    );
  });
});
