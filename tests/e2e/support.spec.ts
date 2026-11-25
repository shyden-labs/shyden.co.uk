import { test, expect } from './fixtures';
import {
  LOCALES,
  getSiteStrings,
  localisePath,
} from '../../src/lib/i18n/index';
import { SHYDESK_LIVE } from '../../src/lib/shydesk';

/**
 * The support page and the ticket page (#1032) carry ShyDesk's support piece
 * as ShyDesk's contract asks (shydesk `0a2abc8`, docs/embedding.md): one
 * classic, deferred `embed.js` from ShyDesk's own host, and one
 * `<shydesk-support>` naming this site's product. The e2e suite measures a
 * production build, which names live ShyDesk. The form itself draws in a
 * shadow DOM from ShyDesk's host; a real message through it is dev-sanity's
 * job, against dev ShyDesk.
 */
for (const locale of LOCALES) {
  const path = localisePath('/support', locale);
  test(`${path}: the heading, the line and ShyDesk's contact form, loaded from live ShyDesk`, async ({
    page,
  }) => {
    const strings = getSiteStrings(locale).support;
    await page.goto(path);
    await expect
      .soft(page.getByRole('heading', { level: 1 }))
      .toHaveText(strings.heading);
    await expect.soft(page.getByText(strings.intro)).toBeVisible();
    const piece = page.locator('shydesk-support');
    await expect.soft(piece).toHaveCount(1);
    await expect.soft(piece).toHaveAttribute('product', 'shyden-co-uk');
    await expect.soft(piece).toHaveAttribute('view', 'contact');
    await expect.soft(piece).toHaveAttribute('lang', locale);
    const script = page.locator('script[src$="/embed.js"]');
    await expect.soft(script).toHaveCount(1);
    await expect
      .soft(script)
      .toHaveAttribute('src', `${SHYDESK_LIVE}/embed.js`);
    expect.soft(await script.getAttribute('defer')).not.toBeNull();
    expect.soft(await script.getAttribute('type')).toBeNull();
  });
}

test("/support/ticket/: English, not indexed, out of the sitemap, with ShyDesk's ticket view", async ({
  page,
}) => {
  await page.goto('/support/ticket/');
  await expect
    .soft(page.getByRole('heading', { level: 1 }))
    .toHaveText('Your support conversation');
  await expect.soft(page).toHaveTitle('Your support conversation — Shyden');
  await expect.soft(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect
    .soft(page.locator('meta[name="robots"]'))
    .toHaveAttribute('content', 'noindex');
  const piece = page.locator('shydesk-support');
  await expect.soft(piece).toHaveCount(1);
  await expect.soft(piece).toHaveAttribute('product', 'shyden-co-uk');
  await expect.soft(piece).toHaveAttribute('view', 'ticket');
  await expect
    .soft(page.locator('script[src$="/embed.js"]'))
    .toHaveAttribute('src', `${SHYDESK_LIVE}/embed.js`);
  const sitemap = await (await page.request.get('/sitemap-0.xml')).text();
  expect.soft(sitemap).toContain('/support');
  expect.soft(sitemap).not.toContain('/support/ticket');
});
