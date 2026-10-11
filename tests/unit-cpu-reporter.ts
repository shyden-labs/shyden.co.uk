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
  }
}
