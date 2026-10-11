/**
 * The unit suite's per-test CPU limit: 0.3 s of the test's own CPU, user plus
 * system, in microseconds, of the thread that ran it. Wall time stretches
 * under load and CPU time does not, so this is the limit that a slow test
 * breaks on a quiet machine and a fast one never breaks on a busy one. #632
 * set it at 1 s; #645 lowered it to 0.3 s (operator rule 2026-10-08: clock
 * time ran up to 3.14x past CPU under load, so 0.3 s of CPU is what keeps a
 * test under the 1 s clock limit on a loaded machine).
 */
export const CPU_LIMIT_MICROSECONDS = 300_000;

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
  return overLimit(
    cpuMicroseconds,
    CPU_LIMIT_MICROSECONDS,
    (used, limit) =>
      `"${testName}" used ${used} ms of its own CPU, over the unit limit of ${limit} ms (#632, #645). ` +
      'Cut the work the test does; a unit test is never given more time.',
  );
}

/**
 * The unit suite's limit on loading one test file (#688): 0.5 s of the worker
 * thread's CPU from just before the file is imported to its first hook, its
 * imports and module-scope work included, which no per-test clock sees.
 * Operator 2026-10-11 ("500 ms, keep isolation"): the runner's heaviest was
 * 340 ms, every one of the ten files over 200 ms reaching `typescript`, which
 * costs ~135 ms to load in each isolated file; the limit sits above that
 * floor and catches heavy work at the top of a file (an 11.4 s whole-tree
 * scan loaded unseen before #684 moved it).
 */
export const LOAD_LIMIT_MICROSECONDS = 500_000;

/** The failure for a file that took `cpuMicroseconds` to load, or nothing within the limit. */
export function loadBreach(
  cpuMicroseconds: number,
  file: string,
): string | undefined {
  return overLimit(
    cpuMicroseconds,
    LOAD_LIMIT_MICROSECONDS,
    (used, limit) =>
      `"${file}" used ${used} ms of its own CPU to load, over the unit load limit of ${limit} ms (#688). ` +
      'Cut what it does at the top of the file, or move a whole-tree scan to the guards suite.',
  );
}

/** `said(used ms, limit ms)` when `microseconds` passes `limit`, or nothing. */
function overLimit(
  microseconds: number,
  limit: number,
  said: (usedMs: number, limitMs: number) => string,
): string | undefined {
  return microseconds <= limit
    ? undefined
    : said(Math.round(microseconds / 1000), limit / 1000);
}

declare module 'vitest' {
  interface TaskMeta {
    /** The test's own CPU in microseconds, stamped by `unit-cpu-setup.ts`. */
    ownCpuMicroseconds?: number;
    /** A file's CPU to load, in microseconds, stamped by `unit-load-setup.ts` (#688). */
    loadCpuMicroseconds?: number;
    /** A file's wall time to load, in milliseconds, stamped beside it. */
    loadWallMilliseconds?: number;
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
  heading = 'Own CPU of each unit test (#645)',
): string[] {
  const over = (microseconds: number) =>
    rows.filter((row) => row.microseconds > microseconds).length;
  const heaviest = [...rows]
    .sort((a, b) => b.microseconds - a.microseconds)
    .slice(0, top);
  return [
    `${heading}: ${rows.length} measured, ${unmeasured} unmeasured; ` +
      `over 300 ms: ${over(300_000)}; over 200 ms: ${over(200_000)}; the heaviest ${heaviest.length}:`,
    ...heaviest.map(
      (row) =>
        `${String(Math.round(row.microseconds / 1000)).padStart(8)} ms  ${row.file} > ${row.name}`,
    ),
  ];
}
