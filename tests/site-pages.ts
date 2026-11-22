import { readdirSync } from 'node:fs';
import { nonEmpty } from './source-files';
import {
  LOCALES,
  localisePath,
  getSiteStrings,
  getStrings,
  type Locale,
} from '../src/lib/i18n/index';

const PAGES_DIR = 'src/pages';

/**
 * The site's pages, read off the routes that serve the default locale.
 *
 * `404.astro` is excluded: it is Cloudflare's not-found document, served at
 * one URL for the whole site, and there is no `/id/404` to match it.
 *
 * Derived, never listed. `route-coverage.test.ts` already did this privately
 * while `locale-routing.test.ts` and `thai-typography.spec.ts` wrote the same
 * three pages out by hand — so adding a fourth page left the hand-written
 * pair silently asserting nothing about it (#68).
 */
export const pageNames = (dir: string = PAGES_DIR): string[] =>
  nonEmpty(
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.astro'))
      .map((entry) => entry.name.replace(/\.astro$/, ''))
      .filter((name) => name !== '404')
      .sort(),
    `routable .astro pages in ${dir}`,
  );

/** The same pages as request paths in the default locale: `index` is `/`. */
export const sitePaths = (): string[] =>
  pageNames().map((name) => (name === 'index' ? '/' : `/${name}`));

const TICKET_DIR = 'src/pages/support';

/**
 * The support ticket page (#1032): English only, out of the sitemap and not
 * indexed, because ShyDesk emails one address per product and the address
 * carries a private token after `#t=`. Derived from its folder, like
 * `docsPaths`.
 */
export const ticketPaths = (): string[] =>
  nonEmpty(
    readdirSync(TICKET_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.astro'))
      .map((entry) => `/support/${entry.name.replace(/\.astro$/, '')}/`),
    `routable .astro pages in ${TICKET_DIR}`,
  );

/**
 * The English pages that paint no form control of their own: no tool, and no
 * report form, since English is not a beta language. The support pages' only
 * form is ShyDesk's, drawn in its own shadow DOM from ShyDesk's host (#1032),
 * so the site's markup there holds none either, and the privacy page (#1080)
 * is text alone. Every other page has a tool
 * or a report form, and a check that finds no control on one fails.
 */
export const pagesWithoutOwnControls = (): string[] => [
  '/',
  '/support',
  ...ticketPaths(),
  ...privacyPaths(),
];

/**
 * The privacy page (#1080), as a request path. English only and in the
 * sitemap, so it is not one of `sitePaths()`, which every locale serves.
 * Named, not read from its folder: the tests declare the page they expect,
 * and `privacy-page.test.ts` holds the route files to exactly this one.
 */
export const privacyPaths = (): string[] => ['/privacy/'];

const DOCS_DIR = 'src/pages/api/docs';

/**
 * The API docs pages (#781), English only and out of the sitemap, as request
 * paths: `index` is `/api/docs/`. Derived from their folder, like
 * `sitePaths`, so a docs page added later is measured the day it appears.
 */
export const docsPaths = (): string[] =>
  nonEmpty(
    readdirSync(DOCS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.astro'))
      .map((entry) => entry.name.replace(/\.astro$/, ''))
      .map((name) => (name === 'index' ? '/api/docs/' : `/api/docs/${name}/`))
      .sort(),
    `docs pages in ${DOCS_DIR}`,
  );

/**
 * The `<h1>` a page renders, per locale, keyed by its UNLOCALISED path.
 *
 * Deliberately a lookup rather than three literals inside each gate. The dev
 * and prod sanity suites carried byte-identical hand-written tables, so
 * `sitePaths()` grew to four and both gates went on testing three: the new
 * page was fetched by `deploy-prod.yml`'s curl smoke and **never rendered in
 * a browser** by the suites that exist because curl is not enough. Measured
 * with a probe page: `--list` reported `Total: 28 tests` before and after.
 *
 * Keyed by page rather than derived from one catalogue because the three
 * pages genuinely read from different ones — the home and glory headings come
 * from `getSiteStrings`, the tool's from `getStrings`. A new page has no entry
 * here, and `headingFor` refuses rather than skipping it.
 */
export const HEADING_FOR: Record<string, (locale: Locale) => string> = {
  '/': (locale) => getSiteStrings(locale).home.heroHeading,
  '/yeetalk-calculators': (locale) =>
    getSiteStrings(locale).calculators.heading,
  '/classroom-groups': (locale) => getStrings(locale).heading,
  '/support': (locale) => getSiteStrings(locale).support.heading,
};

/**
 * The heading for one page, or a refusal.
 *
 * A page with no entry is a page nobody taught the deploy gates about, and
 * silently dropping it from the route list is exactly the failure #89 exists
 * to close. `site-pages.test.ts` asserts this map covers `sitePaths()`, so
 * the unit suite fails first and this throw is the backstop.
 */
export function headingFor(path: string): (locale: Locale) => string {
  const heading = HEADING_FOR[path];
  if (!heading)
    throw new Error(
      `no heading known for ${path} — add it to HEADING_FOR in ` +
        'tests/site-pages.ts. A deploy gate must cover every page the site ' +
        'serves, and dropping one silently is the defect this refuses (#89).',
    );
  return heading;
}

/**
 * The `<title>` a page renders, per locale, keyed like `HEADING_FOR` and for
 * the same reason. `locale-parity.spec.ts` walked a hand-written list of two
 * pages, so `/classroom-groups` could ship an English title in zh, vi and th
 * with every suite green (#390 F130). `site-pages.test.ts` asserts this map
 * covers `sitePaths()`.
 */
export const TITLE_FOR: Record<string, (locale: Locale) => string> = {
  '/': (locale) => getSiteStrings(locale).home.title,
  '/yeetalk-calculators': (locale) => getSiteStrings(locale).calculators.title,
  '/classroom-groups': (locale) => `${getStrings(locale).title} — Shyden`,
  '/support': (locale) => getSiteStrings(locale).support.title,
};

/** One route per page per locale, with the heading each should render. */
export interface DeployedRoute {
  readonly locale: Locale;
  readonly path: string;
  readonly heading: string;
  readonly englishHeading: string;
}

/**
 * Every route the deployed site serves, for the dev and prod sanity gates.
 *
 * The one table both gates read. `englishHeading` is carried alongside so a
 * build that fell back to English fails against the ENGLISH copy rather than
 * agreeing with its own regressed catalogue — the independent half of the
 * check, kept from the tables this replaces.
 */
export const deployedRoutes = (): DeployedRoute[] =>
  LOCALES.flatMap((locale) =>
    sitePaths().map((page) => ({
      locale,
      path: localisePath(page, locale),
      heading: headingFor(page)(locale),
      englishHeading: headingFor(page)('en'),
    })),
  );
