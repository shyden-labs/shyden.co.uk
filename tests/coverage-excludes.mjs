/**
 * Tests are code (Shyden 2026-10-22, every project), but Vitest adds its own
 * excludes to every coverage run (each setup file, the test include patterns,
 * the config) and calls them impossible to override. This wraps a V8
 * provider's `initialize` so that, once Vitest has resolved its options, the
 * exclude list is ours alone, and the matchers and the per-file verdicts it
 * built from Vitest's list are forgotten (#912). Measured in a throwaway
 * project: the wrapped provider reported a test file and a setup file that the
 * plain one left out.
 *
 * It reaches two internal fields of `@vitest/coverage-v8` 5.0.x's provider
 * (`options.exclude`, `globMatchers`), so a Vitest upgrade that renames either
 * stops the run here, naming the field, rather than quietly measuring less.
 * `tests/unit/coverage-excludes.test.ts` holds it; `coverage-provider.mjs`
 * applies it.
 */

/**
 * @template {{ initialize(ctx: unknown): unknown }} P
 * @param {P} provider
 * @param {readonly string[]} exclude
 * @returns {P}
 */
export const withOnlyOurExcludes = (provider, exclude) => {
  const initialize = provider.initialize.bind(provider);
  provider.initialize = (ctx) => {
    const result = initialize(ctx);
    const fields = /** @type {Record<string, unknown>} */ (
      /** @type {unknown} */ (provider)
    );
    const options = /** @type {{ exclude?: unknown }} */ (fields.options ?? {});
    if (!Array.isArray(options.exclude))
      throw new Error(
        'coverage-excludes: the V8 provider has no options.exclude array after initialize; a Vitest upgrade changed it, so re-check tests/coverage-excludes.mjs',
      );
    if (!('globMatchers' in fields))
      throw new Error(
        'coverage-excludes: the V8 provider has no globMatchers field after initialize; a Vitest upgrade changed it, so re-check tests/coverage-excludes.mjs',
      );
    options.exclude = [...exclude];
    fields.globMatchers = undefined;
    if (fields.globCache instanceof Map) fields.globCache.clear();
    return result;
  };
  return provider;
};

/**
 * The custom provider module Vitest loads for coverage, over `v8`, the
 * default export of `@vitest/coverage-v8` (#912). Every worker-side call goes
 * to `v8` itself rather than to a copy: Vitest loads a custom provider module
 * through its module runner, so a worker can evaluate it again between test
 * files, and coverage-v8 keeps its inspector session on its own object, which
 * Node loads once. A spread copy lost the session ("V8 provider missing
 * inspector session", 2026-10-21). The provider Vitest gets measures with
 * `exclude` alone.
 *
 * It refuses a coverage-v8 without the three worker-side methods, naming
 * them, rather than measure the workers with nothing.
 *
 * @param {import('vitest/node').CoverageProviderModule} v8
 * @param {readonly string[]} exclude
 * @returns {import('vitest/node').CoverageProviderModule}
 */
export const delegatingTo = (v8, exclude) => {
  const { startCoverage, takeCoverage, stopCoverage } = v8;
  if (!startCoverage || !takeCoverage || !stopCoverage)
    throw new Error(
      'coverage-excludes: @vitest/coverage-v8 has no startCoverage, takeCoverage or stopCoverage; a Vitest upgrade changed it, so re-check tests/coverage-excludes.mjs',
    );
  return {
    startCoverage: (options) => startCoverage.call(v8, options),
    takeCoverage: (options) => takeCoverage.call(v8, options),
    stopCoverage: (options) => stopCoverage.call(v8, options),
    getProvider: async () =>
      withOnlyOurExcludes(await v8.getProvider(), exclude),
  };
};
