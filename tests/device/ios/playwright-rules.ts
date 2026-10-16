/**
 * Playwright's own text rules, as source the page runs (#821). Every iPhone
 * reader that stands in for a Playwright locator or assertion reads text and
 * names through these, so a mirror cannot read a page more loosely, or more
 * strictly, than its Android twin. Each is a self-contained function
 * expression: the readers splice it into the script they send to Safari, and
 * `tests/unit/ios-playwright-rules.test.ts` runs the same text in a fresh
 * context.
 */

/**
 * Playwright's `normalizeWhiteSpace` (playwright-core): zero-width spaces and
 * soft hyphens dropped, the ends trimmed, every run of whitespace one space.
 * `toHaveText`, `toContainText`, `getByText` and accessible names all read
 * text through it.
 */
export const NORMALISE_SOURCE = String.raw`(s) => (s ?? '').replace(/[\u200b\u00ad]/g, '').trim().replace(/\s+/g, ' ')`;

/**
 * Playwright's name match for `getByRole`, `getByLabel` and `getByText`, on
 * two normalised strings: with `exact`, the whole name, case included;
 * without it, any part of the name, ignoring case.
 */
export const NAME_MATCHES_SOURCE = String.raw`(actual, wanted, exact) => exact ? actual === wanted : actual.toLowerCase().includes(wanted.toLowerCase())`;
