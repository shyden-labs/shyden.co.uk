/**
 * What every Vitest suite measures under `--coverage`, once (#896).
 *
 * V8, branches included, over the code a change can touch: `src/`,
 * `scripts/`, `functions/` and the helpers directly under `tests/`. Tests
 * themselves and type declarations are left out by name. Each suite writes
 * its own report, and `scripts/coverage-merge.mjs` joins them. No report is
 * written for a run that failed, so a red run can never pass as measured.
 * The block is inert until a command passes `--coverage`.
 */
const CODE = '{ts,tsx,mts,cts,js,mjs,cjs}';

export type CoveredSuite = 'unit' | 'simulation' | 'integration';

/**
 * The measured set, shared with `scripts/coverage-processes.mjs` (#899), so
 * code a child process runs is judged by the same globs as Vitest's own.
 */
export const MEASURED = [
  `src/**/*.${CODE}`,
  `scripts/**/*.${CODE}`,
  `functions/**/*.${CODE}`,
  `tests/*.${CODE}`,
];
export const NOT_MEASURED = ['**/*.d.ts', '**/*.test.ts', '**/*.spec.ts'];

export const coverageFor = (suite: CoveredSuite) => ({
  provider: 'v8' as const,
  reporter: ['json', 'lcovonly'],
  include: MEASURED,
  exclude: NOT_MEASURED,
  reportOnFailure: false,
  reportsDirectory: `coverage/${suite}`,
});
