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

test('the bare request fixture resolves a relative URL against baseURL, on the real device', async ({
  request,
}) => {
  // Playwright builds this fixture via `playwright.request.newContext()`
  // (playwright/lib/index.js), a construction path independent of this suite's `browser`/
  // `context` overrides in tests/e2e/fixtures.ts -- so, unlike `page.goto`/`page.request.*`,
  // there was no a priori reason to expect it shared the adopted context's empty-baseURL gap.
  // This is the on-device measurement that settles it rather than assuming it from the source
  // trace alone: see BASE_URL_AWARE_APIS's `bare: true` `request.<method>` rows for the
  // recorded result.
  const res = await request.get('/sitemap-0.xml');
  expect(
    res.ok(),
    `expected the bare \`request\` fixture to resolve '/sitemap-0.xml' against baseURL and ` +
      `return 2xx on-device -- got HTTP ${res.status()}`,
  ).toBe(true);

  const body = await res.text();
  // The exact string head-and-sitemap.spec.ts already asserts on the emulated path, so a match
  // here is real sitemap content for a real page, not an empty or unrelated body.
  expect(
    body,
    'expected a <loc> entry for a known page in the sitemap body, not an empty or unrelated response',
  ).toContain('<loc>https://shyden.co.uk/classroom-groups/</loc>');
});

test.describe('per-test isolation actually isolates state across back-to-back tests', () => {
  // Order matters and a failed setup half makes the isolation half meaningless to run, so this
  // pair is explicit about both: serial execution, and proving the write landed before trusting
  // the next test's absence-check.
  test.describe.configure({ mode: 'serial' });

  const PROBE_KEY = 'shyden-isolation-probe';
  const PROBE_VALUE = 'leaked-if-you-can-read-this-in-the-next-test';

  test('writes a distinctive localStorage value and a form field (setup half of the pair)', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');

    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: PROBE_KEY,
      value: PROBE_VALUE,
    });
    // Confirm the write actually landed before the next test trusts its absence -- an "empty"
    // assertion is worthless as proof of clearing if nothing was ever proven present to clear.
    const written = await page.evaluate(
      (key) => localStorage.getItem(key),
      PROBE_KEY,
    );
    expect(
      written,
      'expected the probe value to be readable back in the same test that wrote it, before ' +
        'the next test can meaningfully assert its absence',
    ).toBe(PROBE_VALUE);

    await page.locator('#cg-class').fill('ISOLATION-PROBE-CLASS-NAME');
    await expect(page.locator('#cg-class')).toHaveValue(
      'ISOLATION-PROBE-CLASS-NAME',
    );
  });

  test('starts with no trace of the previous test (isolation half of the pair)', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');

    const leaked = await page.evaluate(
      (key) => localStorage.getItem(key),
      PROBE_KEY,
    );
    expect(
      leaked,
      "expected localStorage to be empty at the start of this test -- the context fixture's " +
        "Storage.clearDataForOrigin call between tests did not clear the previous test's " +
        'value, which means the one-shared-context isolation mechanism this whole device ' +
        'harness depends on does not actually isolate',
    ).toBeNull();

    // #cg-class is never written to or read from storage -- src/scripts/classroom-groups.ts's
    // own privacy-promise comment and ClassroomGroupsPage.astro's section-11 copy both say so,
    // and grepping the script confirms `cg-class` never touches the `remember` localStorage
    // wrapper. A fresh page load therefore guarantees this field is empty regardless of
    // whether storage cleared correctly -- checked because it was asked for, but it is not
    // evidence of the storage-isolation mechanism the way the localStorage assertion above is.
    await expect(page.locator('#cg-class')).toHaveValue('');
  });
});
