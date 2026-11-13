import { expect } from '../fixtures';
import { PREFIXED_LOCALES } from '../../../src/lib/i18n';
import {
  FOOTER_PAGE_IDS,
  pagePath,
  reportOptions,
  type FooterPageId,
} from '../../../src/lib/report';
import type { Locale } from '../../../src/lib/i18n';
import { DEFAULT_THEME, type PageCheck } from '../page-checks';

/**
 * The report form's per-page reads, moved from report-presence.spec.ts
 * (#1086). Each opened the page again; the walk opens it once. The outcome
 * tests stay there: `#report-<outcome>` is a different URL, a different input.
 */

const FOOTED = PREFIXED_LOCALES.flatMap((locale) =>
  FOOTER_PAGE_IDS.map((id) => ({ locale, id, path: pagePath(id, locale) })),
);

const footed = (route: string): { locale: Locale; id: FooterPageId } => {
  const found = FOOTED.find(({ path }) => path === route);
  if (!found) throw new Error(`${route} is not a footed beta page`);
  return found;
};

export const REPORT_PRESENCE_CHECKS: readonly PageCheck[] = [
  {
    name: "the type-ahead offers exactly this page's strings",
    routes: () => FOOTED.map(({ path }) => path),
    themes: [DEFAULT_THEME],
    run: async ({ page, route }) => {
      const { locale, id } = footed(route);
      const offered = await page
        .locator('footer [data-report-strings] option')
        .evaluateAll((options) =>
          options.map((option) => (option as HTMLOptionElement).value),
        );
      expect.soft(new Set(offered)).toEqual(new Set(reportOptions(id, locale)));
      expect.soft(offered.length).toBe(reportOptions(id, locale).length);
    },
  },
  {
    name: 'the disclosure sits right after the BETA notice, and asks for nothing personal',
    routes: () => PREFIXED_LOCALES.map((locale) => pagePath('home', locale)),
    themes: [DEFAULT_THEME],
    run: async ({ page, route }) => {
      // AC2: beside the BETA notice, not merely somewhere in the footer.
      await expect
        .soft(page.locator('[data-beta-notice] + details[data-report]'))
        .toHaveCount(1);
      // AC6: no contact fields. Exactly the fields spec 3.2 names, so a field
      // added later has to be argued for here.
      const named = await page
        .locator('[data-report-form] [name]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('name')));
      expect
        .soft(named, route)
        .toEqual(['locale', 'page', 'quote', 'suggestion', 'note', 'website']);
    },
  },
];
