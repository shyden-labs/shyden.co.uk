import { expect } from '../fixtures';
import { shoot } from '../evidence';
import {
  LOCALES,
  DEFAULT_LOCALE,
  getSiteStrings,
  localisePath,
} from '../../../src/lib/i18n/index';
import { NOT_FOUND_PATH } from '../published-paths';
import { DEFAULT_THEME, type PageCheck } from '../page-checks';

/**
 * 'the 404 answers everyone', moved from not-found.spec.ts (#1086): four tests
 * that each opened the 404 again to read it. They read '/no-such-page-xyz';
 * the 404 answers every unknown path with the same page, so the walk's own
 * unknown path is read. The 320px test stays in not-found.spec.ts: a width is
 * its own input.
 */

const notFound = (name: string, run: PageCheck['run']): PageCheck => ({
  name,
  routes: () => [NOT_FOUND_PATH],
  themes: [DEFAULT_THEME],
  run,
});

export const NOT_FOUND_CHECKS: readonly PageCheck[] = [
  notFound('the 404 shows every language the site serves', async ({ page }) => {
    for (const locale of LOCALES) {
      const t = getSiteStrings(locale).notFound;
      const heading =
        locale === DEFAULT_LOCALE
          ? page.getByRole('heading', { level: 1, name: t.heading })
          : page.getByRole('heading', { level: 2, name: t.heading });
      await expect
        .soft(heading, `${locale}: no heading on the 404`)
        .toBeVisible();
      await shoot(page, `${locale} is answered on the 404`, heading);
    }
  }),
  notFound(
    'the 404 marks each language so a screen reader changes voice',
    async ({ page }) => {
      // Not asserted as `lang="xx"` anywhere on the page: the language switcher
      // renders `<a hreflang="zh" lang="zh">` for every alternative, so that
      // check passes on a page with no Chinese content at all. Anchored to the
      // heading element instead.
      for (const locale of LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
        const t = getSiteStrings(locale).notFound;
        const heading = page.getByRole('heading', {
          level: 2,
          name: t.heading,
        });
        await expect.soft(heading).toHaveAttribute('lang', locale);
        await shoot(
          page,
          `${locale} heading carries lang="${locale}"`,
          heading,
        );
      }
    },
  ),
  notFound(
    'the 404 sends every visitor home in their own language',
    async ({ page }) => {
      for (const locale of LOCALES) {
        const t = getSiteStrings(locale).notFound;
        const link = page.getByRole('link', { name: t.backHome, exact: true });
        await expect
          .soft(link)
          .toHaveAttribute('href', localisePath('/', locale));
        await shoot(page, `${locale} link goes to its own homepage`, link);
      }
    },
  ),
  notFound(
    'the 404 ends each back-home sentence in its own language',
    async ({ page }) => {
      // #390 F65. Each block was assembled as body, a space, the link and an
      // ASCII full stop, whatever the language: Chinese read 该页面不存在。 返回首页.
      // (a space after the full-width stop and a Latin one at the end), and Thai,
      // which ends no sentence with a full stop, carried one. Literal sentences,
      // so the expectation cannot share the page's mistake.
      const sentences: Record<string, string> = {
        en: "That page doesn't exist. Back to the homepage.",
        id: 'Halaman itu tidak ada. Kembali ke beranda.',
        zh: '该页面不存在。返回首页。',
        vi: 'Trang đó không tồn tại. Quay lại trang chủ.',
        th: 'หน้านั้นไม่มีอยู่ กลับสู่หน้าหลัก',
      };
      expect.soft(Object.keys(sentences).sort()).toEqual([...LOCALES].sort());
      for (const locale of LOCALES) {
        const t = getSiteStrings(locale).notFound;
        const link = page.getByRole('link', { name: t.backHome, exact: true });
        const sentence = link.locator('xpath=ancestor::p[1]');
        await expect.soft(sentence, locale).toHaveCount(1);
        await expect.soft(sentence, locale).toBeVisible();
        expect.soft(await sentence.innerText(), locale).toBe(sentences[locale]);
        await shoot(page, `${locale} back-home sentence`, sentence);
      }
    },
  ),
];
