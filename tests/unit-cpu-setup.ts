import { afterEach, beforeEach, expect } from 'vitest';
import { cpuBreach } from './unit-cpu-limit';

/**
 * In every unit worker: fail a test whose own CPU passes 1 s (#632).
 *
 * A worker is a forked process running one test at a time, so the
 * `process.cpuUsage()` delta across a test is that test's own CPU, children
 * excluded (a unit test starts none). A concurrent test would share the worker
 * with others and could not be attributed, so it is refused outright. The
 * limit and its message live in `tests/unit-cpu-limit.ts`.
 */
let before: NodeJS.CpuUsage = { user: 0, system: 0 };

beforeEach(({ task }) => {
  if (task.concurrent === true)
    throw new Error(
      `"${task.name}" is concurrent, so its CPU cannot be told from the tests ` +
        'running beside it in the same worker (#632). Run it in sequence.',
    );
  before = process.cpuUsage();
});

afterEach(({ task }) => {
  const used = process.cpuUsage(before);
  const breach = cpuBreach(used.user + used.system, task.name);
  expect(breach, breach).toBeUndefined();
});
