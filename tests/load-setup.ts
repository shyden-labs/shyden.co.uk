import { beforeAll } from 'vitest';
import { startOwnCpu } from './unit-cpu-limit';

/**
 * In every worker of every Vitest suite, LAST of the setup files but for the
 * unit suite's judge: measure what loading the test file costs (#688, #696).
 * Everything from here to the file's first `beforeAll` is the file being
 * imported and its tests collected, its own module-scope work included, which
 * no per-test clock or timeout sees. Measured in shyden.co.uk on 2026-10-11,
 * loading the unit files cost 17.5 s of CPU against 3.6 s for their tests.
 *
 * The figures go on the file's own meta, which Vitest carries from the worker
 * to the main process, where `load-reporter.ts` prints the heaviest. A file
 * whose tests are all skipped runs no `beforeAll` and so carries none. This
 * file judges nothing: the unit suite's limit is `unit-load-limit-setup.ts`,
 * and the other suites' loading is reported, not limited, until the operator
 * sets a limit from these figures.
 */
const elapsed = startOwnCpu();
const started = performance.now();
let stamped = false;

// Vitest 5 wants a hook's first argument destructured; the suite is the second.
beforeAll(({}, suite) => {
  if (stamped) return;
  stamped = true;
  suite.meta.loadCpuMicroseconds = elapsed();
  suite.meta.loadWallMilliseconds = performance.now() - started;
});
