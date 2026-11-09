/**
 * Every target runs the same suite, so every target's total (passed + failed +
 * skipped) must be the same and nothing may be skipped (#1049). Pure: no
 * process, no file. The phone run fails on it; CI only prints it until #1056.
 */

/**
 * @typedef {{ passed: number, failed: number, skipped: number }} Counts
 * @typedef {Counts & { target: string }} Target
 */

/** @param {Counts} counts */
const totalOf = ({ passed, failed, skipped }) => passed + failed + skipped;

/** @param {Target} target */
export function totalLine(target) {
  return (
    `${target.target}: ${target.passed} passed, ${target.failed} failed, ` +
    `${target.skipped} skipped (total ${totalOf(target)})`
  );
}

/**
 * @param {readonly Target[]} targets
 * @returns {{ ok: boolean, lines: string[], reason?: string }}
 */
export function evenTotals(targets) {
  const lines = targets.map(totalLine);
  if (targets.length === 0)
    return { ok: false, lines, reason: 'no target reported a total' };
  const problems = [];
  const totals = new Set(targets.map(totalOf));
  if (totals.size > 1)
    problems.push(
      'uneven totals: ' +
        targets.map((t) => `${t.target}: ${totalOf(t)}`).join(', '),
    );
  const skipping = targets.filter((t) => t.skipped > 0);
  if (skipping.length > 0)
    problems.push(
      'skipped tests: ' +
        skipping.map((t) => `${t.target}: ${t.skipped} skipped`).join(', '),
    );
  return problems.length === 0
    ? { ok: true, lines }
    : { ok: false, lines, reason: problems.join('; ') };
}

/**
 * Each Playwright project's own counts, read from the tests in the report and
 * never from its run-wide `stats`. `flaky` (failed, then passed on a retry)
 * counts as failed, as the gauntlet's verdict does.
 *
 * @param {Record<string, any>} report
 * @returns {Record<string, Counts>}
 */
export function countByProject(report) {
  /** @type {Record<string, Counts>} */
  const byProject = {};
  /** @param {any[] | undefined} suites */
  const visit = (suites) => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? [])
        for (const test of spec.tests ?? []) {
          const counts = (byProject[test.projectName] ??= {
            passed: 0,
            failed: 0,
            skipped: 0,
          });
          if (test.status === 'expected') counts.passed += 1;
          else if (test.status === 'skipped') counts.skipped += 1;
          else counts.failed += 1;
        }
      visit(suite.suites);
    }
  };
  visit(report?.suites);
  return byProject;
}

/** @param {Record<string, any>} report a vitest JSON report */
export function vitestCounts(report) {
  return {
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: report.numPendingTests + report.numTodoTests,
  };
}

/** Projects that are not a browser running the shared suite. */
const NOT_A_TARGET = new Set(['android-preflight']);

/**
 * The targets of a phone run: one per desktop browser project, one for the
 * Android phone (its projects added together, its tests excluded by design
 * counted as skipped) and one for the iPhone. A group with no report is left
 * out; the run's verdict already fails it by name.
 *
 * @param {{
 *   desktop: Record<string, any> | null,
 *   android: Record<string, any> | null,
 *   ios: Record<string, any> | null,
 *   excludedByDesign?: number,
 * }} reports
 * @returns {Target[]}
 */
export function deviceTargets({ desktop, android, ios, excludedByDesign = 0 }) {
  /** @type {Target[]} */
  const targets = [];
  if (desktop)
    for (const [name, counts] of Object.entries(countByProject(desktop)))
      if (!NOT_A_TARGET.has(name)) targets.push({ target: name, ...counts });
  if (android) {
    const sum = { passed: 0, failed: 0, skipped: excludedByDesign };
    for (const [name, counts] of Object.entries(countByProject(android))) {
      if (NOT_A_TARGET.has(name)) continue;
      sum.passed += counts.passed;
      sum.failed += counts.failed;
      sum.skipped += counts.skipped;
    }
    targets.push({ target: 'android', ...sum });
  }
  if (ios) targets.push({ target: 'ios', ...vitestCounts(ios) });
  return targets;
}
