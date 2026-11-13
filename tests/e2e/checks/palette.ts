import { expect } from '../fixtures';
import { shoot } from '../evidence';
import { searched } from '../../source-files';
import { THEMES } from '../../palette';
import { PUBLISHED_ROUTES } from '../published-paths';
import { PAINTED, offPalette, readPalette } from '../palette-readings';
import { docsPaths } from '../../site-pages';
import type { PageCheck } from '../page-checks';
import { resolvedColour } from '../helpers';

/**
 * Every control's colour comes from the palette, not from the browser. Moved
 * from palette-controls.spec.ts (#1086), where it opened every page once per
 * theme of its own; the walk has already emulated the theme it reads in.
 *
 * Two live defects found this, both invisible in source review and both
 * measured on the RENDERED page:
 *
 *  - `#glory-input` declared a border and no fill, so the UA's dark-mode
 *    default applied — rgb(59 59 59), a light grey box on a --surface card,
 *    while the same control on /classroom-groups sat on --bg.
 *  - `accent-color` was `auto` site-wide, so the selected radio on
 *    /classroom-groups was drawn in the browser's blue: the one brand colour
 *    on the page that was not ours.
 *
 * `color-scheme: dark` is what makes this class hide. It fixes a control's
 * GROUND, so nothing looks obviously broken, while saying nothing about the
 * fill — the control looks plausible and is off-palette.
 *
 * The allowed set is DERIVED from the custom properties the page actually
 * serves, read off :root at runtime, so it cannot fall behind a token that is
 * added, renamed or retuned. Comparison is in computed rgb: the browser
 * resolves both sides, so `#04070d` and `rgb(4 7 13)` are the same value here
 * and no parsing of ours can disagree with the renderer.
 *
 * Checkboxes, radios and file inputs are excluded from the FILL check on
 * purpose: the UA draws them, and their background is legitimately
 * transparent. `accent-color` is what governs those, and it is asserted
 * separately below.
 */
/**
 * The controls the browser draws (checkboxes, radios) take `accent-color`, not
 * a fill: read before any disclosure is opened, as its own test read them.
 */
export const ACCENT_CHECK: PageCheck = {
  name: 'the controls the browser draws use the brand accent',
  routes: () => ['/classroom-groups'],
  themes: THEMES,
  run: async ({ page, theme }) => {
    const boxes = page.locator('input[type="checkbox"], input[type="radio"]');
    await expect.soft(boxes.first()).toBeVisible();
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--accent')
        .trim(),
    );
    const resolved = await resolvedColour(page, accent);
    for (const box of await boxes.all()) {
      await expect.soft(box).toHaveCSS('accent-color', resolved);
    }
    await shoot(
      page,
      `${theme}: all ${await boxes.count()} browser-drawn controls use --accent ${resolved}`,
      boxes.first(),
    );
  },
};

export const PALETTE_CHECKS: readonly PageCheck[] = [
  {
    name: 'every control it paints uses a palette colour',
    routes: () =>
      PUBLISHED_ROUTES.filter((path) => !docsPaths().includes(path)),
    themes: THEMES,
    // It opens every disclosure on the page.
    mutates: true,
    run: async ({ page, route, theme }) => {
      await page.evaluate(() => {
        for (const details of document.querySelectorAll('details'))
          details.open = true;
      });

      const { allowed, examined, readings } = await readPalette(page);

      if (route === '/') {
        expect
          .soft(
            allowed.length,
            'the homepage served no palette, so nothing was measured at all',
          )
          .toBeGreaterThan(0);
        expect
          .soft(
            searched(readings, {
              of: examined,
              what: 'elements on the homepage the selector ran over',
            }),
            'the homepage paints no form controls',
          )
          .toHaveLength(0);
        await shoot(
          page,
          `${route}, ${theme}: no form controls among ${examined} elements`,
        );
        return;
      }
      expect
        .soft(
          readings.length,
          `${route} rendered no controls — the selector or the page changed`,
        )
        .toBeGreaterThan(0);

      const off = offPalette(readings, allowed);
      expect
        .soft(
          searched(off, {
            of: readings,
            what: `controls measured on ${route}`,
          }),
          `${theme}: off-palette control colours on ${route}; the palette resolved to ${allowed.length} values`,
        )
        .toEqual([]);
      await shoot(
        page,
        `${route}, ${theme}: all ${readings.length} controls drawn from the palette's ${allowed.length} values`,
        page.locator(PAINTED).filter({ visible: true }).first(),
      );
    },
  },
];
