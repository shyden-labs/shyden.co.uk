import type { Suite, TestCase } from '@playwright/test/reporter';

/**
 * Where a reported test sits in the run, derived from the suite hierarchy
 * rather than from string indexing.
 *
 * One home for both, because `jsonl-reporter.ts` and `nav-timing-reporter.ts`
 * both need the project name and would otherwise carry the same walk twice --
 * the duplication `one-home.test.ts` exists to stop, in a directory it does
 * not yet scan.
 */

/**
 * Suite hierarchy is documented (testReporter.d.ts, `Suite.type`) as
 * root -> project -> file -> describe -> ...describe -> test. Walking up to
 * the first `project`-typed suite and reading its title (documented as
 * "Project name for project suite") is more direct than indexing into
 * `test.titlePath()`, which would silently misattribute the project name if
 * the hierarchy ever gained or lost a level.
 */
export function projectNameOf(test: TestCase): string {
  let suite: Suite | undefined = test.parent;
  while (suite && suite.type !== 'project') suite = suite.parent;
  return suite?.title || 'unknown-project';
}

/**
 * The test's own title with its enclosing `describe` titles, outermost first
 * -- what a human needs to find the test again, and what Playwright's own
 * output prints. Built by climbing to the `file`-typed suite for the same
 * reason as above: `titlePath()` would need a fixed slice offset, which is a
 * silent misattribution the day the hierarchy changes shape.
 */
export function describePathOf(test: TestCase): string {
  const titles: string[] = [test.title];
  let suite: Suite | undefined = test.parent;
  while (suite && suite.type === 'describe') {
    titles.unshift(suite.title);
    suite = suite.parent;
  }
  return titles.join(' › ');
}
