import { LOCALES, isBetaLocale, type Locale } from '../src/lib/i18n/index';

/**
 * How many BETA badges a page in `locale` carries.
 *
 * The switcher's list names every language, the one being read included
 * (#329), and marks each unverified one there once. Its control marks the
 * language being read as well, when that language is itself unverified. So an
 * English page carries one badge per beta locale, and a beta locale's page one
 * more.
 *
 * The one home for this count. The browser suite checks it against the build
 * and the dev suite against the deployed site, and each once kept a copy: #329
 * changed the markup and one copy, the pull request's CI did not run the dev
 * suite then (it does since #335, as \`sanity-on-build\`), and the stale copy
 * failed the first deploy after the merge.
 *
 * An EXACT count, never "at least one": a marker painted on everything,
 * English included, would satisfy any weaker check while telling the visitor
 * nothing.
 */
export const expectedBadges = (locale: Locale): number =>
  LOCALES.filter(isBetaLocale).length + (isBetaLocale(locale) ? 1 : 0);
