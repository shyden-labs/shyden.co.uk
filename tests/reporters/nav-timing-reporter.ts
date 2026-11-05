import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { describePathOf, projectNameOf } from './test-identity';

/**
 * How long each individual NAVIGATION took, per project. #44.
 *
 * `e2e-timings.test.ts` already keeps the whole-test durations the run was
 * throwing away, and `playwright.config.ts` records what they settled and what
 * they could not: they "bound the problem, they do not separate a slow
 * navigation from a slow test around one". `page.goto: Test timeout of 30000ms
 * exceeded` names the TEST budget, so a 900ms navigation inside a 29s test and
 * a 29s navigation produce the identical line -- and call for opposite fixes.
 * This reporter is what tells them apart, and it keeps the numbers for every
 * run rather than only for the run that fails.
 *
 * WHY A REPORTER AND NOT ANOTHER READ OF THE JSON REPORT. Measured, Playwright
 * 1.63.0: the built-in `json` reporter -- the file `scripts/test-e2e.mjs`
 * already writes and parses -- STRIPS every `pw:api` step and keeps only the
 * user's `test.step` entries, with no `category` field on them at all. A probe
 * run whose test made two navigations, one of them inside a `test.step`,
 * produced a report containing the `test.step` and NEITHER navigation. The
 * durations exist only in the in-memory tree a reporter is handed.
 *
 * This adds no dependency, no artifact upload and no third-party action to
 * SHA-pin: it is a file in this repo, appended to the reporter list the runner
 * already merges, writing to a temp file the runner already deletes. Keeping
 * the supply chain of this pipeline small is the point of #23 and #39, and it
 * survives this change intact.
 */

/** Playwright's category for its own API steps, as opposed to `test.step`. */
export const NAVIGATION_STEP_CATEGORY = 'pw:api';

/**
 * The title Playwright gives a `page.goto` step. MEASURED, not assumed
 * (1.63.0, probe run 2026-09-10): it is `Navigate`, not `page.goto` and not
 * the URL. Matching the API name -- the obvious guess -- matches nothing, and
 * a collector that matches nothing reports an empty distribution and a green
 * run. `navTimingVerdict` in `scripts/test-e2e.mjs` is the control that turns
 * that silence into a failure, including on the day a Playwright upgrade
 * renames this string.
 */
export const NAVIGATION_STEP_TITLE = 'Navigate';

/** The part of Playwright's `TestStep` this reporter reads. */
export interface NavigationStepLike {
  readonly title: string;
  readonly category: string;
  readonly duration: number;
  readonly error?: unknown;
  readonly steps: readonly NavigationStepLike[];
}

/** One navigation, as it appeared in a result tree. */
export interface Navigation {
  readonly durationMs: number;
  readonly errored: boolean;
}

/** A navigation with enough context to find the test that made it. */
export interface NavigationRecord extends Navigation {
  readonly project: string;
  readonly file: string;
  readonly test: string;
}

/**
 * What the reporter writes, and `scripts/test-e2e.mjs` reads back. It holds no
 * count of the tests that ran: the liveness verdict takes that from the json
 * report, since a reporter that never ran would count zero and certify its own
 * silence.
 */
export interface NavTimingReport {
  readonly navigations: NavigationRecord[];
}

/**
 * Every navigation in a result tree, in the order they were made.
 *
 * RECURSIVE BY NECESSITY, not for tidiness. Measured on the same probe: a
 * `goto` called from a plain helper function is a TOP-LEVEL step, but the same
 * call inside `test.step()` is a CHILD of that step, and one made in
 * `beforeEach` is a grandchild of `Before Hooks`. A scan of the top level only
 * would drop both -- silently, and in a suite whose helpers (`withGroups`,
 * `openPrintPanel`) are exactly where the navigations live.
 */
export function collectNavigations(
  steps: readonly NavigationStepLike[],
): Navigation[] {
  const found: Navigation[] = [];
  for (const step of steps) {
    if (
      step.category === NAVIGATION_STEP_CATEGORY &&
      step.title === NAVIGATION_STEP_TITLE
    ) {
      found.push({
        durationMs: step.duration,
        errored: step.error !== undefined,
      });
    }
    // Not `else`: a navigation is a leaf here, but recursing unconditionally
    // costs nothing and cannot be the reason a future step shape is missed.
    found.push(...collectNavigations(step.steps));
  }
  return found;
}

export default class NavTimingReporter implements Reporter {
  private readonly file: string | undefined;
  private readonly navigations: NavigationRecord[] = [];

  constructor() {
    // An environment variable rather than a reporter option, for the reason
    // `jsonl-reporter.ts` documents: the CLI's `--reporter=a,b,c` form, which
    // `scripts/test-e2e.mjs` uses, has no way to pass per-reporter options.
    // Unset means inert, so a bare `npx playwright test` is unaffected.
    this.file = process.env.NAV_TIMING_FILE;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!this.file) return;
    const project = projectNameOf(test);
    const file = relative(process.cwd(), test.location.file);
    const name = describePathOf(test);
    for (const navigation of collectNavigations(
      result.steps as readonly NavigationStepLike[],
    )) {
      this.navigations.push({ project, file, test: name, ...navigation });
    }
  }

  onEnd(_result: FullResult): void {
    if (!this.file) return;
    const report: NavTimingReport = {
      navigations: this.navigations,
    };
    try {
      writeFileSync(this.file, JSON.stringify(report));
    } catch (error) {
      // Visible and one-time, matching `jsonl-reporter.ts`. The runner treats
      // a missing file as "the collector produced nothing", which is a
      // failure there -- so this cannot be swallowed into a green run.
      // eslint-disable-next-line no-console -- deliberate, one-time, visible failure notice; see module doc
      console.error(
        `[nav-timing-reporter] failed to write ${this.file}: ${(error as Error).message}`,
      );
    }
  }

  /** Writes to its own file, never stdout; the runner prints the table. */
  printsToStdio(): boolean {
    return false;
  }
}
