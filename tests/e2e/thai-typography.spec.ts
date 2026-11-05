import { test, expect } from '@playwright/test';
import { shoot } from './evidence';
import { searched } from '../source-files';
import { THEMES } from '../palette';
import { emulateTheme } from '../themes';
import { sitePaths } from '../site-pages';
import { LOCALES, localisePath } from '../../src/lib/i18n';
import { NOT_FOUND_PATH } from './published-paths';

/**
 * Thai marks must not run into the line above. #22.
 *
 * Thai stacks up to two marks ABOVE the base glyph — a vowel, then a tone —
 * and one below it, so its ink box is far deeper than the Latin
 * cap-height-plus-descender box `tokens.css` tuned `line-height: 1.15` for.
 * On the first build with `th` in LOCALES the /th/ homepage h1 drew 45.9px of
 * ink into a 36.8px line at 320px wide: 9.1px over, across six wrapped lines,
 * with tone marks sitting in the descenders of the line above. Four h3s ran
 * 1.9–4.8px over and one span 1px over.
 *
 * MEASURED, NOT EYEBALLED, and that distinction is the point of this file. A
 * ratio rule ("line-height below 1.35 is risky") is a guess about a font; ink
 * metrics are what the browser will actually paint. Canvas
 * `measureText().actualBoundingBoxAscent/Descent` reports the real inked
 * extent of this exact string in this exact font, so the assertion is about
 * the glyphs on the page rather than about a number someone chose.
 *
 * Nothing here was ever clipped by an `overflow: hidden` — the lines simply
 * collided — which is why the check compares ink against the LINE BOX rather
 * than looking for scroll overflow. A test that asked "does anything scroll"
 * would have passed throughout.
 */

/**
 * Every Thai page, and the 404, whose Thai block (a heading, a sentence and a
 * report form) went unmeasured while the routes came from `sitePaths` alone
 * (TT1). The 404 is served as one, so its expected status travels with it.
 */
const THAI_ROUTES: readonly { route: string; status: number }[] = [
  ...sitePaths().map((p) => ({ route: localisePath(p, 'th'), status: 200 })),
  { route: NOT_FOUND_PATH, status: 404 },
];

/** Both phone sizes #32 fixed, plus a tablet and a laptop. A heading wraps to
 * more lines the narrower it gets, and collisions only happen between lines. */
const WIDTHS = [320, 375, 768, 1280];

test.describe('Thai typography', () => {
  test('th is one of the locales this suite is allowed to assume', () => {
    // Derived, not assumed: if Thai were dropped from LOCALES these routes
    // would 404 and every measurement below would pass on an empty page.
    expect(LOCALES).toContain('th');
  });

  // One test per width, route and theme (#421).
  for (const width of WIDTHS)
    for (const { route, status } of THAI_ROUTES)
      for (const theme of THEMES)
        test(
          `no Thai glyph draws beyond its line box -- ${route} at ${width}px, ${theme}`,
          { tag: '@emulated-viewport' },
          async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            const response = await page.goto(route);

            // Assert the SEAM: that this route served at all. The site's own
            // 404 page carries Thai text (3 characters of it), so a missing
            // route renders Thai, measures clean, and passes — which is how a
            // page with no `/th` twin slipped through before #68.
            expect(
              response?.status(),
              `${route} at ${width}px: route did not serve`,
            ).toBe(status);
            await emulateTheme(page, theme);
            const { offenders, examined } = await page.evaluate(() => {
              const THAI = /[฀-๿]/;
              const context = document
                .createElement('canvas')
                .getContext('2d')!;
              const found: string[] = [];
              let examined = 0;

              // Every text node, in its own parent's font against that
              // parent's line box. A tag list read leaves only, so the Thai
              // words of a paragraph that also held a link or an arrow were
              // never measured (TT2), and no div or legend ever was.
              const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
              );
              for (
                let node = walker.nextNode();
                node;
                node = walker.nextNode()
              ) {
                const el = node.parentElement;
                const text = (node.textContent ?? '').trim();
                if (!el || !THAI.test(text) || el.closest('script, style'))
                  continue;
                examined += 1;

                const style = getComputedStyle(el);
                const fontSize = parseFloat(style.fontSize);
                const lineHeight =
                  style.lineHeight === 'normal'
                    ? fontSize * 1.2
                    : parseFloat(style.lineHeight);

                context.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
                const metrics = context.measureText(text);
                const ink =
                  metrics.actualBoundingBoxAscent +
                  metrics.actualBoundingBoxDescent;

                if (ink > lineHeight)
                  found.push(
                    `${el.tagName.toLowerCase()} ink ${ink.toFixed(1)}px > line ${lineHeight.toFixed(1)}px — "${text.slice(0, 24)}"`,
                  );
              }
              return { offenders: [...new Set(found)], examined };
            });

            // Anti-vacuity, and this file already knew to worry about it: its
            // own opening test says these routes would 404 and "every
            // measurement below would pass on an empty page". That covered
            // Thai leaving LOCALES; it did not cover a route that 404s for any
            // other reason, or a page not yet translated. Deriving the route
            // list (#68) makes the second case reachable, so measure it.
            expect(
              examined,
              `${route} at ${width}px, ${theme}: no Thai text was measured — the route is missing or untranslated`,
            ).toBeGreaterThan(0);

            expect(
              searched(offenders, {
                of: examined,
                what: `Thai headings measured at ${route} ${width}px, ${theme}`,
              }),
              `${route} at ${width}px, ${theme}: Thai marks would collide with the line above`,
            ).toEqual([]);
            // Thai stacks up to two marks above the base glyph and one below, so
            // the collision is visible in the image itself, not only the numbers.
            // Clipped to the heading: that is where #22's measured line-height
            // applies and where the collision appeared, and at full-page size a
            // reader cannot judge a mark against the line above anyway.
            await shoot(
              page,
              `${route} at ${width}px, ${theme}: ${examined} Thai runs clear of the line above`,
              page.locator('h1').first(),
            );
          },
        );
});
