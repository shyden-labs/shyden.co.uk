import type { Page } from '@playwright/test';
import { adb, renderedScreen } from '../../scripts/adb.mjs';
import { test, expect } from '../e2e/fixtures';
import { CHROME_PACKAGE } from './chrome-foreground';

test('the suite is running on the real phone, not an emulated profile', async ({
  page,
}) => {
  await page.goto('/classroom-groups');

  const browserSide = await page.evaluate(() => ({
    ua: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints,
    dpr: devicePixelRatio,
    cssWidth: innerWidth,
  }));

  // What the device itself says its screen is -- adb cannot be fooled by an emulated profile.
  // renderedScreen takes the override line where `wm` prints one, as the browser does.
  const screen = renderedScreen(
    adb(['shell', 'wm', 'size']),
    adb(['shell', 'wm', 'density']),
  );

  expect(browserSide.ua).toContain('Android');
  expect(browserSide.touchPoints).toBeGreaterThan(0);
  // dpr is density/160 on Android, and CSS width is the screen's pixel width divided by it.
  expect(browserSide.dpr).toBeCloseTo(screen.density / 160, 2);
  expect(browserSide.cssWidth).toBeCloseTo(screen.width / browserSide.dpr, 0);
});

test("a test's tab shows a datalist's suggestions without Chrome crashing", async ({
  page,
}) => {
  // #807: on a tab made over DevTools, this exact sequence killed Chrome 5 times in 5
  // (AutofillProvider.showDatalistPopup, then a null view), and every later test in the run
  // failed to connect. The page fixture now hands out a tab Chrome opened for a VIEW intent
  // (tests/device/visitor-tab.ts); the same Chrome process must still be there afterwards.
  const chromePid = () => adb(['shell', 'pidof', CHROME_PACKAGE]).trim();
  const before = chromePid();
  expect(before, 'Chrome is running before the test').toMatch(/^\d+$/);

  // English draws no report form; Indonesian does.
  await page.goto('/id/');
  expect(
    await page.evaluate(() => document.hasFocus()),
    "the test's tab holds the phone's focus",
  ).toBe(true);
  const report = page.locator('[data-report]');
  const quote = report.locator('#report-quote');
  // From the keyboard, as report-form.spec.ts walks the fields: open the form, Tab in.
  await report.locator('summary').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(quote).toBeFocused();
  await page.keyboard.type('Tem', { delay: 120 });

  await expect(quote).toHaveValue('Tem');
  expect(
    chromePid(),
    'the same Chrome process, not a crash and a relaunch',
  ).toBe(before);
});

/** Whether `page` runs on Playwright's fake clock, read on the page itself. */
const clockOnPage = (page: Page) =>
  page.evaluate(() => ({
    fakeClock:
      typeof (globalThis as { __pwClock?: unknown }).__pwClock !== 'undefined',
    nativeFrames: requestAnimationFrame.toString().includes('[native code]'),
  }));

test.describe('a fake clock never outlives the test that installed it (#854)', () => {
  // The phone has one context for the whole run, and Playwright cannot take a clock back out of
  // it: `clock.install()` registers its script on the context, and the protocol has no uninstall.
  // A clock left behind ran every later page's animation frames as timers, one of which fired the
  // theme test's first-frame recorder before the page had an <html> element (#854). The first
  // test is tagged, so it runs in the clock project, which playwright.device.config.ts lists
  // before android-chrome (pinned in tests/guards/browser-matrix.test.ts) and whose worker ends
  // before the second test's begins. The first proves this probe sees a clock where one is
  // installed, so the second's "none" means none.

  test(
    'a test that installs a clock sees it on its own page (first of the pair)',
    // Runs in the phone's clock project, a worker that ends before this file's other tests run.
    { tag: '@installs-a-clock' },
    async ({ page }) => {
      await page.goto('/');
      await page.clock.install();
      expect(
        await clockOnPage(page),
        'the probe reads a fake clock on the page that installed one',
      ).toEqual({ fakeClock: true, nativeFrames: false });
    },
  );

  test('an untagged test runs on real time and real frames (second of the pair)', async ({
    page,
  }) => {
    await page.goto('/');
    expect(
      await clockOnPage(page),
      "the previous test's fake clock is on this test's page: a clock installed on the " +
        "phone's one shared context outlived the test that installed it",
    ).toEqual({ fakeClock: false, nativeFrames: true });
  });
});

test('a clock installed by an untagged test is refused, naming why (#854)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.clock.install()).rejects.toThrow(/@installs-a-clock/);
  expect(
    await clockOnPage(page),
    'the refused install left no clock behind',
  ).toEqual({ fakeClock: false, nativeFrames: true });
});
