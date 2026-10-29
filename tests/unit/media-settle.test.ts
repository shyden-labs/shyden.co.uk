import { afterEach, describe, expect, it, vi } from 'vitest';
import { SPIN_CYCLE_MS, videosIdleFor } from '../e2e/media-settle';

/**
 * The visual suite waits for every video to have been idle for a whole
 * spinner cycle before it captures (#968). `videosIdleFor` runs in the page,
 * once per poll; here the page's videos and clock are stood in for.
 */
const NETWORK_IDLE = 1;
const NETWORK_LOADING = 2;

/** A stand-in `<video>`: its network state, and the constant the page reads it against. */
const video = (networkState: number) => ({ networkState, NETWORK_IDLE });

/** Puts `videos` on the page and the page's clock at `now`, then polls once. */
const poll = (videos: readonly object[], now: number) => {
  vi.stubGlobal('document', { querySelectorAll: () => videos });
  vi.stubGlobal('performance', { now: () => now });
  return videosIdleFor(SPIN_CYCLE_MS);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('videosIdleFor: every video idle for a whole spinner cycle (#968)', () => {
  it('is one cycle of mask-1-spin, as Chromium draws it', () => {
    expect(SPIN_CYCLE_MS).toBe(1_333);
  });

  it('holds on a page with no video at all', () => {
    expect(poll([], 0)).toBe(true);
  });

  it('waits a whole cycle from the poll that first saw the video idle', () => {
    const v = video(NETWORK_IDLE);
    expect(poll([v], 100)).toBe(false);
    expect(poll([v], 100 + SPIN_CYCLE_MS - 1)).toBe(false);
    expect(poll([v], 100 + SPIN_CYCLE_MS)).toBe(true);
  });

  it('starts the cycle again when a video leaves idle', () => {
    const v = video(NETWORK_IDLE);
    expect(poll([v], 0)).toBe(false);
    v.networkState = NETWORK_LOADING;
    expect(poll([v], 1_000)).toBe(false);
    v.networkState = NETWORK_IDLE;
    expect(poll([v], 2_000)).toBe(false);
    expect(poll([v], 2_000 + SPIN_CYCLE_MS - 1)).toBe(false);
    expect(poll([v], 2_000 + SPIN_CYCLE_MS)).toBe(true);
  });

  it('times every video, including one after a video still loading', () => {
    // The second video's cycle starts at the first poll that sees it idle,
    // even while the first one holds the answer at false.
    const first = video(NETWORK_LOADING);
    const second = video(NETWORK_IDLE);
    expect(poll([first, second], 0)).toBe(false);
    first.networkState = NETWORK_IDLE;
    expect(poll([first, second], 500)).toBe(false);
    expect(poll([first, second], 500 + SPIN_CYCLE_MS)).toBe(true);
  });

  it('never holds while any video is loading, however long the others idled', () => {
    const idle = video(NETWORK_IDLE);
    const loading = video(NETWORK_LOADING);
    expect(poll([idle, loading], 0)).toBe(false);
    expect(poll([idle, loading], 10 * SPIN_CYCLE_MS)).toBe(false);
  });
});
