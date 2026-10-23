/**
 * The vitest setup files, once (#632).
 *
 * `SHARED_SETUP` runs in every suite that reads this repository (unit, guards,
 * integration): forget the repository the run was handed, and refuse a worker
 * whose TMPDIR is not the run's own. `UNIT_ONLY_SETUP` runs in the unit suite
 * alone: it refuses every process and every connection off this machine, and
 * fails a test whose own CPU passes 0.1 s. The integration suite exists to start
 * processes and the guards suite reads the whole tree over 1 s, so neither may
 * take the unit-only list. `tests/unit/setup-files.test.ts` pins the split from
 * the three configs' own objects.
 */
export const SHARED_SETUP: readonly string[] = [
  'tests/git-env-setup.ts',
  'tests/temporary-files-setup.ts',
];

/**
 * The integration suite's own (#936): the processes a test starts write raw V8
 * coverage, the fork running the test does not (`tests/child-coverage.ts`).
 */
export const INTEGRATION_ONLY_SETUP: readonly string[] = [
  'tests/child-coverage-setup.ts',
];

/** The unit suite's own-CPU judge (#632). */
const UNIT_CPU_SETUP = 'tests/unit-cpu-setup.ts';

export const UNIT_ONLY_SETUP: readonly string[] = [
  'tests/unit-refusal-setup.ts',
  UNIT_CPU_SETUP,
];

/**
 * Every suite's last setup file but for the unit judge below (#688, #696): it
 * measures loading the test file, so it runs after every other setup file and
 * just before the import.
 */
export const LOAD_SETUP = 'tests/load-setup.ts';

/**
 * The unit suite's judge of that measurement (#688): it fails a file over the
 * unit load limit, so it runs straight after `LOAD_SETUP`. The other suites
 * report their loading and are not limited by it (#696).
 */
export const UNIT_LOAD_LIMIT_SETUP = 'tests/unit-load-limit-setup.ts';

/**
 * The unit suite's two judges (#896): own CPU and file load. The coverage run
 * leaves out exactly these, because instrumentation spends CPU and load time
 * that is not the test's own; the 1 s step, which runs without coverage,
 * judges both.
 */
export const UNIT_JUDGES: readonly string[] = [
  UNIT_CPU_SETUP,
  UNIT_LOAD_LIMIT_SETUP,
];

/**
 * The parser project's setup (#688): loads `typescript` before the load
 * measurement starts, once per worker, since that project shares modules.
 */
export const TYPESCRIPT_PRELOAD_SETUP = 'tests/typescript-preload-setup.ts';
