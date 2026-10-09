import { test, expect } from './fixtures';
import { LOCALE_METADATA } from '../../src/lib/i18n/metadata';
import { LOCALES, localisePath } from '../../src/lib/i18n/index';
import { floorBreach } from '../floors';
import { filesUnder, searched } from '../source-files';
import { PUBLISHED_ROUTES } from './published-paths';

/**
 * The hreflang set every page in the sitemap must declare.
 *
 * Derived from `LOCALE_METADATA.ogLocale` (`en_GB` -> `en-GB`) rather than a
 * second table: that table exists precisely because five separate places used
 * to decide what a locale meant, and each was silently correct for two
 * languages and wrong for the third.
 */
const EXPECTED_ALTERNATES = LOCALES.map((locale) =>
  LOCALE_METADATA[locale].ogLocale.replace('_', '-'),
).sort();
test.describe('the sitemap', () => {
  test('lists every page and pairs the two languages', async ({ request }) => {
    // Nothing tested the sitemap's CONTENTS: seo.spec.ts only checked that
    // robots.txt mentions it. A dropped page or a lost locale went unnoticed.
    const xml = await (await request.get('/sitemap-0.xml')).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
      new URL(m[1]).pathname.replace(/\/$/, ''),
    );

    // Every page the build wrote, not a list. The guards that visit "every
    // published page" generate one test per entry of PUBLISHED_ROUTES, which
    // rendered-text.spec.ts holds to this sitemap (#422), so this is the one
    // check that the sitemap is complete; a hand-written
    // list of three pages could only agree with itself, and a fourth page
    // the sitemap left out would have been invisible to all of them (#390
    // F126). The 404 is the one page deliberately left out. Read here, not
    // at module scope: the web server rebuilds dist/ after this file loads.
    const built = filesUnder('dist', (path) => /\.html$/.test(path))
      .filter((path) => path !== 'dist/404.html')
      .map((path) => path.replace(/^dist/, '').replace(/\/?index\.html$/, ''));
    expect(locs.sort()).toEqual(built.sort());

    // And every page in every locale is among them: a hand-written list of
    // six was correct for two languages and silently wrong the moment #22
    // added three more.
    for (const locale of LOCALES)
      for (const page of ['/', '/classroom-groups', '/yeetalk-calculators'])
        expect(built).toContain(localisePath(page, locale).replace(/\/$/, ''));
  });

  test('declares the language relationships search engines need', async ({
    request,
  }) => {
    // @astrojs/sitemap reads its OWN i18n option; the routing config in
    // astro.config.mjs is not inherited. Without it the file carried six
    // <loc> entries and zero alternates, so the English and Indonesian
    // versions of a page looked like unrelated near-duplicates.
    const xml = await (await request.get('/sitemap-0.xml')).text();
    expect(xml).toContain('xhtml:link');

    // Asserted PER <url>, against a set derived from LOCALE_METADATA.
    //
    // This read `toContain('hreflang="en-GB"')` and `id-ID` — two names
    // written by hand, matched anywhere in the file, agreeing with a config
    // that also named those two by hand. Two hand-written lists agreeing with
    // each other is not a check: nine of fifteen URLs (`/zh/*`, `/vi/*`,
    // `/th/*`) carried NO alternates at all and it passed. See #108, and #104
    // for the same drift in the 404.
    const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
    expect(
      blocks.length,
      'no <url> blocks — the parse is broken',
    ).toBeGreaterThan(0);
    const short = (url: string) => url.replace('https://shyden.co.uk', '');
    const wrong = blocks
      .map((block) => ({
        loc: short(/<loc>([^<]*)<\/loc>/.exec(block)?.[1] ?? '?'),
        langs: [...block.matchAll(/hreflang="([^"]+)"/g)]
          .map((m) => m[1])
          .sort(),
      }))
      .filter((u) => u.langs.join() !== EXPECTED_ALTERNATES.join())
      .map((u) => `${u.loc} -> ${u.langs.join(',') || 'NONE'}`);
    expect(
      searched(wrong, { of: blocks, what: 'sitemap <url> blocks' }),
      `expected every page to declare ${EXPECTED_ALTERNATES.join(',')}`,
    ).toEqual([]);
    expect(
      floorBreach('head-and-sitemap/sitemap-url-blocks', blocks.length),
    ).toBeUndefined();

    // Each entry pairs with its own translation, not with the homepage.
    const groups = xml.split('<url>').slice(1);
    const tool = groups.find((g) =>
      g.includes('<loc>https://shyden.co.uk/classroom-groups/</loc>'),
    );
    expect(tool).toBeDefined();
    expect(tool).toContain('href="https://shyden.co.uk/id/classroom-groups/"');
  });
});

test.describe('the 404 head', () => {
  test('asks not to be indexed, and points nowhere that does not exist', async ({
    page,
  }) => {
    // Cloudflare serves this one file for ANY unknown path, so it has no URL
    // of its own to be canonical about. It used to declare
    // canonical=/404/ and hreflang=id → /id/404/, neither of which is a page.
    await page.goto('/definitely-not-a-page');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex',
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('link[rel="alternate"]')).toHaveCount(0);
    await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  });

  test('real pages still declare theirs', async ({ page }) => {
    // The opt-out must not have leaked into every other page.
    await page.goto('/classroom-groups');
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    // One per locale plus `x-default`, derived: this read 3 while the site
    // shipped two languages, and 3 is not a fact about the page — it is
    // LOCALES.length + 1, and it was going to be wrong on the next language.
    await expect(page.locator('link[rel="alternate"]')).toHaveCount(
      LOCALES.length + 1,
    );
  });
});

/**
 * The viewport every page has to declare, as `BaseLayout.astro` does.
 *
 * Without it a mobile browser lays the page out at a legacy desktop width
 * (980px on the Android phone, measured on `about:blank`, which has no tag),
 * and the visitor sees every page zoomed out. No test asserted it before #233.
 */
const DEVICE_WIDTH = 'width=device-width, initial-scale=1';

test.describe('every published page', () => {
  // One test per published page (#422); `the published routes are the
  // sitemap's` in rendered-text.spec.ts holds the list to the build.
  for (const path of PUBLISHED_ROUTES)
    test(`${path}: declares exactly one viewport, at the device width`, async ({
      page,
    }) => {
      await page.goto(path);
      // `i`: HTML compares meta names without regard to case, so a second tag
      // spelled `Viewport` is still a second viewport.
      const contents = await page
        .locator('meta[name="viewport" i]')
        .evaluateAll((metas) =>
          metas.map((meta) => meta.getAttribute('content')),
        );
      expect(contents).toEqual([DEVICE_WIDTH]);
    });
});
