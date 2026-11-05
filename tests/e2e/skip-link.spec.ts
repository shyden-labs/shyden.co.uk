import { test, expect } from './fixtures';
import { recorded } from './evidence';
import { PUBLISHED_ROUTES } from './published-paths';
import { getSiteStrings, localeFromPath } from '../../src/lib/i18n';

test.use(recorded);

/**
 * The skip link, WCAG 2.4.1, on every engine.
 *
 * These tests lived in `head-and-sitemap.spec.ts`, which is content-only and
 * so runs on one engine at 1280px. They read layout (`toBeInViewport`) and ask
 * which engine they are on (`browserName`), so they ran nowhere else, while
 * the comment in the last test promised WebKit. The widened content-only
 * boundary found them (#198); here they run on all five engines, which is what
 * that comment always said.
 */
test.describe('skip link — WCAG 2.4.1', () => {
  // Every published page, its label from that page's own locale. Five
  // hand-written pairs in English and Indonesian let a Thai page offer the
  // English label (SL1).
  for (const path of PUBLISHED_ROUTES)
    test(`${path} offers it, in the page's language`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('.skip-link')).toHaveText(
        getSiteStrings(localeFromPath(path)).skipToContent,
      );
    });

  test('it is the FIRST thing a Tab reaches', async ({ page, browserName }) => {
    test.skip(
      browserName === 'webkit',
      'Safari omits plain links from the Tab sequence unless the visitor opts ' +
        'in, so a Tab walk here would assert a browser preference rather than ' +
        'our markup. The link itself is asserted for WebKit in the test below.',
    );
    // The whole point of the link, on the page where it matters most:
    // without it a keyboard user crosses the wordmark, the hamburger, the
    // theme switch, the language switcher and three nav links before the
    // first form field.
    await page.goto('/classroom-groups');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveClass(/skip-link/);
    // ...and on through the header in the bar's own order (#142): every
    // control it shows, derived from the DOM, with the theme switch
    // immediately before the language switcher.
    const controls = await page.locator('header .bar').evaluate((bar) =>
      [...bar.querySelectorAll('a[href], summary, button')]
        .filter((el) => el.checkVisibility())
        .map((el, i) => {
          el.setAttribute('data-walk', String(i));
          if (el.matches('[data-theme-toggle]')) return 'theme switch';
          if (el.matches('.lang-switch > summary')) return 'language switcher';
          return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
        }),
    );
    const languages = controls.indexOf('language switcher');
    expect(
      controls[languages - 1],
      `the theme switch sits right before the language switcher: ${controls.join(', ')}`,
    ).toBe('theme switch');
    for (const [i, control] of controls.entries()) {
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus'), control).toHaveAttribute(
        'data-walk',
        String(i),
      );
    }
  });

  test('it becomes visible when focused, and lands on the content', async ({
    page,
  }) => {
    // Asserted on EVERY engine, WebKit included: focusability and the jump
    // are our markup, and only the Tab ORDER is the browser's preference.
    await page.goto('/classroom-groups');
    const link = page.locator('.skip-link');

    // Off-screen until focused, which is the only time it is any use — and
    // `display: none` would have made it unfocusable, i.e. not a skip link.
    await expect(link).not.toBeInViewport();
    await link.focus();
    await expect(link).toBeInViewport();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    await expect(page.locator(':focus')).toHaveAttribute('id', 'main');
  });
});
