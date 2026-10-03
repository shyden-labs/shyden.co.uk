import { test, expect } from './fixtures';
import { shoot } from './evidence';
import { searched } from '../source-files';
import { THEMES } from '../palette';
import { emulateTheme } from '../themes';
import { resolvedColour } from './helpers';
import { PUBLISHED_ROUTES } from './published-paths';

/**
 * Every control's colour comes from the palette, not from the browser.
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
// Every published page in every locale, and the 404. A hand-written four
// missed the 404's four report forms, /id/classroom-groups and every zh, vi
// and th page, so a textarea painted off-palette on the 404 passed (PC1).
const PAGES = PUBLISHED_ROUTES;

/** Controls the page paints itself, as opposed to the ones the UA draws. */
const PAINTED =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), select, textarea';

type Reading = {
  what: string;
  background: string;
  color: string;
};

for (const path of PAGES) {
  // One test per page per theme (#421).
  for (const theme of THEMES)
    test(`${path}, ${theme}: every control it paints uses a palette colour`, async ({
      page,
    }) => {
      await page.goto(path);
      await emulateTheme(page, theme);
      // Every disclosure open, so the shot below finds a control to clip to:
      // on most pages the only ones sit in a closed report form. A control's
      // computed colours are the same open or closed.
      await page.evaluate(() => {
        for (const details of document.querySelectorAll('details'))
          details.open = true;
      });

      const { allowed, readings } = await page.evaluate((selector) => {
        // Resolve a declared value the way the renderer does, so the comparison
        // cannot disagree with what is actually on screen.
        const probe = document.createElement('span');
        probe.style.display = 'none';
        document.body.append(probe);
        const computed = (value: string): string => {
          probe.style.color = '';
          probe.style.color = value;
          return getComputedStyle(probe).color;
        };

        const root = getComputedStyle(document.documentElement);
        const names = Array.from(document.styleSheets)
          .flatMap((sheet) => {
            try {
              return Array.from(sheet.cssRules);
            } catch {
              return []; // a cross-origin sheet; none of ours are
            }
          })
          .flatMap((rule) =>
            rule instanceof CSSStyleRule ? Array.from(rule.style) : [],
          )
          .filter((property) => property.startsWith('--'));

        const palette = new Set<string>(['rgba(0, 0, 0, 0)']);
        for (const name of new Set(names)) {
          const value = root.getPropertyValue(name).trim();
          if (value) palette.add(computed(value));
        }
        probe.remove();

        return {
          allowed: [...palette],
          readings: [...document.querySelectorAll(selector)].map((el) => {
            const style = getComputedStyle(el);
            return {
              what: `${el.tagName.toLowerCase()}#${el.id || '(no id)'}`,
              background: style.backgroundColor,
              color: style.color,
            };
          }),
        };
      }, PAINTED);

      // Liveness. A page with no controls would pass the loop below having
      // measured nothing, and every page but the English homepage carries
      // controls: the tools their own, the rest a beta report form.
      if (path === '/') {
        // #185 AC3, decided explicitly. The right answer here IS none, so
        // `searched` cannot wrap it: there is no population to count. What has
        // to be proved instead is that the measurement HAPPENED -- a 404, a
        // page that never rendered, or a script that threw would all produce
        // this same empty list, and each would read as "the homepage paints no
        // form controls".
        //
        // `allowed` is built by the SAME `page.evaluate` call, from the custom
        // properties `:root` actually serves, so a non-empty palette is proof
        // that the page loaded and the script ran to completion. The
        // SELECTOR's own liveness is carried by the sibling tests for the
        // other paths, which assert `readings.length > 0` against the same
        // constant -- a typo there fails every other page, not none.
        expect(
          allowed.length,
          'the homepage served no palette, so nothing was measured at all',
        ).toBeGreaterThan(0);
        expect(readings, 'the homepage paints no form controls').toHaveLength(
          0,
        );
        return;
      }
      expect(
        readings.length,
        `${path} rendered no controls — the selector or the page changed`,
      ).toBeGreaterThan(0);

      const offPalette = (readings as Reading[])
        .flatMap((r) => [
          { ...r, role: 'background', value: r.background },
          { ...r, role: 'color', value: r.color },
        ])
        .filter((r) => !allowed.includes(r.value))
        .map((r) => `${r.what} ${r.role}=${r.value}`);

      expect(
        searched(offPalette, {
          of: readings,
          what: `controls measured on ${path}`,
        }),
        `${theme}: off-palette control colours on ${path}; the palette resolved to ${allowed.length} values`,
      ).toEqual([]);
      // The defect this documents was a UA default passing for styled: an input
      // with a border and no background drew rgb(59 59 59) on a dark card.
      // Clipped to the control, not the page. `shoot`'s own note says an
      // operator scanning for one control should not hunt for it in a shot of
      // the whole page -- and on Aurora's gradients a full viewport PNG is
      // ~700KB, because a gradient does not compress the way a flat ground does.
      await shoot(
        page,
        `${path}, ${theme}: all ${readings.length} controls drawn from the palette's ${allowed.length} values`,
        page.locator(PAINTED).filter({ visible: true }).first(),
      );
    });
}

// One test per theme (#421).
for (const theme of THEMES)
  test(`${theme}: the controls the browser draws use the brand accent`, async ({
    page,
  }) => {
    await page.goto('/classroom-groups');
    const boxes = page.locator('input[type="checkbox"], input[type="radio"]');
    // Liveness: an empty list and a correct one both report zero offenders.
    // Written as a locator assertion rather than `expect(await boxes.count())`
    // because that is the form tests/unit/event-collectors.test.ts recognises,
    // and a proof a guard cannot see is not a proof.
    await expect(boxes.first()).toBeVisible();
    await emulateTheme(page, theme);

    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--accent')
        .trim(),
    );
    const resolved = await resolvedColour(page, accent);

    // Inline, not hoisted: `event-collectors.test.ts` matches this exact shape
    // when scanning for locator loops that were never proved non-empty, and a
    // hoisted list drops out of that scan without anything going red.
    for (const box of await boxes.all()) {
      await expect(box).toHaveCSS('accent-color', resolved);
    }
    // `accent-color: auto` drew the selected radio in the browser's blue. The
    // clipped shot is of the control itself, so the brand mint is visible.
    await shoot(
      page,
      `${theme}: all ${await boxes.count()} browser-drawn controls use --accent ${resolved}`,
      boxes.first(),
    );
  });
