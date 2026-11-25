import type { Page } from '@playwright/test';
import { expect } from '../fixtures';
import { shoot } from '../evidence';
import { expectNoHorizontalScroll } from '../../viewport';
import {
  LOCALES,
  getSiteStrings,
  localisePath,
  type Locale,
} from '../../../src/lib/i18n';
import { LOCALE_METADATA } from '../../../src/lib/i18n/metadata';
import { DEFAULT_THEME, type PageCheck } from '../page-checks';

export const SWITCHER = 'details.lang-switch';

/**
 * Below this width the menu button appears, and the switcher shows its flag
 * and short code instead of the full name. The operator's decision for #329,
 * 2026-09-23: one breakpoint shared with the menu, in every locale.
 */
export const COMPACT_BELOW = 720;

/**
 * Which of the two labels shows, asserted on what is VISIBLE. Both are in the
 * markup at every width, so the hidden one still sits in `textContent`, and a
 * `toContainText` on the summary passes whichever the page paints.
 */
const expectLabel = async (
  page: Page,
  locale: Locale,
  width: number,
): Promise<void> => {
  const summary = page.locator(`${SWITCHER} > summary`);
  const { nativeName, shortName } = LOCALE_METADATA[locale];
  const [shown, hidden, text] =
    width < COMPACT_BELOW
      ? ['.short', '.full', shortName]
      : ['.full', '.short', nativeName];
  const where = `${locale} at ${width}px`;
  await expect.soft(summary.locator(shown), `${where}: ${shown}`).toBeVisible();
  await expect.soft(summary.locator(shown)).toHaveText(text);
  await expect
    .soft(summary.locator(hidden), `${where}: ${hidden}`)
    .toHaveCount(1);
  await expect
    .soft(summary.locator(hidden), `${where}: ${hidden}`)
    .toBeHidden();
  await expect
    .soft(summary)
    .toHaveAccessibleName(getSiteStrings(locale).language.label);
  await shoot(
    page,
    `${where}: the switcher shows ${text}`,
    page.locator('header'),
  );
};

const HOMES = LOCALES.map((locale) => ({
  locale,
  path: localisePath('/', locale),
}));
const localeOf = (route: string): Locale => {
  const home = HOMES.find(({ path }) => path === route);
  if (!home) throw new Error(`${route} is not a homepage`);
  return home.locale;
};

/**
 * The language switcher's reads on each homepage, moved from
 * language-switcher.spec.ts (#1086). Two of them were one test per locale and
 * width, and a real phone, which keeps its own width (#1046), repeated the
 * same load at each. The tests that open the switcher stay there.
 */
export const LANGUAGE_SWITCHER_CHECKS: readonly PageCheck[] = [
  {
    // At the target's own width -- and on a real phone, which emulates
    // nothing: the desktop projects see the full name and the phone projects
    // the short code, so both branches run.
    name: 'names the current language in its own language, as its width calls for',
    routes: () => HOMES.map(({ path }) => path),
    themes: [DEFAULT_THEME],
    run: async ({ page, route }) => {
      const width = await page.evaluate(() => window.innerWidth);
      await expectLabel(page, localeOf(route), width);
    },
  },
  {
    // Both sides of the edge, and both ends of the range (#329). The label
    // follows the width the page really has. It read at 720px tall; the walk
    // reads at 900px, and the label reads only the width.
    name: 'shows the short code below 720px and the full name from 720px',
    routes: () => HOMES.map(({ path }) => path),
    themes: [DEFAULT_THEME],
    widths: [320, COMPACT_BELOW - 1, COMPACT_BELOW, 1280],
    run: async ({ page, route, took }) => {
      await expectLabel(page, localeOf(route), took.width);
    },
  },
  {
    // Width at 320px is one of the few genuinely locale-sensitive things
    // here: Thai and Chinese set to different widths than English (#75).
    name: 'the language switcher adds no horizontal scroll at 320px',
    routes: () => HOMES.map(({ path }) => path),
    themes: [DEFAULT_THEME],
    widths: [320],
    run: async ({ page, route, took }) => {
      // Not vacuous: a switcher hidden at 320px would satisfy "no overflow"
      // trivially, and would also be the wrong fix.
      await expect.soft(page.locator(`${SWITCHER} > summary`)).toBeVisible();
      await expectNoHorizontalScroll(
        page,
        `${route} scrolls sideways at ${took.width}px`,
      );
    },
  },
];
