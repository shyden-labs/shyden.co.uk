import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // In every worker: forget the repository the run was handed, so no git
    // process a test starts can act on it (#377), and refuse a worker whose
    // TMPDIR is not the run's own (#390 F56).
    setupFiles: ['tests/git-env-setup.ts', 'tests/temporary-files-setup.ts'],
    // A temporary directory of the run's own: anything a test leaves in it
    // fails the run, and it is removed either way (#390 F56). Then the run's
    // one reading of the tree, which every test reads in place of starting git
    // (#631); it must come second, into that directory.
    globalSetup: ['tests/temporary-files.ts', 'tests/tree-reading-setup.ts'],
    // Sized from the slowest test that spawns a process, never left at the
    // 5000ms default: `test-e2e.mjs refuses from this checkout` took 1.1s on a
    // laptop, 5.4s on the CI runner and up to 9.8s under load (#235). Pinned
    // by tests/unit/unit-budget.test.ts.
    testTimeout: 30_000,
  },
});
