/**
 * The half of the two dashboard reporters that is not framework-specific.
 *
 * `jsonl-reporter.ts` (Playwright) and `jsonl-vitest.ts` (vitest) held
 * character-identical copies of the status mapping and of the whole writer —
 * the two environment variables, the `writeFailed` latch, the truncate, the
 * append, and the one-time notice — differing only in the name each put in
 * front of its error message (#277). Two copies of "the dashboard must never
 * be able to fail a test run" is two places for that promise to stop being
 * true, and neither copy was reachable from a test: both are instantiated by
 * a test runner, so nothing in this repo had ever exercised the failure path
 * they exist for. Here it is a plain object, and `dashboard-jsonl.test.ts`
 * drives it.
 */
import { appendFileSync, writeFileSync } from 'node:fs';

/** The dashboard's flat contract (task brief step 1). */
export type DashboardStatus = 'passed' | 'failed' | 'skipped';

/**
 * A framework's own outcome, folded into the dashboard's three.
 *
 * Playwright distinguishes `timedOut` and `interrupted` from `failed`, and
 * vitest has a `pending` its own docs say cannot reach a finished test —
 * real distinctions for a human reading a runner's output, and not ones the
 * dashboard's counters draw. The Playwright reporter hands this the run's
 * verdict on a test rather than how its body ended, the way
 * `playwrightVerdict` in `scripts/test-devices.mjs` counts `expected` and
 * `unexpected`: a `test.fail()` that fails is a pass (#390 F158).
 *
 * Takes a `string` rather than either framework's union so this module
 * imports neither. Both unions are assignable to it, and the mapping is
 * total either way: anything unrecognised becomes `failed`, NEVER `passed`.
 * A dashboard that reports a timed-out test as green is worse than one that
 * reports a passing test as red, and this project has shipped that
 * confusion before.
 */
export const toDashboardStatus = (outcome: string): DashboardStatus => {
  if (outcome === 'passed') return 'passed';
  if (outcome === 'skipped') return 'skipped';
  return 'failed';
};

/** Just the variables this reads, so a test hands it two strings. */
type Environment = Partial<
  Record<'DASHBOARD_JSONL_FILE' | 'DASHBOARD_GROUP', string>
>;

/**
 * One JSON object per line, appended live for `scripts/dashboard.mjs` to
 * tail.
 *
 * Every write is wrapped and the first failure latches this quiet for the
 * rest of the run: the dashboard is an observer, so a filesystem error here
 * may never propagate into a test failure, and a notice repeated per test
 * would bury the run's real output. Unset `DASHBOARD_JSONL_FILE` makes every
 * method a no-op, which is what keeps a bare `npx playwright test` — no
 * dashboard anywhere — completely unaffected.
 */
export class DashboardLog {
  private readonly file: string | undefined;
  private readonly group: string;
  private failed = false;

  /** `reporter` is what the notice names, so a reader knows which one spoke. */
  constructor(
    private readonly reporter: string,
    env: Environment = process.env,
  ) {
    this.file = env.DASHBOARD_JSONL_FILE;
    this.group = env.DASHBOARD_GROUP || 'unknown-group';
  }

  get enabled(): boolean {
    return this.file !== undefined;
  }

  /**
   * Named, so a reporter can skip work that only feeds this.
   *
   * `enabled` answers "was a file asked for"; this also answers "is it still
   * being written". `jsonl-vitest`'s module counter guarded on both before
   * this module existed, and `append` alone would not preserve that: it would
   * go quiet, but the counting either side of it would carry on.
   */
  get live(): boolean {
    return this.enabled && !this.failed;
  }

  /**
   * Truncate-or-create, and say whether events may follow.
   *
   * Fresh per invocation: an old run's lines must never bleed into this
   * run's dashboard the way an append-only file would. Same contract
   * `PLAYWRIGHT_JSON_OUTPUT_NAME` and vitest's `--outputFile.json` give.
   */
  start(): boolean {
    if (!this.file) return false;
    try {
      writeFileSync(this.file, '');
      return true;
    } catch (error) {
      this.stop(`create/truncate ${this.file}`, 'will not see the', error);
      return false;
    }
  }

  /** One event, stamped with its group. */
  append(event: Record<string, unknown>): void {
    if (!this.file || this.failed) return;
    try {
      appendFileSync(
        this.file,
        // `group` first, so a line cut short by a crash still says whose.
        JSON.stringify({ group: this.group, ...event }) + '\n',
      );
    } catch (error) {
      this.stop(`write to ${this.file}`, 'will stop updating for', error);
    }
  }

  /**
   * Latch quiet, and say what a reader has lost.
   *
   * The two consequences are genuinely different and were spelled
   * differently before this module existed: a failed truncate means the
   * dashboard never sees this group AT ALL, a failed append means it stops
   * where it stopped. A reader chasing a missing group needs to know which.
   */
  private stop(what: string, consequence: string, cause: unknown): void {
    this.failed = true;
    // eslint-disable-next-line no-console -- deliberate, one-time, visible failure notice; see the module doc
    console.error(
      `[${this.reporter}] failed to ${what} -- the live dashboard ${consequence} ` +
        `"${this.group}" group this run, but the test run itself is unaffected: ${(cause as Error).message}`,
    );
  }
}
