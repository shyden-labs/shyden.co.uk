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

/** The two calculators: what each is called, where it is, what it prints. */
const CALCULATORS = [
  { key: 'glory', anchor: 'glory-points' },
  { key: 'gift', anchor: 'gift-value' },
] as const;

test.describe('each calculator speaks the page it is on', () => {
  for (const locale of LOCALES) {
    for (const { key, anchor } of CALCULATORS) {
      const input = `#${key}-input`;
      const submit = `#${key}-submit`;

      test(`${locale}: ${key} validation is answered in ${locale}`, async ({
        page,
      }) => {
        await page.goto(localisePath('/yeetalk-calculators', locale));
        const t = getSiteStrings(locale).calculators;

        await page.locator(input).fill('');
        await page.locator(submit).click();

        // Visible copy: `toHaveText` alone passes for a message the page
        // wrote and never showed (#390 F123).
        const error = page.locator(`#${key}-error`);
        await expectVisibleText(error, t.errors.empty);
        await shoot(
          page,
          `${locale}: ${key} empty input is refused in ${locale}`,
          error,
        );
      });

      test(`${locale}: ${key} numbers use ${locale} conventions`, async ({
        page,
      }) => {
        await page.goto(localisePath('/yeetalk-calculators', locale));

        await page.locator(input).fill('1112');
        await page.locator(submit).click();

        const result = page.locator(`#${key}-result`);
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
        await shoot(
          page,
          `${locale}: ${key} 1112 renders as ${expected}`,
          result,
        );
      });

      // #635: the 301 from /glory-points lands on `#glory-points`, so each
      // section id is part of the contract in every language -- on the one
      // section that holds its calculator, named by its own heading, and
      // reachable from the jump link. A missing id lands the old bookmark at
      // the top of the page with nothing to say so. #636 added `#gift-value`.
      test(`${locale}: #${anchor} is the ${key} section, and the jump link reaches it`, async ({
        page,
      }) => {
        await page.goto(localisePath('/yeetalk-calculators', locale));
        const t = getSiteStrings(locale).calculators[key];

        const section = page.locator(`section#${anchor}`);
        await expect(section).toHaveCount(1);
        await expect(page.locator(`[id="${anchor}"]`)).toHaveCount(1);
        await expect(section.getByRole('heading', { level: 2 })).toHaveText(
          t.heading,
        );
        await expect(section.locator(input)).toHaveCount(1);
        await expect(section.locator(`label[for="${key}-input"]`)).toHaveText(
          t.inputLabel,
        );

        const jump = page.locator(`a[href="#${anchor}"]`);
        await expect(jump).toHaveCount(1);
        await expect(jump).toBeVisible();
        await expect(jump).toHaveText(t.heading);
        await shoot(
          page,
          `${locale}: the jump link names the ${key} section`,
          jump,
        );
      });

      test(`${locale}: arriving on #${anchor} shows the ${key} calculator`, async ({
        page,
      }) => {
        await page.goto(
          `${localisePath('/yeetalk-calculators', locale)}#${anchor}`,
        );
        await expect(page.locator(input)).toBeInViewport();
      });
    }
  }
});
