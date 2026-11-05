/**
 * Whether a parsed value is a plain object whose keys can be read: not
 * `null`, and not an array, both of which `typeof` calls `'object'`.
 *
 * The one home for this check: `tests/workflow-jobs.ts` and
 * `scripts/e2e-shards.mjs` each held a copy when #349 was about to add a third.
 * Imports nothing, and is erasable TypeScript, so a script Node runs by
 * stripping types can import it as well as the site and the tests.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
