import { test, expect } from './fixtures';
import { LOCALES, type Locale } from '../../src/lib/i18n/index';
import {
  siteEn,
  siteId,
  siteZh,
  siteVi,
  siteTh,
  type SiteStrings,
} from '../../src/lib/i18n/site';
import { sitePaths, TITLE_FOR } from '../site-pages';
import { floorBreach } from '../floors';
import { searched } from '../source-files';

/**
 * Every published page is served in every locale it claims to ship.
 *
 * The gap this closes: `classroom-groups` had "the Indonesian page is genuinely
 * in Indonesian", but the homepage and the Glory Points page had no equivalent
 * — 1 of 12 homepage tests and 2 of 16 glory-points tests touched `/id` at all.
 *
 * Written against LOCALES rather than against `id`, deliberately. The existing
 * Indonesian tests are hand-copied mirrors of their English twins with the
 * strings swapped; repeating that for zh, vi and th (#22) triples the suite by
 * hand. Everything here is derived, so a locale added to LOCALES is covered the
 * moment its dictionary exists, with no new test code.
 */

/** The site copy each locale ships. Keyed loosely so a missing one is a test
 *  failure below, not a compile error that would hide behind `as`. */
const SITE: Record<string, SiteStrings> = {
  en: siteEn,
  id: siteId,
  zh: siteZh,
  vi: siteVi,
  th: siteTh,
};

/**
 * Every page the site serves, read off disk, with the title each renders.
 * This was a hand-written two of three: `/classroom-groups` could ship an
 * English title in zh, vi and th with every suite green (#390 F130).
 */
const PAGES = sitePaths().map((path) => ({ path, title: TITLE_FOR[path] }));

/**
 * Where a page lives in a given locale, derived from the route layout
 * (`src/pages/<locale>/…`) rather than from `localisePath`.
 *
 * Kept as a SECOND, independent derivation rather than deleted now that
 * `localisePath` is general (#21 Stage 1 replaced its hardcoded
 * `/^\/id(?=\/|$)/` with a pattern built from `PREFIXED_LOCALES`). The two
 * are pinned together below: the helper and the route layout must agree for
 * every locale, and a test that used the helper to check the helper would
 * agree with itself no matter what either one said.
 */
const urlFor = (path: string, locale: Locale) =>
  locale === 'en' ? path : `/${locale}${path === '/' ? '/' : path}`;

test.describe('every locale, every page', () => {
  test('every shipped locale has site copy', () => {
    // A locale added to LOCALES with no catalogue would otherwise reach the
    // pages as a missing dictionary. When this was written the components
    // picked one with `lang === 'id' ? siteId : siteEn`, which returned
    // ENGLISH silently; they now go through getSiteStrings, and this is still
    // the assertion that makes a missing catalogue loud.
    expect(
      searched(
        LOCALES.filter((l) => !SITE[l]),
        { of: LOCALES, what: 'shipped locales' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('locale-parity/shipped-locales', LOCALES.length),
    ).toBeUndefined();
  });

  // 'localisePath agrees with the route layout for every locale' is retired
  // here (#277). `locale-routing.test.ts` makes exactly that assertion over
  // `sitePaths()`, DERIVED from the page files, where this copy walked a
  // hand-written `PAGES` holding two of them. `site-pages.ts`'s own docblock
  // records the same failure from the other direction: the dev and prod
  // sanity suites kept hand-written tables, `sitePaths()` grew to four, and
  // both gates went on testing three. It is also a pure-function assertion
  // that was costing a browser to make.

  test('the translated titles actually differ from English', () => {
    // Vacuity guard. Every per-page assertion below compares the rendered
    // title against that locale's dictionary; if a dictionary simply held the
    // English string, those would all pass on a page that had fallen back to
    // English entirely and prove nothing.
    for (const locale of LOCALES.filter((l) => l !== 'en'))
      for (const { path, title } of PAGES)
        expect(title(locale), `${path} title in ${locale}`).not.toBe(
          title('en'),
        );
  });

  for (const locale of LOCALES)
    for (const { path, title } of PAGES) {
      const url = urlFor(path, locale);
      test(`${url} is served in ${locale}`, async ({ page }) => {
        await page.goto(url);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page).toHaveTitle(title(locale));
      });
    }
});
