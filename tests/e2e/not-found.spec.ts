import { test, expect } from './fixtures';
import { shoot } from './evidence';
import { expectNoHorizontalScroll } from '../viewport';
import { LOCALES, getSiteStrings } from '../../src/lib/i18n/index';
import { eachWidth } from '../each-width';

/**
 * The 404, as a visitor who mistyped a URL actually meets it.
 *
 * Cloudflare Pages serves this one file for ANY unknown path, so it is the only
 * place a lost visitor can be answered — and until #104 it answered in two of
 * the five languages this site serves. `copy-reaches-a-page.spec.ts` holds the
 * bytes; this holds what rendering and geometry can show and bytes cannot: that
 * five stacked languages are visible, and that they do not push the page
 * sideways on the narrowest phone.
 */

const NOT_FOUND = '/no-such-page-' + 'xyz';

test.describe('the 404 answers everyone', () => {
  // The four reads of the 404 at the project's own width are made on its
  // walk: checks/not-found.ts (#1086). A width is its own input, so this stays.
  // One test, widths inside (#1086, Shyden 2026-11-13). It held 320px alone,
  // and site-meta.spec.ts walked the same page at 320, 375, 768 and 1280px
  // (900px tall; this one was 720px, and no check here reads the height).
  // A real phone has one width, so it is walked once.
  test('the 404 adds no horizontal scroll at any width, five languages stacked', async ({
    page,
  }) => {
    await eachWidth(
      page,
      [320, 375, 768, 1280].map((width) => ({ width, height: 900 })),
      async (took) => {
        await page.goto(NOT_FOUND);
        // Not vacuous: a 404 whose content were hidden would satisfy
        // "no overflow" trivially, and hiding it is also the wrong fix.
        await expect
          .soft(
            page.getByRole('heading', {
              level: 2,
              name: getSiteStrings(LOCALES[LOCALES.length - 1]).notFound
                .heading,
            }),
          )
          .toBeVisible();
        const overflow = await expectNoHorizontalScroll(
          page,
          `the 404 at ${took.width}px`,
        );
        await shoot(
          page,
          `${took.width}px: last language visible, overflow ${overflow}px`,
        );
      },
    );
  });
});
