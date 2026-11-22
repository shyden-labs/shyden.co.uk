import { expect } from '@playwright/test';
import { THEMES } from '../../palette';
import { privacyPaths } from '../../site-pages';
import { expectNoHorizontalScroll } from '../../viewport';
import { contrastRatio } from '../helpers';
import { searched } from '../../source-files';
import { BAND_WIDTHS } from './homepage';
import type { PageCheck } from '../page-checks';

/**
 * The privacy page meets the site's own floors (#1080 AC4): no sideways
 * scroll and nothing escaping its column at any width from 320px, every line
 * of text at WCAG AA in both themes, and the footer's links at least 44px.
 * The links inside its paragraphs are inline text, which WCAG 2.5.8 exempts
 * from the target size; the footer's stand alone, so they are measured.
 */
export const PRIVACY_PAGE_CHECKS: readonly PageCheck[] = [
  {
    name: 'the privacy page: no sideways scroll, nothing escapes its column, every line AA, footer links 44px',
    routes: () => privacyPaths(),
    themes: THEMES,
    widths: BAND_WIDTHS,
    run: async ({ page, route, took }) => {
      const at = `${route} ${took.width}px`;
      await expectNoHorizontalScroll(page, at);

      // Page-level scrollWidth is not containment (CLAUDE.md): a line can
      // overflow its article and scroll nothing.
      const escaped = await page.locator('main article').evaluate((article) => {
        const edge = article.getBoundingClientRect();
        return [...article.querySelectorAll('*')]
          .filter((el) => {
            const box = el.getBoundingClientRect();
            return (
              box.width > 0 &&
              (box.right > edge.right + 0.5 || box.left < edge.left - 0.5)
            );
          })
          .map(
            (el) =>
              `${el.tagName.toLowerCase()}: ${(el.textContent ?? '').slice(0, 40)}`,
          );
      });
      const blocks = page.locator('main article').locator('h1, h2, p, li, a');
      expect
        .soft(
          searched(escaped, {
            of: await blocks.all(),
            what: `${at} text blocks`,
          }),
          `${at}: escapes its column`,
        )
        .toEqual([]);

      const low: string[] = [];
      for (const block of await blocks.all()) {
        const ratio = await contrastRatio(block);
        if (ratio < 4.5)
          low.push(
            `${(await block.textContent())?.slice(0, 40)}: ${ratio.toFixed(2)}`,
          );
      }
      expect.soft(low, `${at}: text under AA (4.5:1)`).toEqual([]);

      const links = await page.locator('footer a').all();
      expect.soft(links.length, `${at}: footer links`).toBeGreaterThan(0);
      for (const link of links) {
        const box = await link.boundingBox();
        const name = await link.textContent();
        expect
          .soft(box?.width ?? 0, `${at}: ${name} width`)
          .toBeGreaterThanOrEqual(44);
        expect
          .soft(box?.height ?? 0, `${at}: ${name} height`)
          .toBeGreaterThanOrEqual(44);
      }
    },
  },
];
