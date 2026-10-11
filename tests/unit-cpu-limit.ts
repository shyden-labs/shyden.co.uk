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

declare module 'vitest' {
  interface TaskMeta {
    /** The test's own CPU in microseconds, stamped by `unit-cpu-setup.ts`. */
    ownCpuMicroseconds?: number;
  }
}

/** One measured unit test, as `unit-cpu-reporter.ts` reads it off the run. */
export type CpuRow = {
  name: string;
  file: string;
  microseconds: number;
};

/** How many of the heaviest tests every unit run prints (#645, AC1). */
export const CPU_REPORT_TOP = 20;

/**
 * The lines the unit run prints about its tests' own CPU (#645): a count of
 * those over 300 ms and over 200 ms, beside how many tests carried no figure
 * (a report that lost its tests reads as a quiet one otherwise), then the
 * heaviest `top`, each named with its file and rounded to the millisecond.
 * Printed on every run, laptop and CI alike, so the headroom under the limit
 * is measured where the limit is judged rather than estimated.
 */
export function cpuReport(
  rows: readonly CpuRow[],
  unmeasured: number,
  top = CPU_REPORT_TOP,
): string[] {
  const over = (microseconds: number) =>
    rows.filter((row) => row.microseconds > microseconds).length;
  const heaviest = [...rows]
    .sort((a, b) => b.microseconds - a.microseconds)
    .slice(0, top);
  return [
    `Own CPU of each unit test (#645): ${rows.length} measured, ${unmeasured} unmeasured; ` +
      `over 300 ms: ${over(300_000)}; over 200 ms: ${over(200_000)}; the heaviest ${heaviest.length}:`,
    ...heaviest.map(
      (row) =>
        `${String(Math.round(row.microseconds / 1000)).padStart(8)} ms  ${row.file} > ${row.name}`,
    ),
  ];
}
