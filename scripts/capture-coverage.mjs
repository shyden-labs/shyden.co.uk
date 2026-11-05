// @ts-check
/**
 * Every case the release page cites takes its picture (#774; operator ruling
 * 2026-10-14: a cited case that runs but takes no picture is FIXED so it
 * captures, never dropped from the page, and that is caught per pull request).
 *
 * `release-inventory.mjs --tests` selects capturing tests by the `file:line`
 * of their `test(` call, and a loop generates every case at that one line, so
 * a case whose `shoot()` is conditional is selected and captures nothing. v4
 * found 64 such cases only at the first page build (#765).
 *
 * Reads a capture run's evidence directory (`EVIDENCE_DIR`): its report says
 * which cases passed on which engine, its manifest which took a picture. Every
 * passed case with no picture of this run is named, by engine and title, in
 * one run. A case that did not pass is not judged here: the e2e suite judges
 * that. A run that captured nothing, or in which nothing passed, is refused:
 * it proved nothing.
 *
 *   node scripts/capture-coverage.mjs <evidence-dir>
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { capturesOfThisRun, flattenReport } from './build-evidence-page.mjs';
import { EVIDENCE_MANIFEST, EVIDENCE_REPORT } from './evidence-files.mjs';

/**
 * @param {{ report: any, manifest: any[] }} run
 * @returns {{ judged: ReturnType<typeof flattenReport>, missing: string[] }}
 */
export const uncaptured = ({ report, manifest }) => {
  const judged = flattenReport(report).filter((s) => s.status === 'passed');
  if (!judged.length)
    throw new Error(
      'capture-coverage: no case passed in this run, so nothing was judged',
    );
  // Only this run's rows: an earlier run's picture is not this case's.
  const { current } = capturesOfThisRun(manifest, report);
  const pictured = new Set(
    current.map(
      (/** @type {{ project: string, title: string }} */ r) =>
        `${r.project}\u0000${r.title}`,
    ),
  );
  const missing = judged
    .filter((s) => !pictured.has(`${s.project}\u0000${s.title}`))
    .map((s) => `${s.project} › ${s.title}`);
  return { judged, missing };
};

const main = () => {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node scripts/capture-coverage.mjs <evidence-dir>');
    process.exitCode = 2;
    return;
  }
  const report = JSON.parse(readFileSync(join(dir, EVIDENCE_REPORT), 'utf8'));
  const manifest = readFileSync(join(dir, EVIDENCE_MANIFEST), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const { judged, missing } = uncaptured({ report, manifest });
  const engines = new Set(judged.map((s) => s.project)).size;
  console.log(
    `capture-coverage: judged ${judged.length} passed case(s) on ${engines} ` +
      `engine(s); ${missing.length} took no picture`,
  );
  if (missing.length) {
    for (const m of missing) console.log(`  no picture: ${m}`);
    console.log(
      'Each of these is cited by the release page and must capture: fix the ' +
        'test so it calls shoot() on every path, never drop it (#774).',
    );
    process.exitCode = 1;
  }
};

// Only when run, never when imported: the unit suite imports the verdict.
if (import.meta.main) main();
