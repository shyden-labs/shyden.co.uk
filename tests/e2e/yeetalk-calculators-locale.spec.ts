import { test, expect } from './fixtures';
import { recorded, shoot } from './evidence';
import { expectVisibleText } from './helpers';
import {
  LOCALES,
  localisePath,
  getSiteStrings,
} from '../../src/lib/i18n/index';
import { LOCALE_METADATA } from '../../src/lib/i18n/metadata';

test.use(recorded);

/**
 * The calculator answers in the language of the page it is on.
 *
 * `yeetalk-calculators.ts` chose its locale with
 * `document.documentElement.lang === 'id' ? 'id' : 'en'` -- a binary written
 * when the site served two languages. #22 shipped five, so on /zh/, /vi/ and
 * /th/ it fell through to ENGLISH: English validation messages, and numbers
 * grouped as en-GB.
 *
 * That second half is the bug `formatNumber`'s own docblock describes for
 * Indonesian, reappearing in three more locales: Vietnamese groups thousands
 * with "." and marks decimals with ",", the exact reverse of English, so a
 * result read as one number and meant another.
 *
 * Derived from LOCALES, so a sixth language is covered the day it is added.
 */

test.describe('the Glory Points calculator speaks the page it is on', () => {
  for (const locale of LOCALES) {
    test(`${locale}: validation is answered in ${locale}`, async ({ page }) => {
      await page.goto(localisePath('/yeetalk-calculators', locale));
      const t = getSiteStrings(locale).calculators;

      await page.locator('#glory-input').fill('');
      await page.locator('#glory-submit').click();

      // Visible copy: `toHaveText` alone passes for a message the page
      // wrote and never showed (#390 F123).
      const error = page.locator('#glory-error');
      await expectVisibleText(error, t.errors.empty);
      await shoot(
        page,
        `${locale}: empty input is refused in ${locale}`,
        error,
      );
    });

    test(`${locale}: numbers use ${locale} conventions`, async ({ page }) => {
      await page.goto(localisePath('/yeetalk-calculators', locale));

      await page.locator('#glory-input').fill('1112');
      await page.locator('#glory-submit').click();

      const result = page.locator('#glory-result');
      await expect(result).toBeVisible();
      await expect(result).not.toBeEmpty();
      const shown = (await result.textContent()) ?? '';

      // Compare against what the platform itself formats for this locale --
      // never a hand-written expectation of where the separators go, which
      // would be a second table to keep in step with LOCALE_METADATA.
      const expected = (1112).toLocaleString(
        LOCALE_METADATA[locale].numberLocale,
      );
      expect(
        shown.includes(expected),
        `${locale}: expected ${expected} in "${shown.trim().slice(0, 80)}"`,
      ).toBe(true);
      await shoot(page, `${locale}: 1112 renders as ${expected}`, result);
    });

    // #635: the 301 from /glory-points lands on `#glory-points`, so that id is
    // part of the contract in every language -- on the one section that holds
    // the calculator, named by its own heading, and reachable from the jump
    // link. A missing id lands the old bookmark at the top of the page with
    // nothing to say so.
    test(`${locale}: #glory-points is the Glory Points section, and the jump link reaches it`, async ({
      page,
    }) => {
      await page.goto(localisePath('/yeetalk-calculators', locale));
      const t = getSiteStrings(locale).calculators;

      const section = page.locator('section#glory-points');
      await expect(section).toHaveCount(1);
      await expect(page.locator('[id="glory-points"]')).toHaveCount(1);
      await expect(section.getByRole('heading', { level: 2 })).toHaveText(
        t.glory.heading,
      );
      await expect(section.locator('#glory-input')).toHaveCount(1);

      const jump = page.locator('a[href="#glory-points"]');
      await expect(jump).toHaveCount(1);
      await expect(jump).toBeVisible();
      await expect(jump).toHaveText(t.glory.heading);
      await shoot(
        page,
        `${locale}: the jump link names the Glory section`,
        jump,
      );
    });

    test(`${locale}: arriving on #glory-points shows the calculator`, async ({
      page,
    }) => {
      await page.goto(
        `${localisePath('/yeetalk-calculators', locale)}#glory-points`,
      );
      await expect(page.locator('#glory-input')).toBeInViewport();
    });
  }
});
