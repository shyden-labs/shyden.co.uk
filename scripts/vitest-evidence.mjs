// @ts-check
/**
 * A real-device iOS run's Vitest JSON report, read as the Playwright report
 * the evidence page builder already understands (#354).
 *
 * The iOS leg drives a real iPhone over WebDriver under Vitest, so it writes
 * Vitest's report, not Playwright's, and the builder refused it. Rather than
 * teach every part of the builder a second format, the report is rebuilt in
 * the one shape it reads: a file suite holding its describes as nested
 * suites, one spec per test. `flattenReport` then spells a journey the way it
 * spells a Playwright one, the describes and the test joined with ` > `,
 * which is also exactly what `expect.getState().currentTestName` gives the
 * capture (measured 2026-10-15: "en > Journey 14 -- a > b"), so a capture and
 * its test name the same journey by construction.
 *
 * Refuses rather than guesses: a status it does not know, a run test with no
 * duration, a file outside the root or with no end time, a report with no
 * start time.
 */
import path from 'node:path';

/** Vitest's statuses for a test that did not run, read as Playwright's one. */
const NOT_RUN = new Set(['skipped', 'pending', 'todo', 'disabled']);
/** Vitest's statuses for a test that ran. */
const RAN = new Set(['passed', 'failed']);

/**
 * @param {unknown} report Vitest's JSON report (`JsonTestResults`).
 * @param {{ project: string, root: string }} options `project` names the leg
 *   on the page; `root` is the repository, so a file reads as Playwright's
 *   does, relative to it.
 * @returns {{ stats: ShapedStats, suites: any[] }}
 */
export const playwrightShapeOfVitest = (report, { project, root }) => {
  const r = /** @type {Record<string, unknown>} */ (
    typeof report === 'object' && report !== null ? report : {}
  );
  if (typeof r.startTime !== 'number' || !Number.isFinite(r.startTime))
    throw new Error(
      `the Vitest report has no startTime (got ${JSON.stringify(r.startTime)}), ` +
        "so no capture can be told apart from an earlier run's",
    );
  if (!Array.isArray(r.testResults))
    throw new Error('the Vitest report has no testResults list');

  const outcomes = { passed: 0, failed: 0, skipped: 0 };
  let lastEnd = r.startTime;
  const suites = r.testResults.map((/** @type {any} */ file) => {
    const relative = path.relative(root, String(file.name));
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error(`${file.name} is not under ${root}`);
    if (typeof file.endTime !== 'number' || !Number.isFinite(file.endTime))
      throw new Error(
        `${file.name} has no endTime, so the run's wall clock is unknown`,
      );
    lastEnd = Math.max(lastEnd, file.endTime);
    /** @type {any} */
    const fileSuite = {
      title: relative,
      file: relative,
      suites: [],
      specs: [],
    };
    for (const a of file.assertionResults ?? []) {
      const ancestors = /** @type {string[]} */ (a.ancestorTitles ?? []);
      const journey = [...ancestors, a.title].join(' > ');
      let status;
      let duration;
      if (RAN.has(a.status)) {
        if (typeof a.duration !== 'number')
          throw new Error(`${journey}: a ${a.status} test carries no duration`);
        status = a.status;
        // Vitest measures in fractions of a millisecond; Playwright, whose
        // shape the page reads, reports whole ones.
        duration = Math.round(a.duration);
      } else if (NOT_RUN.has(a.status)) {
        status = 'skipped';
        duration = 0;
      } else
        throw new Error(
          `${journey}: Vitest status ${JSON.stringify(a.status)} is not one this reader knows`,
        );
      outcomes[/** @type {'passed' | 'failed' | 'skipped'} */ (status)] += 1;
      // Down the describes, making each one the first time it is met, so two
      // tests in one describe share its suite as Playwright's do.
      let suite = fileSuite;
      for (const title of ancestors) {
        let child = suite.suites.find(
          (/** @type {any} */ s) => s.title === title,
        );
        if (!child) {
          child = { title, suites: [], specs: [] };
          suite.suites.push(child);
        }
        suite = child;
      }
      suite.specs.push({
        title: a.title,
        file: relative,
        tests: [
          {
            projectName: project,
            results: [{ status, duration, attachments: [] }],
          },
        ],
      });
    }
    return fileSuite;
  });
  // The page's summary tiles read these, as they read a Playwright run's.
  // Vitest retries nothing here, so nothing is flaky.
  return {
    stats: {
      startTime: new Date(r.startTime).toISOString(),
      duration: Math.round(lastEnd - r.startTime),
      expected: outcomes.passed,
      unexpected: outcomes.failed,
      flaky: 0,
      skipped: outcomes.skipped,
    },
    suites,
  };
};

/**
 * @typedef {{
 *   startTime: string,
 *   duration: number,
 *   expected: number,
 *   unexpected: number,
 *   flaky: number,
 *   skipped: number,
 * }} ShapedStats
 */
