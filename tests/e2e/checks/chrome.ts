import { expect } from '../fixtures';
import { shoot } from '../evidence';
import { searched } from '../../source-files';
import { LOCALES, localisePath } from '../../../src/lib/i18n';
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
        .toEqual(['/#shytalk', '/#yawelo-idle', '/#tools', '/#contact']);
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
      await expect
        .soft(footer.locator('a[href="mailto:support@shyden.co.uk"]'))
        .toBeVisible();
      await shoot(
        page,
        `${route} footer: the support email, and no company`,
        footer,
      );
    },
  },
];
