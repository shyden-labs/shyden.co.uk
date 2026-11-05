import { tmpdir } from 'node:os';
import { RUN_TMPDIR } from './temporary-files';

/**
 * In every worker, before any test: the run's temporary directory reached it.
 * Without this, a `globalSetup` whose `TMPDIR` stopped reaching the workers
 * would leave the end-of-run check reading an empty directory and passing on
 * nothing (#390 F56).
 */
const expected = process.env[RUN_TMPDIR];
if (expected === undefined || tmpdir() !== expected) {
  throw new Error(
    `expected this worker's temporary directory to be the run's own (${expected ?? 'unset'}) -- ` +
      `it is ${tmpdir()}, so a test's leftovers would escape tests/temporary-files.ts`,
  );
}
