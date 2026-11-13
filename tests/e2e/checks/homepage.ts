import { expect } from '../fixtures';
import { shoot } from '../evidence';
import { searched } from '../../source-files';
import { expectNoHorizontalScroll } from '../../viewport';
import { LOCALES, localisePath } from '../../../src/lib/i18n';
import { DEFAULT_THEME, type PageCheck } from '../page-checks';

/**
 * The six widths the band is held to (#599 AC2): the four #423 read, plus 390
 * (the common phone) and 1024 (the tablet-landscape edge).
 */
export const BAND_WIDTHS = [320, 375, 390, 768, 1024, 1280];

/**
 * The homepage's reads at set widths, moved from homepage.spec.ts (#1086),
 * where each was one test per locale and width: on a real phone, which keeps
 * its own width (#1046), the same load repeated at every width.
 */
export const HOMEPAGE_WIDTH_CHECKS: readonly PageCheck[] = [
  {
    // Every locale at every width (#423): theme-gallery reads every locale at
    // 320 and 1280px only. English is read at each width inside the band's
    // own journey in homepage.spec.ts, so it is not repeated here.
    name: 'no horizontal scroll',
    routes: () =>
      LOCALES.filter((l) => l !== 'en').map((l) => localisePath('/', l)),
    themes: [DEFAULT_THEME],
    widths: BAND_WIDTHS,
    run: async ({ page, route, took }) => {
      const overflow = await expectNoHorizontalScroll(page);
      // This is the guard the marquee tripped: a rotated-and-scaled element
      // is not clipped by an ancestor's `overflow`, so it pushed 10px of
      // sideways scroll at every width. 1217 unit tests could not see it.
      await shoot(
        page,
        `${route} ${took.width}px: horizontal overflow is ${overflow}px`,
      );
    },
  },
  {
    // The control shows no words, so what a long label once risked (Thai and
    // Vietnamese running past the band) is now the screen-reader text's to
    // risk: it is absolutely positioned, and an absolute box with nothing to
    // contain it can land anywhere, which at 320px means sideways scroll.
    // It read at 320 x 800; the walk reads at 320 x 900, and nothing here
    // reads the height.
    name: 'the pause control and its hidden name stay inside the band, with no sideways scroll',
    routes: () => LOCALES.map((l) => localisePath('/', l)),
    themes: [DEFAULT_THEME],
    widths: [320],
    run: async ({ page }) => {
      const target = page.locator('.band-pause');
      await expect.soft(target).toHaveCount(1);
      const inside = await target.evaluate((label) => {
        const band = label.closest('.band')!.getBoundingClientRect();
        return [label, ...label.querySelectorAll('*')].map((el) => {
          const r = el.getBoundingClientRect();
          return {
            what: el.tagName.toLowerCase() + '.' + el.getAttribute('class'),
            ok:
              r.left >= band.left - 0.5 &&
              r.right <= band.right + 0.5 &&
              r.left >= 0 &&
              r.right <= window.innerWidth,
          };
        });
      });
      expect
        .soft(
          searched(
            inside.filter((box) => !box.ok).map((box) => box.what),
            { of: inside, what: 'boxes in the pause control' },
          ),
          'boxes in the control that leave the band or the viewport',
        )
        .toEqual([]);
      expect
        .soft(
          inside.map((box) => box.what),
          'the boxes the control is built from, each measured',
        )
        .toEqual(
          expect.arrayContaining([
            'label.band-pause',
            'input.null',
            'span.band-pause-disc',
            'svg.band-pause-icon',
            // its whole class attribute: the name wears the global recipe (#767)
            'span.band-pause-name visually-hidden',
          ]),
        );
      await expectNoHorizontalScroll(page);
    },
  },
];
