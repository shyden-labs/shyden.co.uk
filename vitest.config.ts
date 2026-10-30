import './tests/main-coverage.ts';
import { defineConfig } from 'vitest/config';
import { SHARED_SETUP, UNIT_ONLY_SETUP } from './tests/setup-files.ts';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // In every worker: forget the repository the run was handed, so no git
    // process a test starts can act on it (#377), and refuse a worker whose
    // TMPDIR is not the run's own (#390 F56); then, for the unit suite alone,
    // refuse every process and every connection off this machine (#632).
    setupFiles: [...UNIT_ONLY_SETUP, ...SHARED_SETUP],
    // A temporary directory of the run's own: anything a test leaves in it
    // fails the run, and it is removed either way (#390 F56). Then the run's
    // one reading of the tree, which every test reads in place of starting git
    // (#631); it must come second, into that directory.
    globalSetup: ['tests/temporary-files.ts', 'tests/tree-reading-setup.ts'],
    // One second a test and a hook, never raised (#632).
    testTimeout: 1_000,
    hookTimeout: 1_000,
    pool: 'forks',
  },
});
