import { beforeAll, expect } from 'vitest';
import { loadBreach } from './unit-cpu-limit';

/**
 * In every unit worker, after `load-setup.ts`: fail a file whose loading
 * passed `LOAD_LIMIT_MICROSECONDS` (#688), naming itself and its figure, so
 * every test in it fails with that reason. Hooks run in the order they were
 * registered, so the figure is on the file's meta by the time this one runs;
 * a file that carries none fails too, since a measurement that stopped would
 * otherwise pass every file.
 */
// Vitest 5 wants a hook's first argument destructured; the suite is the second.
beforeAll(({}, suite) => {
  const used = suite.meta.loadCpuMicroseconds;
  expect(
    used,
    `"${suite.name}" carries no load figure: tests/load-setup.ts must run before this file (#688).`,
  ).toBeTypeOf('number');
  const breach = loadBreach(used ?? 0, suite.name);
  expect(breach, breach).toBeUndefined();
});
