import { expect } from '../fixtures';
import { LOCALES, localeFromPath } from '../../../src/lib/i18n/index';
import {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  linkPreviewFor,
} from '../../../src/lib/preview-image';
import { docsPaths } from '../../site-pages';
import { NOT_FOUND_PATH, PUBLISHED_ROUTES } from '../published-paths';
import { DEFAULT_THEME, type PageCheck } from '../page-checks';

/**
 * What a page's <head> declares, read on its walk (#1086). Moved from
 * smoke.spec.ts, seo.spec.ts, head-and-sitemap.spec.ts and site-meta.spec.ts,
 * each of which opened the page again to read it.
 */

/**
 * The viewport every page has to declare, as `BaseLayout.astro` does.
 *
 * Without it a mobile browser lays the page out at a legacy desktop width
 * (980px on the Android phone, measured on `about:blank`, which has no tag),
 * and the visitor sees every page zoomed out. No test asserted it before #233.
 *
 * `interactive-widget=resizes-content` (#807, operator 2026-10-18): Android
 * Chrome's keyboard otherwise covers the bottom of the page without shrinking
 * it, and `/classroom-groups`' docked Make Groups bar sat hidden behind the
 * keyboard while a teacher typed (bar at 703 px, 471 px left visible, measured
 * on the phone). Safari ignores the key.
 */
const DEVICE_WIDTH =
  'width=device-width, initial-scale=1, interactive-widget=resizes-content';

export const HEAD_CHECKS: readonly PageCheck[] = [
  {
    // smoke.spec.ts
    name: 'homepage responds with the Shyden title',
    routes: () => ['/'],
    themes: [DEFAULT_THEME],
    run: async ({ page }) => {
      await expect.soft(page).toHaveTitle(/Shyden/);
    },
  },
  {
    // seo.spec.ts
    name: 'homepage SEO head: has title, meta description, canonical and Open Graph',
    routes: () => ['/'],
    themes: [DEFAULT_THEME],
    run: async ({ page }) => {
      await expect.soft(page).toHaveTitle(/Shyden/);
      await expect
        .soft(page.locator('meta[name="description"]'))
        .toHaveAttribute('content', /.{20,}/);
      await expect.soft(page.locator('link[rel="canonical"]')).toHaveCount(1);
      await expect
        .soft(page.locator('link[rel="canonical"]'))
        .toHaveAttribute('href', 'https://shyden.co.uk/');
      await expect
        .soft(page.locator('meta[property="og:title"]'))
        .toHaveCount(1);
      await expect
        .soft(page.locator('meta[property="og:type"]'))
        .toHaveAttribute('content', 'website');
      await expect
        .soft(page.locator('meta[property="og:url"]'))
        .toHaveAttribute('content', 'https://shyden.co.uk/');
      await expect
        .soft(page.locator('meta[property="og:image"]'))
        .toHaveAttribute(
          'content',
          'https://shyden.co.uk/previews/en/home.png',
        );
      await expect
        .soft(page.locator('meta[name="twitter:card"]'))
        .toHaveAttribute('content', 'summary_large_image');
    },
  },
  {
    // #1158: a pasted link shows a picture of the page it opens, not the
    // flat green placeholder every page named before.
    name: 'names a link preview of this page, which the site serves',
    routes: () => PUBLISHED_ROUTES,
    themes: [DEFAULT_THEME],
    run: async ({ page, route }) => {
      const image = linkPreviewFor(route, localeFromPath(route));
      await expect
        .soft(page.locator('meta[property="og:image"]'))
        .toHaveAttribute('content', `https://shyden.co.uk${image}`);
      await expect
        .soft(page.locator('meta[property="og:image:width"]'))
        .toHaveAttribute('content', String(PREVIEW_WIDTH));
      await expect
        .soft(page.locator('meta[property="og:image:height"]'))
        .toHaveAttribute('content', String(PREVIEW_HEIGHT));
      await expect
        .soft(page.locator('meta[property="og:image:alt"]'))
        .toHaveAttribute('content', /\S/);
      const served = await page.request.get(image);
      expect.soft(served.status(), `${image} is served`).toBe(200);
      expect.soft(served.headers()['content-type']).toBe('image/png');
    },
  },
  {
    // head-and-sitemap.spec.ts, 'the API docs head (#781)'
    name: 'asks not to be indexed, and claims no other language',
    routes: () => docsPaths(),
    themes: [DEFAULT_THEME],
    run: async ({ page }) => {
      await expect
        .soft(page.locator('meta[name="robots"]'))
        .toHaveAttribute('content', 'noindex');
      await expect.soft(page.locator('link[rel="alternate"]')).toHaveCount(0);
      await expect.soft(page.locator('html')).toHaveAttribute('lang', 'en');
    },
  },
  {
    // head-and-sitemap.spec.ts, 'the 404 head'
    name: 'the 404 head asks not to be indexed, and points nowhere that does not exist',
    routes: () => [NOT_FOUND_PATH],
    themes: [DEFAULT_THEME],
    run: async ({ page }) => {
      await expect
        .soft(page.locator('meta[name="robots"]'))
        .toHaveAttribute('content', 'noindex');
      // Cloudflare serves this one file for ANY unknown path, so it has no URL
      // of its own to be canonical about. It used to declare
      // canonical=/404/ and hreflang=id → /id/404/, neither of which is a page.
      await expect.soft(page.locator('link[rel="canonical"]')).toHaveCount(0);
      await expect.soft(page.locator('link[rel="alternate"]')).toHaveCount(0);
      await expect.soft(page.locator('meta[property="og:url"]')).toHaveCount(0);
    },
  },
  {
    // head-and-sitemap.spec.ts, 'the 404 head'
    name: 'real pages still declare theirs',
    routes: () => ['/classroom-groups'],
    themes: [DEFAULT_THEME],
    run: async ({ page }) => {
      // The opt-out must not have leaked into every other page.
      await expect.soft(page.locator('meta[name="robots"]')).toHaveCount(0);
      await expect.soft(page.locator('link[rel="canonical"]')).toHaveCount(1);
      // One per locale plus `x-default`, derived: this read 3 while the site
      // shipped two languages, and 3 is not a fact about the page.
      await expect
        .soft(page.locator('link[rel="alternate"]'))
        .toHaveCount(LOCALES.length + 1);
    },
  },
  {
    // head-and-sitemap.spec.ts, 'every published page'
    name: 'declares exactly one viewport, at the device width',
    routes: () => PUBLISHED_ROUTES,
    themes: [DEFAULT_THEME],
    run: async ({ page }) => {
      // `i`: HTML compares meta names without regard to case, so a second tag
      // spelled `Viewport` is still a second viewport.
      const contents = await page
        .locator('meta[name="viewport" i]')
        .evaluateAll((metas) =>
          metas.map((meta) => meta.getAttribute('content')),
        );
      expect.soft(contents).toEqual([DEVICE_WIDTH]);
    },
  },
  {
    // site-meta.spec.ts. It read '/no-such-page-xyz'; the 404 answers every
    // unknown path with the same page, so the walk's own unknown path is read.
    name: 'custom 404 renders branded not-found copy',
    routes: () => [NOT_FOUND_PATH],
    themes: [DEFAULT_THEME],
    run: async ({ page, response }) => {
      expect.soft(response?.status()).toBe(404);
      await expect.soft(page.locator('h1')).toContainText(/not found/i);
      await expect.soft(page.locator('main a[href="/"]')).toBeVisible();
    },
  },
];
