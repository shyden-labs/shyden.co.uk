import { expect, type Page } from '@playwright/test';
import { searched } from './source-files';

/**
 * The products the homepage links out to, each by the word its hosts carry
 * and the build variable that points it at an environment (#403).
 */
export const PRODUCTS = [
  {
    name: 'ShyTalk',
    hostWord: 'shytalk',
    variable: 'PUBLIC_SHYTALK_URL',
    prod: 'shytalk.shyden.co.uk',
    dev: 'dev.shytalk.shyden.co.uk',
  },
  {
    name: 'Yawelo Idle',
    hostWord: 'yawelo-idle',
    variable: 'PUBLIC_YAWELO_IDLE_URL',
    prod: 'yawelo-idle.shyden.co.uk',
    dev: 'dev.yawelo-idle.shyden.co.uk',
  },
] as const;

export type Product = (typeof PRODUCTS)[number];

/**
 * Every link on the homepage that leaves this site for `product` points at
 * `host` (#338, widened to Yawelo Idle by #403).
 *
 * One home for dev-sanity and prod-sanity, which assert the two halves of the
 * same cross-environment rule: each product's build variable points dev at the
 * dev host and production at the production host, and neither may leak into
 * the other. The two bodies were 94.5% identical when each carried its own
 * copy, and 91.3% while each still did its own navigation, which
 * `duplication.test.ts` refused both times; the navigation lives here for
 * that reason.
 *
 * Selection is by the RESOLVED host, never by the `href` attribute's text.
 * prod-sanity once took the first `a[href*="shytalk"]`, and when the header
 * gained its in-page `/#shytalk` anchor that became the first match — a link
 * that never leaves the site, so the test failed before it read an outbound
 * link at all. `el.href` is always absolute, and a fragment on this site
 * resolves to this site's own host, which never names a product. dev-sanity's
 * selector, `a[href*="shytalk.shyden.co.uk"]`, had the opposite hole: it could
 * not see a link to any other ShyTalk host, which is the leak it exists for.
 *
 * Hosts are READ, never fetched: the production Yawelo Idle host has no DNS
 * record yet, by the operator's choice (2026-10-04, #403), and nothing here
 * depends on it resolving.
 *
 * DERIVED, not pinned to a count. dev-sanity once read `toHaveCount(1)` on the
 * dev URL; the Aurora merge added a hero call-to-action, the count became 2,
 * and the guard reddened the dev deploy on a legitimate design change (run
 * 34678649630) — while `toHaveCount(0)` on the other environment's URL, the
 * assertion that actually protects against a leak, never ran, because a test
 * stops at its first failed expectation.
 */
export async function expectHomepageLinksAt(
  page: Page,
  product: Product,
  host: string,
): Promise<void> {
  await page.goto('/');
  const hosts = await outboundHosts(page, product);

  // `searched()` carries the LIVENESS CONTROL, the repo's recognised idiom
  // (#118). The assertion is an ABSENCE, so a page carrying no outbound link
  // to the product would satisfy it having measured nothing. Putting the
  // population inside the assertion makes that impossible, and `searched`
  // counts its members by CONTENT, not by entries.
  const wrongHost = hosts.filter((found) => found !== host);
  expect(
    searched(wrongHost, {
      of: hosts,
      what: `outbound ${product.name} links on the homepage`,
    }),
    `every outbound ${product.name} link on the homepage must point at ${host}; found ${JSON.stringify(wrongHost)} across ${hosts.length} link(s)`,
  ).toEqual([]);
}

async function outboundHosts(page: Page, product: Product): Promise<string[]> {
  const hosts = await page
    .locator('a[href]')
    .evaluateAll((els) =>
      els.map((el) => new URL((el as HTMLAnchorElement).href).host),
    );
  return hosts.filter((found) => found.includes(product.hostWord));
}
