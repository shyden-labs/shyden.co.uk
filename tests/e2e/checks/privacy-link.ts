import { expect } from '@playwright/test';
import { PUBLISHED_ROUTES } from '../published-paths';
import { LOCALES, getSiteStrings, type Locale } from '../../../src/lib/i18n';
import type { PageCheck } from '../page-checks';

/**
 * The footer of every page links to the English privacy page (#1080 AC3), and
 * a page in any other language says beside the link, in that language, that
 * the page is in English only (the global legal-pages rule of 2026-11-08;
 * Indonesian too until #1082's copy, Shyden 2026-11-22). The language comes
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
      await expect.soft(link, route).toHaveAttribute('href', '/privacy/');
      await expect.soft(link, route).toBeVisible();
      const note = footer.locator('[data-english-only]');
      if (lang === 'en') await expect.soft(note, route).toHaveCount(0);
      else await expect.soft(note, route).toHaveText(t.englishOnly);
    },
  },
];
