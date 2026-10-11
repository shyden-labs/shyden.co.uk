import { beforeAll, expect } from 'vitest';
import { loadBreach, startOwnCpu } from './unit-cpu-limit';

/**
 * In every unit worker, LAST of the setup files: measure what loading the test
 * file costs (#688). Everything from here to the file's first `beforeAll` is
 * the file being imported and its tests collected, its own module-scope work
 * included, which no per-test clock sees (`unit-cpu-setup.ts` starts its clock
 * in `beforeEach`). Measured in shyden.co.uk on 2026-10-11, loading the unit
 * files cost 17.5 s of CPU against 3.6 s for their tests.
 *
 * The figures go on the file's own meta, which Vitest carries from the worker
 * to the main process, where `unit-cpu-reporter.ts` prints the heaviest. A
 * file whose tests are all skipped runs no `beforeAll` and so carries none.
 * A file over `LOAD_LIMIT_MICROSECONDS` fails here, naming itself and its
 * figure, so every test in it fails with that reason.
 */
const elapsed = startOwnCpu();
const started = performance.now();
let stamped = false;

// Vitest 5 wants a hook's first argument destructured; the suite is the second.
beforeAll(({}, suite) => {
  if (stamped) return;
  stamped = true;
  const used = elapsed();
  suite.meta.loadCpuMicroseconds = used;
  suite.meta.loadWallMilliseconds = performance.now() - started;
  const breach = loadBreach(used, suite.name);
  expect(breach, breach).toBeUndefined();
});
