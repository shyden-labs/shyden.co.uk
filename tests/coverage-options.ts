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

export const coverageFor = (suite: CoveredSuite) => ({
  provider: 'v8' as const,
  reporter: ['json', 'lcovonly'],
  include: [
    `src/**/*.${CODE}`,
    `scripts/**/*.${CODE}`,
    `functions/**/*.${CODE}`,
    `tests/*.${CODE}`,
  ],
  exclude: ['**/*.d.ts', '**/*.test.ts', '**/*.spec.ts'],
  reportOnFailure: false,
  // Code a test runs in a process of its own (#899): Vitest hands each child
  // process and worker thread NODE_V8_COVERAGE and converts what they wrote
  // with its own transform. Measured 2026-10-21: a child's taken arm reads
  // run and its other arm unrun; without this, the child's file reads 0.
  autoAttachSubprocess: true,
  reportsDirectory: `coverage/${suite}`,
});
