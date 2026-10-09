import { test } from './fixtures';
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
 * The Gift Value calculator prints its whole result line in the page's own
 * language, its numbers grouped as that locale groups them (Indonesian and
 * Vietnamese reverse English's "," and "."). The validation, the section id,
 * the jump link and the arrival on the anchor are asserted for BOTH
 * calculators in `yeetalk-calculators-locale.spec.ts`. Derived from LOCALES,
 * so a sixth language is covered the day it is added.
 */
test.describe('the Gift Value result line reads in every language', () => {
  for (const locale of LOCALES) {
    test(`${locale}: 1000000 prints as the whole line in ${locale}`, async ({
      page,
    }) => {
      await page.goto(localisePath('/yeetalk-calculators', locale));
      const t = getSiteStrings(locale).calculators;
      // Compared with what the platform itself formats for this locale, never
      // a hand-written table of separators.
      const group = (n: number) =>
        n.toLocaleString(LOCALE_METADATA[locale].numberLocale);

      await page.locator('#gift-input').fill('1000000');
      await page.locator('#gift-submit').click();

      const result = page.locator('#gift-result');
      await expectVisibleText(
        result,
        t.gift.resultLine(group(1_000_000), group(400_000), group(360_000)),
      );
      await shoot(
        page,
        `${locale}: 1000000 renders as ${group(1_000_000)}`,
        result,
      );
    });
  }
});
