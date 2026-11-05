import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import {
  getSiteStrings,
  localeFromPath,
  type Locale,
} from '../../src/lib/i18n';
import { layoutWidthsFrom } from '../layout-widths';
import { searched } from '../source-files';
import { PUBLISHED_ROUTES } from './published-paths';
import { docsPaths } from '../site-pages';
import { recorded, shoot } from './evidence';

test.use(recorded);

/**
 * The header row has room for everything in it, in every locale (#329).
 *
 * At 320px in Indonesian the Shyden wordmark ran 13px under the menu button.
 * The language switcher needed 184px for "Bahasa Indonesia", so the row's
 * three items needed 302px of the 288px inside the gutters, and flex squeezed
 * the wordmark's box below the width of its own text. Nothing could see it:
 * text assertions read text, which was all there, and the no-horizontal-scroll
 * tests read the document's `scrollWidth`, which never moved because the
 * overlap happened INSIDE the header. Only geometry sees this -- every item's
 * box, and the range its text paints, against every other item's.
 *
 * Nothing is listed by hand. The pages come from the built sitemap, the widths
 * from the breakpoints the served CSS declares, and the items from the controls
 * the bar renders at that width, so #142's theme switch is measured the day it
 * exists.
 */

/** Sub-pixel rounding: two boxes that merely touch do not overlap. */
const EPSILON = 0.5;

type Rect = { left: number; right: number; top: number; bottom: number };
/** `wraps`: each piece of the item's text that runs onto more than one line. */
type Item = { name: string; rects: Rect[]; wraps: string[] };
type Row = { left: number; right: number; items: Item[] };

/**
 * Every width at which the page's layout can change: both sides of each
 * breakpoint its stylesheets declare, plus 320px and 1280px. The browser only
 * collects the media queries; which widths they mean is `layoutWidthsFrom`'s
 * job, unit-tested against every way a width condition can be written.
 */
const layoutWidths = async (page: Page) =>
  layoutWidthsFrom(
    await page.evaluate(() => {
      const mediaTexts: string[] = [];
      const read = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSMediaRule)
            mediaTexts.push(rule.media.mediaText);
          if ('cssRules' in rule) read((rule as CSSGroupingRule).cssRules);
        }
      };
      for (const sheet of Array.from(document.styleSheets))
        read(sheet.cssRules);
      return mediaTexts;
    }),
  );

/** Every control the header bar renders at this width, with what it paints. */
const headerRow = (page: Page): Promise<Row> =>
  page.evaluate(() => {
    const bar = document.querySelector('header .bar');
    if (!bar) return { left: 0, right: 0, items: [] };
    const style = getComputedStyle(bar);
    const box = bar.getBoundingClientRect();
    const plain = ({ left, right, top, bottom }: DOMRect) => ({
      left,
      right,
      top,
      bottom,
    });
    // `checkVisibility`, not `getClientRects`: Chromium hides a closed
    // <details>'s content with `content-visibility: hidden`, which keeps its
    // boxes, so the dropdown's entries still report rects while unpainted.
    const items = Array.from(bar.querySelectorAll('a[href], summary, button'))
      .filter((el) => el.checkVisibility())
      .map((el) => {
        // The box AND the text: #329's wordmark kept its text at 73.6px while
        // its box was squeezed to 60.4px, so a box-only check passes it. Text
        // is measured as PAINTED: a range reports a node's layout, and the
        // BETA badge's visually-hidden label lays out ~110px of nowrap text
        // inside a 1px box that clips it, so each text node is cut to every
        // box between it and the item that clips its overflow.
        const painted = (node: Node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return Array.from(range.getClientRects()).map((rect) => {
            const cut = plain(rect);
            for (let at = node.parentElement; at; at = at.parentElement) {
              const style = getComputedStyle(at);
              if (
                style.overflowX !== 'visible' ||
                style.overflowY !== 'visible'
              ) {
                const clip = at.getBoundingClientRect();
                cut.left = Math.max(cut.left, clip.left);
                cut.right = Math.min(cut.right, clip.right);
                cut.top = Math.max(cut.top, clip.top);
                cut.bottom = Math.min(cut.bottom, clip.bottom);
              }
              if (at === el) break;
            }
            return cut;
          });
        };
        const shows = (r: Rect) => r.right - r.left > 0 && r.bottom - r.top > 0;
        const texts: Rect[] = [];
        const wraps: string[] = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent?.trim();
          if (!text) continue;
          const lines = painted(node).filter(shows);
          // One text node on two lines is a label that did not fit: "Bahasa
          // Indonesia" wrapped at its space, or 中文 broken between its
          // characters. Squeezed that way a row can fit with no overlap at
          // all, which is how mutation M3 passed the first version of this
          // guard.
          if (new Set(lines.map((r) => Math.round(r.top))).size > 1)
            wraps.push(text);
          texts.push(...lines);
        }
        const rects = [plain(el.getBoundingClientRect()), ...texts].filter(
          shows,
        );
        const name =
          el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
        return { name, rects, wraps };
      });
    return {
      left: box.left + parseFloat(style.paddingLeft),
      right: box.right - parseFloat(style.paddingRight),
      items,
    };
  });

/** How far two rectangles overlap horizontally, or 0 when they do not. */
const overlap = (a: Rect, b: Rect): number => {
  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return x > EPSILON && y > EPSILON ? x : 0;
};

/**
 * Every collision in one row: item against item, item against the row, and
 * text that had to wrap to fit.
 */
const collisions = (row: Row): string[] => {
  const found: string[] = [];
  row.items.forEach((a, i) => {
    for (const b of row.items.slice(i + 1)) {
      const worst = Math.max(
        0,
        ...a.rects.flatMap((ra) => b.rects.map((rb) => overlap(ra, rb))),
      );
      if (worst > 0)
        found.push(
          `"${a.name}" and "${b.name}" overlap by ${worst.toFixed(1)}px`,
        );
    }
    for (const text of a.wraps)
      found.push(`"${a.name}" wraps "${text}" onto more than one line`);
    for (const r of a.rects) {
      const out = Math.max(row.left - r.left, r.right - row.right);
      if (out > EPSILON)
        found.push(`"${a.name}" runs ${out.toFixed(1)}px outside the row`);
    }
  });
  return found;
};

/**
 * What one test measures, row by row: the collisions, the rows (by content:
 * the names of the items found), and the rows or pages that measured too
 * little to mean anything. The test owns the loop and every resize, so each
 * resize sits in the body of a test tagged `@emulated-viewport`.
 */
const survey = (locale: Locale, localised: boolean) => {
  const findings: string[] = [];
  const rows: string[] = [];
  const thin: string[] = [];
  // Wordmark, menu or nav, theme switch, language switcher; an English-only
  // page (the API docs, #781) has no switcher by decision, so three.
  const least = localised ? 4 : 3;
  // The theme switch by its own name (#142): a row without it has not
  // measured the room AC5 asks for.
  const themeSwitch = getSiteStrings(locale).themeDarkMode;
  return {
    /** Load a page, and read the widths its CSS can lay out. */
    open: async (page: Page, path: string): Promise<number[]> => {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const layout = await layoutWidths(page);
      // The widths are only as good as the CSS they were read from: with no
      // breakpoints found, 320px and 1280px would stand for every width.
      if (layout.edges.length === 0)
        thin.push(`${path}: no breakpoints were read from its CSS`);
      return layout.widths;
    },
    /** Measure the header row at the width the test has just set. */
    measure: async (page: Page, where: string): Promise<void> => {
      const row = await headerRow(page);
      const names = row.items.map((item) => item.name);
      rows.push(`${where}: ${names.join(' | ')}`);
      if (
        names.filter((name) => name !== '').length < least ||
        !names.includes('Shyden') ||
        !names.includes(themeSwitch)
      )
        thin.push(`${where} measured only [${names.join(' | ')}]`);
      for (const collision of collisions(row))
        findings.push(`${where}: ${collision}`);
    },
    /** Every row measured enough to mean something, and none collided. */
    expectRoom: (): void => {
      expect(
        searched(thin, { of: rows, what: 'header rows measured' }),
        'rows that measured too little to prove anything',
      ).toEqual([]);
      expect(
        searched(findings, { of: rows, what: 'header rows measured' }),
        findings.join('\n'),
      ).toEqual([]);
    },
  };
};

test.describe('the header row has room for everything in it (#329)', () => {
  // One test per published page (#422). The 404 is English, so it is
  // measured as an English page.
  for (const path of PUBLISHED_ROUTES) {
    const locale = localeFromPath(path);
    test(
      `${path}: no header item overlaps another, at any width`,
      { tag: '@emulated-viewport' },
      async ({ page }) => {
        const header = survey(locale, !docsPaths().includes(path));
        // runtime population: the widths this page's own CSS can lay out,
        // read from the media queries it serves, so only the loaded page
        // knows them (#422).
        for (const width of await header.open(page, path)) {
          await page.setViewportSize({ width, height: 800 });
          await header.measure(page, `${path} at ${width}px`);
        }
        header.expectRoom();
        // The picture comes after the verdict, so it shows a row that passed.
        // The release evidence cites every page here, so every page takes it
        // (#774: a cited case that captured nothing is fixed, never dropped).
        await header.open(page, path);
        await page.setViewportSize({ width: 320, height: 800 });
        await shoot(
          page,
          `${path} at 320px: the header row`,
          page.locator('header'),
        );
      },
    );
  }
});
