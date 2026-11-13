import type { Page } from '@playwright/test';
import { expect } from '../fixtures';
import { tapOn } from '../../real-touch';
import { atLeast44, expectNoHorizontalScroll } from '../../viewport';
import { formTextsUnderAA, resolvedColour } from '../helpers';
import { searched } from '../../source-files';
import { PREFIXED_LOCALES, getSiteStrings } from '../../../src/lib/i18n';
import type { Locale } from '../../../src/lib/i18n';
import { FOOTER_PAGE_IDS, pagePath } from '../../../src/lib/report';
import { DEFAULT_THEME, type PageCheck } from '../page-checks';

/**
 * The footer's report form, opened by a real tap, moved from
 * report-form.spec.ts (#1086). Two tests loaded each Glory Points page and
 * tapped the form open: one measured its targets and contrast, one (at 320px)
 * its fit. On a real phone, which keeps its own width (#1046), that is one
 * journey twice. The form is opened once per load; a check that finds it open
 * reads it as it is. These run BEFORE the touching-words check, which opens
 * every disclosure by script: the form is opened by a tap.
 */

const FOOTED = PREFIXED_LOCALES.flatMap((locale) =>
  FOOTER_PAGE_IDS.map((id) => ({ locale, path: pagePath(id, locale) })),
);
const localeOf = (route: string): Locale => {
  const found = FOOTED.find(({ path }) => path === route);
  if (!found) throw new Error(`${route} carries no report form`);
  return found.locale;
};

const openForm = async (page: Page): Promise<void> => {
  const open = await page
    .locator('[data-report]')
    .evaluate((details) => (details as HTMLDetailsElement).open);
  if (!open) await tapOn(page.locator('[data-report] summary'));
};

export const REPORT_FORM_CHECKS: readonly PageCheck[] = [
  {
    // Every locale that carries the form (#423): the 44px half measures its
    // localised labels, and this read Thai alone.
    name: 'every report-form control is at least 44px, every text meets AA, every field has a 3:1 boundary',
    routes: () =>
      PREFIXED_LOCALES.map((locale) => pagePath('yeetalk-calculators', locale)),
    themes: [DEFAULT_THEME],
    mutates: true,
    run: async ({ page, route }) => {
      const locale = localeOf(route);
      const t = getSiteStrings(locale).report;
      await openForm(page);
      for (const target of [
        page.locator('[data-report] summary'),
        page.getByLabel(t.quoteLabel, { exact: true }),
        page.getByLabel(t.suggestionLabel, { exact: true }),
        page.getByLabel(t.noteLabel, { exact: true }),
        page.getByRole('button', { name: t.send }),
      ])
        await atLeast44(target);
      const { failing, read } = await formTextsUnderAA(
        page.locator('[data-report]'),
        page.getByRole('button', { name: t.send }),
      );
      expect
        .soft(searched(failing, { of: read, what: `${locale} form texts` }))
        .toEqual([]);
      // WCAG 1.4.11: each field's boundary is --border-strong, the token
      // contrast.test.ts scores at 3:1. #133 shipped --border (1.17:1) on
      // every control. Resolved by the browser, so both sides are computed rgb.
      const strong = await resolvedColour(page, 'var(--border-strong)');
      for (const label of [t.quoteLabel, t.suggestionLabel, t.noteLabel])
        await expect
          .soft(page.getByLabel(label, { exact: true }))
          .toHaveCSS('border-top-color', strong);
    },
  },
  {
    // It read at 320 x 800; the walk reads at 320 x 900, and nothing here
    // reads the height.
    name: 'no sideways scroll at 320px with the report form open',
    routes: () => FOOTED.map(({ path }) => path),
    themes: [DEFAULT_THEME],
    widths: [320],
    mutates: true,
    run: async ({ page }) => {
      await openForm(page);
      await expect
        .soft(page.locator('[data-report]'))
        .toHaveAttribute('open', '');
      await expectNoHorizontalScroll(page);
      // Page-level scrollWidth is not containment (CLAUDE.md): nothing in the
      // form may escape the footer's own column.
      const column = await page.locator('footer .inner').boundingBox();
      expect.soft(column, 'the footer column has a box').not.toBeNull();
      const boxes = await page
        .locator(
          '[data-report] form > *:not(.visually-hidden):not(input[type="hidden"]):not(datalist)',
        )
        .evaluateAll((els) =>
          els.map((el) => ({
            right: el.getBoundingClientRect().right,
            name: el.tagName,
          })),
        );
      for (const box of boxes)
        expect
          .soft(box.right, box.name)
          .toBeLessThanOrEqual(column!.x + column!.width + 0.5);
      // Liveness by content, after the invariant: the widest controls were measured.
      expect
        .soft(boxes.map(({ name }) => name))
        .toEqual(expect.arrayContaining(['INPUT', 'TEXTAREA', 'BUTTON']));
    },
  },
];
