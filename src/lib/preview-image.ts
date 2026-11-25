/**
 * Link previews (#1158). When a link to this site is pasted into Facebook,
 * WhatsApp or X, the app shows the page's `og:image`. Shyden ruled
 * (2026-11-14) that it is a picture of that page: a screenshot of the top of
 * each page in each language, captured by `scripts/capture-previews.mjs` from
 * the built site and committed under `public/previews/`. The placeholder it
 * replaces was one flat green rectangle, unchanged since the first commit.
 */
// Leaf import with its extension, so `scripts/capture-previews.mjs` can load
// this file under plain Node as well as under Astro and Vitest.
import { DEFAULT_LOCALE, LOCALES, type Locale } from './i18n/locales.ts';

/** The size Facebook recommends for a large preview, and the capture's viewport. */
export const PREVIEW_WIDTH = 1200;
export const PREVIEW_HEIGHT = 630;

/** Every published page with a preview, as its English path. */
export const PREVIEW_PAGES = [
  '/',
  '/classroom-groups/',
  '/yeetalk-calculators/',
] as const;

/** Where a page's preview lives, from the page's own path. */
export function previewImageFor(pathname: string): string {
  const prefix = /^\/([^/]+)(?=\/|$)/.exec(pathname)?.[1];
  const locale = LOCALES.find((code) => code === prefix) ?? DEFAULT_LOCALE;
  const rest = pathname
    .replace(new RegExp(`^/${locale}(?=/|$)`), '')
    .replace(/^\/+|\/+$/g, '');
  return `/previews/${locale}/${rest || 'home'}.png`;
}

/** Every preview file the site serves, one per page per locale. */
export const PREVIEW_IMAGES: readonly string[] = LOCALES.flatMap((locale) =>
  PREVIEW_PAGES.map((page) =>
    previewImageFor(locale === 'en' ? page : `/${locale}${page}`),
  ),
);

/**
 * The preview a page's <head> names: its own when it has one, otherwise its
 * language's homepage (the 404 page in every language, the API docs).
 */
export function linkPreviewFor(pathname: string, locale: Locale): string {
  const own = previewImageFor(pathname);
  return PREVIEW_IMAGES.includes(own) ? own : `/previews/${locale}/home.png`;
}
