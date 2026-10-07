import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { floorBreach } from '../floors';
import { searched } from '../source-files';
import { IOS_ZOOM_FLOOR_PX, measureTypedFields } from '../typed-fields';
import { LOCALES, localisePath } from '../../src/lib/i18n';
import { PUBLISHED_ROUTES } from './published-paths';

/**
 * iOS Safari zooms the whole page when a visitor focuses a text field whose
 * computed font-size is under 16px, and leaves it zoomed after the field loses
 * focus (#352).
 *
 * The footer's report form (#97) shipped its fields at 14.4px -- `font:
 * inherit` inside a 0.9rem footer -- in every beta locale, on every page, with
 * CI green. The only assertion of this floor was Journey 11 in
 * `tests/device/ios/journeys.journey.ts`, which runs on a real phone and never
 * in CI; it found the defect on 2026-09-26. This is the CI half of the same
 * rule. Computed font-size is a CSS value, identical in every engine, so an
 * emulated browser can hold it even though only a phone can show the zoom.
 *
 * DERIVED, NEVER LISTED: every page the build emits in every locale, and every
 * control on it that takes typed text. The report form sits inside a CLOSED
 * `<details>`, so a filter on visibility would search nothing there and pass;
 * computed style is defined for a closed subtree, and the visitor who opens it
 * is the one who gets zoomed. Excluded: `type=hidden`, the controls no one
 * types into, and anything under `aria-hidden` (the honeypot no person
 * reaches). Which fields count is `tests/typed-fields.ts`, the one definition
 * Journey 11 sends to the phone as well.
 */
type Control = { page: string; field: string; fontSize: number };

const typedControls = async (page: Page, path: string): Promise<Control[]> => {
  await page.goto(path);
  const found = await page.evaluate(measureTypedFields);
  return found.map((control) => ({ page: path, ...control }));
};

test.describe('no field makes iOS zoom the page (#352)', () => {
  // One test per page (#390 F152): each locale's pages were visited in one
  // test through typedControls, whose goto the one-test-per-case guard could
  // not see while it matched names alone.
  for (const path of PUBLISHED_ROUTES)
    test(`${path}: every typed field computes to at least ${IOS_ZOOM_FLOOR_PX}px`, async ({
      page,
    }) => {
      const controls = await typedControls(page, path);
      if (path === '/') {
        // The one page with no typed field: no tool, and no report form,
        // since English is not a beta language. That empty answer is only
        // worth something if the page rendered.
        await expect(page.locator('main h1')).toBeVisible();
        // The elements the measurement ran over (#610): a page that lost its
        // content would answer "no typed field" just the same.
        const examined = await page.evaluate(
          () => document.body.querySelectorAll('*').length,
        );
        expect(
          searched(controls, {
            of: examined,
            what: 'elements on the English homepage',
          }),
          'the English homepage has no typed field',
        ).toEqual([]);
        expect(
          floorBreach('zoom-on-focus/homepage-elements', examined),
        ).toBeUndefined();
        return;
      }
      expect(
        searched(
          controls.filter((c) => !(c.fontSize >= IOS_ZOOM_FLOOR_PX)),
          { of: controls, what: `typed fields on ${path}` },
        ),
        'a field under 16px makes iOS Safari zoom the page when it is focused',
      ).toEqual([]);
    });

  test('the report form is among the fields searched', async ({ page }) => {
    // Liveness for the population above: the form that shipped at 14.4px has
    // to be IN it, or a selector that stopped reaching a closed <details>
    // would pass every locale over the fields that remain.
    const beta = LOCALES.find((l) => l !== LOCALES[0]);
    expect(beta, 'a second locale to carry the report form').toBeDefined();
    const fields = (await typedControls(page, localisePath('/', beta!))).map(
      (c) => c.field,
    );
    expect(fields).toEqual(
      expect.arrayContaining([
        '#report-quote',
        '#report-suggestion',
        '#report-note',
      ]),
    );
  });
});
