import { tabTo } from '../tab-to';
import { tapOn } from '../real-touch';
import { test, expect } from './fixtures';
import { recorded, shoot } from './evidence';
import { PUBLISHED_ROUTES } from './published-paths';
import { refuseFullscreen, withGroups } from './helpers';
import { THEMES } from '../palette';
import { expectTheme } from '../themes';
import { expectNoHorizontalScroll } from '../viewport';
import { atViewport } from '../viewport-at';

/**
 * Every built page in both themes (#142 §6.7), in every locale, at the
 * narrowest width the site supports and a laptop's. The assertion is the one
 * a theme can break on any page: it renders its theme, and nothing scrolls
 * sideways. The captures are what the operator reviews on the evidence page.
 */
const WIDTHS = [320, 1280];

// File level: `recorded` sets `video`, which Playwright refuses inside a
// describe ("Cannot use({ video }) in a describe group, because it forces a
// new worker"), and every test here acts, so all of them record.
test.use(recorded);

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    // One test per page, width and theme (#421): every page in a locale was
    // one test, so the 404 rode along with the English pages' budget.
    for (const width of WIDTHS)
      for (const path of PUBLISHED_ROUTES)
        test(`${path} at ${width}px: renders the theme, with no sideways scroll`, async ({
          page,
        }) => {
          const took = await atViewport(page, { width, height: 900 });
          await page.goto(path);
          await expectTheme(page, theme);
          await expectNoHorizontalScroll(page);
          await shoot(page, `${path}, ${theme}, ${took.width}px`);
        });

    test.describe('interactive states', () => {
      test('the header: the phone menu, the language list and the focused switch', async ({
        page,
      }) => {
        await atViewport(page, { width: 390, height: 844 });
        await page.goto('/');
        await expectTheme(page, theme);
        const menu = page.locator('header details.menu > summary');
        await tapOn(menu);
        await expect(page.locator('header nav a').first()).toBeVisible();
        await shoot(page, `${theme}: the phone menu, open`);
        await tapOn(menu);

        const languages = page.locator('header details.lang-switch');
        await tapOn(languages.locator('summary'));
        await expect(languages.locator('a.entry').first()).toBeVisible();
        await shoot(
          page,
          `${theme}: the language list, open beside the compact label`,
          languages,
        );
        await tapOn(languages.locator('summary'));

        const toggle = page.locator('header [data-theme-toggle]');
        // The switch sits just before the language list (#142 §5), so the
        // walk to it from the list goes back.
        await tabTo(toggle, 'backwards');
        await expect(toggle).toBeFocused();
        await shoot(
          page,
          `${theme}: the theme switch, focused`,
          page.locator('header'),
        );
      });

      test(
        '/classroom-groups: results, the roster, the docked bar, print and the full-screen board',
        { tag: '@emulated-viewport' },
        async ({ page }) => {
          await page.setViewportSize({ width: 1280, height: 900 });
          // A refused requestFullscreen lands in the overlay on every engine,
          // so the board renders the same way wherever this runs.
          await refuseFullscreen(page);
          await withGroups(page);
          await expectTheme(page, theme);
          await expect(
            page.locator('#cg-results .group').first(),
          ).toBeVisible();
          await shoot(page, `${theme}: /classroom-groups with results`);

          await expect(
            page.locator('#cg-roster tbody tr').first(),
          ).toBeVisible();
          await shoot(page, `${theme}: the roster`, page.locator('#cg-roster'));

          await page.evaluate(() => scrollTo(0, 0));
          const bar = page.locator('p.actions');
          await expect(bar).toHaveCSS('position', 'sticky');
          // Docking is proved before the picture, as visual.spec proves it:
          // sticky holds whether or not the bar has reached the fold.
          const { bottom, fold } = await bar.evaluate((el) => ({
            bottom: el.getBoundingClientRect().bottom,
            fold: window.innerHeight,
          }));
          expect(bottom, 'the action bar rests on the fold').toBeCloseTo(
            fold,
            0,
          );
          await shoot(page, `${theme}: the action bar, docked`);

          await page.emulateMedia({ media: 'print' });
          await expect(
            page.locator('#cg-results .group').first(),
          ).toBeVisible();
          await shoot(page, `${theme}: the print preview`);
          await page.emulateMedia({ media: 'screen' });

          await tapOn(page.getByRole('button', { name: 'Full screen' }));
          await expect(page.locator('#cg-board')).toBeVisible();
          await shoot(page, `${theme}: the full-screen board`);
        },
      );
    });
  });
}
