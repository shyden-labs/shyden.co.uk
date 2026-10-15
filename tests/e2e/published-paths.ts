import { expect, type Page } from '@playwright/test';
import { NOT_FOUND_PATH, docsPaths } from '../site-pages';

export { NOT_FOUND_PATH, PUBLISHED_ROUTES } from '../site-pages';

/**
 * Every page the site publishes, read from the built sitemap rather than
 * listed here. The 404 is appended because it is deliberately absent from
 * the sitemap. Read at run time, so it is the check on `PUBLISHED_ROUTES`,
 * never a population to generate tests from.
 *
 * One home for the list: `rendered-text.spec.ts` kept it privately until
 * `head-and-sitemap.spec.ts` needed the same pages (#233).
 */
export async function publishedPaths(page: Page): Promise<string[]> {
  const xml = await (await page.request.get('/sitemap-0.xml')).text();
  const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (m) => new URL(m[1]).pathname,
  );
  expect(paths.length).toBeGreaterThan(0); // an empty sitemap must not pass
  // The API docs (#781) are left out of the sitemap on purpose, like the 404.
  return [...paths, ...docsPaths(), NOT_FOUND_PATH];
}

/** A path without its trailing slash, so `/id/` and `/id` compare equal. */
export const withoutTrailingSlash = (path: string): string =>
  path.length > 1 ? path.replace(/\/$/, '') : path;
