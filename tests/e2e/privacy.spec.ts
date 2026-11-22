import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { getSiteStrings, localisePath } from '../../src/lib/i18n/index';
import {
  PRIVACY_EN,
  PRIVACY_ID,
  legalTexts,
  type LegalDocument,
} from '../../src/lib/legal/privacy';
import { tapOn } from '../real-touch';

/**
 * The privacy page (#1080) in English, Shyden's approved words of
 * 2026-11-22, and in Indonesian (#1082), which governs for residents of
 * Indonesia. The two are hreflang alternates of each other and of nothing
 * else, both indexed, and both send requests to the support page alone. The
 * footer link every page carries is the page walk's check,
 * `checks/privacy-link.ts`.
 */

const ORIGIN = 'https://shyden.co.uk';
const PAIR = [
  { hreflang: 'en', href: `${ORIGIN}/privacy/` },
  { hreflang: 'id', href: `${ORIGIN}/id/privacy/` },
  { hreflang: 'x-default', href: `${ORIGIN}/privacy/` },
];

async function expectDocument(
  page: Page,
  path: string,
  lang: 'en' | 'id',
  doc: LegalDocument,
  links: { support: string; other: string },
) {
  await page.goto(path);
  const main = page.locator('main');
  await expect.soft(page.locator('html')).toHaveAttribute('lang', lang);
  await expect.soft(page).toHaveTitle(doc.title);
  await expect
    .soft(main.getByRole('heading', { level: 1 }))
    .toHaveText(doc.heading);
  await expect
    .soft(main.getByRole('heading', { level: 2 }))
    .toHaveText(doc.sections.map(({ heading }) => heading));
  await expect.soft(main).toContainText(doc.updated);
  for (const line of legalTexts(doc))
    await expect.soft(main, line).toContainText(line);

  await expect
    .soft(page.locator('link[rel="canonical"]'))
    .toHaveAttribute('href', `${ORIGIN}${path}`);
  await expect.soft(page.locator('meta[name="robots"]')).toHaveCount(0);
  const alternates = await page
    .locator('link[rel="alternate"][hreflang]')
    .evaluateAll((els) =>
      els.map((el) => ({
        hreflang: el.getAttribute('hreflang'),
        href: el.getAttribute('href'),
      })),
    );
  expect.soft(alternates, `${path} alternates`).toEqual(PAIR);
  await expect.soft(page.locator('header [hreflang]')).toHaveCount(0);

  await expect.soft(main.locator(`a[href="${links.support}"]`)).toHaveCount(2);
  await expect.soft(main.locator(`a[href="${links.other}"]`)).toHaveCount(1);
  await expect
    .soft(main.locator('a[href="https://www.cloudflare.com/privacypolicy/"]'))
    .toHaveCount(1);
  // Shyden, 2026-11-11: requests go through the support page, never an email.
  await expect.soft(main.locator('a[href^="mailto:"]')).toHaveCount(0);
}

test('/privacy/ shows every approved line, in English, paired with the Indonesian page alone', async ({
  page,
}) => {
  await expectDocument(page, '/privacy/', 'en', PRIVACY_EN, {
    support: '/support',
    other: '/id/privacy/',
  });
});

test('/id/privacy/ shows every line in Indonesian, paired with the English page alone', async ({
  page,
}) => {
  await expectDocument(page, '/id/privacy/', 'id', PRIVACY_ID, {
    support: '/id/support',
    other: '/privacy/',
  });
});

test('the sitemap lists the two privacy pages as each other’s alternates, and no other locale serves one', async ({
  page,
}) => {
  const sitemap = await (await page.request.get('/sitemap-0.xml')).text();
  const urls = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(
    ([, body]) => body,
  );
  expect(urls.length).toBeGreaterThan(0);
  const privacy = urls
    .filter((body) => body.includes('privacy'))
    .map((body) => ({
      loc: /<loc>([^<]*)<\/loc>/.exec(body)?.[1],
      alternates: [
        ...body.matchAll(/hreflang="([^"]+)"\s+href="([^"]+)"/g),
      ].map(([, lang, href]) => `${lang} ${href}`),
    }));
  const pair = [`en-GB ${ORIGIN}/privacy/`, `id-ID ${ORIGIN}/id/privacy/`];
  expect(privacy).toEqual([
    { loc: `${ORIGIN}/id/privacy/`, alternates: pair },
    { loc: `${ORIGIN}/privacy/`, alternates: pair },
  ]);
  for (const locale of ['zh', 'vi', 'th'] as const) {
    const path = localisePath('/privacy/', locale);
    expect.soft((await page.request.get(path)).status(), path).toBe(404);
  }
});

test("from the Indonesian homepage, the footer's privacy link leads to the Indonesian page", async ({
  page,
}) => {
  const t = getSiteStrings('id').legal;
  await page.goto(localisePath('/', 'id'));
  const footer = page.locator('footer');
  await expect.soft(footer.locator('[data-english-only]')).toHaveCount(0);
  await tapOn(footer.getByRole('link', { name: t.privacy, exact: true }));
  await expect(page).toHaveURL(/\/id\/privacy\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    PRIVACY_ID.heading,
  );
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
