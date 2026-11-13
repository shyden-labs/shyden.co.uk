import { test, expect } from './fixtures';
import { THEMES } from '../palette';
import { emulateTheme } from '../themes';
import { PUBLISHED_ROUTES } from './published-paths';
import { atViewport, measuredViewport, onRealPhone } from '../viewport-at';
import { WIDTH_CHECK_HEIGHT, type PageCheck, type Visit } from './page-checks';
import { RIBBON_CHECK } from './checks/ribbon';
import { REPORT_FORM_CHECKS } from './checks/report-form';
import { THAI_CHECK } from './checks/thai';
import { CHROME_CHECKS } from './checks/chrome';
import { THEME_GALLERY_CHECKS } from './checks/theme-gallery';
import { YEETALK_WIDTH_CHECKS } from './checks/yeetalk';
import { HOMEPAGE_WIDTH_CHECKS } from './checks/homepage';
import { LANGUAGE_SWITCHER_CHECKS } from './checks/language-switcher';
import {
  SWITCHER_OPEN_CHECKS,
  SWITCHER_READ_CHECKS,
} from './checks/switcher-open';
import { HEAD_CHECKS } from './checks/head';
import { NOT_FOUND_CHECKS } from './checks/not-found';
import { SERVED_PAGE_CHECKS } from './checks/served-page';
import { REPORT_PRESENCE_CHECKS } from './checks/report-presence';
import {
  RENDERED_TEXT_CHECKS,
  RENDERED_TEXT_SELF_CHECKS,
} from './checks/rendered-text';
import { ACCENT_CHECK, PALETTE_CHECKS } from './checks/palette';
import { RECORDER_CHECKS } from './checks/recorders';

/**
 * One walk per page, per theme, making every read-only check (#1086).
 *
 * Shyden, 2026-11-09: "i am watching it doing the same journey over and over
 * again". The page-reading tests of eleven files each opened the same page
 * again, so the phone loaded `/id/` once per file. His ruling of 2026-11-13:
 * one test per page, per language and per theme opens the page once and makes
 * every read-only check, as soft assertions, so one failure hides none of the
 * rest. Each check is a `test.step` named as the test it replaced.
 *
 * In ORDER: the checks that only read come first; then those that change the
 * page (`mutates`), placed so each reads the page its old test read. The
 * ribbon scan hides every glyph and loads the page again, so it goes first.
 * The report form, then the language switcher, are each opened by one real
 * tap; between them the touching-words check opens the flow's disclosures by
 * script (the switcher is in the header, which it leaves shut). The palette
 * opens every disclosure. The text scans (`renderedText`) open every
 * disclosure and remove every `hidden` attribute, so they come after every
 * check that reads the page as served: placed earlier, they changed what the
 * touching-words and palette checks read (#1086, found from a trace on PR
 * #1147). The recorders plant errors and silence the console; the last two
 * replace the homepage's body.
 *
 * WIDTHS (Shyden, 2026-11-13, "One test, widths inside"). A check read at set
 * widths was one test per width, and a real phone, which cannot take an
 * emulated width (#1046), ran each as the identical journey at its own width.
 * On an emulated target the walk reads its other checks at the target's own
 * size, then loads the page again at each width a check asks for. On a real
 * phone everything is read on its one load, at the width it has.
 */
const [SEAM_CHECK, ...BODY_CHECKS] = RENDERED_TEXT_SELF_CHECKS;
const [SPACE_CHECK, PLACEHOLDER_CHECK, TOUCHING_CHECK] = RENDERED_TEXT_CHECKS;

const WALK: readonly PageCheck[] = [
  ...HEAD_CHECKS,
  ...NOT_FOUND_CHECKS,
  ...SERVED_PAGE_CHECKS,
  ...REPORT_PRESENCE_CHECKS,
  ...CHROME_CHECKS,
  ...HOMEPAGE_WIDTH_CHECKS,
  ...YEETALK_WIDTH_CHECKS,
  ...THEME_GALLERY_CHECKS,
  ...LANGUAGE_SWITCHER_CHECKS,
  ...SWITCHER_READ_CHECKS,
  ACCENT_CHECK,
  THAI_CHECK,
  RIBBON_CHECK,
  ...REPORT_FORM_CHECKS,
  TOUCHING_CHECK,
  ...SWITCHER_OPEN_CHECKS,
  ...PALETTE_CHECKS,
  SPACE_CHECK,
  PLACEHOLDER_CHECK,
  SEAM_CHECK,
  ...RECORDER_CHECKS,
  ...BODY_CHECKS,
];

const applies = (check: PageCheck, route: string, theme: string) =>
  check.themes.some((t) => t === theme) && check.routes().includes(route);

test.describe('one walk per page (#1086)', () => {
  test('every check reads only pages the walk opens', () => {
    const strays = WALK.flatMap((check) =>
      check
        .routes()
        .filter((route) => !PUBLISHED_ROUTES.includes(route))
        .map((route) => `${check.name}: ${route}`),
    );
    expect(strays).toEqual([]);
    // Every check is walked somewhere: an empty population would drop its
    // assertions without a word.
    expect(
      WALK.filter((check) => check.routes().length === 0).map((c) => c.name),
    ).toEqual([]);
  });

  test('no check that only reads comes after one that changes the page', () => {
    const firstMutating = WALK.findIndex((check) => check.mutates);
    expect(firstMutating).toBeGreaterThan(0);
    expect(
      WALK.slice(firstMutating)
        .filter((check) => !check.mutates)
        .map((check) => check.name),
    ).toEqual([]);
  });

  for (const route of PUBLISHED_ROUTES)
    for (const theme of THEMES) {
      const checks = WALK.filter((check) => applies(check, route, theme));
      if (checks.length === 0) continue;
      test(`${route}, ${theme}: one walk, ${checks.length} checks`, async ({
        page,
      }) => {
        const check = async (one: PageCheck, visit: Visit, label: string) =>
          test.step(label, async () => {
            // A check that throws (a reader refusing an empty population) is
            // reported like a soft failure, so it hides none of the checks
            // after it.
            try {
              await one.run(visit);
            } catch (error) {
              expect.soft(error, `${one.name} threw`).toBeUndefined();
            }
          });
        const load = async () => {
          const response = await page.goto(route);
          await emulateTheme(page, theme);
          return response;
        };

        if (onRealPhone(page)) {
          // A real phone: one load, every check, at its own width.
          const response = await load();
          const took = await measuredViewport(page);
          for (const one of checks)
            await check(one, { page, route, theme, response, took }, one.name);
          return;
        }

        const atOwnSize = checks.filter((one) => !one.widths);
        if (atOwnSize.length > 0) {
          const response = await load();
          const took = await measuredViewport(page);
          for (const one of atOwnSize)
            await check(one, { page, route, theme, response, took }, one.name);
        }
        const widths = [
          ...new Set(checks.flatMap((one) => one.widths ?? [])),
        ].sort((a, b) => a - b);
        for (const width of widths) {
          const took = await atViewport(page, {
            width,
            height: WIDTH_CHECK_HEIGHT,
          });
          const response = await load();
          for (const one of checks.filter((c) => c.widths?.includes(width)))
            await check(
              one,
              { page, route, theme, response, took },
              `at ${width}px: ${one.name}`,
            );
        }
      });
    }
});
