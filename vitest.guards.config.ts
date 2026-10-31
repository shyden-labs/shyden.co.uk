import { defineConfig } from 'vitest/config';
import unit from './vitest.config.ts';
import { SHARED_SETUP } from './tests/setup-files.ts';

/**
 * The guards suite (#638): every test whose cost is reading or parsing the
 * whole tree to check a rule across it (a scan over every tracked file, every
 * spec, every catalogue).
 *
 * The unit suite holds tests that meet 1 s and 0.1 s of their own CPU; a guard
 * whose population is the repository cannot, and its cost is the tree, not a
 * defect to cut. The two share the repo's setup files. There is NO time limit
 * in this file: the suite's one measured limit is on the command that runs it
 * (`npm run test:guards`), pinned by `tests/unit/suite-budgets.test.ts`.
 */
export default defineConfig({
  test: {
    include: ['tests/guards/**/*.test.ts'],
    // The shared setup, then the measurement of loading each file (#696):
    // reported by the reporter below, not limited, since a limit for this
    // suite's loading is the operator's to set from those figures.
    setupFiles: [...SHARED_SETUP],
    // The verbose listing its command once named (a reporter on the command
    // line replaces this whole list), then what loading each file cost.
    reporters: ['verbose'],
    globalSetup: unit.test?.globalSetup,
  },
});
