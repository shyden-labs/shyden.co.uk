/**
 * The theme script on the real iPhone: every test tests/e2e/theme-script.spec.ts
 * runs on the real Android phone, under the same title with an `iOS mirror:`
 * prefix (#801; global rule 2026-10-15, every test mirrored, no exceptions).
 * The inventory is read from Safari's own DOM over WebDriver, the same reads
 * Playwright's `page.evaluate` makes there.
 */
import { describe, expect, test } from 'vitest';
import { LOCALES, localisePath } from '../../../src/lib/i18n';
import { floorBreach } from '../../floors';
import { THEME_SCRIPT_SOURCE } from '../../palette';
import { docsPaths, NOT_FOUND_PATH, sitePaths } from '../../site-pages';
import { searched } from '../../source-files';
import { holdIosSession } from './held-session';
import { announceMode } from './session';

const phone = holdIosSession();

/** What each page carries beside the theme script, as Android's spec holds it. */
const OWN_SCRIPTS: Record<string, readonly string[]> = {
  '/': [],
  '/yeetalk-calculators': ['external module in body'],
  '/classroom-groups': ['inline classic in body', 'external module in body'],
  [NOT_FOUND_PATH]: [],
  '/api/docs/': ['external classic in head', 'inline module in body'],
  '/api/docs/private/': ['external classic in head', 'inline module in body'],
};

type Script = {
  inline: boolean;
  module: boolean;
  inHead: boolean;
  text: string;
  sheetsBefore: string[];
};

/** Every script and stylesheet on the page, in Safari's document order. */
const scriptsOn = (): Promise<{ scripts: Script[]; sheets: string[] }> =>
  phone().driver.executeScript(
    `const sheetElements = [...document.querySelectorAll('link[rel~="stylesheet"], style')];
     const name = (sheet) => sheet instanceof HTMLLinkElement ? 'link ' + sheet.href : 'style';
     return {
       sheets: sheetElements.map(name),
       scripts: [...document.scripts].map((script) => ({
         inline: !script.hasAttribute('src'),
         module: script.type === 'module',
         inHead: document.head.contains(script),
         text: script.hasAttribute('src') ? '' : (script.textContent ?? ''),
         sheetsBefore: sheetElements
           .filter((sheet) => !(script.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING))
           .map(name),
       })),
     };`,
  );

const kindOf = ({ inline, module, inHead }: Script): string =>
  `${inline ? 'inline' : 'external'} ${module ? 'module' : 'classic'} in ${inHead ? 'head' : 'body'}`;

const isTheme = (script: Script): boolean =>
  script.inline && script.text === THEME_SCRIPT_SOURCE;

const BUILT = [
  ...LOCALES.flatMap((locale) =>
    sitePaths().map((route) => ({ route, path: localisePath(route, locale) })),
  ),
  ...docsPaths().map((route) => ({ route, path: route })),
  { route: NOT_FOUND_PATH, path: NOT_FOUND_PATH },
];

describe('iOS mirror: the theme script (#142 §6.4)', () => {
  test('iOS mirror: is compared with the real script', () => {
    expect(THEME_SCRIPT_SOURCE).toContain("localStorage.getItem('theme')");
  });

  for (const { route, path } of BUILT) {
    test(`iOS mirror: ${path}: carries it exactly once, and nothing it did not carry before`, async () => {
      announceMode(phone(), `theme script inventory (${path})`);
      const own = OWN_SCRIPTS[route];
      if (own === undefined)
        throw new Error(
          `${route} has no entry in OWN_SCRIPTS: decide what it may carry`,
        );
      await phone().navigateToPath(path, 'body');
      const { scripts } = await scriptsOn();
      expect(scripts.filter(isTheme), 'the theme script').toHaveLength(1);
      expect(scripts.filter((script) => !isTheme(script)).map(kindOf)).toEqual(
        own,
      );
    });

    test(`iOS mirror: ${path}: runs it before the first paint: inline, classic, in <head>, ahead of every stylesheet`, async () => {
      announceMode(phone(), `theme script placement (${path})`);
      await phone().navigateToPath(path, 'body');
      const { scripts, sheets } = await scriptsOn();
      const [theme] = scripts.filter(isTheme);
      expect(theme, 'the theme script is on the page').toBeDefined();
      expect(kindOf(theme)).toBe('inline classic in head');
      expect(
        searched(theme.sheetsBefore, { of: sheets, what: 'stylesheets' }),
        'a stylesheet ahead of the theme script paints before it runs',
      ).toEqual([]);
      // The stylesheets read, as a floor recorded on the phone (#801): one id
      // per route, spelled whole here, since a route's locales render one
      // page; a locale reading another count is refused by the recorder.
      // Android's copy of this search is on the floorless burn-down; this one
      // carries its floor from the start.
      const floor = {
        '/': () => floorBreach('ios-theme-script/sheets-home', sheets.length),
        '/yeetalk-calculators': () =>
          floorBreach('ios-theme-script/sheets-glory-points', sheets.length),
        '/classroom-groups': () =>
          floorBreach(
            'ios-theme-script/sheets-classroom-groups',
            sheets.length,
          ),
        [NOT_FOUND_PATH]: () =>
          floorBreach('ios-theme-script/sheets-not-found', sheets.length),
        '/api/docs/': () =>
          floorBreach('ios-theme-script/sheets-api-docs', sheets.length),
        '/api/docs/private/': () =>
          floorBreach(
            'ios-theme-script/sheets-api-docs-private',
            sheets.length,
          ),
      }[route];
      expect(floor, `${route} has a stylesheet floor`).toBeDefined();
      expect(floor!()).toBeUndefined();
    });
  }
});
