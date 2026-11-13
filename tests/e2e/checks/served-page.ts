import type { Page } from '@playwright/test';
import { expect } from '../fixtures';
import { searched } from '../../source-files';
import { docsPaths, sitePaths, TITLE_FOR } from '../../site-pages';
import { THEME_SCRIPT_SOURCE } from '../../themes';
import { IOS_ZOOM_FLOOR_PX, measureTypedFields } from '../../typed-fields';
import { LOCALES, localisePath, type Locale } from '../../../src/lib/i18n';
import { NOT_FOUND_PATH, PUBLISHED_ROUTES } from '../published-paths';
import { DEFAULT_THEME, type PageCheck } from '../page-checks';

/**
 * What every served page carries, read on its walk (#1086). Moved from
 * locale-parity.spec.ts, theme-script.spec.ts and zoom-on-focus.spec.ts, which
 * each opened every page again to read it. Their tests that open no page stay
 * in those files.
 */

/**
 * Where a page lives in a given locale, derived from the route layout
 * (`src/pages/<locale>/…`) rather than from `localisePath`: a SECOND,
 * independent derivation, kept so the helper is never checked against itself
 * (locale-parity.spec.ts, #21 Stage 1).
 */
export const urlFor = (path: string, locale: Locale) =>
  locale === 'en' ? path : `/${locale}${path === '/' ? '/' : path}`;

/** Every (url, locale, title) locale-parity.spec.ts walked. */
export const LOCALE_PAGES = LOCALES.flatMap((locale) =>
  sitePaths().map((path) => ({
    url: urlFor(path, locale),
    locale,
    title: TITLE_FOR[path],
  })),
);

/**
 * What each page carries of its own, besides the theme script, as the build
 * measured on 2026-09-24. Keyed by unlocalised path, so a page added to
 * src/pages has no entry and fails until someone decides what it may carry.
 */
const OWN_SCRIPTS: Record<string, readonly string[]> = {
  '/': [],
  '/yeetalk-calculators': ['external module in body'],
  '/classroom-groups': ['inline classic in body', 'external module in body'],
  [NOT_FOUND_PATH]: [],
  // #781: the Swagger UI library the page loads into <head>, then the page's
  // own module, in document order.
  '/api/docs/': ['external classic in head', 'inline module in body'],
  '/api/docs/private/': ['external classic in head', 'inline module in body'],
};

/** Every page the build emits: each page in each locale, the docs and the 404. */
export const BUILT = [
  ...LOCALES.flatMap((locale) =>
    sitePaths().map((route) => ({ route, path: localisePath(route, locale) })),
  ),
  ...docsPaths().map((route) => ({ route, path: route })),
  { route: NOT_FOUND_PATH, path: NOT_FOUND_PATH },
];

type Script = {
  inline: boolean;
  module: boolean;
  inHead: boolean;
  text: string;
  /** Every stylesheet that comes BEFORE this script in the document. */
  sheetsBefore: string[];
};

/**
 * The page's scripts, and every stylesheet it carries, from the DOM: never by
 * matching `<script` in the HTML, since /classroom-groups carries a comment
 * that only mentions the tag.
 */
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

const builtRoute = (path: string): string => {
  const found = BUILT.find((built) => built.path === path);
  if (!found) throw new Error(`${path} is not a page the build emits`);
  return found.route;
};

export const SERVED_PAGE_CHECKS: readonly PageCheck[] = [
  {
    // locale-parity.spec.ts, 'every locale, every page'
    name: 'is served in its own locale',
    routes: () => LOCALE_PAGES.map(({ url }) => url),
    themes: [DEFAULT_THEME],
    run: async ({ page, route }) => {
      const served = LOCALE_PAGES.find(({ url }) => url === route);
      if (!served) throw new Error(`${route} is not a locale page`);
      await expect
        .soft(page.locator('html'))
        .toHaveAttribute('lang', served.locale);
      await expect.soft(page).toHaveTitle(served.title(served.locale));
    },
  },
  {
    // theme-script.spec.ts (#142 §6.4)
    name: 'carries the theme script exactly once, and nothing it did not carry before',
    routes: () => BUILT.map(({ path }) => path),
    themes: [DEFAULT_THEME],
    run: async ({ page, route }) => {
      const own = OWN_SCRIPTS[builtRoute(route)];
      if (own === undefined)
        throw new Error(
          `${builtRoute(route)} has no entry in OWN_SCRIPTS: decide what it may carry`,
        );
      const { scripts } = await scriptsOn(page);
      expect.soft(scripts.filter(isTheme), 'the theme script').toHaveLength(1);
      expect
        .soft(scripts.filter((script) => !isTheme(script)).map(kindOf))
        .toEqual(own);
    },
  },
  {
    // theme-script.spec.ts (#142 §6.4)
    name: 'runs the theme script before the first paint: inline, classic, in <head>, ahead of every stylesheet',
    routes: () => BUILT.map(({ path }) => path),
    themes: [DEFAULT_THEME],
    run: async ({ page }) => {
      const { scripts, sheets } = await scriptsOn(page);
      const [theme] = scripts.filter(isTheme);
      expect.soft(theme, 'the theme script is on the page').toBeDefined();
      if (!theme) return;
      expect.soft(kindOf(theme)).toBe('inline classic in head');
      expect
        .soft(
          searched(theme.sheetsBefore, { of: sheets, what: 'stylesheets' }),
          'a stylesheet ahead of the theme script paints before it runs',
        )
        .toEqual([]);
    },
  },
  {
    // zoom-on-focus.spec.ts (#352). The API docs draw their fields only once
    // Try it out is open: api-docs.spec.ts holds the same floor there.
    name: `every typed field computes to at least ${IOS_ZOOM_FLOOR_PX}px`,
    routes: () =>
      PUBLISHED_ROUTES.filter((route) => !docsPaths().includes(route)),
    themes: [DEFAULT_THEME],
    run: async ({ page, route }) => {
      const controls = await page.evaluate(measureTypedFields);
      if (route === '/') {
        // The one page with no typed field: no tool, and no report form,
        // since English is not a beta language. That empty answer is only
        // worth something if the page rendered.
        await expect.soft(page.locator('main h1')).toBeVisible();
        // The elements the measurement ran over (#610): a page that lost its
        // content would answer "no typed field" just the same.
        const examined = await page.evaluate(
          () => document.body.querySelectorAll('*').length,
        );
        expect
          .soft(
            searched(controls, {
              of: examined,
              what: 'elements on the English homepage',
            }),
            'the English homepage has no typed field',
          )
          .toEqual([]);
      } else {
        expect
          .soft(
            searched(
              controls.filter((c) => !(c.fontSize >= IOS_ZOOM_FLOOR_PX)),
              { of: controls, what: `typed fields on ${route}` },
            ),
            'a field under 16px makes iOS Safari zoom the page when it is focused',
          )
          .toEqual([]);
      }
      // 'the report form is among the fields searched': liveness for the
      // population above, on the first beta locale's homepage, which this
      // walk has just measured.
      const beta = LOCALES.find((l) => l !== LOCALES[0]);
      if (route === '/')
        expect
          .soft(beta, 'a second locale to carry the report form')
          .toBeDefined();
      if (beta && route === localisePath('/', beta))
        expect
          .soft(controls.map((c) => c.field))
          .toEqual(
            expect.arrayContaining([
              '#report-quote',
              '#report-suggestion',
              '#report-note',
            ]),
          );
    },
  },
];
