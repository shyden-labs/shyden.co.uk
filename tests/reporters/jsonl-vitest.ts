/**
 * Vitest counterpart to `tests/reporters/jsonl-reporter.ts` (Playwright) --
 * same shared event shape, same env-var-driven no-op contract, same
 * "never let a dashboard write break the real run" guarantee. See that
 * file's module doc for the full reasoning; this one only calls out where
 * Vitest's Reporter API (v2, `vitest/node`) genuinely differs.
 *
 * Wired in purely via the CLI, exactly like `list`/`json` already are in
 * `scripts/test-devices.mjs` (`--reporter=verbose --reporter=json
 * --outputFile.json=<file> --reporter=./tests/reporters/jsonl-vitest.ts`),
 * with NO change to `vitest.ios.config.ts`. Measured, not assumed: Vitest's
 * own CLI-to-config resolution only treats a `--reporter` value as a file
 * path when it matches `/^\.\.?\//` (`node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js`,
 * the block starting `// ./reporter.js || ../reporter.js, but not
 * .reporters/reporter.js`) -- so the leading `./` on that CLI argument is
 * load-bearing, not decorative; a bare `tests/reporters/jsonl-vitest.ts`
 * would be treated as a reporter NAME, not a path, and fail to resolve.
 *
 * Default export required: `loadCustomReporterModule` (same file as above)
 * does `new (await import(path)).default(options)` for any CLI-supplied
 * reporter path.
 */
import type {
  Reporter,
  TestCase,
  TestModule,
  TestResult,
  TestSpecification,
} from 'vitest/node';
import { DashboardLog, toDashboardStatus } from './dashboard-jsonl';

export default class JsonlVitestReporter implements Reporter {
  private readonly log = new DashboardLog('jsonl-vitest');

  // Collection happens per-file and (per vitest.ios.config.ts's own
  // `fileParallelism: false`) never concurrently, but this reporter counts
  // modules generally rather than assuming exactly one journeys file, so it
  // stays correct if this project ever splits iOS journeys across files.
  // `onTestRunStart` gives the expected file COUNT; `begin` (with the real
  // test-case total) fires once every expected module has reported via
  // `onTestModuleCollected` -- collection always completes for a module
  // before any of its tests can start, so `begin` is always emitted before
  // the first `test-start`.
  private expectedModules = 0;
  private collectedModules = 0;
  private totalTests = 0;
  private begun = false;

  onTestRunStart(specifications: ReadonlyArray<TestSpecification>): void {
    if (!this.log.start()) return;
    this.expectedModules = specifications.length;
    this.collectedModules = 0;
    this.totalTests = 0;
    this.begun = false;
  }

  onTestModuleCollected(testModule: TestModule): void {
    if (!this.log.live) return;
    this.collectedModules += 1;
    this.totalTests += Array.from(testModule.children.allTests()).length;
    if (!this.begun && this.collectedModules >= this.expectedModules) {
      this.begun = true;
      this.log.append({
        event: 'begin',
        total: this.totalTests,
        at: Date.now(),
      });
    }
  }

  onTestCaseReady(testCase: TestCase): void {
    this.log.append({
      event: 'test-start',
      id: testCase.id,
      // `fullName` (not the leaf `name`) deliberately: journeys.journey.ts
      // parameterises every test over `describe.each(LOCALES)`, so the leaf
      // name alone ("Journey 1 -- 12 students...") cannot tell the `en` run
      // apart from the `id` run on the dashboard -- `fullName` includes the
      // parameterised describe block and disambiguates.
      title: testCase.fullName,
      project: 'ios-safari',
      at: Date.now(),
    });
  }

  onTestCaseResult(testCase: TestCase): void {
    // Annotated rather than inferred. `toDashboardStatus` takes a `string`,
    // so this module would import neither framework's union -- and that is
    // exactly the check this line puts back: what reaches it is vitest's own
    // `TestResult['state']`, not any string that happens to be to hand.
    const result: TestResult = testCase.result();
    this.log.append({
      event: 'test',
      id: testCase.id,
      title: testCase.fullName,
      project: 'ios-safari',
      status: toDashboardStatus(result.state),
      durationMs: testCase.diagnostic()?.duration ?? 0,
      at: Date.now(),
    });
  }

  onTestRunEnd(): void {
    this.log.append({ event: 'end', at: Date.now() });
  }
}
