import type { Reporter, TestModule } from 'vitest/node';
import { cpuReport, type CpuRow } from './unit-cpu-limit';

/**
 * Prints, at the end of every run of a Vitest suite, the own CPU of loading
 * its heaviest files (#688, #696): the figure `load-setup.ts` stamps on each
 * file's meta in its worker, read here in the main process. One reporter for
 * every suite, named in each config with the suite it reports on. A file that
 * ran a test (passed or failed) and carries no figure is counted as
 * unmeasured, so a setup that stopped stamping is seen; a file none of whose
 * tests ran never ran its hooks, so it is not counted at all.
 */
export default class LoadReporter implements Reporter {
  private readonly suite: string;

  constructor({ suite }: { suite: string }) {
    if (!suite)
      throw new Error(
        'The load reporter needs the name of the suite it reports on (#696).',
      );
    this.suite = suite;
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const loads: CpuRow[] = [];
    let unloaded = 0;
    for (const testModule of testModules) {
      const ran = testModule.children
        .allTests()
        .some((test) => ['passed', 'failed'].includes(test.result().state));
      if (!ran) continue;
      const microseconds = testModule.meta().loadCpuMicroseconds;
      if (microseconds === undefined) unloaded++;
      else
        loads.push({
          name: `loaded in ${Math.round(testModule.meta().loadWallMilliseconds ?? 0)} ms of wall`,
          file: testModule.relativeModuleId,
          microseconds,
        });
    }
    process.stdout.write(
      `\n${cpuReport(loads, unloaded, undefined, `Own CPU of loading each ${this.suite} file (#688)`, [300_000, 200_000]).join('\n')}\n`,
    );
  }
}
