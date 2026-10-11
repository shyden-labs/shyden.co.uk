import { defineConfig } from 'vitest/config';
import unit from './vitest.config';
import { SHARED_SETUP } from './tests/setup-files';

/**
 * The simulation suite (#650): every test whose real case is a run of the
 * engine over many seeded inputs (a sweep over class sizes, modes and seeds),
 * too dear for the unit suite's 1 s and 0.3 s of CPU.
 *
 * The unit suite keeps a stand-in of each sweep that meets its limits; the real
 * run lives here (global rule: a cut never drops a real run, it moves). The
 * two share the repo's setup files. There is NO time limit in this file: the
 * suite's one measured limit is on the command that runs it
 * (`npm run test:simulation`), pinned by
 * `tests/unit/suite-budgets.test.ts`.
 */
export default defineConfig({
  test: {
    include: ['tests/simulation/**/*.test.ts'],
    setupFiles: [...SHARED_SETUP],
    globalSetup: unit.test?.globalSetup,
  },
});
