/**
 * Emits one JSON object per line to a file, live, so `scripts/dashboard.mjs`
 * can tail it and drive the live dashboard (task brief step 1). This is a
 * SEPARATE reporter from `list`/`json` (see `scripts/test-devices.mjs`,
 * which runs all three together via `--reporter=list,json,./tests/reporters/jsonl-reporter.ts`)
 * -- it does not replace either, and writes to its own file, never stdout.
 * `list`'s terminal output and `json`'s summary file are exactly as they
 * were before this reporter existed.
 *
 * Which file, and which group label to put on every event, come from two
 * environment variables (`DASHBOARD_JSONL_FILE`, `DASHBOARD_GROUP`) rather
 * than reporter options, because Playwright's CLI `--reporter=a,b,c` syntax
 * (which `scripts/test-devices.mjs` already uses for `list,json`) has no
 * way to pass per-reporter options -- only the config-array form
 * (`reporter: [['x', {...}]]`) does, and this project deliberately keeps
 * `playwright.config.ts` and `playwright.device.config.ts` untouched by the
 * dashboard feature, so a bare `npx playwright test` (no dashboard env vars
 * set) is unaffected either way. Measured, not assumed: Playwright resolves a
 * CLI reporter id that isn't a built-in name via
 * `path.resolve(process.cwd(), id)` then `require.resolve` --
 * `node_modules/playwright/lib/cli/testActions.js`'s `resolveReporter` --
 * so a relative path on the CLI works with no config change at all.
 *
 * If `DASHBOARD_JSONL_FILE` is unset, every hook below is a no-op. That is
 * what makes a bare `npx playwright test --reporter=list,json,./tests/reporters/jsonl-reporter.ts`
 * (run by hand, no dashboard involved) harmless -- and it is the mechanism
 * behind the task's hardest requirement: "if the dashboard server throws,
 * the tests carry on" (step 3). This reporter does not talk to the
 * dashboard server or the network at all -- it only appends to a file, and
 * every append is wrapped so a filesystem error here can never propagate
 * into a test failure or abort the run. A write failure is logged ONCE
 * (so it is not silently invisible -- see this project's own rule against
 * `if (ok) { act() }` with no `else`) and then this reporter goes quiet for
 * the rest of the run rather than spamming a failure on every subsequent
 * test.
 */
import type {
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { projectNameOf } from './test-identity';
import { DashboardLog, toDashboardStatus } from './dashboard-jsonl';

/**
 * Playwright's verdict on one attempt, not how its body ended (#390 F158).
 * A test declared to fail with `test.fail()` and failing is expected, a pass
 * to the run; one that passes instead fails the run. Read from `status`
 * alone, the dashboard showed the first as failed and the second as passed.
 */
const verdictOf = (test: TestCase, result: TestResult): string => {
  if (result.status === 'skipped') return 'skipped';
  return result.status === test.expectedStatus ? 'passed' : 'failed';
};

export default class JsonlReporter implements Reporter {
  private readonly log = new DashboardLog('jsonl-reporter');

  onBegin(_config: unknown, suite: Suite): void {
    if (!this.log.start()) return;
    this.log.append({
      event: 'begin',
      total: suite.allTests().length,
      at: Date.now(),
    });
  }

  onTestBegin(test: TestCase): void {
    this.log.append({
      event: 'test-start',
      id: test.id,
      title: test.title,
      project: projectNameOf(test),
      at: Date.now(),
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.log.append({
      event: 'test',
      id: test.id,
      title: test.title,
      project: projectNameOf(test),
      status: toDashboardStatus(verdictOf(test, result)),
      durationMs: result.duration,
      at: Date.now(),
    });
  }

  onEnd(_result: FullResult): void {
    this.log.append({ event: 'end', at: Date.now() });
  }

  printsToStdio(): boolean {
    return false; // this reporter only ever writes to its file, never stdout/stderr
  }
}
