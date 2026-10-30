import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutTsComments } from './source-text';
import { LOCALES } from '../../src/lib/i18n/index';
import { LOCALE_METADATA } from '../../src/lib/i18n/metadata';

/**
 * The sitemap's locale map, which cannot import the table it must agree with.
 *
 * `@astrojs/sitemap` reads its OWN i18n option, and `astro.config.mjs` runs
 * under plain Node and cannot import `src/lib/i18n`. So the list is written
 * out a second time -- and that duplication is exactly what went wrong: it
 * said en+id for weeks after #22 shipped five languages, so nine of fifteen
 * URLs declared no `xhtml:link` alternates at all. The e2e guard that should
 * have caught it named the same two locales by hand and passed. **Two
 * hand-written lists agreeing with each other is not a check.**
 *
 * The import cannot be fixed, so the SEAM is asserted instead -- the pattern
 * `pipeline-wiring.test.ts` already uses for workflow files.
 *
 * READ OVER COMMENT-STRIPPED SOURCE, and that is not a formality here: the
 * config's own comment above the map explains what the values are, and this
 * file's docblock names several. A guard matched against raw text would be
 * satisfied by documentation while the config said something else -- the #23
 * defect, which has now shipped in four repos. Mutation-verified below by
 * commenting the real entry out and watching it stay red.
 */

const CONFIG = 'astro.config.mjs';

/** `en_GB` -> `en-GB`. One transformation, so no second table exists. */
const hreflangOf = (locale: (typeof LOCALES)[number]) =>
  LOCALE_METADATA[locale].ogLocale.replace('_', '-');

/** The `locales: { … }` map passed to the sitemap integration. */
const sitemapLocales = (): Record<string, string> => {
  const source = withoutTsComments(readFileSync(CONFIG, 'utf8'));
  const block = /sitemap\(\s*\{[\s\S]*?locales:\s*\{([\s\S]*?)\}/.exec(source);
  if (!block) throw new Error(`${CONFIG}: no sitemap locales map found`);
  const entries = [...block[1].matchAll(/([A-Za-z-]+)\s*:\s*'([^']+)'/g)];
  return Object.fromEntries(entries.map((m) => [m[1], m[2]]));
};

describe('the sitemap declares every locale the site serves', () => {
  it('is the only locale list the config writes out', () => {
    // Astro's own `i18n` block listed en and id long after #22 shipped five,
    // and nothing read it: the site localises paths itself, and the build was
    // byte-identical with it, without it and with all five (61 files,
    // measured 2026-10-01). It is gone, so no second hand-written list can go
    // stale beside the one this file checks (#390).
    const source = withoutTsComments(readFileSync(CONFIG, 'utf8'));
    expect(source.match(/\blocales\s*:/g)).toEqual(['locales:']);
  });

  it('maps exactly the locales in LOCALES, with no extras', () => {
    expect(Object.keys(sitemapLocales()).sort()).toEqual([...LOCALES].sort());
  });

  it('uses the hreflang LOCALE_METADATA defines for each', () => {
    const configured = sitemapLocales();
    const expected = Object.fromEntries(
      LOCALES.map((locale) => [locale, hreflangOf(locale)]),
    );
    expect(configured).toEqual(expected);
  });

  it('finds a real map, not an empty one', () => {
    // A regex that stopped matching would hand every assertion above an empty
    // object, and `{} === {}` is a pass for a check phrased as "no extras".
    // #84: a guard handed an empty list asserts nothing at all.
    expect(Object.keys(sitemapLocales()).length).toBeGreaterThan(0);
  });
});
