import { defineConfig } from 'vitest/config';
import unit from './vitest.config';

/**
 * The guards suite (#638): every test whose cost is reading or parsing the
 * whole tree to check a rule across it (a scan over every tracked file, every
 * spec, every catalogue).
 *
 * The unit suite holds tests that meet 1 s and 0.3 s of their own CPU; a guard
 * whose population is the repository cannot, and its cost is the tree, not a
 * defect to cut. The two share the repo's setup files. There is NO time limit
 * in this file: the suite's one measured limit is on the command that runs it
 * (`npm run test:guards`), pinned by `tests/unit/guards-budget.test.ts`.
 */
export default defineConfig({
  test: {
    include: ['tests/guards/**/*.test.ts'],
    setupFiles: unit.test?.setupFiles,
    globalSetup: unit.test?.globalSetup,
  },
});
