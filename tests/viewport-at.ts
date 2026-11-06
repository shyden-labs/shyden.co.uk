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
  // An emulated target takes the size it is given. Its innerWidth is no
  // witness: a mobile project reports its 980px layout viewport right after
  // a resize (CI run 42243143607).
  if (page.viewportSize() !== null) {
    await page.setViewportSize(want);
    return want;
  }
  // A real phone is measured. Before a test opens its page, the tab may hold
  // a blank one with no viewport meta, laid out at Chrome's 980px default
  // (2026-11-06 phone run: 980x1809 on a 411px-wide screen). The screen's own
  // width says what a page with `width=device-width` will have, and the
  // height scales with it.
  const { innerWidth, innerHeight, screenWidth } = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    screenWidth: window.screen.width,
  }));
  if (innerWidth <= screenWidth)
    return { width: innerWidth, height: innerHeight };
  return {
    width: screenWidth,
    height: Math.round((innerHeight * screenWidth) / innerWidth),
  };
}
