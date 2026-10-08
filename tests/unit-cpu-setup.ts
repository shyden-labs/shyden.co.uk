import { afterEach, beforeEach, expect } from 'vitest';
import { cpuBreach, startOwnCpu } from './unit-cpu-limit';

/**
 * In every unit worker: fail a test whose own CPU passes 1 s (#632).
 *
 * A worker is a forked process running one test at a time on one thread, so
 * that thread's CPU across a test is the test's own (`startOwnCpu`), with the
 * garbage collector's helper threads and any children left out. A concurrent
 * test would share the thread with others and could not be attributed, so it
 * is refused outright. The limit and its message live in
 * `tests/unit-cpu-limit.ts`.
 */
let elapsed: () => number = () => 0;

beforeEach(({ task }) => {
  if (task.concurrent === true)
    throw new Error(
      `"${task.name}" is concurrent, so its CPU cannot be told from the tests ` +
        'running beside it in the same worker (#632). Run it in sequence.',
    );
  elapsed = startOwnCpu();
});

afterEach(({ task }) => {
  const breach = cpuBreach(elapsed(), task.name);
  expect(breach, breach).toBeUndefined();
});
