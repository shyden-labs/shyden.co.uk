import { test, expect } from '@playwright/test';
import { deployedRoutes } from '../site-pages';
import { expectNotFoundServed } from '../not-found-served';
import { PRODUCTS } from '../product-links';
import { withoutMarkupComments } from '../unit/source-text';

/**
 * The production smoke: status codes, page inventory, and strings in the
 * served bytes, requested without a browser (#390).
 *
 * It was a curl step inline in deploy-prod.yml, so the first build it ever
 * met was the one already serving shyden.co.uk. #370 took the company number
 * off every page and the smoke went on requiring it: the next release would
 * have gone live, failed its own smoke, and never posted `prod-verified`,
 * with every check on its pull request green. As a spec it runs against each
 * pull request's own prod build (`sanity-on-build`) as well as against the
 * deployed site, so a fact kept here cannot go stale in front of a deploy.
 *
 * prod-sanity.spec.ts holds what needs rendering; this holds what bytes prove.
 * The routes are derived, as prod-sanity's are: the curl loop's hand-written
 * list was held to LOCALES only by a guard that had to be told it existed.
 */

/** A page's body as served, after any redirect, with its final status. */
const served = async (
  request: import('@playwright/test').APIRequestContext,
  path: string,
) => {
  const response = await request.get(path);
  return { status: response.status(), body: await response.text() };
};

/** A `<script>` that fetches a file, as opposed to one carried inline. */
const FETCHED_SCRIPT = /<script[^>]+src="[^"]*\.js"/;

test.describe('the production smoke', () => {
  for (const { path } of deployedRoutes()) {
    // Non-trivial: a Cloudflare error page or an empty build is a 200 too.
    test(`${path} answers 200 with a real page`, async ({ request }) => {
      const page = await served(request, path);
      expect(page.status, `${path} HTTP status`).toBe(200);
      expect(page.body.length, `${path} body bytes`).toBeGreaterThan(2000);
      // A markup comment in `.astro` ships to every visitor; a `{/* */}` one
      // compiles to nothing. /classroom-groups served 32 KB of engineering
      // notes, 55% of its English page, and one quoted the form's own tag,
      // which is the marker the form check below looks for (#390).
      expect(
        page.body.length - withoutMarkupComments(page.body).length,
        `${path} ships bytes of HTML comment`,
      ).toBe(0);
    });
  }

  test('an unknown path answers 404 with the not-found page', async ({
    request,
  }) => {
    await expectNotFoundServed(request);
  });

  test('the homepage is this site, fetching no script', async ({ request }) => {
    const home = await served(request, '/');
    expect(home.status).toBe(200);
    expect(home.body).toMatch(/shyden/i);
    // Its one script, the theme script, is inline (#142), and a bundler
    // change could add a fetched one silently.
    expect(home.body).not.toMatch(FETCHED_SCRIPT);
  });

  // One test per product (#403). The production Yawelo Idle host has no DNS
  // record yet, by the operator's choice: its URL is read in the served HTML,
  // never fetched.
  for (const product of PRODUCTS)
    test(`the homepage links prod ${product.name}, never dev`, async ({
      request,
    }) => {
      const home = await served(request, '/');
      expect(home.status).toBe(200);
      expect(home.body).toContain(`https://${product.prod}`);
      expect(
        home.body,
        `a DEV ${product.name} link leaked into prod`,
      ).not.toContain(`https://${product.dev}`);
    });

  test('the calculator still explains itself', async ({ request }) => {
    const page = await served(request, '/yeetalk-calculators');
    expect(page.status).toBe(200);
    expect(page.body).toMatch(/How to use it/i);
  });

  // This page is a tool, and a partial deploy that dropped the bundle would
  // leave a form that looks fine and does nothing.
  test('the Classroom Group Creator still ships its form and its script', async ({
    request,
  }) => {
    const page = await served(request, '/classroom-groups');
    expect(page.status).toBe(200);
    expect(page.body).toContain('id="cg-form"');
    expect(page.body).toMatch(FETCHED_SCRIPT);
  });
});
