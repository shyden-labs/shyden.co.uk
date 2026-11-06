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
    evaluate: async () => current ?? real,
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

  it('leaves a target with one fixed screen alone and reports that screen', async () => {
    const { page, calls } = fakePage(null, { width: 411, height: 800 });
    const got = await atViewport(page, { width: 320, height: 900 });
    expect(calls).toEqual([]);
    expect(got).toEqual({ width: 411, height: 800 });
  });
});
