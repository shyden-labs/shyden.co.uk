/**
 * The locales the site serves, in a module of their own.
 *
 * Separate from `index.ts` so that `metadata.ts` and `index.ts` can both
 * depend on these without depending on each other: `getStrings` reads
 * `LOCALE_METADATA` for the `Intl` tag its messages format with (#136), and
 * `metadata.ts` falls back to `DEFAULT_LOCALE`. `index.ts` re-exports all
 * three, so no importer changes.
 */

/** English first: it is the default and lives at the unprefixed route. */
export const LOCALES = ['en', 'id', 'zh', 'vi', 'th'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * The locale served without a URL prefix, by construction the first in LOCALES.
 *
 * Named rather than written as the literal `'en'` in six places: the default
 * being English is a routing decision, not a fact about the English language,
 * and every `=== 'en'` was a place a reader had to infer that.
 */
export const DEFAULT_LOCALE: Locale = LOCALES[0];
