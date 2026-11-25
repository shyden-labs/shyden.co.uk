import type { Page } from '@playwright/test';
import { expect } from '../fixtures';
import { shoot } from '../evidence';
import { tapOn } from '../../real-touch';
import { atLeast44, expectNoHorizontalScroll } from '../../viewport';
import { searched } from '../../source-files';
import { expectedBadges } from '../../beta-badges';
import { THEMES } from '../../palette';
import { sitePaths } from '../../site-pages';
import { contrastRatio } from '../helpers';
import {
  LOCALES,
  DEFAULT_LOCALE,
  PREFIXED_LOCALES,
  isBetaLocale,
  localisePath,
  otherLocales,
  getSiteStrings,
  BETA_BADGE,
  type Locale,
} from '../../../src/lib/i18n/index';
import { LOCALE_METADATA } from '../../../src/lib/i18n/metadata';
import { DEFAULT_THEME, type PageCheck } from '../page-checks';
import { SWITCHER } from './language-switcher';

/**
 * The language switcher, opened, and the BETA marking it carries (#96),
 * moved from language-switcher.spec.ts and locale-beta.spec.ts (#1086).
 *
 * Five tests in those two files each loaded a homepage and tapped the
 * switcher open: the list and its order, the BETA badges in it, the badges'
 * spoken language, opening without JavaScript, and its touch targets. That
 * is one journey, so it is one check, made on each homepage's walk: what is
 * read with the switcher closed is read first, then ONE real tap opens it.
 * The checks after it that need it open find it open, and tap only where
 * they run on a load of their own (an emulated target's 320px load, the
 * light theme's walk).
 */

const BADGE = '[data-beta]';
const NOTICE = '[data-beta-notice]';
const FOOTER = 'footer#contact-legal';

const HOMES = LOCALES.map((locale) => ({
  locale,
  path: localisePath('/', locale),
}));
const localeOf = (route: string): Locale => {
  const home = HOMES.find(({ path }) => path === route);
  if (!home) throw new Error(`${route} is not a homepage`);
  return home.locale;
};

/** Open the switcher with a real tap, unless an earlier check on this load already did. */
const openSwitcher = async (page: Page): Promise<void> => {
  const open = await page
    .locator(SWITCHER)
    .evaluate((details) => (details as HTMLDetailsElement).open);
  if (!open) await tapOn(page.locator(`${SWITCHER} > summary`));
};

const switcherTargets = (page: Page): Promise<Record<string, string>> =>
  page
    .locator(`${SWITCHER} li a`)
    .evaluateAll((links) =>
      Object.fromEntries(
        links.map((l) => [
          l.getAttribute('hreflang') ?? '',
          l.getAttribute('href') ?? '',
        ]),
      ),
    );

const withSlash = (path: string): string =>
  path.endsWith('/') ? path : `${path}/`;

/** Every page in every language, for the switcher's links. */
const LOCALE_PAGES = sitePaths().flatMap((path) =>
  LOCALES.map((locale) => ({ path, locale, here: localisePath(path, locale) })),
);
const pageOf = (route: string) => {
  const found = LOCALE_PAGES.find(({ here }) => here === route);
  if (!found) throw new Error(`${route} is not a locale page`);
  return found;
};

/** Read with the switcher closed: before the tap that opens it. */
export const SWITCHER_READ_CHECKS: readonly PageCheck[] = [
  {
    // locale-beta.spec.ts
    name: 'the footer says why, in its own language',
    routes: () => HOMES.map(({ path }) => path),
    themes: [DEFAULT_THEME],
    run: async ({ page, route }) => {
      const locale = localeOf(route);
      const t = getSiteStrings(locale);
      const notice = page.locator(NOTICE);
      if (!isBetaLocale(locale)) {
        // English is the one locale we can confirm verified, so its page
        // carries no notice at all.
        await expect.soft(notice).toHaveCount(0);
        await shoot(
          page,
          'the English footer carries no beta notice',
          page.locator(FOOTER),
        );
        return;
      }
      await expect.soft(notice).toBeVisible();
      await expect.soft(notice).toContainText(t.language.betaNotice);
      // The badge token is not translated; the sentence beside it is.
      await expect.soft(notice).toContainText(BETA_BADGE);
      await shoot(page, `the notice is present and in ${locale}`, notice);
      if (locale !== DEFAULT_LOCALE) {
        await expect
          .soft(notice)
          .not.toContainText(
            getSiteStrings(DEFAULT_LOCALE).language.betaNotice,
          );
        await shoot(
          page,
          `${locale} does not fall back to the English sentence`,
          page.locator(FOOTER),
        );
      }
    },
  },
  {
    // locale-beta.spec.ts. "BETA" alone tells a screen-reader user nothing
    // about WHAT is in beta. Read from the accessibility tree, not as an
    // accessible name: the badge is a plain `<span>` with no role, and the
    // label is a visually-hidden child that a reader traverses but
    // `innerText` omits. Not as textContent either: that keeps a label set
    // to `display: none`, which no reader hears (BB1).
    name: 'the badge carries a translated name for screen readers',
    routes: () => PREFIXED_LOCALES.map((l) => localisePath('/', l)),
    themes: [DEFAULT_THEME],
    run: async ({ page, route }) => {
      const locale = localeOf(route);
      const badge = page.locator(`${SWITCHER} > summary ${BADGE}`);
      const spoken = await badge.ariaSnapshot();
      expect
        .soft(spoken, 'badge is a bare token')
        .toContain(getSiteStrings(locale).language.betaLabel);
      expect.soft(spoken).toContain(BETA_BADGE);
      await shoot(
        page,
        `${locale} badge is announced as "${spoken.trim()}"`,
        page.locator(`${SWITCHER} > summary`),
      );
    },
  },
  {
    // language-switcher.spec.ts (#390 F131). The classic i18n bug is a
    // switcher that dumps the visitor on the homepage instead of translating
    // the page in front of them. Trailing slash included deliberately: Astro
    // serves these paths with one, so this asserts the href a visitor
    // actually gets.
    name: 'the switcher keeps you on the page you were reading',
    routes: () => LOCALE_PAGES.map(({ here }) => here),
    themes: [DEFAULT_THEME],
    run: async ({ page, route }) => {
      const { path, locale } = pageOf(route);
      expect
        .soft(await switcherTargets(page))
        .toEqual(
          Object.fromEntries(
            otherLocales(locale).map((other) => [
              other,
              withSlash(localisePath(path, other)),
            ]),
          ),
        );
    },
  },
  {
    // language-switcher.spec.ts (#390 F131)
    name: 'every switcher target is a real page, not a 404',
    routes: () => LOCALE_PAGES.map(({ here }) => here),
    themes: [DEFAULT_THEME],
    run: async ({ page, route }) => {
      const { locale } = pageOf(route);
      const targets = Object.values(await switcherTargets(page));
      // The population: one entry for every other language.
      expect.soft(targets).toHaveLength(otherLocales(locale).length);
      for (const href of targets)
        expect.soft((await page.request.get(href)).status(), href).toBe(200);
    },
  },
  {
    // locale-beta.spec.ts. It read at 320 x 720; the walk reads at 320 x 900,
    // and nothing here reads the height.
    name: 'the BETA marker adds no horizontal scroll at 320px',
    routes: () => HOMES.map(({ path }) => path),
    themes: [DEFAULT_THEME],
    widths: [320],
    run: async ({ page, route, took }) => {
      const locale = localeOf(route);
      // Not vacuous: a badge hidden at 320px would satisfy "no overflow"
      // trivially, and hiding it is also the wrong fix.
      if (isBetaLocale(locale))
        await expect
          .soft(page.locator(`${SWITCHER} > summary ${BADGE}`))
          .toBeVisible();
      await expect
        .soft(page.locator(NOTICE))
        .toHaveCount(isBetaLocale(locale) ? 1 : 0);
      const overflow = await expectNoHorizontalScroll(
        page,
        `${route} scrolls sideways at ${took.width}px with the BETA marker`,
      );
      await shoot(
        page,
        `${locale} at ${took.width}px: badge visible, overflow ${overflow}px`,
      );
    },
  },
];

/** One tap opens the switcher; then everything read with it open. */
export const SWITCHER_OPEN_CHECKS: readonly PageCheck[] = [
  {
    name: 'the open language switcher: its list, its BETA badges, their voices, its targets, without JavaScript',
    routes: () => HOMES.map(({ path }) => path),
    themes: [DEFAULT_THEME],
    mutates: true,
    run: async ({ page, route }) => {
      const locale = localeOf(route);
      const details = page.locator(SWITCHER);
      const summary = page.locator(`${SWITCHER} > summary`);

      // CLOSED. locale-beta: one badge per beta locale, and one for the
      // summary when the language being read is itself unverified.
      expect
        .soft(
          await page.locator(BADGE).count(),
          `${route}: expected one badge per beta locale, and one for the summary`,
        )
        .toBe(expectedBadges(locale));
      await shoot(
        page,
        `${locale} page carries exactly ${expectedBadges(locale)} badges`,
        details,
      );
      await expect
        .soft(page.locator(`${SWITCHER} > summary ${BADGE}`))
        .toHaveCount(isBetaLocale(locale) ? 1 : 0);
      await shoot(
        page,
        isBetaLocale(locale)
          ? `${locale} is unverified, so the control it is read in is badged`
          : `${locale} is verified, so the control shows no badge`,
        summary,
      );
      if (locale === DEFAULT_LOCALE) {
        // 'opens and closes without JavaScript': a native <details>, with no
        // script of its own, since a language switcher is exactly the
        // control someone needs when something else has failed.
        await expect
          .soft(page.locator(`${SWITCHER} li a`).first())
          .toBeHidden();
        // 'the control and its entries are touchable'
        await atLeast44(summary, 'the switcher summary');
      }

      // OPEN, by one real tap.
      await openSwitcher(page);

      if (locale === DEFAULT_LOCALE) {
        await expect.soft(details).toHaveAttribute('open', '');
        await expect
          .soft(page.locator(`${SWITCHER} li a`).first())
          .toBeVisible();
        await atLeast44(
          page.locator(`${SWITCHER} li a`).first(),
          'the first switcher entry',
        );
        await atLeast44(
          page.locator(`${SWITCHER} li[aria-current]`),
          'the current language entry',
        );
      }

      // language-switcher: every language, derived. A count of 1 and a
      // single hard-coded name asserted that the site had two languages, not
      // that the switcher lists them.
      const items = page.locator(`${SWITCHER} li`);
      await expect.soft(items).toHaveCount(LOCALES.length);
      // ONE order on every page, LOCALES order (operator, 2026-09-30, #385).
      await expect
        .soft(items.locator('.name'))
        .toHaveText(LOCALES.map((l) => LOCALE_METADATA[l].nativeName));
      // The current language, with its full name, ticked IN ITS OWN PLACE:
      // at narrow widths the summary shows only a code, so this is where the
      // name is (#329).
      const current = items.nth(LOCALES.indexOf(locale));
      await expect.soft(current).toHaveAttribute('aria-current', 'true');
      await expect.soft(current.locator('.name')).toBeVisible();
      await expect
        .soft(current.locator('.name'))
        .toHaveText(LOCALE_METADATA[locale].nativeName);
      await expect.soft(current.locator('.tick')).toBeVisible();
      await expect
        .soft(current.locator('a'), 'the current entry is a link')
        .toHaveCount(0);
      await expect
        .soft(page.locator(`${SWITCHER} li[aria-current]`))
        .toHaveCount(1);
      await expect.soft(page.locator(`${SWITCHER} .tick`)).toHaveCount(1);
      const entries = page.locator(`${SWITCHER} li a`);
      await expect.soft(entries).toHaveCount(otherLocales(locale).length);
      for (const other of otherLocales(locale)) {
        const entry = entries.filter({
          hasText: LOCALE_METADATA[other].nativeName,
        });
        await expect
          .soft(entry, `${locale}: an entry for ${other}`)
          .toHaveCount(1);
        await expect.soft(entry).toBeVisible();
        await expect.soft(entry).toHaveAttribute('hreflang', other);
        await expect.soft(entry).toHaveAttribute('lang', other);
      }
      await shoot(
        page,
        `${locale}: every language listed in one order, ${LOCALE_METADATA[locale].nativeName} ticked in place`,
        page.locator(`${SWITCHER} ul`),
      );

      // locale-beta: the current entry is badged only if it is unverified,
      // and every other entry by its own language.
      await expect
        .soft(
          page.locator(`${SWITCHER} li[aria-current]`).locator(BADGE),
          `${route}: the current entry, ${locale}, is badged only if it is unverified`,
        )
        .toHaveCount(isBetaLocale(locale) ? 1 : 0);
      for (const other of otherLocales(locale)) {
        const entry = page.locator(`${SWITCHER} li a[hreflang="${other}"]`);
        await expect
          .soft(
            entry.locator(BADGE),
            `${route}: ${other} is ${isBetaLocale(other) ? 'unverified and unbadged' : 'verified but badged'}`,
          )
          .toHaveCount(isBetaLocale(other) ? 1 : 0);
        await shoot(
          page,
          `${other} entry ${isBetaLocale(other) ? 'is badged' : 'is NOT badged'}`,
          entry,
        );
      }

      // locale-beta: each entry carries its own `lang`, so a screen reader
      // voices 中文 in Chinese. The badge's hidden label is written in the
      // PAGE's language, and with no `lang` of its own it inherited the
      // entry's, handing English words to a Chinese voice.
      const voices = await page
        .locator(`${SWITCHER} ${BADGE} .visually-hidden`)
        .evaluateAll((labels) =>
          labels.map((label) => label.closest('[lang]')?.getAttribute('lang')),
        );
      expect
        .soft(voices, 'one label per badge')
        .toHaveLength(expectedBadges(locale));
      expect
        .soft(
          searched(
            voices.filter((voice) => voice !== locale),
            { of: voices, what: 'badge labels' },
          ),
          'badge labels voiced in another language',
        )
        .toEqual([]);
    },
  },
  {
    // locale-beta.spec.ts. Both placements: the dropdown paints its own
    // background, so the entry badge is a different composite from the one in
    // the summary. One prefixed locale stands for all: a badge's contrast
    // does not depend on its language.
    name: 'the badge clears the WCAG AA floor for normal text',
    routes: () => [localisePath('/', PREFIXED_LOCALES[0])],
    themes: THEMES,
    mutates: true,
    run: async ({ page, theme }) => {
      await openSwitcher(page);
      const summaryBadge = page
        .locator(`${SWITCHER} > summary ${BADGE}`)
        .first();
      const entryBadge = page.locator(`${SWITCHER} li ${BADGE}`).first();
      await expect.soft(entryBadge).toBeVisible();
      const summaryRatio = await contrastRatio(summaryBadge);
      expect
        .soft(summaryRatio, 'the summary badge')
        .toBeGreaterThanOrEqual(4.5);
      const entryRatio = await contrastRatio(entryBadge);
      expect.soft(entryRatio, 'the entry badge').toBeGreaterThanOrEqual(4.5);
      await shoot(
        page,
        `${theme}: the badge paints ${summaryRatio.toFixed(2)}:1 in the summary and ${entryRatio.toFixed(2)}:1 in the list, floor 4.5:1`,
        page.locator(SWITCHER),
      );
    },
  },
  {
    // language-switcher.spec.ts (#390 F131): the panel hangs off a summary
    // whose width is each language's own, so this is a fit test. Page-level
    // scrollWidth is not containment: a panel can escape its own container
    // and still produce zero document scroll. It read at 320 x 720; the walk
    // reads at 320 x 900, and the panel's left and right edges do not read
    // the height.
    name: 'the open dropdown stays inside the viewport at 320px',
    routes: () => HOMES.map(({ path }) => path),
    themes: [DEFAULT_THEME],
    widths: [320],
    mutates: true,
    run: async ({ page, took }) => {
      await expect.soft(page.locator(`${SWITCHER} > summary`)).toBeVisible();
      await openSwitcher(page);
      const box = (await page.locator(`${SWITCHER} ul`).boundingBox())!;
      expect
        .soft(box.x, 'dropdown escapes the left edge')
        .toBeGreaterThanOrEqual(0);
      expect
        .soft(box.x + box.width, 'dropdown escapes the right edge')
        .toBeLessThanOrEqual(took.width);
    },
  },
];
