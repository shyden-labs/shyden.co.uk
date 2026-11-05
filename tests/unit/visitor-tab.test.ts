import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from '@playwright/test';

vi.mock('../../scripts/adb.mjs', () => ({ adb: vi.fn(() => '') }));

import { adb } from '../../scripts/adb.mjs';
import {
  INTENT_LAUNCH_BUDGET,
  INTENT_RESET_GAP_MS,
  IntentPacer,
  VISITOR_TAB_TIMEOUT_MS,
  openVisitorTab,
  openTabsAsAVisitor,
} from '../device/visitor-tab';

/**
 * #807: on the real Android phone, a tab Playwright makes with `context.newPage()` (DevTools'
 * `Target.createTarget`) crashes the whole of Chrome the moment a `<datalist>` field shows its
 * suggestions: `AutofillProvider.showDatalistPopup`, then a null view in
 * `ViewAndroidDelegate.setViewPosition`. Measured 5 of 5 on such tabs, 0 of 5 on a tab Chrome
 * opened for an intent and Playwright adopted, and 0 of 10 for a visitor. So the device leg opens
 * every tab the way a visitor's link does, and adopts it.
 */

const adbCalls = vi.mocked(adb);

/** A stand-in for the phone's one context: `waitForEvent` hands back `tab`, or rejects. */
function phoneContext(
  outcome: { tab: Page } | { error: Error },
  order: string[] = [],
) {
  const rawNewPage = vi.fn(async () => {
    throw new Error('a test called the raw CDP newPage');
  });
  const context = {
    waitForEvent: vi.fn((event: string) => {
      order.push(`waitForEvent:${event}`);
      return 'tab' in outcome
        ? Promise.resolve(outcome.tab)
        : Promise.reject(outcome.error);
    }),
    pages: vi.fn(() => [{}, {}] as Page[]),
    newPage: rawNewPage,
  };
  return {
    context: context as unknown as BrowserContext,
    raw: context,
    rawNewPage,
  };
}

const tab = { url: () => 'about:blank' } as unknown as Page;

beforeEach(() => adbCalls.mockClear());

describe('openVisitorTab', () => {
  it('asks Chrome for a new about:blank tab through a VIEW intent', async () => {
    const { context } = phoneContext({ tab });
    await openVisitorTab(context);
    expect(adbCalls.mock.calls).toEqual([
      [
        [
          'shell',
          'am',
          'start',
          '-a',
          'android.intent.action.VIEW',
          '-d',
          'about:blank',
          'com.android.chrome',
        ],
      ],
    ]);
  });

  it('returns the tab Chrome opened for the intent', async () => {
    const { context } = phoneContext({ tab });
    await expect(openVisitorTab(context)).resolves.toBe(tab);
  });

  it('listens for the new tab before sending the intent, so a fast tab is not missed', async () => {
    const order: string[] = [];
    adbCalls.mockImplementationOnce(() => {
      order.push('adb');
      return '';
    });
    const { context } = phoneContext({ tab }, order);
    await openVisitorTab(context);
    expect(order).toEqual(['waitForEvent:page', 'adb']);
  });

  it('sends its intent only once the pacer lets it', async () => {
    const order: string[] = [];
    adbCalls.mockImplementationOnce(() => {
      order.push('adb');
      return '';
    });
    const { context } = phoneContext({ tab }, order);
    const pacer = {
      beforeIntent: vi.fn(async () => {
        order.push('pacer');
      }),
    } as unknown as IntentPacer;
    await openVisitorTab(context, pacer);
    expect(order).toEqual(['pacer', 'waitForEvent:page', 'adb']);
  });

  it('waits five seconds for the tab, and for an about:blank one only', async () => {
    const { context, raw } = phoneContext({ tab });
    await openVisitorTab(context);
    expect(VISITOR_TAB_TIMEOUT_MS).toBe(5_000);
    const [, options] = raw.waitForEvent.mock.calls[0] as unknown as [
      string,
      { timeout: number; predicate: (page: Page) => boolean },
    ];
    expect(options.timeout).toBe(5_000);
    expect(
      options.predicate({ url: () => 'about:blank' } as unknown as Page),
    ).toBe(true);
    expect(
      options.predicate({
        url: () => 'http://localhost:4321/',
      } as unknown as Page),
    ).toBe(false);
  });

  it('fails naming the wait and the tabs open when Chrome opens none', async () => {
    const { context } = phoneContext({
      error: new Error('Timeout 5000ms exceeded'),
    });
    await expect(openVisitorTab(context)).rejects.toThrow(
      'Chrome opened no tab within 5000ms of the about:blank VIEW intent (#807); ' +
        'tabs open: 2; Playwright said: Timeout 5000ms exceeded',
    );
  });
});

describe('openTabsAsAVisitor', () => {
  it("routes the context's newPage through the VIEW intent", async () => {
    const { context, rawNewPage } = phoneContext({ tab });
    openTabsAsAVisitor(context);
    await expect(context.newPage()).resolves.toBe(tab);
    expect(rawNewPage).not.toHaveBeenCalled();
    expect(adbCalls).toHaveBeenCalledTimes(1);
  });

  it('patches a context once, however many tests ask', async () => {
    const { context } = phoneContext({ tab });
    openTabsAsAVisitor(context);
    const patched = context.newPage;
    openTabsAsAVisitor(context);
    expect(context.newPage).toBe(patched);
    await context.newPage();
    expect(adbCalls).toHaveBeenCalledTimes(1);
  });
});

/**
 * Android kills an app whose activities launch too fast (AOSP
 * `WindowProcessController.updateRapidActivityLaunch`): a launch within 500 ms of the previous one
 * adds 1, a gap of 1,500 ms or more resets the count, and above 200 the task is removed and the
 * process killed, `am_kill … rapidActivityLaunch`. Each intent launches Chrome's trampoline
 * activity and then its tabbed activity, so a run of fast tests reached 200 and the phone killed
 * Chrome at test 216 (2026-10-18). The pacer counts what the harness causes and, before the count
 * would pass a budget under Android's, waits out the reset gap.
 */
describe('IntentPacer', () => {
  /** A clock that only moves when told to, and a wait that moves it. */
  function pacedClock() {
    let now = 1_000_000;
    const waits: number[] = [];
    const pacer = new IntentPacer(
      () => now,
      async (ms) => {
        waits.push(ms);
        now += ms;
      },
    );
    const start = now;
    return {
      pacer,
      waits,
      /** Time passed since the clock was made, waits included. */
      elapsed: () => now - start,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it("keeps the harness's count a quarter under Android's 200", () => {
    expect(INTENT_LAUNCH_BUDGET).toBe(150);
  });

  it("waits 2 s, Android's 1.5 s reset plus the trampoline's own launch", () => {
    expect(INTENT_RESET_GAP_MS).toBe(2_000);
  });

  it('lets 75 rapid intents through in the time they take themselves', async () => {
    const { pacer, elapsed, advance } = pacedClock();
    for (let i = 0; i < 75; i++) {
      await pacer.beforeIntent();
      advance(100);
    }
    expect(elapsed()).toBe(7_500);
  });

  it('waits out the rest of the reset gap before the 76th rapid intent', async () => {
    const { pacer, waits, advance } = pacedClock();
    for (let i = 0; i < 75; i++) {
      await pacer.beforeIntent();
      advance(100);
    }
    await pacer.beforeIntent();
    expect(waits).toEqual([1_900]);
  });

  it('counts from zero again after the wait', async () => {
    const { pacer, waits, advance } = pacedClock();
    for (let i = 0; i < 151; i++) {
      await pacer.beforeIntent();
      advance(100);
    }
    expect(waits).toEqual([1_900, 1_900]);
  });

  it('counts from zero after a natural gap of the reset length', async () => {
    const { pacer, elapsed, advance } = pacedClock();
    for (let i = 0; i < 75; i++) {
      await pacer.beforeIntent();
      advance(100);
    }
    advance(2_000);
    for (let i = 0; i < 75; i++) {
      await pacer.beforeIntent();
      advance(100);
    }
    // 150 intents of 100 ms and the 2 s gap, with nothing added by the pacer.
    expect(elapsed()).toBe(17_000);
  });
});
