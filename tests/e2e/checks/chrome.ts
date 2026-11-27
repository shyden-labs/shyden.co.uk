import { expect } from '../fixtures';
import { shoot } from '../evidence';
import { searched } from '../../source-files';
import {
  LOCALES,
  getSiteStrings,
  localeFromPath,
  localisePath,
} from '../../../src/lib/i18n';
import { DISSOLVED_COMPANY, dissolvedIn } from '../../dissolved-company';
import { DEFAULT_THEME, type PageCheck } from '../page-checks';

/**
 * The header's and footer's reads, moved from chrome.spec.ts (#1086), where
 * each opened its page again. The tests that tap, type or walk by keyboard
 * stay there.
 */
export const CHROME_CHECKS: readonly PageCheck[] = [
  {
    // The Header renders on every page via BaseLayout, but its section
    // anchors exist only on the homepage — so the nav hrefs must be
    // root-relative (/#…) or they dead-link on sub-pages. Regression guard for
    // the cross-task defect the whole-branch review caught (nav was #shytalk →
    // /yeetalk-calculators#shytalk = dead).
    name: 'nav links are root-relative so they work from every page, not just /',
    routes: () => ['/yeetalk-calculators'],
    themes: [DEFAULT_THEME],
    run: async ({ page }) => {
      const hrefs = await page
        .locator('header nav a')
        .evaluateAll((els) => els.map((e) => e.getAttribute('href')));
      expect
        .soft(hrefs)
        .toEqual(['/#shytalk', '/#yawelo-idle', '/#tools', '/support']);
    },
  },
  {
    // Shyden Ltd is dissolved (operator, 2026-09-27, #370): the footer names
    // no company, no number and no registered office, in any language. What
    // stays is the way to reach a person. The forms it must not print have
    // one home, tests/dissolved-company.ts (#390 F116).
    name: 'the footer names no company, and still reaches a person',
    routes: () => LOCALES.map((locale) => localisePath('/', locale)),
    themes: [DEFAULT_THEME],
    run: async ({ page, route }) => {
      const footer = page.locator('footer');
      await expect.soft(footer).toBeVisible();
      await expect.soft(footer.locator('.disclosure')).toHaveCount(0);
      // textContent, not innerText: a form hidden from sight is still printed.
      const printed = dissolvedIn((await footer.textContent()) ?? '');
      expect
        .soft(
          searched(printed, {
            of: DISSOLVED_COMPANY,
            what: 'dissolved-company forms',
          }),
          `${route} footer still names the company`,
        )
        .toEqual([]);
      // No web page shows an email address (Shyden, 2026-11-23, #1266): the
      // way to a person is the support page, which the header links.
      await expect.soft(footer.locator('a[href^="mailto:"]')).toHaveCount(0);
      expect
        .soft(
          (await footer.textContent()) ?? '',
          `${route} footer prints an address`,
        )
        .not.toContain('@');
      await shoot(page, `${route} footer: no address, and no company`, footer);
    },
  },
  {
    // #1266: support requests come only through the support form, so both
    // ways the homepage offers to reach a person lead to it, in the page's
    // own language: a visitor on /vi/ lands on /vi/support, not English.
    name: 'Contact and Get in touch lead to the page’s own support page',
    routes: () => LOCALES.map((locale) => localisePath('/', locale)),
    themes: [DEFAULT_THEME],
    run: async ({ page, route }) => {
      const locale = localeFromPath(route);
      const t = getSiteStrings(locale);
      const support = localisePath('/support', locale);
      await expect
        .soft(
          // Read-only: where the link goes, not whether it shows. On a phone the
          // nav is folded behind the menu button, so the link is hidden there
          // and a visible-only lookup finds nothing (#1310, measured on the
          // OPPO); the menu's opening is the header journeys' to test.
          page.locator('header nav').getByRole('link', {
            name: t.nav.contact,
            exact: true,
            includeHidden: true,
          }),
          `${route} header Contact`,
        )
        .toHaveAttribute('href', support);
      await expect
        .soft(
          page
            .locator('#contact')
            .getByRole('link', { name: t.home.getInTouch, exact: true }),
          `${route} Get in touch`,
        )
        .toHaveAttribute('href', support);
    },
  },
];
