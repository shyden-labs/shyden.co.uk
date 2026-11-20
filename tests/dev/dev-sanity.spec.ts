import { tapOn } from '../real-touch';
import { typeInto } from '../real-typing';
import { chooseOption } from '../real-select';
import { test, expect } from '@playwright/test';
import { makeGroups } from '../make-groups';
import {
  LOCALES,
  localisePath,
  getStrings,
  isBetaLocale,
  getSiteStrings,
} from '../../src/lib/i18n/index';
import { expectReportsBound } from '../report-health';
import { expectedBadges } from '../beta-badges';
import { deployedRoutes, docsPaths } from '../site-pages';
import { expectDocsRendered } from '../api-docs-pages';
import { PRODUCTS, expectHomepageLinksAt } from '../product-links';
import { expectTheSwitchPersists } from '../themes';
import { LEGACY_REDIRECTS, expectMovedTo } from '../legacy-redirect';
import { robotsDirectives } from '../robots-directives';
import { expectNotFoundServed } from '../not-found-served';

// Runs against the REAL deployed dev site behind Basic auth. baseURL +
// httpCredentials are supplied by playwright.dev.config.ts (env-driven).
// A pull request also runs it against a preview of its own build (#335),
// leaving out the tests tagged @deployed-only; BASE is read only by one of
// those, the raw fetch that must reach the deployed gate.
const BASE = process.env.WEB_BASE_URL ?? 'https://dev.shyden.co.uk';

test('dev homepage loads behind Basic auth', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  await expect(page.locator('h1')).toBeVisible();
});

test('an unknown path answers 404 with the not-found page', async ({
  request,
}) => {
  await expectNotFoundServed(request);
});

test('the Glory Points calculator loads on dev', async ({ page }) => {
  const res = await page.goto('/yeetalk-calculators');
  expect(res?.status()).toBe(200);
  await expect(page.locator('#glory-input')).toBeVisible();
});

test('the Classroom Group Creator loads on dev', async ({ page }) => {
  const res = await page.goto('/classroom-groups');
  expect(res?.status()).toBe(200);
  await expect(page.locator('#cg-form')).toBeVisible();
  // The script is what makes this page a tool rather than a form that leaks.
  // If the bundle 404s after a partial deploy, this is where it shows.
  await makeGroups(page, '8', '4');
  await expect(page.locator('#cg-results .student')).toHaveCount(8);
});

/**
 * Every locale the site CLAIMS to serve is actually on the deployed host.
 *
 * This block used to be a hand-written list of three `/id/*` paths, and its own
 * comment recorded that the same gap had already happened once: "Half the
 * routes on this site are /id/* and none of them were checked here." It was
 * fixed by extending the list, so it broke again the moment #22 added zh, vi
 * and th — nine routes, the entire point of that ticket, never requested from
 * the deployed site while `dev-verified` went green anyway. See #49.
 *
 * `dev-verified` is a REQUIRED status on main's branch protection. It is the
 * gate between develop and production, so a list that silently stops covering
 * new routes is not a coverage gap, it is a gate that stopped gating.
 *
 * DERIVED ON BOTH AXES, so a sixth language is covered the day it joins
 * LOCALES and a fourth page the day it appears under `src/pages/` — nobody has
 * to remember this file. The page axis was hand-written until #89, which is
 * how a new page could be smoked by curl and never rendered in a browser. The expected heading comes from the same
 * catalogue the page renders from, which closes the "second hand-written
 * table" drift but opens a smaller hole: a catalogue accidentally left as
 * English would agree with itself and pass. The differs-from-English check
 * below is the independent half.
 */
const ROUTES = deployedRoutes();

test.describe('every locale the site claims to serve is deployed', () => {
  for (const { locale, path, heading, englishHeading } of ROUTES) {
    test(`${path} is served in ${locale}`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status(), `${path} did not return 200`).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('h1')).toContainText(heading);

      if (locale !== 'en') {
        // Independent of the catalogue above: a build that fell back to
        // English would still match its own strings if the catalogue were the
        // thing that regressed. This asserts against the ENGLISH copy instead,
        // so the two checks cannot fail together silently.
        await expect(page.locator('h1')).not.toHaveText(englishHeading);
      }

      // #102. `dev-verified` proved the marker was BUILT and that wrangler did
      // not error -- not that the deployed site serves it. Asserted on THIS
      // page load rather than in a loop of its own, so full locale x page
      // coverage costs no extra navigation.
      //
      // The status assertion above is load-bearing here: a failed request
      // yields an empty document, and an empty document contains zero badges,
      // which is indistinguishable from the marker having been removed. Counted
      // only after the page is known to be a real 200.
      await expect(
        page.locator('[data-beta]'),
        `${path}: expected one BETA badge per unverified locale, and one more when ${locale} is one`,
      ).toHaveCount(expectedBadges(locale));
      await expect(
        page.locator('[data-beta-notice]'),
        `${path}: ${locale === 'en' ? 'English is verified and must carry no notice' : 'the beta notice is missing'}`,
      ).toHaveCount(isBetaLocale(locale) ? 1 : 0);
    });
  }
});

test(
  'robots.txt disallows all crawling on the dev site',
  {
    tag: '@deployed-only',
    annotation: {
      type: 'deployed-only',
      description:
        'the functions suite proves functions/_middleware.js serves this robots.txt before the merge (#394); only the deployed site proves dev.shyden.co.uk itself serves it',
    },
  },
  async ({ request }) => {
    // Served before the auth gate, so this holds with or without creds.
    const body = await (await request.get('/robots.txt')).text();
    // Every directive, whole: `Disallow: /private` contains `Disallow: /`.
    expect(robotsDirectives(body)).toEqual(['User-agent: *', 'Disallow: /']);
  },
);

// The homepage's Yawelo Idle preview plays from Yawelo Idle's DEV media host
// itself, the real files, not the suite's stand-ins (#835, #1193). The host
// sends `Cross-Origin-Resource-Policy: cross-origin`, so this runs on the
// pull request's own build too. The dev build points it at the dev host; a
// poster or video from the production host is the cross-environment leak the
// product links below are checked for.
test("the homepage's Yawelo Idle preview plays from Yawelo Idle's dev media host", async ({
  page,
}) => {
  await page.goto('/');
  const video = page.locator('#yawelo-idle video');
  await expect(video).toBeVisible();
  // Muted, so no engine's autoplay rule refuses a play that is not a tap.
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play();
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.5);
  expect(
    await video.evaluate((v: HTMLVideoElement) => ({
      video: new URL(v.currentSrc).origin,
      poster: new URL(v.poster).origin,
    })),
  ).toEqual({
    video: 'https://dev-media.yaweloidle.com',
    poster: 'https://dev-media.yaweloidle.com',
  });
});

// The support page (#1032) loads ShyDesk's piece from Non-Prod on dev, and
// only on dev: dev ShyDesk accepts dev.shyden.co.uk alone, and live ShyDesk
// is the production build's. Checked on the pull request's own dev build
// too, so a missing build variable is caught before a deploy.
test("the support page loads ShyDesk's piece from dev ShyDesk", async ({
  page,
}) => {
  await page.goto('/support');
  await expect(page.locator('shydesk-support')).toHaveAttribute(
    'product',
    'shyden-co-uk',
  );
  await expect(page.locator('script[src$="/embed.js"]')).toHaveAttribute(
    'src',
    'https://shydesk.shydesk-non-prod.workers.dev/embed.js',
  );
});

// A real message from the support page reaches dev ShyDesk and shows in its
// thread (#1032 AC5): typed with real key presses, a photo attached through
// the file chooser a real press opened, sent with a real press. STAND-IN: the
// photo is handed to that chooser, because the system file dialog is outside
// the browser (as `upload` in tests/e2e/helpers.ts). Dev ShyDesk sends no
// email (its monthly share is 0), so the private link is read off the page.
// The field names are ShyDesk's (embed.js at shydesk `0a2abc8`).
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);

test(
  'a message typed on /support reaches dev ShyDesk and shows in its thread',
  {
    tag: '@deployed-only',
    annotation: {
      type: 'deployed-only',
      description:
        'dev ShyDesk accepts https://dev.shyden.co.uk alone as an origin, so a preview of the build cannot send to it',
    },
  },
  async ({ page }) => {
    const words = `Support page check ${Date.now()}`;
    await page.goto('/support');
    const form = page.locator('shydesk-support');
    await typeInto(form.getByLabel('Email'), 'support-test@shyden.co.uk');
    await typeInto(form.getByLabel('Subject'), 'Support page check');
    await chooseOption(form.getByLabel('Category'), 'question');
    await typeInto(form.getByLabel('Message'), words);
    page.on('filechooser', () => {});
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      tapOn(form.getByLabel('Photos and videos')),
    ]);
    await chooser.setFiles({
      name: 'support-photo.png',
      mimeType: 'image/png',
      buffer: ONE_PIXEL_PNG,
    });
    // SCRATCH measurement (#1032, never merged): one real click on Turnstile.
    const widget = form.locator('iframe[src*="challenges.cloudflare.com"]');
    await expect(widget).toBeVisible({ timeout: 20_000 });
    const box = await widget.boundingBox();
    console.error('[1032-turnstile] widget box', JSON.stringify(box));
    await tapOn(widget, {
      position: { x: 22, y: Math.round((box?.height ?? 65) / 2) },
    });
    const send = form.getByRole('button', { name: 'Send', exact: true });
    const t0 = Date.now();
    await expect(send)
      .toBeEnabled({ timeout: 20_000 })
      .then(
        () =>
          console.error(
            '[1032-turnstile] Send enabled after',
            Date.now() - t0,
            'ms',
          ),
        (e) => {
          console.error('[1032-turnstile] Send still disabled after 20 s');
          throw e;
        },
      );
    await tapOn(send);
    await expect(
      form.getByText('Request sent. Keep this private link to follow it:'),
    ).toBeVisible({ timeout: 30_000 });
    const link = await form
      .getByRole('link', { name: /support\/ticket/ })
      .getAttribute('href');
    expect(link).toMatch(/\/support\/ticket\/?#t=/);
    await page.goto(new URL(link ?? '', page.url()).toString());
    await expect(page.locator('shydesk-support').getByText(words)).toBeVisible({
      timeout: 30_000,
    });
  },
);

test(
  'an unauthenticated request is challenged with 401',
  {
    tag: '@deployed-only',
    annotation: {
      type: 'deployed-only',
      description:
        'the functions suite proves the Basic-auth gate, functions/_middleware.js, before the merge (#394); only the deployed site proves dev.shyden.co.uk itself is gated',
    },
  },
  async () => {
    // Raw fetch — NOT a Playwright request context, which would inherit the
    // config's httpCredentials and silently authenticate (making this pass a
    // 200 as if unchallenged). fetch sends no Authorization header, so this
    // genuinely exercises the no-credentials path.
    const res = await fetch(`${BASE}/`, { redirect: 'manual' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Basic realm=/);
  },
);

// #635: the Glory Points page moved. The redirect answers BEFORE the auth gate
// (like www), so a bookmark never meets a 401: raw fetch, no credentials.
for (const [from, to] of LEGACY_REDIRECTS)
  test(
    `${from} answers 301 to ${to} with no credentials`,
    {
      tag: '@deployed-only',
      annotation: {
        type: 'deployed-only',
        description:
          'the functions suite proves the redirect, functions/_middleware.js, before the merge (#394); only the deployed site proves dev.shyden.co.uk itself answers it',
      },
    },
    async () => {
      const res = await fetch(`${BASE}${from}`, { redirect: 'manual' });
      expectMovedTo(res.status, res.headers.get('location'), to);
    },
  );

// The dev build sets each product's variable (PUBLIC_SHYTALK_URL,
// PUBLIC_YAWELO_IDLE_URL) to its dev host, so EVERY outbound link to that
// product must resolve there. The mirror of prod-sanity's check; the selection
// and the liveness control live in `tests/product-links.ts`. One test per
// product (#403).
for (const product of PRODUCTS)
  test(`every outbound ${product.name} link points at DEV ${product.name}, never prod (no cross-env leak)`, async ({
    page,
  }) => {
    await expectHomepageLinksAt(page, product, product.dev);
  });

/**
 * The v2 surfaces, on the deployed dev site.
 *
 * Dev is the MERGE GATE now, so this suite is what stands between a broken
 * build and `main`. It stays a smoke, not a second copy of the e2e suite:
 * each of these asks only "did this part of the tool arrive at all", which is
 * the question a deploy can answer wrongly. Behaviour is proven by the e2e
 * suite, which already ran before the deploy.
 */
test.describe('the Classroom Group Creator v2 surfaces reached dev', () => {
  test('Student details builds a roster', async ({ page }) => {
    await page.goto('/classroom-groups');
    await tapOn(page.locator('#cg-students-toggle'));
    await tapOn(page.getByRole('button', { name: /Add student/ }));
    await expect(page.locator('.cg-student')).toHaveCount(1);
    // The roster's own controls, not just a row: a partial bundle can render
    // the table and wire nothing.
    await expect(
      page.locator('.cg-student').first().getByLabel('Name'),
    ).toBeVisible();
  });

  test('Import / export offers its controls', async ({ page }) => {
    await page.goto('/classroom-groups');
    await tapOn(page.locator('#cg-io-toggle'));
    await expect(
      page.getByRole('button', { name: 'Export class list' }),
    ).toBeVisible();
    await expect(page.locator('#cg-import')).toBeVisible();
  });

  test('the print panel and the projector are reachable once groups exist', async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    await makeGroups(page, '8', '4');
    await expect(page.locator('#cg-results .group').first()).toBeVisible();

    await tapOn(page.getByRole('button', { name: 'Print' }));
    await expect(page.locator('#cg-print-panel')).toBeVisible();
    await tapOn(
      page.locator('#cg-print-panel').getByRole('button', { name: 'Cancel' }),
    );

    await tapOn(page.getByRole('button', { name: 'Full screen' }));
    await expect(page.locator('#cg-board')).toBeVisible();
    await expect(page.locator('#cg-board #cg-results')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#cg-board')).toBeHidden();
  });

  // Was one test against `/id/classroom-groups` asserting the literal string
  // 'Ekspor daftar kelas' -- a hand-written copy expectation that could drift
  // from the catalogue, covering one of the four translated locales. Both the
  // path and the expected label are derived now, so this checks that each
  // locale's TOOL, not just its page shell, carries its own copy. #49.
  for (const locale of LOCALES.filter((l) => l !== 'en')) {
    test(`the ${locale} tool carries its own copy`, async ({ page }) => {
      await page.goto(localisePath('/classroom-groups', locale));
      await tapOn(page.locator('#cg-io-toggle'));
      await expect(
        page.getByRole('button', {
          name: getStrings(locale).ioExportClassList,
        }),
      ).toBeVisible();
    });
  }
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
    await expectReportsBound(request);
  },
);

test(
  'a real report from the Vietnamese homepage reaches #report-sent',
  {
    tag: '@deployed-only',
    annotation: {
      type: 'deployed-only',
      description:
        'the report endpoint is a Pages Function with a D1 binding, and a preview of dist/ runs no Pages Function',
    },
  },
  async ({ page }) => {
    // Writes one row per dev deploy, in the dev database only. The runbook's
    // "automated dev check" statement clears them (docs/runbooks/translation-reports.md).
    const t = getSiteStrings('vi').report;
    const home = localisePath('/', 'vi');
    await page.goto(home);
    await tapOn(page.locator('[data-report] summary'));
    await typeInto(page.getByLabel(t.quoteLabel, { exact: true }), t.open);
    await typeInto(
      page.getByLabel(t.noteLabel, { exact: true }),
      `automated dev check ${process.env.GITHUB_SHA ?? 'local'}`,
    );
    await tapOn(page.getByRole('button', { name: t.send }));
    await expect(page).toHaveURL(
      (url) => url.pathname === home && url.hash === '#report-sent',
    );
    await expect(page.locator('#report-sent')).toBeVisible();
  },
);

// #781: the API docs, public and private; dev's own gate covers both.
for (const path of docsPaths())
  test(`the API docs at ${path} render on dev`, async ({ page }) => {
    await expectDocsRendered(page, path);
  });

test(
  "Try it out sends the report form from dev's docs, and dev answers sent",
  {
    tag: '@deployed-only',
    annotation: {
      type: 'deployed-only',
      description:
        'POST /api/report is a Pages Function, and a preview of dist/ runs no Pages Function',
    },
  },
  async ({ page }) => {
    await page.goto('/api/docs/');
    await tapOn(page.locator('#swagger .opblock-summary-control').first());
    await tapOn(page.locator('#swagger .try-out__btn'));
    await typeInto(page.getByPlaceholder('quote', { exact: true }), 'x');
    // The honeypot: dev answers sent and stores nothing.
    await typeInto(page.getByPlaceholder('website', { exact: true }), 'a bot');
    await tapOn(page.locator('#swagger .btn.execute'));
    const live = page.locator('#swagger .live-responses-table .response');
    await expect(live).toHaveCount(1);
    await expect(live.locator('.response-col_status')).toHaveText('200');
    await expect(live.locator('.response-col_description')).toContainText(
      '"outcome": "sent"',
    );
  },
);
