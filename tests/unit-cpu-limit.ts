/**
 * The unit suite's per-test CPU limit (#632): 1 s of the test's own CPU, user
 * plus system, in microseconds, of the thread that ran it. Wall time
 * stretches under load and CPU time does not, so this is the limit that a slow
 * test breaks on a quiet machine and a fast one never breaks on a busy one.
 */
export const CPU_LIMIT_MICROSECONDS = 1_000_000;

/**
 * Start a test's CPU clock; the function it returns reads the microseconds
 * since, user plus system, of THIS thread only. `process.cpuUsage()` would sum
 * every thread in the worker, and V8 collects garbage on helper threads: a test
 * that allocated for 500 ms of its own thread read 1 489 ms process-wide, and
 * that figure grows with the machine's core count.
 */
export function startOwnCpu(): () => number {
  const start = process.threadCpuUsage();
  return () => {
    const used = process.threadCpuUsage(start);
    return used.user + used.system;
  };
}

/** The failure for a test that used `cpuMicroseconds`, or nothing when it is within the limit. */
export function cpuBreach(
  cpuMicroseconds: number,
  testName: string,
): string | undefined {
  if (cpuMicroseconds <= CPU_LIMIT_MICROSECONDS) return undefined;
  return (
    `"${testName}" used ${Math.round(cpuMicroseconds / 1000)} ms of its own CPU, ` +
    `over the unit limit of ${CPU_LIMIT_MICROSECONDS / 1000} ms (#632). ` +
    'Cut the work the test does; a unit test is never given more time.'
  );
}
