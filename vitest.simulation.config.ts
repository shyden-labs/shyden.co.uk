import './tests/main-coverage.ts';
import { defineConfig } from 'vitest/config';
import LoadReporter from './tests/load-reporter.ts';
import unit from './vitest.config.ts';
import { LOAD_SETUP, SHARED_SETUP } from './tests/setup-files.ts';
import { coverageFor } from './tests/coverage-options.ts';

/**
 * The simulation suite (#650): every test whose real case is a run of the
 * engine over many seeded inputs (a sweep over class sizes, modes and seeds),
 * too dear for the unit suite's 1 s and 0.1 s of CPU.
 *
 * The unit suite keeps a stand-in of each sweep that meets its limits; the real
 * run lives here (global rule: a cut never drops a real run, it moves). The
 * two share the repo's setup files. There is NO time limit in this file: the
 * suite's one measured limit is on the command that runs it
 * (`npm run test:simulation`), pinned by
 * `tests/unit/suite-budgets.test.ts`. The coverage run of this suite
 * (`npm run test:coverage:simulation`) sets no limit: instrumentation took
 * sweep cases past 700 ms, so there the limit timed V8, not the engine (#916).
 */
export default defineConfig({
  test: {
    include: ['tests/simulation/**/*.test.ts'],
    // The shared setup, then the measurement of loading each file (#696):
    // reported by the reporter below, not limited, since a limit for this
    // suite's loading is the operator's to set from those figures.
    setupFiles: [...SHARED_SETUP, LOAD_SETUP],
    // The verbose listing its command once named (a reporter on the command
    // line replaces this whole list), then what loading each file cost.
    reporters: ['verbose', new LoadReporter({ suite: 'simulation' })],
    globalSetup: unit.test?.globalSetup,
    // Inert until a command passes --coverage (#896).
    coverage: coverageFor('simulation'),
  },
});
