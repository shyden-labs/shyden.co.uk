import { expect } from '@playwright/test';
import { LOCALES, localisePath } from '../src/lib/i18n';

/**
 * The page that moved (#635): each old address and where it must land. One
 * home for the dev and prod sanity suites, so the two cannot disagree. The
 * redirect is `functions/_middleware.js`, which a preview of `dist/` never
 * runs, so only the deployed sites can answer it.
 */
export const LEGACY_REDIRECTS: readonly (readonly [string, string])[] =
  // Every locale, derived: a hand-written pair of samples would miss the
  // prefix that breaks.
  LOCALES.map((locale): readonly [string, string] => [
    localisePath('/glory-points', locale),
    `${localisePath('/yeetalk-calculators', locale)}#glory-points`,
  ]);

/** A permanent redirect to exactly `to`: status AND target, whole. */
export function expectMovedTo(
  status: number,
  location: string | null,
  to: string,
): void {
  expect(status).toBe(301);
  expect(location).toBe(to);
}
