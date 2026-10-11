import { defineConfig } from 'vitest/config';
import { parserTestFiles } from './tests/parser-files.ts';
import {
  SHARED_SETUP,
  LOAD_SETUP,
  TYPESCRIPT_PRELOAD_SETUP,
  UNIT_LOAD_LIMIT_SETUP,
  UNIT_ONLY_SETUP,
} from './tests/setup-files.ts';

// The unit files that load the TypeScript parser, read from their imports
// (#688): ~135 ms of CPU to load it again in every isolated file.
const PARSER_FILES = parserTestFiles();

export default defineConfig({
  test: {
    // In every worker: forget the repository the run was handed, so no git
    // process a test starts can act on it (#377), and refuse a worker whose
    // TMPDIR is not the run's own (#390 F56); then, for the unit suite alone,
    // refuse every process and every connection off this machine and check
    // each test's own CPU (#632). Each project below adds its own after these.
    setupFiles: [...UNIT_ONLY_SETUP, ...SHARED_SETUP],
    // A temporary directory of the run's own: anything a test leaves in it
    // fails the run, and it is removed either way (#390 F56). Then the run's
    // one reading of the tree, which every test reads in place of starting git
    // (#631); it must come second, into that directory.
    globalSetup: ['tests/temporary-files.ts', 'tests/tree-reading-setup.ts'],
    // One second a test and a hook, never raised (#632): a unit test that
    // needs more has its work cut. Wall time stretches under load, so
    // `tests/unit-cpu-setup.ts` also fails a test whose own CPU passes 0.3 s.
    // Pinned by tests/unit/unit-budget.test.ts, and any raise is refused by
    // tests/guards/unit-limit.test.ts.
    testTimeout: 1_000,
    hookTimeout: 1_000,
    // Each worker a process of its own, its tests on its main thread: the
    // ground the CPU check and the refusals were measured on (#632).
    pool: 'forks',
    // The default reporter, then the own CPU of the heaviest tests, so every
    // run shows its headroom under the CPU limit (#645), then that of loading
    // the heaviest files (#688), from the reporter every suite shares (#696).
    reporters: [
      'default',
      './tests/unit-cpu-reporter.ts',
      ['./tests/load-reporter.ts', { suite: 'unit' }],
    ],
    // The unit suite in two projects (#688; operator 2026-10-11, "500 ms,
    // share the parser first"). A project inherits everything above and adds
    // its setup files after the shared ones, so the load measurement and its
    // judge are last in both. The parser files run with isolation off and load the parser in
    // setup, once per worker, before their load clock starts; every other
    // file keeps its own fresh modules. Pinned by parser-project.test.ts.
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          exclude: PARSER_FILES,
          setupFiles: [LOAD_SETUP, UNIT_LOAD_LIMIT_SETUP],
        },
      },
      {
        test: {
          name: 'unit-parser',
          include: PARSER_FILES,
          isolate: false,
          setupFiles: [
            TYPESCRIPT_PRELOAD_SETUP,
            LOAD_SETUP,
            UNIT_LOAD_LIMIT_SETUP,
          ],
        },
      },
    ],
  },
});
