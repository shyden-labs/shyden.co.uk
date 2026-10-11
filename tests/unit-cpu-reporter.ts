import type { Reporter, TestModule } from 'vitest/node';
import { cpuReport, type CpuRow } from './unit-cpu-limit';

/**
 * Prints, at the end of every unit run, the own CPU of its heaviest tests
 * (#645): the figure `unit-cpu-setup.ts` judges each test by, stamped on the
 * test's meta in its worker and read here in the main process. A test that
 * ran (passed or failed) with no figure is counted as unmeasured; a skipped
 * one never ran its hooks, so it is not counted at all.
 */
export default class UnitCpuReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const rows: CpuRow[] = [];
    let unmeasured = 0;
    for (const testModule of testModules)
      for (const test of testModule.children.allTests()) {
        const { state } = test.result();
        if (state !== 'passed' && state !== 'failed') continue;
        const microseconds = test.meta().ownCpuMicroseconds;
        if (microseconds === undefined) unmeasured++;
        else
          rows.push({
            name: test.fullName,
            file: testModule.relativeModuleId,
            microseconds,
          });
      }
    process.stdout.write(`\n${cpuReport(rows, unmeasured).join('\n')}\n`);
    // Loading each file (#688): a file that ran a test and carries no figure is
    // unmeasured, so a setup that stopped stamping is seen.
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
      `\n${cpuReport(loads, unloaded, undefined, 'Own CPU of loading each unit file (#688)').join('\n')}\n`,
    );
  }
}
