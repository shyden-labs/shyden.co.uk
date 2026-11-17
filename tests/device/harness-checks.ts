/**
 * The Android harness's own checks (#1178). Each was a test in tests/device/real-device.spec.ts,
 * which ran on the phone alone and so made the phone's total differ from every other target's
 * (Shyden 2026-11-17: the same tests on every device). They check the harness, not the site, so
 * they now run inside the phone's fixtures (tests/e2e/fixtures.ts), on every run, and are not
 * counted as tests. Each verdict returns the failure to report, or null when the check holds;
 * tests/unit/harness-checks.test.ts holds them.
 */

/** What the page reports about the screen it is drawn on. */
export type BrowserScreen = {
  ua: string;
  touchPoints: number;
  dpr: number;
  cssWidth: number;
};

/** What the probe reads on a page: Playwright's fake clock, and whether frames are native. */
export type ClockProbe = { fakeClock: boolean; nativeFrames: boolean };

/**
 * Whether the browser is drawing on the phone's real screen rather than an emulated profile.
 * `screen` is what adb says (`renderedScreen` in scripts/adb.mjs), which an emulated profile
 * cannot change. On Android the device pixel ratio is density / 160, and the CSS width is the
 * screen's pixel width divided by it; the tolerances are the original test's `toBeCloseTo`
 * precisions (2 decimal places, and whole pixels).
 */
export function emulatedScreenFailure(
  browser: BrowserScreen,
  screen: { width: number; density: number },
): string | null {
  if (!browser.ua.includes('Android'))
    return `the browser is not Android: its user agent is ${JSON.stringify(browser.ua)}`;
  if (browser.touchPoints <= 0)
    return `the browser reports no touch points (maxTouchPoints ${browser.touchPoints})`;
  const dpr = screen.density / 160;
  if (Math.abs(browser.dpr - dpr) >= 0.005)
    return `the browser's devicePixelRatio is ${browser.dpr}, but the phone's density ${screen.density} gives ${dpr}: an emulated profile`;
  const cssWidth = screen.width / browser.dpr;
  if (Math.abs(browser.cssWidth - cssWidth) >= 0.5)
    return `the browser's CSS width is ${browser.cssWidth}, but the phone's ${screen.width} px at dpr ${browser.dpr} is ${cssWidth}: an emulated profile`;
  return null;
}

/**
 * Whether Chrome is the same process at a test's end as at its start. On a tab made over
 * DevTools, a datalist's suggestions killed Chrome (#807), and every later test failed to
 * connect; the pid names the test where it happened. `before` and `after` are `pidof` output.
 */
export function chromeRelaunchFailure(
  before: string,
  after: string,
): string | null {
  if (!/^\d+$/.test(before))
    return 'Chrome was not running when the test started';
  if (!/^\d+$/.test(after))
    return 'Chrome is not running at the end of the test: it crashed';
  if (before !== after)
    return `Chrome was pid ${before} when the test started and is pid ${after} at its end: it crashed and relaunched`;
  return null;
}

/**
 * Whether the page's clock is what the worker expects. The phone has one context for the whole
 * run and Playwright cannot take a clock back out of it, so a clock may exist only in the
 * `android-chrome-clock` worker (#854). `installed` proves the probe can see a clock where one
 * is, so `none` elsewhere means none.
 */
export function clockProbeFailure(
  probe: ClockProbe,
  expected: 'none' | 'installed',
): string | null {
  if (expected === 'none') {
    if (probe.fakeClock || !probe.nativeFrames)
      return "a fake clock is on this worker's page: a clock installed on the phone's one shared context outlived the worker that installed it (#854)";
    return null;
  }
  if (!probe.fakeClock || probe.nativeFrames)
    return 'the clock probe reads no fake clock where a test installed one, so its "none" elsewhere proves nothing';
  return null;
}
