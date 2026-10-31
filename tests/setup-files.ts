/**
 * The setup files each Vitest suite runs, in one home.
 *
 * `SHARED_SETUP` runs in every suite that reads this repository (unit, guards,
 * integration): forget the repository the run was handed, and refuse a worker
 * whose TMPDIR is not the run's own. `UNIT_ONLY_SETUP` runs in the unit suite
 * alone: it refuses every process and every connection off this machine. The
 * integration suite exists to start processes, so it adds its own instead.
 */
export const SHARED_SETUP: readonly string[] = [
  'tests/git-env-setup.ts',
  'tests/temporary-files-setup.ts',
];

export const UNIT_ONLY_SETUP: readonly string[] = [
  'tests/unit-refusal-setup.ts',
];
