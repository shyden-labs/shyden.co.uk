import { defineConfig } from 'vitest/config';
import unit from './vitest.config.ts';
import { SHARED_SETUP } from './tests/setup-files.ts';

/**
 * The integration suite (#630): every test that starts a process (a script run
 * as a script, a git scratch repository, a shell hook, a native tool).
 *
 * The unit suite starts none. The two share the repo's setup files, so a
 * process here is as isolated from the checkout as one was there. There is NO
 * time limit in this file: the suite's one measured limit is on the command
 * that runs it (`npm run test:integration`), pinned by
 * `tests/unit/suite-budgets.test.ts`.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
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
