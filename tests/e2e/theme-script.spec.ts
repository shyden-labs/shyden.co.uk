import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { searched } from '../source-files';
import { sitePaths } from '../site-pages';
import { THEME_SCRIPT_SOURCE } from '../themes';
import { LOCALES, localisePath } from '../../src/lib/i18n';

/**
 * The one script every page carries, pinned by what MAY exist (#142 §6.4).
 *
 * The homepage's promise was "no JavaScript", held by counting to zero. With
 * the theme script it ships exactly one, so the promise is pinned as an
 * inventory instead: the theme script on every page exactly once, identical
 * to its source, and nothing else on a page that carried nothing before.
 *
 * Read from a real DOM (`document.scripts`), never by matching `<script` in
 * the HTML: /classroom-groups carries a comment that only mentions the tag,
 * and a text match counts it.
 */

/** The 404 is served for any unknown path, so any unknown path reaches it. */
const NOT_FOUND = '/definitely-not-a-page';

/**
 * What each page carries of its own, besides the theme script, as the build
 * measured on 2026-09-24. Keyed by unlocalised path, so a page added to
 * src/pages has no entry and fails until someone decides what it may carry.
 */
const OWN_SCRIPTS: Record<string, readonly string[]> = {
  '/': [],
  '/yeetalk-calculators': ['external module in body'],
  '/classroom-groups': ['inline classic in body', 'external module in body'],
  [NOT_FOUND]: [],
};

type Script = {
  inline: boolean;
  module: boolean;
  inHead: boolean;
  text: string;
  /** Every stylesheet that comes BEFORE this script in the document. */
  sheetsBefore: string[];
};

/** The page's scripts, and every stylesheet it carries, from the DOM. */
const scriptsOn = (
  page: Page,
): Promise<{ scripts: Script[]; sheets: string[] }> =>
  page.evaluate(() => {
    const sheetElements = [
      ...document.querySelectorAll('link[rel~="stylesheet"], style'),
    ];
    const name = (sheet: Element) =>
      sheet instanceof HTMLLinkElement ? `link ${sheet.href}` : 'style';
    return {
      sheets: sheetElements.map(name),
      scripts: [...document.scripts].map((script) => ({
        inline: !script.hasAttribute('src'),
        module: script.type === 'module',
        inHead: document.head.contains(script),
        text: script.hasAttribute('src') ? '' : (script.textContent ?? ''),
        sheetsBefore: sheetElements
          .filter(
            (sheet) =>
              !(
                script.compareDocumentPosition(sheet) &
                Node.DOCUMENT_POSITION_FOLLOWING
              ),
          )
          .map(name),
      })),
    };
  });

const kindOf = ({ inline, module, inHead }: Script): string =>
  `${inline ? 'inline' : 'external'} ${module ? 'module' : 'classic'} in ${inHead ? 'head' : 'body'}`;

const isTheme = (script: Script): boolean =>
  script.inline && script.text === THEME_SCRIPT_SOURCE;

/** Every page the build emits: each page in each locale, and the 404. */
const BUILT = [
  ...LOCALES.flatMap((locale) =>
    sitePaths().map((route) => ({ route, path: localisePath(route, locale) })),
  ),
  { route: NOT_FOUND, path: NOT_FOUND },
];

test.describe('the theme script (#142 §6.4)', () => {
  test('is compared with the real script', () => {
    // The control for every comparison below: an empty or missing source
    // would match nothing, or an empty inline script, and prove nothing.
    expect(THEME_SCRIPT_SOURCE).toContain("localStorage.getItem('theme')");
  });

  for (const { route, path } of BUILT) {
    test(`${path}: carries it exactly once, and nothing it did not carry before`, async ({
      page,
    }) => {
      const own = OWN_SCRIPTS[route];
      if (own === undefined)
        throw new Error(
          `${route} has no entry in OWN_SCRIPTS: decide what it may carry`,
        );
      await page.goto(path);
      const { scripts } = await scriptsOn(page);
      expect(scripts.filter(isTheme), 'the theme script').toHaveLength(1);
      expect(scripts.filter((script) => !isTheme(script)).map(kindOf)).toEqual(
        own,
      );
    });

    test(`${path}: runs it before the first paint: inline, classic, in <head>, ahead of every stylesheet`, async ({
      page,
    }) => {
      await page.goto(path);
      const { scripts, sheets } = await scriptsOn(page);
      const [theme] = scripts.filter(isTheme);
      expect(theme, 'the theme script is on the page').toBeDefined();
      expect(kindOf(theme)).toBe('inline classic in head');
      expect(
        searched(theme.sheetsBefore, { of: sheets, what: 'stylesheets' }),
        'a stylesheet ahead of the theme script paints before it runs',
      ).toEqual([]);
    });
  }
});
