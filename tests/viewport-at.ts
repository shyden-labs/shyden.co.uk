import type { Page } from '@playwright/test';

/**
 * A test that wants a screen width asks for it here (#1046).
 *
 * Every target runs the same test. A desktop engine or an emulated phone can be
 * given the width asked for. A real phone has one screen: Playwright reports
 * `viewportSize()` as null there, and CDP would "resize" it into numbers that
 * describe nothing physical (playwright.device.config.ts). So the screen is left
 * as it is, and the test measures its behaviour at the width the target really
 * has. Nothing is skipped on either side.
 *
 * Returns the size the page has afterwards, read from the page, so a test that
 * needs the width (to ask which layout applies) reads it from the answer.
 */
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export async function atViewport(
  page: Page,
  want: ViewportSize,
): Promise<ViewportSize> {
  if (page.viewportSize() !== null) await page.setViewportSize(want);
  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
}
