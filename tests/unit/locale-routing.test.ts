import { describe, it, expect } from 'vitest';
import { sitePaths } from '../site-pages';
import {
  LOCALES,
  localisePath,
  localeFromPath,
  type Locale,
} from '../../src/lib/i18n/index';

/**
 * Locale routing works for every locale in LOCALES, not just the two we ship.
 *
 * `localisePath` and `localeFromPath` were written when `id` was the only
 * prefixed locale, and both hardcode that literal: the strip is
 * `/^\/id(?=\/|$)/` and the match is `/^\/id(\/|$)/`. Neither is a bug while
 * LOCALES has two entries. Both become bugs the moment it has three, and they
 * fail QUIETLY — `localisePath('/zh/glory-points', 'en')` hands back
 * `/zh/glory-points` unchanged, so the English link on a Chinese page points at
 * the Chinese page and every test that only ever passes `id` still goes green.
 *
 * That is why every case below is DERIVED from LOCALES. A hand-written list of
 * locales would have to be extended by the same person who forgot to
 * generalise the helper — which is precisely the person these tests exist to
 * catch. #22 adds zh, vi and th; nothing in this file should need editing.
 *
 * The route layout is the contract these assert against: English is unprefixed
 * and lives at `/`, every other locale lives under `/<code>`. That is stated
 * once here and mirrored from `src/pages/`.
 */

/** Locales that carry a URL prefix — everything except the default. */
const PREFIXED = LOCALES.filter((l) => l !== 'en');

/** Where a path lives in a locale, per the route layout. */
const urlFor = (path: string, locale: Locale) =>
  locale === 'en' ? path : `/${locale}${path === '/' ? '/' : path}`;

const PATHS = sitePaths();

describe('locale routing generalises across every shipped locale', () => {
  it('places every path in every locale per the route layout', () => {
    for (const locale of LOCALES) {
      for (const path of PATHS) {
        expect(localisePath(path, locale), `${path} in ${locale}`).toBe(
          urlFor(path, locale),
        );
      }
    }
  });

  it('switches between any two locales without stranding the prefix', () => {
    // The classic i18n bug is a switcher that leaves the old prefix in place,
    // so /zh/glory-points "switched to English" stays Chinese. Every ordered
    // pair is checked, not just pairs involving English.
    for (const from of LOCALES) {
      for (const to of LOCALES) {
        for (const path of PATHS) {
          expect(
            localisePath(urlFor(path, from), to),
            `${path}: ${from} -> ${to}`,
          ).toBe(urlFor(path, to));
        }
      }
    }
  });

  it('switching to the same locale is a no-op', () => {
    for (const locale of LOCALES) {
      for (const path of PATHS) {
        const url = urlFor(path, locale);
        expect(localisePath(url, locale), `${url} in ${locale}`).toBe(url);
      }
    }
  });

  it('recognises the locale of every localised path', () => {
    for (const locale of LOCALES) {
      for (const path of PATHS) {
        expect(
          localeFromPath(urlFor(path, locale)),
          `${urlFor(path, locale)}`,
        ).toBe(locale);
      }
    }
  });

  it('does not mistake a path that merely starts with a locale code', () => {
    // `/idea` begins with "id" but is not Indonesian, and `/identity-check`
    // would be silently rerouted by a prefix match that forgets the boundary.
    for (const locale of PREFIXED) {
      const decoy = `/${locale}entity-check`;
      expect(localeFromPath(decoy), decoy).toBe('en');
      expect(localisePath(decoy, 'en'), decoy).toBe(decoy);
    }
  });

  it('round-trips through every locale back to the original', () => {
    for (const path of PATHS) {
      let url = path;
      for (const locale of LOCALES) url = localisePath(url, locale);
      expect(localisePath(url, 'en'), path).toBe(path);
    }
  });
});
