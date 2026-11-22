import { test, expect } from './fixtures';
import { getSiteStrings, localisePath } from '../../src/lib/i18n/index';
import { PRIVACY_EN, legalTexts } from '../../src/lib/legal/privacy';
import { tapOn } from '../real-touch';

/**
 * The privacy page itself (#1080): English, Shyden's approved words of
 * 2026-11-22, indexed with no language alternates, and contacted through the
 * support page alone. The footer link every page carries is the page walk's
 * check, `checks/privacy-link.ts`.
 */
test('/privacy/ shows every approved line, in English, with no other language declared', async ({
  page,
}) => {
  await page.goto('/privacy/');
  const main = page.locator('main');
  await expect.soft(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect.soft(page).toHaveTitle(PRIVACY_EN.title);
  await expect
    .soft(main.getByRole('heading', { level: 1 }))
    .toHaveText(PRIVACY_EN.heading);
  await expect
    .soft(main.getByRole('heading', { level: 2 }))
    .toHaveText(PRIVACY_EN.sections.map(({ heading }) => heading));
  await expect.soft(main).toContainText(PRIVACY_EN.updated);
  for (const line of legalTexts(PRIVACY_EN))
    await expect.soft(main, line).toContainText(line);

  await expect
    .soft(page.locator('link[rel="canonical"]'))
    .toHaveAttribute('href', 'https://shyden.co.uk/privacy/');
  await expect.soft(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect.soft(page.locator('link[hreflang]')).toHaveCount(0);
  await expect.soft(page.locator('header [hreflang]')).toHaveCount(0);

  const support = main.getByRole('link', { name: 'support page', exact: true });
  await expect.soft(support).toHaveCount(2);
  for (const link of await support.all())
    await expect.soft(link).toHaveAttribute('href', '/support');
  await expect
    .soft(main.getByRole('link', { name: "Cloudflare's privacy policy" }))
    .toHaveAttribute('href', 'https://www.cloudflare.com/privacypolicy/');
  // Shyden, 2026-11-11: requests go through the support page, never an email.
  await expect.soft(main.locator('a[href^="mailto:"]')).toHaveCount(0);
});

test('the sitemap lists /privacy/ once, with no alternates, and no other locale serves it', async ({
  page,
}) => {
  const sitemap = await (await page.request.get('/sitemap-0.xml')).text();
  const urls = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(
    ([, body]) => body,
  );
  expect(urls.length).toBeGreaterThan(0);
  const privacy = urls.filter((body) => body.includes('privacy'));
  expect(privacy).toEqual([
    expect.stringContaining('<loc>https://shyden.co.uk/privacy/</loc>'),
  ]);
  expect.soft(privacy[0]).not.toContain('xhtml:link');
  for (const locale of ['id', 'zh', 'vi', 'th'] as const) {
    const path = localisePath('/privacy/', locale);
    expect.soft((await page.request.get(path)).status(), path).toBe(404);
  }
});

test("from the Thai homepage, the footer's privacy link leads to the English page", async ({
  page,
}) => {
  const t = getSiteStrings('th').legal;
  await page.goto(localisePath('/', 'th'));
  const footer = page.locator('footer');
  await expect
    .soft(footer.locator('[data-english-only]'))
    .toHaveText(t.englishOnly);
  await tapOn(footer.getByRole('link', { name: t.privacy, exact: true }));
  await expect(page).toHaveURL(/\/privacy\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    PRIVACY_EN.heading,
  );
});
