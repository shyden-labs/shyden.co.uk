import { test, expect } from '@playwright/test';
import { makeGroups } from '../make-groups';
import { deployedRoutes } from '../site-pages';
import { PRODUCTS, expectHomepageLinksAt } from '../product-links';
import { expectNoHorizontalScroll } from '../viewport';
import { expectTheSwitchPersists } from '../themes';
import { expectReportsBound } from '../report-health';

/**
 * Every route the site serves, derived. #49.
 *
 * Both lists below were hand-written `/id/*` triples, and each carried a
 * comment saying a dropped locale would deploy green -- which is what happened
 * the moment #22 added zh, vi and th: nine routes, never requested here, while
 * the gate stayed green. Extending the list by hand is how it broke the first
 * time, so it is derived now and a sixth language is covered the day it joins
 * LOCALES. The PAGE axis stayed hand-written until #89 — three literals, so a
 * fourth page was smoked by curl in deploy-prod.yml and never rendered in a
 * browser here. Both axes are derived now.
 */
const ROUTES = deployedRoutes();

/**
 * Production, verified in a real browser before `prod-verified` is posted.
 *
 * Every check here is one the previous `curl` smoke could not make. curl proved
 * that bytes arrived with a 200 and that certain strings were among them. It
 * could not tell whether the stylesheet loaded, whether the calculators' script
 * ran, or whether the page fits the screen — and this repo has shipped, for a
 * whole release, a bug that only geometry could see.
 *
 * So the rule for this file: if `curl` could already prove it, it does not
 * belong here. Status codes and page inventory stay in the smoke; this suite
 * asserts things that require rendering.
 *
 * Deliberately does NOT assert homepage copy. The wording is being replaced,
 * and a release gate that fails because marketing text changed teaches everyone
 * to ignore it.
 */

test('the homepage renders, and its stylesheet actually applied', async ({
  page,
}) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  await expect(page.locator('h1')).toBeVisible();

  // A deploy that drops or 404s the CSS still returns 200 with all its text
  // intact — curl cannot tell the difference. The rendered background can:
  // unstyled, it is the browser default (transparent/white).
  //
  // Read on the ROOT, where the ground is painted (`tokens.css`: `html {
  // background: var(--bg) }`). This read `document.body` until Aurora moved
  // the ground to `html`, after which `body` is transparent on every CORRECT
  // deploy and the test failed on a page whose stylesheet had applied (#338).
  const background = await page.evaluate(
    () => getComputedStyle(document.documentElement).backgroundColor,
  );
  expect(background).not.toBe('rgba(0, 0, 0, 0)');
  expect(background).not.toBe('');
});

test('the Glory Points calculator computes, not just loads', async ({
  page,
}) => {
  await page.goto('/glory-points');
  await expect(page.locator('#glory-input')).toBeVisible();

  // The script is what makes this a calculator rather than a form. If the
  // bundle 404s after a partial deploy, the page still serves 200 and still
  // contains every label — and this is where that shows.
  await page.fill('#glory-input', '1000');
  await page.click('#glory-submit');

  // The handler fills exactly one of the two boxes. Wait for its answer,
  // whichever it is, so the no-error invariant below runs even when the
  // calculation fails — asserted after the result instead, a failed
  // calculation would stop the test on the result and never name the error.
  await expect(
    page.locator('#glory-result:not(:empty), #glory-error:not(:empty)'),
  ).toHaveCount(1);

  // "No error shown" is an EMPTY error box, not a hidden one. `.error` keeps a
  // `min-height` so the line is reserved and the layout does not jump when an
  // error arrives, so the empty box is visible by design and `toBeHidden()`
  // failed on every correct calculation (#338). A box holding text is an error
  // shown; an empty one is not, whatever space it takes.
  await expect(
    page.locator('#glory-error'),
    'a valid amount must show no error',
  ).toHaveText('');
  await expect(page.locator('#glory-result')).toBeVisible();
  await expect(page.locator('#glory-result')).not.toBeEmpty();
});

test('the Classroom Group Creator forms groups', async ({ page }) => {
  await page.goto('/classroom-groups');
  await expect(page.locator('#cg-form')).toBeVisible();

  await makeGroups(page, '8', '4');

  await expect(page.locator('#cg-results .student')).toHaveCount(8);
});

// Geometry, which no text assertion can reach. `#cg-io-toggle`'s intrinsic
// minimum once propagated up a grid whose items default to `min-width: auto`
// and pinned a track wide enough to force 74px of horizontal scroll at 320px —
// while every text-based test stayed green.
//
// 320px because that is the narrowest viewport the working agreement supports.
test.describe('no page scrolls sideways at 320px', () => {
  for (const { path } of ROUTES) {
    test(
      `${path} fits a 320px viewport`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 720 });
        await page.goto(path);
        await expectNoHorizontalScroll(page, path);
      },
    );
  }
});

// The original note here said a heading assertion must not be able to redden
// a release gate, because the COPY is changing and a hand-written table of
// headings would drift from it. That concern is answered rather than
// overridden: the expectation comes from the SAME catalogue the page renders
// from, so a copy change updates both in one commit and cannot drift.
//
// What it cannot catch on its own is a catalogue left as English -- it would
// agree with itself. The comparison against the English string is the
// independent half, so the two cannot fail together silently. One test per
// route, as dev-sanity.spec.ts already does (#422).
for (const { locale, path, heading, englishHeading } of ROUTES)
  test(`${path} is live, and in ${locale}`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status(), `${path} did not return 200`).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('h1')).toContainText(heading);
    if (locale !== 'en') {
      await expect(page.locator('h1')).not.toHaveText(englishHeading);
    }
  });

// The mirror of dev-sanity's cross-env check. Each URL is env-derived
// (PUBLIC_SHYTALK_URL, PUBLIC_WORDFARER_URL) precisely so the two environments
// never cross, and a production page sending visitors to a dev host is a leak,
// not a typo.
//
// Every outbound link is checked, by the host it resolves to. This took the
// first `a[href*="shytalk"]`, which became the header's in-page `/#shytalk`
// anchor and failed before any outbound link was read (#338). The production
// Wordfarer host has no DNS record yet, by the operator's choice (#403); its
// links are read here, never followed. One test per product.
for (const product of PRODUCTS)
  test(`the outbound ${product.name} link points at PROD ${product.name}, never dev`, async ({
    page,
  }) => {
    await expectHomepageLinksAt(page, product, product.prod);
  });

// The switch is a rendering fact, so the deployed site's browser run proves
// it (#142 §6.2): it changes the page, and the choice survives a reload.
test('the theme switch changes the page, and the choice survives a reload', async ({
  page,
}) => {
  await expectTheSwitchPersists(page);
});

test(
  'the report endpoint is bound to its migrated database',
  {
    tag: '@deployed-only',
    annotation: {
      type: 'deployed-only',
      description:
        'the report endpoint is a Pages Function with a D1 binding, and a preview of dist/ runs no Pages Function',
    },
  },
  async ({ request }) => {
    // Health only: automation never writes to the production database.
    await expectReportsBound(request);
  },
);
