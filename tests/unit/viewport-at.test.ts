import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { atViewport } from '../viewport-at';

/**
 * #1046: a target with a screen of its own (a real phone) cannot be resized, so a
 * test that "sets 320px" must measure the width it has instead. Playwright reports
 * `viewportSize()` as null exactly there (see playwright.device.config.ts).
 */

interface Size {
  width: number;
  height: number;
}

const fakePage = (emulated: Size | null, real: Size) => {
  const calls: Size[] = [];
  let current = emulated;
  const page = {
    viewportSize: () => current,
    setViewportSize: async (size: Size) => {
      calls.push(size);
      current = size;
    },
    evaluate: async () => ({
      innerWidth: real.width,
      innerHeight: real.height,
      screenWidth: real.width,
    }),
  } as unknown as Page;
  return { page, calls };
};

describe('atViewport', () => {
  it('resizes an emulated target and reports the size it now has', async () => {
    const { page, calls } = fakePage(
      { width: 1280, height: 720 },
      { width: 1280, height: 720 },
    );
    const got = await atViewport(page, { width: 320, height: 900 });
    expect(calls).toEqual([{ width: 320, height: 900 }]);
    expect(got).toEqual({ width: 320, height: 900 });
  });

  it('reports the size it set, not a mobile layout viewport the page reports', async () => {
    // CI run 42243143607: on mobile-chrome and mobile-safari, innerWidth read
    // straight after a resize said 980x477 (the layout viewport) for 320 asked.
    const page = {
      viewportSize: () => ({ width: 390, height: 664 }),
      setViewportSize: async () => {},
      evaluate: async () => ({ width: 980, height: 477 }),
    } as unknown as Page;
    const got = await atViewport(page, { width: 320, height: 900 });
    expect(got).toEqual({ width: 320, height: 900 });
  });

  it('leaves a target with one fixed screen alone and reports that screen', async () => {
    const { page, calls } = fakePage(null, { width: 411, height: 800 });
    const got = await atViewport(page, { width: 320, height: 900 });
    expect(calls).toEqual([]);
    expect(got).toEqual({ width: 411, height: 800 });
  });

  it('on a real phone, reports the screen a loaded page will have, even from a blank page', async () => {
    // The 2026-11-06 phone run: called before page.goto, the OPPO's blank page
    // said 980x1809 (Chrome's default layout width, no viewport meta) while
    // the page the test then opened measured 411x759.
    const page = {
      viewportSize: () => null,
      setViewportSize: async () => {},
      evaluate: async () => ({
        innerWidth: 980,
        innerHeight: 1809,
        screenWidth: 411,
      }),
    } as unknown as Page;
    expect(await atViewport(page, { width: 320, height: 900 })).toEqual({
      width: 411,
      height: 759,
    });
  });
});
