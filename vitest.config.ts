import { defineConfig } from 'vitest/config';
import { SHARED_SETUP, UNIT_ONLY_SETUP } from './tests/setup-files';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // In every worker: forget the repository the run was handed, so no git
    // process a test starts can act on it (#377), and refuse a worker whose
    // TMPDIR is not the run's own (#390 F56); then, for the unit suite alone,
    // refuse every process and every connection off this machine and check
    // each test's own CPU (#632).
    setupFiles: [...UNIT_ONLY_SETUP, ...SHARED_SETUP],
    // A temporary directory of the run's own: anything a test leaves in it
    // fails the run, and it is removed either way (#390 F56). Then the run's
    // one reading of the tree, which every test reads in place of starting git
    // (#631); it must come second, into that directory.
    globalSetup: ['tests/temporary-files.ts', 'tests/tree-reading-setup.ts'],
    // One second a test and a hook, never raised (#632): a unit test that
    // needs more has its work cut. Wall time stretches under load, so
    // `tests/unit-cpu-setup.ts` also fails a test whose own CPU passes 1 s.
    // Pinned by tests/unit/unit-budget.test.ts, and any raise is refused by
    // tests/guards/unit-limit.test.ts.
    testTimeout: 1_000,
    hookTimeout: 1_000,
    // Each worker a process of its own, its tests on its main thread: the
    // ground the CPU check and the refusals were measured on (#632).
    pool: 'forks',
  },
});
