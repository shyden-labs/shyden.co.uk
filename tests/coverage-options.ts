/**
 * What every Vitest suite measures under `--coverage`, once (#896).
 *
 * V8, branches included, over the code a change can touch: `src/`,
 * `scripts/`, `functions/` and everything under `tests/`, test and setup
 * files included, since tests are code (#912; Shyden 2026-10-22, every
 * project). Only type declarations are left out. Each suite writes
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
  `tests/**/*.${CODE}`,
  'vitest*.config.ts',
];
export const NOT_MEASURED = ['**/*.d.ts'];

/**
 * Every Playwright web server's command, prefixed (#913): the server builds
 * the site, which loads `src/` through Vite, code no Playwright run can
 * convert (the build is #914's). So nothing it starts writes raw coverage,
 * while the runner and workers that started it do.
 */
export const unmeasured = (command: string): string =>
  `unset NODE_V8_COVERAGE; ${command}`;

/** A measured set: the globs a file must match, then the globs it must not. */
export type Measure = {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
};

/**
 * What a Playwright run measures (#913): the shared set and the Playwright
 * configs. Its runner and workers load specs and e2e helpers, which the
 * shared set holds since #912.
 */
export const PLAYWRIGHT_MEASURE: Measure = {
  include: [...MEASURED, 'playwright*.config.ts'],
  exclude: NOT_MEASURED,
};

export const coverageFor = (suite: CoveredSuite) => ({
  // V8, through a module that hands Vitest's own hard-coded excludes (setup
  // and test files) over to NOT_MEASURED (#912).
  provider: 'custom' as const,
  customProviderModule: './tests/coverage-provider.mjs',
  reporter: ['json', 'lcovonly'],
  include: MEASURED,
  exclude: NOT_MEASURED,
  reportOnFailure: false,
  reportsDirectory: `coverage/${suite}`,
});
