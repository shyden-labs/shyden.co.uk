import { test, expect } from './fixtures';
import { shoot } from './evidence';
import { expectNoHorizontalScroll } from '../viewport';
import {
  LOCALES,
  DEFAULT_LOCALE,
  getSiteStrings,
  localisePath,
} from '../../src/lib/i18n/index';

/**
 * The 404, as a visitor who mistyped a URL actually meets it.
 *
 * Cloudflare Pages serves this one file for ANY unknown path, so it is the only
 * place a lost visitor can be answered — and until #104 it answered in two of
 * the five languages this site serves. `copy-reaches-a-page.spec.ts` holds the
 * bytes; this holds what rendering and geometry can show and bytes cannot: that
 * five stacked languages are visible, and that they do not push the page
 * sideways on the narrowest phone.
 */

const NOT_FOUND = '/no-such-page-' + 'xyz';

test.describe('the 404 answers everyone', () => {
  test('shows every language the site serves', async ({ page }) => {
    await page.goto(NOT_FOUND);

    for (const locale of LOCALES) {
      const t = getSiteStrings(locale).notFound;
      const heading =
        locale === DEFAULT_LOCALE
          ? page.getByRole('heading', { level: 1, name: t.heading })
          : page.getByRole('heading', { level: 2, name: t.heading });
      await expect(heading, `${locale}: no heading on the 404`).toBeVisible();
      await shoot(page, `${locale} is answered on the 404`, heading);
    }
  });

  test('marks each language so a screen reader changes voice', async ({
    page,
  }) => {
    // Not asserted as `lang="xx"` anywhere on the page: the language switcher
    // renders `<a hreflang="zh" lang="zh">` for every alternative, so that
    // check passes on a page with no Chinese content at all. Anchored to the
    // heading element instead.
    await page.goto(NOT_FOUND);
    for (const locale of LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
      const t = getSiteStrings(locale).notFound;
      const heading = page.getByRole('heading', { level: 2, name: t.heading });
      await expect(heading).toHaveAttribute('lang', locale);
      await shoot(page, `${locale} heading carries lang="${locale}"`, heading);
    }
  });

  test('sends every visitor home in their own language', async ({ page }) => {
    await page.goto(NOT_FOUND);
    for (const locale of LOCALES) {
      const t = getSiteStrings(locale).notFound;
      const link = page.getByRole('link', { name: t.backHome, exact: true });
      await expect(link).toHaveAttribute('href', localisePath('/', locale));
      await shoot(page, `${locale} link goes to its own homepage`, link);
    }
  });

  // #390 F65. Each block was assembled as body, a space, the link and an
  // ASCII full stop, whatever the language: Chinese read 该页面不存在。 返回首页.
  // (a space after the full-width stop and a Latin one at the end), and Thai,
  // which ends no sentence with a full stop, carried one. Literal sentences,
  // so the expectation cannot share the page's mistake.
  test('ends each back-home sentence in its own language', async ({ page }) => {
    const sentences: Record<string, string> = {
      en: "That page doesn't exist. Back to the homepage.",
      id: 'Halaman itu tidak ada. Kembali ke beranda.',
      zh: '该页面不存在。返回首页。',
      vi: 'Trang đó không tồn tại. Quay lại trang chủ.',
      th: 'หน้านั้นไม่มีอยู่ กลับสู่หน้าหลัก',
    };
    expect(Object.keys(sentences).sort()).toEqual([...LOCALES].sort());
    await page.goto(NOT_FOUND);
    for (const locale of LOCALES) {
      const t = getSiteStrings(locale).notFound;
      const link = page.getByRole('link', { name: t.backHome, exact: true });
      const sentence = link.locator('xpath=ancestor::p[1]');
      await expect(sentence, locale).toHaveCount(1);
      await expect(sentence, locale).toBeVisible();
      expect(await sentence.innerText(), locale).toBe(sentences[locale]);
      await shoot(page, `${locale} back-home sentence`, sentence);
    }
  });

  test(
    'five stacked languages add no horizontal scroll at 320px',
    { tag: '@emulated-viewport' },
    async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 720 });
      await page.goto(NOT_FOUND);
      // Not vacuous: a 404 whose content were hidden at 320px would satisfy
      // "no overflow" trivially, and hiding it is also the wrong fix.
      await expect(
        page.getByRole('heading', {
          level: 2,
          name: getSiteStrings(LOCALES[LOCALES.length - 1]).notFound.heading,
        }),
      ).toBeVisible();
      const overflow = await expectNoHorizontalScroll(page, 'the 404 at 320px');
      await shoot(page, `320px: last language visible, overflow ${overflow}px`);
    },
  );
});
