import { tapOn } from '../real-touch';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { LOCALES, localisePath, otherLocales } from '../../src/lib/i18n';
import { LOCALE_METADATA } from '../../src/lib/i18n/metadata';
import { recorded, shoot } from './evidence';
import { atLeast44 } from '../viewport';
import { sitePaths } from '../site-pages';
import { SWITCHER } from './checks/language-switcher';
import { atViewport } from '../viewport-at';

test.use(recorded);

/**
 * The language switcher, as a visitor meets it.
 *
 * It replaced a single link labelled "the other language" — one string that
 * could only ever name one alternative. The unit tests hold the source shape;
 * these hold what a person actually gets: the right name, in the right script,
 * linking to the page they were already reading.
 *
 * The 320px case is not a formality. The old control was one short word; this
 * one is a flag, a caret and a full native name — "Bahasa Indonesia" is 16
 * characters — sitting in a header that already carries a wordmark and a menu
 * button. This repo has shipped horizontal scroll from exactly this kind of
 * intrinsic-width growth before (#cg-io-toggle pinned a grid track to 378px
 * and put 74px of scroll on a 320px screen).
 */

/** Each switcher entry's href, keyed by the language it offers. */
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

/** A path as Astro serves it, with its trailing slash. */
const withSlash = (path: string): string =>
  path.endsWith('/') ? path : `${path}/`;

test.describe('language switcher', () => {
  // The label at the target's own width, the label on both sides of 720px,
  // and no sideways scroll at 320px are read on each homepage's walk:
  // checks/language-switcher.ts (#1086).

  // One test per case below (#420): per locale, and per locale and width.

  for (const locale of LOCALES)
    test(`${locale}: lists every language in one fixed order, the current one ticked in place, every other a link`, async ({
      page,
    }) => {
      await page.goto(localisePath('/', locale));
      await tapOn(page.locator(`${SWITCHER} > summary`));
      // Every language, derived. A count of 1 and a single hard-coded name
      // asserted that the site had two languages, not that the switcher lists
      // them -- and it would have gone on passing if #22 had wired the three
      // new locales everywhere EXCEPT here.
      const items = page.locator(`${SWITCHER} li`);
      await expect(items).toHaveCount(LOCALES.length);

      // ONE order on every page, LOCALES order (operator, 2026-09-30, #385).
      // The list used to put the language being read first, so it reordered
      // itself on every language and nothing sat where the eye last left it.
      await expect(items.locator('.name')).toHaveText(
        LOCALES.map((l) => LOCALE_METADATA[l].nativeName),
      );

      // The current language, with its full name, ticked IN ITS OWN PLACE:
      // at narrow widths the summary shows only a code, so this is where the
      // name is (#329).
      const current = items.nth(LOCALES.indexOf(locale));
      await expect(current).toHaveAttribute('aria-current', 'true');
      await expect(current.locator('.name')).toBeVisible();
      await expect(current.locator('.name')).toHaveText(
        LOCALE_METADATA[locale].nativeName,
      );
      await expect(current.locator('.tick')).toBeVisible();
      await expect(
        current.locator('a'),
        'the current entry is a link',
      ).toHaveCount(0);
      await expect(page.locator(`${SWITCHER} li[aria-current]`)).toHaveCount(1);
      await expect(page.locator(`${SWITCHER} .tick`)).toHaveCount(1);

      const entries = page.locator(`${SWITCHER} li a`);
      await expect(entries).toHaveCount(otherLocales(locale).length);
      for (const other of otherLocales(locale)) {
        const entry = entries.filter({
          hasText: LOCALE_METADATA[other].nativeName,
        });
        await expect(entry, `${locale}: an entry for ${other}`).toHaveCount(1);
        await expect(entry).toBeVisible();
        await expect(entry).toHaveAttribute('hreflang', other);
        await expect(entry).toHaveAttribute('lang', other);
      }
      await shoot(
        page,
        `${locale}: every language listed in one order, ${LOCALE_METADATA[locale].nativeName} ticked in place`,
        page.locator(`${SWITCHER} ul`),
      );
    });

  test('opens and closes without JavaScript', async ({ page }) => {
    // A native <details>, with no script of its own: a language switcher is
    // exactly the control someone needs when something else has failed.
    await page.goto('/');
    const details = page.locator(SWITCHER);
    const entry = page.locator(`${SWITCHER} li a`).first();

    await expect(entry).toBeHidden();
    await tapOn(page.locator(`${SWITCHER} > summary`));
    await expect(details).toHaveAttribute('open', '');
    await expect(entry).toBeVisible();
  });

  // Every page, every language, every entry (#390 F131). Both tests read the
  // first entry on /glory-points and nothing else, so a Thai entry that sent
  // the visitor to the homepage, or a /classroom-groups switcher pointing at
  // the wrong page, passed. One test per page per language, so each has its
  // own budget and a failure names the page in its title.
  for (const path of sitePaths())
    for (const locale of LOCALES) {
      const here = localisePath(path, locale);

      test(`${here}: keeps you on the page you were reading`, async ({
        page,
      }) => {
        // The classic i18n bug is a switcher that dumps the visitor on the
        // homepage instead of translating the page in front of them.
        // Trailing slash included deliberately: Astro serves these paths with
        // one, so this asserts the href a visitor actually gets rather than a
        // tidied version of it. `every target is a real page` proves it
        // resolves.
        await page.goto(here);
        expect(await switcherTargets(page)).toEqual(
          Object.fromEntries(
            otherLocales(locale).map((other) => [
              other,
              withSlash(localisePath(path, other)),
            ]),
          ),
        );
      });

      test(`${here}: every target is a real page, not a 404`, async ({
        page,
      }) => {
        await page.goto(here);
        const targets = Object.values(await switcherTargets(page));
        // The population: one entry for every other language.
        expect(targets).toHaveLength(otherLocales(locale).length);
        for (const href of targets)
          expect((await page.request.get(href)).status(), href).toBe(200);
      });
    }

  test('the control and its entries are touchable', async ({ page }) => {
    await page.goto('/');
    const summary = page.locator(`${SWITCHER} > summary`);
    await atLeast44(summary, 'the switcher summary');

    await tapOn(summary);
    const entry = page.locator(`${SWITCHER} li a`).first();
    await atLeast44(entry, 'the first switcher entry');
    await atLeast44(
      page.locator(`${SWITCHER} li[aria-current]`),
      'the current language entry',
    );
  });

  // Derived from LOCALES (#75). This read `['/', '/id/']`, written when those
  // were the only two. Width at 320px is one of the few genuinely
  // locale-sensitive things here — Thai and Chinese set to different widths
  // than English — so the three locales #22 added are exactly the ones this
  // test most needed to see. One test per locale (#420): the loop that once
  // lived inside this test shared one budget across all five.

  // Every language (#390 F131): the panel hangs off a summary whose width is
  // each language's own, so this is a fit test, and it read English only.
  for (const locale of LOCALES)
    test(`${locale}: the open dropdown stays inside the viewport at 320px`, async ({
      page,
    }) => {
      // Page-level scrollWidth is not containment: a panel can escape its
      // own container and still produce zero document scroll.
      const { width: viewportWidth } = await atViewport(page, {
        width: 320,
        height: 720,
      });
      await page.goto(localisePath('/', locale));
      await expect(page.locator(`${SWITCHER} > summary`)).toBeVisible();
      await tapOn(page.locator(`${SWITCHER} > summary`));
      const box = (await page.locator(`${SWITCHER} ul`).boundingBox())!;
      expect(box.x, 'dropdown escapes the left edge').toBeGreaterThanOrEqual(0);
      expect(
        box.x + box.width,
        'dropdown escapes the right edge',
      ).toBeLessThanOrEqual(viewportWidth);
    });
});
