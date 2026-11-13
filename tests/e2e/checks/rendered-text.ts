import { expect } from '../fixtures';
import { searched } from '../../source-files';
import { PUBLISHED_ROUTES } from '../published-paths';
import {
  INTENTIONAL_JOINS,
  LEFT,
  ONE_PIXEL,
  RIGHT,
  el,
  joinsReportedFor,
  renderedText,
  scan,
  visualJoins,
} from '../rendered-text';
import { DEFAULT_THEME, type PageCheck } from '../page-checks';

/**
 * 'rendered text — no sentence may lose a space to the formatter', moved from
 * rendered-text.spec.ts (#1086), where each of three tests opened every page
 * again. Each reports every finding on its page at once (#422).
 */
export const RENDERED_TEXT_CHECKS: readonly PageCheck[] = [
  {
    name: 'no sentence loses a space',
    routes: () => PUBLISHED_ROUTES,
    themes: [DEFAULT_THEME],
    run: async ({ page, route }) => {
      const text = await renderedText(page);
      const findings = scan(text).map(({ why, at }) => {
        const context = text.slice(Math.max(0, at - 45), at + 45).trim();
        return `${why} -> …${context}…`;
      });
      expect
        .soft(
          // Its words, not its characters: whitespace is characters, so a page
          // rendered blank would have counted as searched (#446).
          searched(findings, {
            of: text.split(/\s+/),
            what: `words of ${route}`,
          }),
          findings.join('\n'),
        )
        .toEqual([]);
    },
  },
  {
    // release.yml refuses to ship a `[[…]]` placeholder at release; the same
    // check belongs where it runs on every PR.
    name: 'no unfilled [[placeholder]] reaches the page',
    routes: () => PUBLISHED_ROUTES,
    themes: [DEFAULT_THEME],
    run: async ({ page, route }) => {
      const text = await renderedText(page);
      const findings = [...text.matchAll(/\[\[[^\]]{1,60}\]\]/g)].map(
        (m) => m[0],
      );
      expect
        .soft(
          searched(findings, {
            of: text.split(/\s+/),
            what: `words of ${route}`,
          }),
          findings.join('\n'),
        )
        .toEqual([]);
    },
  },
  {
    // Where a box lands depends on the width it was laid out at, so the width
    // is part of what was searched (#198). `page.viewportSize()` is null on a
    // real phone, so each page reports its own width once it has loaded.
    name: 'no two words are rendered touching',
    routes: () => PUBLISHED_ROUTES,
    themes: [DEFAULT_THEME],
    // It opens every disclosure in the page's flow.
    mutates: true,
    run: async ({ page, route }) => {
      // Every disclosure in the page's flow open, as a visitor can: a closed
      // one paints nothing (RT3). Not the header's two: they are menus that
      // drop OVER the page, and a covered line is not one anybody reads as
      // touching.
      await page.evaluate(() =>
        document
          .querySelectorAll<HTMLDetailsElement>('details:not(header details)')
          .forEach((details) => (details.open = true)),
      );
      const width = await page.evaluate(
        () => document.documentElement.clientWidth,
      );
      const joins = await visualJoins(page);
      const findings = joins
        .filter(
          (join) =>
            !INTENTIONAL_JOINS.some(
              ({ left, right }) =>
                left.test(join.left) && right.test(join.right),
            ),
        )
        .map(
          (join) =>
            `<${join.tag.toLowerCase()}>: ` +
            `…${join.left.slice(-40).trim()}⟨NO SPACE⟩${join.right.slice(0, 40).trim()}…`,
        );
      expect
        .soft(
          searched(findings, {
            of: width,
            what: `px of ${route} laid out, a width read from the page`,
          }),
          `at ${width}px wide:\n${findings.join('\n')}`,
        )
        .toEqual([]);
    },
  },
];

/**
 * The scan's own liveness, on the homepage, after every real check: each one
 * plants a defect into the page or replaces its body (#1086 moved them here
 * from rendered-text.spec.ts, where each opened '/' again).
 */
export const RENDERED_TEXT_SELF_CHECKS: readonly PageCheck[] = [
  {
    // A detector nobody has watched fail is a detector nobody should trust.
    // This injects the exact defect that shipped and asserts the scan finds it.
    name: 'the scan can actually see a broken seam',
    routes: () => ['/'],
    themes: [DEFAULT_THEME],
    // It plants a paragraph, and takes it out again once read, so the checks
    // after it read the page as served.
    mutates: true,
    run: async ({ page }) => {
      await page.evaluate(() => {
        const p = document.createElement('p');
        p.id = 'planted-seam';
        p.textContent = 'Company No.17110487 · Registered office:71-75 Shelton';
        document.body.appendChild(p);
      });
      const text = await renderedText(page);
      await page.evaluate(() =>
        document.getElementById('planted-seam')?.remove(),
      );
      expect
        .soft([...new Set(scan(text).map((h) => h.why))].sort())
        .toEqual(['a label glued to its value', 'a word glued to a number']);
    },
  },
  {
    // Every case lays its left text out flush against its right text, on one
    // line. Only `visible` can be seen, so only `visible` is a join. The rest
    // are the ways this site keeps text in the layout while hiding it: the
    // closed language menu and its `.visually-hidden` label are what failed
    // every page at phone width (#198).
    name: 'the touching-words check only counts text a visitor can see',
    routes: () => ['/'],
    themes: [DEFAULT_THEME],
    mutates: true,
    run: async ({ page }) => {
      const reported = await joinsReportedFor(page, {
        visible: { left: el('span', LEFT, 'visible-left') },
        invisible: {
          left: el('span', `${LEFT}; visibility: hidden`, 'invisible-left'),
        },
        transparent: {
          left: el('span', `${LEFT}; opacity: 0`, 'transparent-left'),
        },
        closed: {
          left: el(
            'details',
            '',
            el('summary', 'position: absolute; top: 0; left: 0', 'menu'),
            el('span', LEFT, 'closed-left'),
          ),
        },
        'clip-path': {
          left: el(
            'span',
            `${LEFT}; ${ONE_PIXEL}; clip-path: inset(50%)`,
            'clip-path-left',
          ),
        },
        'clip-rect': {
          left: el(
            'span',
            `${LEFT}; ${ONE_PIXEL}; clip: rect(0 0 0 0)`,
            'clip-rect-left',
          ),
        },
      });
      expect.soft(reported).toEqual(['visible']);
    },
  },
  {
    // `box` puts its right text 3em below the line its left text sits on, and
    // gives the paragraph holding it a border box that starts ON that line.
    // A detector that reads the paragraph's box reports a join nobody can see,
    // which is how the hero section's 550px box came to "touch" the header.
    name: 'the touching-words check compares lines of text, never an element box',
    routes: () => ['/'],
    themes: [DEFAULT_THEME],
    mutates: true,
    run: async ({ page }) => {
      const reported = await joinsReportedFor(page, {
        line: {
          left: el('span', LEFT, 'line-left'),
          right: el('div', RIGHT, el('p', 'margin: 0', 'line-right')),
        },
        box: {
          left: el('span', LEFT, 'box-left'),
          right: el(
            'div',
            RIGHT,
            el('p', 'margin: 0; padding-top: 3em', 'box-right'),
          ),
        },
      });
      expect.soft(reported).toEqual(['line']);
    },
  },
];
