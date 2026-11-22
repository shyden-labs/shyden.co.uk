import { expect } from '@playwright/test';
import { PUBLISHED_ROUTES } from '../published-paths';
import { LOCALES, getSiteStrings, type Locale } from '../../../src/lib/i18n';
import type { PageCheck } from '../page-checks';

/**
 * The footer of every page links to the privacy page in its own language
 * where one exists, English or Indonesian (#1080 AC3, #1082 AC4), and a page
 * in any other language links to the English one and says beside the link,
 * in that language, that the page is in English only (the global legal-pages
 * rule of 2026-11-08). The language comes
 * from the page's own `<html lang>`, so the 404 and the English-only pages
 * are judged by what they render.
 */
export const PRIVACY_LINK_CHECKS: readonly PageCheck[] = [
  {
    name: 'its footer links to the privacy page, noting English only in another language',
    routes: () => PUBLISHED_ROUTES,
    themes: ['dark'],
    run: async ({ page, route }) => {
      const lang = await page.locator('html').getAttribute('lang');
      expect(LOCALES, `${route} <html lang>`).toContain(lang);
      const t = getSiteStrings(lang as Locale).legal;
      const footer = page.locator('footer');
      const link = footer.getByRole('link', { name: t.privacy, exact: true });
      const own = lang === 'en' || lang === 'id';
      await expect
        .soft(link, route)
        .toHaveAttribute('href', lang === 'id' ? '/id/privacy/' : '/privacy/');
      await expect.soft(link, route).toBeVisible();
      const note = footer.locator('[data-english-only]');
      if (own) await expect.soft(note, route).toHaveCount(0);
      else await expect.soft(note, route).toHaveText(t.englishOnly);
    },
  },
];
