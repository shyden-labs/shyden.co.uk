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
  return measuredViewport(page);
}

/**
 * The size a test may hold the page to now, without changing it (#1046).
 *
 * An emulated target answers with the size the test set: Playwright's own
 * record, so a window the engine grew by itself (Firefox under fullscreen,
 * #758) still reads as a mismatch against the page. A real phone is measured
 * as it is now. Before a test opens its page, the tab may hold a blank one
 * with no viewport meta: a 980px layout zoomed to fit the screen (OPPO,
 * 2026-11-07: 980 at scale 0.4198, then 411x759 once the page loaded). The
 * visual viewport times its scale is the screen in CSS pixels either way, and
 * the page's own innerWidth is that rounded down. And the screen changes: an
 * open board makes Chrome hide its address bar (411x759 to 411x815).
 */
export async function measuredViewport(page: Page): Promise<ViewportSize> {
  const set = page.viewportSize();
  if (set !== null) return set;
  const { vvWidth, vvHeight, vvScale } = await page.evaluate(() => {
    const vv = window.visualViewport;
    if (vv === null) throw new Error('this browser has no visualViewport');
    return { vvWidth: vv.width, vvHeight: vv.height, vvScale: vv.scale };
  });
  return {
    width: Math.floor(vvWidth * vvScale),
    height: Math.floor(vvHeight * vvScale),
  };
}

/**
 * Whether this target is a real phone: one screen, which takes no emulated
 * width (#1046). Playwright reports no viewport size exactly there. A test
 * that walks several widths asks this once, so a phone walks its one width
 * once instead of repeating the journey at widths it never takes (#1086).
 */
export const onRealPhone = (page: Page): boolean =>
  page.viewportSize() === null;
