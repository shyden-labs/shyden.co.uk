import { tapOn } from '../real-touch';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { recorded } from './evidence';
import { expectTheme } from '../themes';

test.use(recorded);

// Playwright launches Chromium with the back-forward cache switched off; this
// file launches it with the cache on, as a visitor's browser has it (Shyden's
// ruling on #1048, 2026-11-06). The flag is Chromium's alone, so the other
// engines launch as before. `launchOptions` is a worker fixture, which
// Playwright refuses inside a describe group, so it is set here, top level, in
// a file of its own: inside theme.spec.ts's describe it stopped the whole suite
// from loading.
test.use({
  launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'] },
});

const toggle = (page: Page) => page.locator('header [data-theme-toggle]');

test.describe('Back (#142 §5 step 5, AC4)', () => {
  test('a page restored from the back-forward cache shows the theme chosen after leaving it', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await expectTheme(page, 'dark');
    await page.evaluate(() => {
      addEventListener('pageshow', (event) => {
        if (event.persisted) document.documentElement.dataset.restored = '';
      });
    });
    await page.goto('/yeetalk-calculators');
    await tapOn(toggle(page));
    await expectTheme(page, 'light');
    // A page restored from the back-forward cache fires `pageshow` and no
    // `load`, so `goBack()`'s default wait for `load` never ends where the cache
    // is on: on the real Android phone it held the test to its 30 s timeout
    // (issue 807). Wait for the navigation to commit, then for the document,
    // which a restore and a reload both leave complete.
    await page.goBack({ waitUntil: 'commit' });
    await expect
      .poll(() => page.evaluate(() => document.readyState))
      .toBe('complete');
    const restored = await page.evaluate(
      () => 'restored' in document.documentElement.dataset,
    );
    // A reload re-runs the head script and would pass without the pageshow
    // handler ever running, so a reload fails here, naming the engine.
    expect(
      restored,
      `${testInfo.project.name} reloaded the page instead of restoring it from the back-forward cache`,
    ).toBe(true);
    await expectTheme(page, 'light');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  });
});
