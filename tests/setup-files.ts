/**
 * The vitest setup files, once (#632).
 *
 * `SHARED_SETUP` runs in every suite that reads this repository (unit, guards,
 * integration): forget the repository the run was handed, and refuse a worker
 * whose TMPDIR is not the run's own. `UNIT_ONLY_SETUP` runs in the unit suite
 * alone: it refuses every process and every connection off this machine, and
 * fails a test whose own CPU passes 1 s. The integration suite exists to start
 * processes and the guards suite reads the whole tree over 1 s, so neither may
 * take the unit-only list. `tests/unit/setup-files.test.ts` pins the split from
 * the three configs' own objects.
 */
export const SHARED_SETUP: readonly string[] = [
  'tests/git-env-setup.ts',
  'tests/temporary-files-setup.ts',
];

export const UNIT_ONLY_SETUP: readonly string[] = [
  'tests/unit-refusal-setup.ts',
  'tests/unit-cpu-setup.ts',
];
