import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { DEFAULT_LOCALE, getSiteStrings } from '../src/lib/i18n';
import { renderedText } from './html-text';

/**
 * A path the site does not have answers 404 with the site's own not-found
 * page (#390 F157). The one home for the dev and prod gates.
 *
 * Cloudflare Pages serves `404.html` for an unknown path only while the build
 * has one. Without it, Pages takes the site for a single-page app and answers
 * every unknown path with the homepage, at 200. Both gates requested only
 * routes that exist, so a deploy that had lost its not-found page, and with
 * it the 404's report forms, passed both.
 */
export async function expectNotFoundServed(
  request: APIRequestContext,
): Promise<void> {
  const path = `/no-such-page-${randomUUID()}`;
  const response = await request.get(path);
  expect(response.status(), `${path} HTTP status`).toBe(404);
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(await response.text());
  expect(heading && renderedText(heading[1]), `${path} <h1>`).toBe(
    getSiteStrings(DEFAULT_LOCALE).notFound.heading,
  );
}
