import { test, expect } from './fixtures';
import { contrastRatio } from './helpers';
import { recorded, shoot } from './evidence';
import { expectedBadges } from '../beta-badges';
import { searched } from '../source-files';
import { THEMES } from '../palette';
import { emulateTheme } from '../themes';
import { expectNoHorizontalScroll } from '../viewport';
import {
  LOCALES,
  DEFAULT_LOCALE,
  PREFIXED_LOCALES,
  isBetaLocale,
  localisePath,
  otherLocales,
  getSiteStrings,
  BETA_BADGE,
} from '../../src/lib/i18n/index';

test.use(recorded);

/**
 * What a visitor actually sees: every unverified language is labelled BETA.
 *
 * The unit tests hold the derivation and the copy. These hold the RENDERING,
 * which is what #96's acceptance criteria are written about -- a marker that
 * exists in a string table and reaches no page is exactly the vacuity this
 * repo keeps finding.
 *
 * Runs over the full LOCALES set, not `SAMPLED_LOCALES`: this is text- and
 * layout-sensitive, and the 320px case in particular differs by script.
 *
 * `shoot` calls sit AFTER the assertion they document, so a captured image is
 * itself the result -- see tests/e2e/evidence.ts. They are free unless
 * `EVIDENCE_DIR` is set.
 */

const SWITCHER = 'details.lang-switch';
const BADGE = '[data-beta]';
const NOTICE = '[data-beta-notice]';
const FOOTER = 'footer#contact-legal';

test.describe('every unverified language is marked BETA', () => {
  for (const locale of LOCALES) {
    const path = localisePath('/', locale);
    const t = getSiteStrings(locale);

    test(`${locale}: marks each beta language once in the list, and English never`, async ({
      page,
    }) => {
      await page.goto(path);

      expect(
        await page.locator(BADGE).count(),
        `${path}: expected one badge per beta locale, and one for the summary`,
      ).toBe(expectedBadges(locale));
      await shoot(
        page,
        `${locale} page carries exactly ${expectedBadges(locale)} badges`,
        page.locator(SWITCHER),
      );

      // The language being read is badged only when it is itself unverified.
      const summaryBadge = page.locator(`${SWITCHER} > summary ${BADGE}`);
      await expect(summaryBadge).toHaveCount(isBetaLocale(locale) ? 1 : 0);
      await shoot(
        page,
        isBetaLocale(locale)
          ? `${locale} is unverified, so the control it is read in is badged`
          : `${locale} is verified, so the control shows no badge`,
        page.locator(`${SWITCHER} > summary`),
      );

      await page.locator(`${SWITCHER} > summary`).click();
      const current = page.locator(`${SWITCHER} li[aria-current]`);
      await expect(
        current.locator(BADGE),
        `${path}: the current entry, ${locale}, is badged only if it is unverified`,
      ).toHaveCount(isBetaLocale(locale) ? 1 : 0);
      for (const other of otherLocales(locale)) {
        const entry = page.locator(`${SWITCHER} li a[hreflang="${other}"]`);
        await expect(
          entry.locator(BADGE),
          `${path}: ${other} is ${isBetaLocale(other) ? 'unverified and unbadged' : 'verified but badged'}`,
        ).toHaveCount(isBetaLocale(other) ? 1 : 0);
        await shoot(
          page,
          `${other} entry ${isBetaLocale(other) ? 'is badged' : 'is NOT badged'}`,
          entry,
        );
      }
    });

    test(`${locale}: the footer says why, in ${locale}`, async ({ page }) => {
      await page.goto(path);
      const notice = page.locator(NOTICE);

      if (!isBetaLocale(locale)) {
        // English is the one locale we can confirm verified, so its page
        // carries no notice at all.
        await expect(notice).toHaveCount(0);
        await shoot(
          page,
          'the English footer carries no beta notice',
          page.locator(FOOTER),
        );
        return;
      }

      await expect(notice).toBeVisible();
      await expect(notice).toContainText(t.language.betaNotice);
      // The badge token is not translated; the sentence beside it is.
      await expect(notice).toContainText(BETA_BADGE);
      await shoot(page, `the notice is present and in ${locale}`, notice);

      if (locale !== DEFAULT_LOCALE) {
        await expect(notice).not.toContainText(
          getSiteStrings(DEFAULT_LOCALE).language.betaNotice,
        );
        await shoot(
          page,
          `${locale} does not fall back to the English sentence`,
          page.locator(FOOTER),
        );
      }
    });
  }

  // One test per case from here (#420): per locale, and per theme.
  //
  // "BETA" alone tells a screen-reader user nothing about WHAT is in beta.
  // Read from the accessibility tree, not as an accessible name: the badge is
  // a plain `<span>` with no role, and the label is a visually-hidden child
  // that a reader traverses but `innerText` omits. Not as textContent either:
  // that keeps a label set to `display: none`, which no reader hears (BB1).
  for (const locale of PREFIXED_LOCALES)
    test(`${locale}: the badge carries a translated name for screen readers`, async ({
      page,
    }) => {
      await page.goto(localisePath('/', locale));
      const badge = page.locator(`${SWITCHER} > summary ${BADGE}`);
      const spoken = await badge.ariaSnapshot();
      expect(spoken, 'badge is a bare token').toContain(
        getSiteStrings(locale).language.betaLabel,
      );
      expect(spoken).toContain(BETA_BADGE);
      await shoot(
        page,
        `${locale} badge is announced as "${spoken.trim()}"`,
        page.locator(`${SWITCHER} > summary`),
      );
    });

  // Each entry carries its own `lang`, so a screen reader voices 中文 in
  // Chinese. The badge's hidden label is written in the PAGE's language --
  // "beta translation" on an English page -- and with no `lang` of its own
  // it inherited the entry's, handing English words to a Chinese voice.
  for (const locale of LOCALES)
    test(`${locale}: the badge's spoken label keeps the page's language, even inside another language's entry`, async ({
      page,
    }) => {
      await page.goto(localisePath('/', locale));
      await page.locator(`${SWITCHER} > summary`).click();
      const voices = await page
        .locator(`${SWITCHER} ${BADGE} .visually-hidden`)
        .evaluateAll((labels) =>
          labels.map((label) => label.closest('[lang]')?.getAttribute('lang')),
        );
      expect(voices, 'one label per badge').toHaveLength(
        expectedBadges(locale),
      );
      const misvoiced = voices.filter((voice) => voice !== locale);
      expect(
        searched(misvoiced, { of: voices, what: 'badge labels' }),
        'badge labels voiced in another language',
      ).toEqual([]);
    });

  // Both placements: the dropdown paints its own background, so the entry
  // badge is a different composite from the one in the summary. The list is
  // opened first, so both badges are measured. One prefixed locale stands
  // for all: a badge's contrast does not depend on its language.
  for (const theme of THEMES)
    test(`${theme}: the badge clears the WCAG AA floor for normal text`, async ({
      page,
    }) => {
      await page.goto(localisePath('/', PREFIXED_LOCALES[0]));
      await page.locator(`${SWITCHER} > summary`).click();
      const summaryBadge = page
        .locator(`${SWITCHER} > summary ${BADGE}`)
        .first();
      const entryBadge = page.locator(`${SWITCHER} li ${BADGE}`).first();
      await expect(entryBadge).toBeVisible();
      await emulateTheme(page, theme);
      const summaryRatio = await contrastRatio(summaryBadge);
      expect(summaryRatio, 'the summary badge').toBeGreaterThanOrEqual(4.5);
      const entryRatio = await contrastRatio(entryBadge);
      expect(entryRatio, 'the entry badge').toBeGreaterThanOrEqual(4.5);
      await shoot(
        page,
        `${theme}: the badge paints ${summaryRatio.toFixed(2)}:1 in the summary and ${entryRatio.toFixed(2)}:1 in the list, floor 4.5:1`,
        page.locator(SWITCHER),
      );
    });

  for (const locale of LOCALES)
    test(
      `${locale}: adds no horizontal scroll at 320px`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        const path = localisePath('/', locale);
        await page.setViewportSize({ width: 320, height: 720 });
        await page.goto(path);
        // Not vacuous: a badge hidden at 320px would satisfy "no overflow"
        // trivially, and hiding it is also the wrong fix.
        if (isBetaLocale(locale))
          await expect(
            page.locator(`${SWITCHER} > summary ${BADGE}`),
          ).toBeVisible();
        await expect(page.locator(NOTICE)).toHaveCount(
          isBetaLocale(locale) ? 1 : 0,
        );
        const overflow = await expectNoHorizontalScroll(
          page,
          `${path} scrolls sideways at 320px with the BETA marker`,
        );
        await shoot(
          page,
          `${locale} at 320px: badge visible, overflow ${overflow}px`,
        );
      },
    );
});
