/**
 * The unit suite's per-test CPU limit (#632): 1 s of the test's own CPU, user
 * plus system, in microseconds as `process.cpuUsage()` reports it. Wall time
 * stretches under load and CPU time does not, so this is the limit that a slow
 * test breaks on a quiet machine and a fast one never breaks on a busy one.
 */
export const CPU_LIMIT_MICROSECONDS = 1_000_000;

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
