import type { Page } from '@playwright/test';

/**
 * Notes the moment each student card is dealt (gains the `dealt` class), so
 * a test can tell a deal placed one by one from one placed all at once
 * (#1339: reduced motion gets the full deal, at its normal pace, with
 * nothing moving). Call before the press that starts the deal.
 */
export const recordDealTimes = (page: Page) =>
  page.evaluate(() => {
    const w = window as Window & { __cgDealTimes?: number[] };
    w.__cgDealTimes = [];
    const seen = new WeakSet<Element>();
    new MutationObserver((records) => {
      for (const { target } of records) {
        const el = target as Element;
        if (el.classList?.contains('dealt') && !seen.has(el)) {
          seen.add(el);
          w.__cgDealTimes?.push(performance.now());
        }
      }
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  });

/** How many cards were dealt, and the milliseconds from the first to the last. */
export const dealSpread = (page: Page) =>
  page.evaluate(() => {
    const times =
      (window as Window & { __cgDealTimes?: number[] }).__cgDealTimes ?? [];
    return {
      dealt: times.length,
      spanMs: times.length ? Math.max(...times) - Math.min(...times) : 0,
    };
  });
