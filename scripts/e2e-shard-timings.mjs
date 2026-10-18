#!/usr/bin/env node
/**
 * Rewrites `tests/e2e-shard-timings.json`, the seconds per spec file per
 * project that CI's e2e shards are planned from (`scripts/e2e-shard-plan.mjs`,
 * #607), from a green CI run's shard logs.
 *
 * Run by hand (operator ruling 2026-10-18): the laptop never runs the e2e
 * suite, so the timings only ever come from CI. When build-and-test's shard
 * table shows the slowest shard drifting from the mean, or the plan names
 * spec files the timings do not know, refresh it:
 *
 *   run=<id of a green ci.yml run>
 *   mkdir -p shard-logs
 *   gh run view "$run" --json jobs \
 *     -q '.jobs[] | select(.name|startswith("e2e shard")) | .databaseId' |
 *     while read -r job; do gh run view --job "$job" --log > "shard-logs/$job.log"; done
 *   node scripts/e2e-shard-timings.mjs --source "$run" shard-logs/*.log
 *
 * and commit the file in a pull request of its own.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { timingsFromLogs } from './e2e-shard-plan.mjs';

/** Playwright's `testDir` (`playwright.config.ts`), as the logs print it. */
export const TEST_DIR = 'tests/e2e/';
export const TIMINGS_FILE = 'tests/e2e-shard-timings.json';

/**
 * The file's content: keys sorted, seconds to one decimal, so a refresh's
 * diff shows only what moved.
 *
 * @param {string} source the run the logs came from
 * @param {Record<string, number>} seconds
 */
export function timingsFileText(source, seconds) {
  const sorted = Object.fromEntries(
    Object.keys(seconds)
      .sort()
      .map((key) => [key, Math.round(seconds[key] * 10) / 10]),
  );
  return `${JSON.stringify({ source, seconds: sorted }, null, 2)}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--source');
  const source = at === -1 ? undefined : args[at + 1];
  const logs = args.filter((_, i) => i !== at && i !== at + 1);
  if (!source || logs.length === 0) {
    console.error(
      'usage: node scripts/e2e-shard-timings.mjs --source <run id> <shard log>...',
    );
    process.exitCode = 2;
    return;
  }
  const seconds = timingsFromLogs(
    logs.map((file) => readFileSync(file, 'utf8')),
    TEST_DIR,
  );
  writeFileSync(TIMINGS_FILE, timingsFileText(source, seconds));
  console.log(
    `${TIMINGS_FILE}: ${Object.keys(seconds).length} spec files, from run ${source}`,
  );
}

// Only when run, never when imported (#221, `tests/guards/script-entry.test.ts`).
if (import.meta.main) main();
