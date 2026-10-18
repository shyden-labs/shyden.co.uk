/**
 * Which spec files each CI e2e shard runs (#607).
 *
 * Playwright's own `--shard=i/N` gives every shard the same NUMBER of tests,
 * in project order, and a WebKit or Mobile Safari test costs about three times
 * a Chromium one. So the shard holding most of WebKit took 15.8-19.8 minutes
 * over four runs while the mean was 10.7-11.5, and one run hit the job's
 * 20-minute limit. This module splits by measured TIME instead: whole spec
 * files per project ("units"), longest first, each to the least-loaded shard.
 * Simulated on the same four runs, trained on one and judged on the next, the
 * slowest shard came within 3-6% of the mean (#607, comment 6250460434).
 *
 * The split is the operator's (2026-10-18, comment 6250507921): whole spec
 * files rather than single tests, so a renamed test never leaves the timings,
 * and timings refreshed by hand from a green CI run
 * (`scripts/e2e-shard-timings.mjs`).
 *
 * Every shard computes the same plan from the same unfiltered `--list`, so
 * nothing passes between jobs. What proves the shards ran the suite exactly
 * once is unchanged: each shard's account, added up in build-and-test
 * (`scripts/e2e-shards.mjs`).
 *
 * PURE: no process, no file. `scripts/test-e2e.mjs` wires it.
 */

/**
 * One spec file in one project, keyed exactly as a `--test-list` line names
 * it, so the plan's key IS the line Playwright reads.
 *
 * @typedef {{ key: string, tests: number }} Unit
 */

/**
 * @typedef {{ units: string[], seconds: number }} PlannedShard
 * @typedef {{ shards: PlannedShard[], unknown: string[], estimate: number }} Plan
 */

/** The list-mode reporter's test line: `  [project] › file:line:col › titles`. */
const LIST_LINE = /^ {2}\[([^\]]+)\] › (.+?):\d+:\d+ › /;
const LIST_FOOTER = /^Total: (\d+) tests? in \d+ files?$/m;

/**
 * Every unit `playwright test --list` printed, with its test count, in
 * listing order.
 *
 * Fail-closed: a line that looks like a test but cannot be read, or a count
 * that disagrees with the listing's own footer, throws. A unit dropped here
 * would be in no shard's test list, and the sum in build-and-test would be
 * the first to notice, three jobs later.
 *
 * @param {string} stdout
 * @returns {Unit[]}
 */
export function unitsOfListing(stdout) {
  const footer = LIST_FOOTER.exec(stdout);
  if (!footer)
    throw new Error('the listing has no `Total:` footer to count it against');

  /** @type {Map<string, number>} */
  const counts = new Map();
  let read = 0;
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('  ')) continue;
    const match = LIST_LINE.exec(line);
    if (!match)
      throw new Error(`cannot read listing line ${JSON.stringify(line)}`);
    const key = `[${match[1]}] › ${match[2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    read += 1;
  }

  const reported = Number(footer[1]);
  if (read !== reported)
    throw new Error(
      `read ${read} test lines but the listing reports ${reported}`,
    );
  return [...counts].map(([key, tests]) => ({ key, tests }));
}

/** @param {number[]} values non-empty */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Whole units across `total` shards: longest first, each to the shard with
 * the least time so far, ties to the lowest index. Sorted by time and then by
 * key, so the plan does not depend on the order the units arrive in, and
 * every shard of one run computes the same one.
 *
 * A unit the timings do not know, a spec file added since they were taken,
 * weighs the median of the listed units they do know, and is named in
 * `unknown`, so a stale file shows in every run's log rather than as a slow
 * shard nobody can explain.
 *
 * @param {readonly Unit[]} units
 * @param {Readonly<Record<string, number>>} timings seconds per unit key
 * @param {number} total
 * @returns {Plan}
 */
export function planShards(units, timings, total) {
  if (units.length < total)
    throw new Error(
      `${total} shards for ${units.length} spec files: a shard would run nothing`,
    );
  const known = units.filter(({ key }) => Object.hasOwn(timings, key));
  if (known.length === 0)
    throw new Error(
      `the timings know none of the ${units.length} spec files listed`,
    );

  const estimate = median(known.map(({ key }) => timings[key]));
  const weighed = units.map(({ key }) => ({
    key,
    seconds: Object.hasOwn(timings, key) ? timings[key] : estimate,
  }));
  weighed.sort(
    (a, b) =>
      b.seconds - a.seconds || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );

  /** @type {PlannedShard[]} */
  const shards = Array.from({ length: total }, () => ({
    units: /** @type {string[]} */ ([]),
    seconds: 0,
  }));
  for (const { key, seconds } of weighed) {
    let least = 0;
    for (let i = 1; i < total; i += 1)
      if (shards[i].seconds < shards[least].seconds) least = i;
    shards[least].units.push(key);
    shards[least].seconds += seconds;
  }

  return {
    shards,
    unknown: units
      .filter(({ key }) => !Object.hasOwn(timings, key))
      .map(({ key }) => key),
    estimate,
  };
}

/**
 * A shard's units as a `--test-list` file (Playwright 1.56+): a line of
 * `[project] › file` selects every test of that file in that project.
 *
 * @param {readonly string[]} keys
 */
export function testListText(keys) {
  return keys.map((key) => `${key}\n`).join('');
}

/**
 * The run's args without `--shard`, which the plan's `--test-list` replaces.
 * Left in, Playwright would split the shard's own list a second time.
 *
 * @param {readonly string[]} args
 * @returns {string[]}
 */
export function withoutShardArgs(args) {
  const kept = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith('--shard=')) continue;
    if (args[i] === '--shard') {
      i += 1;
      continue;
    }
    kept.push(args[i]);
  }
  return kept;
}

/**
 * The committed timings file (`scripts/e2e-shard-timings.mjs` writes it), or
 * a refusal naming the entry that is wrong. A time that is not a number
 * would sort as NaN and quietly scramble the plan.
 *
 * @param {string} text
 * @returns {{ source: string, seconds: Record<string, number> }}
 */
export function readTimings(text) {
  const parsed = JSON.parse(text);
  if (typeof parsed?.source !== 'string' || parsed.source === '')
    throw new Error('the timings file names no source run');
  const seconds = parsed.seconds;
  if (typeof seconds !== 'object' || seconds === null || Array.isArray(seconds))
    throw new Error('the timings file holds no `seconds` record');
  for (const [key, value] of Object.entries(seconds))
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      throw new Error(
        `${JSON.stringify(key)} is not a number of seconds: ${JSON.stringify(value)}`,
      );
  return { source: parsed.source, seconds };
}

/**
 * What a CI shard hands Playwright when `E2E_SHARD_PLAN` names a timings
 * file: its own spec files as a `--test-list`, in place of `--shard`. `null`
 * when no plan was asked for, which leaves Playwright's count split.
 *
 * Refused on a run that is not a shard, where there is nothing to split, and
 * on a capture shard (`E2E_ENUMERATE=selection`), which counts the selection
 * it was handed: a plan built from the whole suite would hand it spec files
 * outside that selection.
 *
 * @param {{
 *   planFile: string | undefined,
 *   shard: { index: number, total: number } | null,
 *   selection: boolean,
 *   listing: string,
 *   timingsText: string,
 *   passthrough: readonly string[],
 *   listPath: string,
 * }} run
 * @returns {{ args: string[], testList: string, report: string } | null}
 */
export function plannedRun({
  planFile,
  shard,
  selection,
  listing,
  timingsText,
  passthrough,
  listPath,
}) {
  if (!planFile) return null;
  if (!shard)
    throw new Error('E2E_SHARD_PLAN is set on a run that is not a shard');
  if (selection)
    throw new Error('E2E_SHARD_PLAN is refused with E2E_ENUMERATE=selection');

  const units = unitsOfListing(listing);
  const { source, seconds } = readTimings(timingsText);
  const plan = planShards(units, seconds, shard.total);
  const mine = plan.shards[shard.index - 1];
  // AC4 MUTANT (measuring branch, never merged): shard 3 swaps one of its spec
  // files for another shard's file of the same test count, so the counts still
  // add up while one file runs twice and the other nowhere.
  if (shard.index === 3) {
    const count = new Map(units.map(({ key, tests }) => [key, tests]));
    const others = plan.shards.flatMap((s, i) => (i === 2 ? [] : s.units));
    const at = mine.units.findIndex((k) =>
      others.some((o) => count.get(o) === count.get(k)),
    );
    mine.units[at] = /** @type {string} */ (
      others.find((o) => count.get(o) === count.get(mine.units[at]))
    );
  }

  const lines = [
    `shard ${shard.index} of ${shard.total} runs ${mine.units.length} of ${units.length} spec files, ` +
      `estimated ${(mine.seconds / 60).toFixed(1)} test-minutes, planned from run ${source}`,
  ];
  if (plan.unknown.length > 0)
    lines.push(
      `${plan.unknown.length} spec file${plan.unknown.length === 1 ? '' : 's'} the timings do not know, ` +
        `weighed at ${Math.round(plan.estimate)} s: ${plan.unknown.join(', ')}`,
    );

  return {
    args: [...withoutShardArgs(passthrough), '--test-list', listPath],
    testList: testListText(mine.units),
    report: lines.join('\n'),
  };
}

/** A run-time list reporter line, as a CI log holds it. */
const LOG_LINE =
  /[✓✘]\s+\d+\s+\[([^\]]+)\] › (\S+?):\d+:\d+ › .*? \((\d+(?:\.\d+)?)(ms|s|m)\)\s*$/;
/** @type {Record<string, number>} */
const UNIT_SECONDS = { ms: 0.001, s: 1, m: 60 };

/**
 * Seconds per unit, summed over the tests CI's shard logs report.
 *
 * The run-time reporter prints a path from the repository root
 * (`tests/e2e/a.spec.ts`), while `--list` and `--test-list` both resolve
 * against the config's test directory (`a.spec.ts`). `testDir` is stripped
 * here, and a path outside it throws rather than becoming a key no listing
 * will ever match.
 *
 * @param {readonly string[]} logs
 * @param {string} testDir e.g. `tests/e2e/`
 * @returns {Record<string, number>}
 */
export function timingsFromLogs(logs, testDir) {
  /** @type {Record<string, number>} */
  const seconds = {};
  let read = 0;
  for (const log of logs) {
    for (const line of log.split('\n')) {
      const match = LOG_LINE.exec(line);
      if (!match) continue;
      const [, project, path, value, unit] = match;
      if (!path.startsWith(testDir))
        throw new Error(`${path} is not under ${testDir}`);
      const key = `[${project}] › ${path.slice(testDir.length)}`;
      seconds[key] = (seconds[key] ?? 0) + Number(value) * UNIT_SECONDS[unit];
      read += 1;
    }
  }
  if (read === 0)
    throw new Error(
      `no test durations in ${logs.length} log${logs.length === 1 ? '' : 's'}`,
    );
  return seconds;
}
