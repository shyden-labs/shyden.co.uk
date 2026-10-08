import { defineConfig } from 'vitest/config';
import unit from './vitest.config';

/**
 * The integration suite (#630): every test that starts a process (a script run
 * as a script, a git scratch repository, a shell hook, a native tool).
 *
 * The unit suite starts none. The two share the repo's setup files, so a
 * process here is as isolated from the checkout as one was there. There is NO
 * time limit in this file: the suite's one measured limit is on the command
 * that runs it (`npm run test:integration`), pinned by
 * `tests/unit/integration-budget.test.ts`.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: unit.test?.setupFiles,
    globalSetup: unit.test?.globalSetup,
  },
});
