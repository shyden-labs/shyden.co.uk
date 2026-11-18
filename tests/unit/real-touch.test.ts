import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Locator, Page } from '@playwright/test';

const adbCalls: string[][] = [];
vi.mock('../../scripts/adb.mjs', () => ({
  adb: (args: string[]) => {
    adbCalls.push(args);
    return '';
  },
}));
import {
  backOn,
  landingVerdict,
  mustMove,
  planSwipe,
  type Prepared,
  scrollOver,
  scrollToOn,
  SPARE_SWIPES,
  swipeCeiling,
  tapOn,
  waitUntilMoved,
  waitUntilStill,
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
  it('names the real wheel where the input is a wheel (#1004)', () => {
    expect(whyNotTappable('#go', at(3000), 11, 11, 'wheel')).toBe(
      '#go did not come into view after 11 real wheel turns (the point is at y 3000, the view is 800 tall)',
    );
    expect(whyNotTappable('#go', at(3000), 2, 11, 'wheel')).toMatch(
      /^#go did not come into view: a real wheel turn no longer moves it/,
    );
  });
});

describe('the desktop engines scroll with the real wheel (#1004)', () => {
  const VIEW = { width: 1280, height: 720 };

  /**
   * A page holding one 40 px tall element at `top` in the document, scrolled
   * to `startY`. The real wheel moves `scrollY` within the page's length; any
   * other way of scrolling is recorded, so a test can say it was never taken.
   */
  function fakeDesktop(
    top: number,
    {
      startY = 0,
      length = 4000,
      wheelMoves = true,
      landsAfterSamples = 0,
    } = {},
  ) {
    const sent: unknown[] = [];
    let scrollY = startY;
    // A turn whose scroll the engine applies only after this many samples
    // have read the page (CI's WebKit lands a turn late, #1004).
    let pending: { dy: number; samples: number } | null = null;
    const maxScroll = length - VIEW.height;
    const rect = () => ({ x: 600, y: top - scrollY, width: 80, height: 40 });
    const land = () => {
      if (pending === null || pending.samples > 0) return;
      scrollY = Math.min(maxScroll, Math.max(0, scrollY + pending.dy));
      pending = null;
    };
    const page = {
      mouse: {
        move: async (x: number, y: number) => {
          sent.push(['move', x, y]);
        },
        wheel: async (dx: number, dy: number) => {
          sent.push(['wheel', dx, dy]);
          if (wheelMoves) pending = { dy, samples: landsAfterSamples };
          land();
        },
      },
    };
    const target = {
      page: () => page,
      waitFor: async () => undefined,
      evaluate: async (
        _fn: unknown,
        arg?: { offset?: { x: number; y: number } },
      ) => {
        if (arg === undefined && pending !== null) {
          pending.samples--;
          land();
        }
        const r = rect();
        if (arg === undefined)
          return [r.x, r.y, r.width, r.height, 0, VIEW.height, 0, scrollY].join(
            ',',
          );
        const point = {
          x: r.x + (arg.offset ? arg.offset.x : r.width / 2),
          y: r.y + (arg.offset ? arg.offset.y : r.height / 2),
        };
        return {
          point,
          viewTop: 0,
          viewHeight: VIEW.height,
          viewWidth: VIEW.width,
          inView: point.y >= 0 && point.y <= VIEW.height,
          hit: null,
          keyboard: false,
        };
      },
      click: async (options: unknown) => {
        sent.push(['click', options]);
      },
      hover: async () => {
        sent.push(['hover']);
      },
      scrollIntoViewIfNeeded: async () => {
        sent.push(['scrollIntoViewIfNeeded']);
      },
      toString: () => 'locator(#far)',
    };
    return {
      target: target as unknown as Locator,
      sent,
      centreY: () => rect().y + 20,
    };
  }

  const kinds = (sent: unknown[]) => sent.map((s) => (s as unknown[])[0]);
  const wheelsOf = (sent: unknown[]) =>
    sent.filter((s) => (s as unknown[])[0] === 'wheel') as [
      'wheel',
      number,
      number,
    ][];

  /** Runs the helper to its end on the fake clock, keeping a rejection. */
  const settle = async <T>(work: Promise<T>): Promise<T> => {
    const settled = work.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.runAllTimersAsync();
    const outcome = await settled;
    if ('error' in outcome) throw outcome.error;
    return outcome.value;
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  const setUp = () => {
    vi.stubEnv('PW_REAL_DEVICE', '');
    vi.useFakeTimers();
  };

  const clearOfTheEdges = (y: number) => {
    expect(y).toBeGreaterThanOrEqual(VIEW.height * 0.1);
    expect(y).toBeLessThanOrEqual(VIEW.height * 0.9);
  };

  it('scrollToOn brings an element below the view in with real wheel turns, never by protocol', async () => {
    setUp();
    const { target, sent, centreY } = fakeDesktop(2500);
    await settle(scrollToOn(target));
    expect(wheelsOf(sent).length).toBeGreaterThan(0);
    expect(wheelsOf(sent).every(([, dx, dy]) => dx === 0 && dy > 0)).toBe(true);
    expect(kinds(sent)).not.toContain('scrollIntoViewIfNeeded');
    clearOfTheEdges(centreY());
  });

  it('scrollToOn turns the wheel the other way for an element above the view', async () => {
    setUp();
    const { target, sent, centreY } = fakeDesktop(200, { startY: 2000 });
    await settle(scrollToOn(target));
    expect(wheelsOf(sent).length).toBeGreaterThan(0);
    expect(wheelsOf(sent).every(([, , dy]) => dy < 0)).toBe(true);
    clearOfTheEdges(centreY());
  });

  it('scrollToOn sends no input for an element already in view', async () => {
    setUp();
    const { target, sent } = fakeDesktop(300);
    await settle(scrollToOn(target));
    expect(sent).toEqual([]);
  });

  it('turns the wheel with the mouse over the view, before each turn', async () => {
    setUp();
    const { target, sent } = fakeDesktop(2500);
    await settle(scrollToOn(target));
    expect(wheelsOf(sent).length).toBeGreaterThan(0);
    const k = kinds(sent);
    k.forEach((kind, i) => {
      if (kind === 'wheel') expect(k[i - 1]).toBe('move');
    });
    for (const s of sent.filter((s) => (s as unknown[])[0] === 'move')) {
      const [, x, y] = s as [string, number, number];
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(VIEW.width);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(VIEW.height);
    }
  });

  it('tapOn wheels the element in, then clicks it with the real mouse once', async () => {
    setUp();
    const { target, sent } = fakeDesktop(2500);
    await settle(tapOn(target, { position: { x: 4, y: 4 } }));
    expect(wheelsOf(sent).length).toBeGreaterThan(0);
    expect(sent.at(-1)).toEqual(['click', { position: { x: 4, y: 4 } }]);
    expect(kinds(sent).filter((k) => k === 'click')).toHaveLength(1);
  });

  it('fails naming the element when a real wheel turn no longer moves it', async () => {
    setUp();
    const { target, sent } = fakeDesktop(2500, { wheelMoves: false });
    await expect(settle(tapOn(target))).rejects.toThrow(
      /^locator\(#far\) did not come into view: a real wheel turn no longer moves it/,
    );
    expect(kinds(sent)).not.toContain('scrollIntoViewIfNeeded');
    expect(kinds(sent)).not.toContain('click');
  });

  it('one wheel turn covers the whole distance to an element far down a long page (Shyden, 2026-11-19)', async () => {
    setUp();
    const { target, sent, centreY } = fakeDesktop(20_000, { length: 30_000 });
    await settle(scrollToOn(target));
    expect(wheelsOf(sent)).toHaveLength(1);
    clearOfTheEdges(centreY());
  });

  it('waits for a wheel turn the engine lands late, and turns the wheel once', async () => {
    setUp();
    const { target, sent, centreY } = fakeDesktop(2500, {
      landsAfterSamples: 12,
    });
    await settle(scrollToOn(target));
    expect(wheelsOf(sent)).toHaveLength(1);
    clearOfTheEdges(centreY());
  });

  it('scrollOver turns the wheel over the centre of an element in view, without hover()', async () => {
    setUp();
    const { target, sent } = fakeDesktop(300);
    await settle(scrollOver(target, 240));
    expect(sent).toEqual([
      ['move', 640, 320],
      ['wheel', 0, 240],
    ]);
  });

  it('scrollOver wheels an element below the view in first', async () => {
    setUp();
    const { target, sent } = fakeDesktop(2500);
    await settle(scrollOver(target, 240));
    expect(kinds(sent)).not.toContain('hover');
    expect(sent.at(-1)).toEqual(['wheel', 0, 240]);
    expect(wheelsOf(sent).length).toBeGreaterThan(1);
  });
});

/** A clock the test owns: sleep moves it, nothing else does (#1044). */
const testClock = () => {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
};

describe('waitUntilMoved', () => {
  it('returns as soon as a sample differs from the one before the input', async () => {
    const shapes = ['a', 'a', 'a', 'b'];
    let read = 0;
    const result = await waitUntilMoved(async () => shapes[read++]!, 'a', {
      gapMs: 16,
      ceilingMs: 1_000,
      clock: testClock(),
    });
    expect(result).toEqual({ moved: true, waitedMs: 3 * 16 });
    expect(read).toBe(4);
  });

  it('reads once and returns at once when the page has already moved', async () => {
    let read = 0;
    const result = await waitUntilMoved(async () => (read++, 'b'), 'a', {
      gapMs: 16,
      ceilingMs: 1_000,
      clock: testClock(),
    });
    expect(result).toEqual({ moved: true, waitedMs: 0 });
    expect(read).toBe(1);
  });

  it('gives up at the ceiling, on its own clock, when nothing moves', async () => {
    const result = await waitUntilMoved(async () => 'a', 'a', {
      gapMs: 16,
      ceilingMs: 100,
      clock: testClock(),
    });
    expect(result).toEqual({ moved: false, waitedMs: 112 });
  });
});

describe('waitUntilStill', () => {
  it('is still once six samples in a row match the one before', async () => {
    const shapes = ['a', 'b', 'c', 'c', 'c', 'c', 'c', 'c', 'c', 'x'];
    let read = 0;
    const result = await waitUntilStill(async () => shapes[read++]!, {
      gapMs: 16,
      ceilingMs: 3_000,
      clock: testClock(),
    });
    expect(result).toEqual({ still: true, waitedMs: 8 * 16 });
    expect(read).toBe(9);
  });

  it('starts the count again when the shape moves', async () => {
    const shapes = ['a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', 'b', 'b', 'b', 'b'];
    let read = 0;
    const result = await waitUntilStill(async () => shapes[read++]!, {
      gapMs: 10,
      ceilingMs: 3_000,
      clock: testClock(),
    });
    expect(result).toEqual({ still: true, waitedMs: 11 * 10 });
  });

  it('gives up at the ceiling, on its own clock, when the shape never settles', async () => {
    let read = 0;
    const result = await waitUntilStill(async () => String(read++), {
      gapMs: 16,
      ceilingMs: 100,
      clock: testClock(),
    });
    expect(result).toEqual({ still: false, waitedMs: 112 });
  });
});

describe('landingVerdict', () => {
  it('has landed once a trusted click reached the element', () => {
    expect(
      landingVerdict({ at: 'ok', stray: null, clicked: true }, 0, 2_000),
    ).toBeNull();
  });

  it('names a stray touch at once', () => {
    expect(
      landingVerdict(
        { at: null, stray: 'div#x (touch, trusted true)', clicked: false },
        10,
        2_000,
      ),
    ).toBe('the touch reached div#x (touch, trusted true) instead');
  });

  it('keeps waiting while nothing has arrived inside the ceiling', () => {
    expect(
      landingVerdict({ at: null, stray: null, clicked: false }, 1_999, 2_000),
    ).toBe('wait');
    expect(
      landingVerdict({ at: null, stray: null, clicked: false }, 2_000, 2_000),
    ).toBe('wait');
    expect(landingVerdict(undefined, 0, 2_000)).toBe('wait');
  });

  it('says a touch with no click past the ceiling may have stopped a scroll', () => {
    expect(
      landingVerdict({ at: 'ok', stray: null, clicked: false }, 2_001, 2_000),
    ).toBe(
      'the touch reached it but no click followed within 2 s (Chrome may have taken it as stopping a scroll)',
    );
  });

  it('says nothing reached it past the ceiling', () => {
    expect(
      landingVerdict({ at: null, stray: null, clicked: false }, 2_001, 2_000),
    ).toBe('no touch reached it within 2 s');
  });
});

describe('scrollOver', () => {
  /** A locator whose page records each input it is sent. */
  function fakeTarget() {
    const sent: unknown[] = [];
    const cdp = {
      send: async (method: string, params: unknown) => {
        sent.push([method, params]);
      },
    };
    const page = {
      context: () => ({ newCDPSession: async () => cdp }),
      mouse: {
        wheel: async (dx: number, dy: number) => {
          sent.push(['wheel', dx, dy]);
        },
      },
    };
    const target = {
      page: () => page,
      hover: async () => {
        sent.push(['hover']);
      },
      boundingBox: async () => ({ x: 100, y: 300, width: 80, height: 40 }),
      toString: () => 'locator(#cg-count)',
    };
    return { target: target as unknown as Locator, sent };
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('drags a real finger from the element the opposite way on the phone', async () => {
    vi.stubEnv('PW_REAL_DEVICE', '1');
    vi.useFakeTimers();
    const { target, sent } = fakeTarget();
    const done = scrollOver(target, 200);
    await vi.runAllTimersAsync();
    await done;
    const touches = sent as [
      string,
      { type: string; touchPoints: { x: number; y: number }[] },
    ][];
    expect(
      touches.every(([method]) => method === 'Input.dispatchTouchEvent'),
    ).toBe(true);
    expect(touches[0]![1]).toEqual({
      type: 'touchStart',
      touchPoints: [{ x: 140, y: 320 }],
    });
    expect(touches.at(-2)![1]).toEqual({
      type: 'touchMove',
      touchPoints: [{ x: 140, y: 120 }],
    });
    expect(touches.at(-1)![1]).toEqual({ type: 'touchEnd', touchPoints: [] });
  });

  it('fails naming the element when it has no box to put a finger on', async () => {
    vi.stubEnv('PW_REAL_DEVICE', '1');
    const { target } = fakeTarget();
    (target as unknown as { boundingBox: () => Promise<null> }).boundingBox =
      async () => null;
    await expect(scrollOver(target, 200)).rejects.toThrow(
      'locator(#cg-count) has no box to put a finger on',
    );
  });
});

describe('backOn', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    adbCalls.length = 0;
  });

  const fakePage = () => {
    const sent: unknown[] = [];
    const page = {
      goBack: async (options: unknown) => {
        sent.push(['goBack', options]);
        return null;
      },
    };
    return { page: page as unknown as Page, sent };
  };

  it("goes Back through the browser's own history where there is no phone", async () => {
    vi.stubEnv('PW_REAL_DEVICE', '');
    const { page, sent } = fakePage();
    await backOn(page);
    expect(sent).toEqual([['goBack', { waitUntil: 'commit' }]]);
    expect(adbCalls).toEqual([]);
  });

  it("presses the phone's own Back key on the phone", async () => {
    vi.stubEnv('PW_REAL_DEVICE', '1');
    const { page, sent } = fakePage();
    await backOn(page);
    expect(adbCalls).toEqual([['shell', 'input', 'keyevent', 'KEYCODE_BACK']]);
    expect(sent).toEqual([]);
  });
});
