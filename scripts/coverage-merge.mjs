/**
 * Joins the Vitest suites' V8 coverage reports into one (#896).
 *
 * Each suite (`npm run test:coverage`, `test:coverage:<suite>`) writes
 * `coverage/<suite>/coverage-final.json` in Istanbul's shape. A suite
 * transforms each file on its own, so one statement can carry a different id
 * in two reports: counts are joined by WHERE the code is (`line:col-line:col`),
 * never by id. Branch arms are keyed the same way, plus their index; an arm
 * with no place of its own (an implicit `else`) takes its branch's, marked
 * `:implicit`. Two places one report keys alike are refused, never summed.
 * Every report of a file lists the same places, the process reports too,
 * which are converted on Vitest's own transform (#913): a place one report
 * lists and another does not is refused, naming it.
 *
 *   node scripts/coverage-merge.mjs
 *
 * writes `coverage/merged/coverage.json` and `coverage/merged/tree.txt`, the
 * tree the reports measured, which `scripts/coverage-changed.mjs` checks
 * before it trusts them. A missing report is refused, naming it: a suite that
 * failed writes none, so a red run can never pass as measured.
 * `tests/unit/coverage-merge.test.ts` holds the joining;
 * `tests/integration/coverage-merge-script.test.ts` runs it against a real
 * repository.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { die, messageOf, nonEmpty } from './errors.mjs';

/**
 * A place in a file, and a span between two; `FileCoverage` is one file as
 * Istanbul writes it; `LocatedCoverage` is one file joined, every statement
 * and branch arm by where it is, with its `Counted` lines and runs.
 *
 * @typedef {{ line?: number, column?: number }} Position
 * @typedef {{ start?: Position, end?: Position }} Location
 * @typedef {{
 *   path: string,
 *   statementMap: Record<string, Location>,
 *   s: Record<string, number>,
 *   branchMap: Record<string, { loc: Location, locations: Location[] }>,
 *   b: Record<string, number[]>,
 *   fnMap: Record<string, unknown>,
 *   f: Record<string, number>,
 * }} FileCoverage
 * @typedef {{ start: number, end: number, count: number }} Counted
 * @typedef {{ statements: Record<string, Counted>, branches: Record<string, Counted> }} LocatedCoverage
 */

/** The suites whose reports are joined, in the order they are read. */
// Not guards: under coverage its whole-tree scans cannot meet the suite's
// 25 s limit (the duplication guard took 64 s on PR #903's first run), and no
// limit is raised. Code only a guard runs therefore reads as unrun.
// `processes`: what the integration suite's child processes ran, converted by
// scripts/coverage-processes.mjs (#899). `vitest-main`: what the coverage
// commands' own Vitest main processes loaded natively, the configs and
// reporters (#912, tests/main-coverage.ts), converted the same way.
export const SUITES = [
  'unit',
  'simulation',
  'integration',
  'processes',
  'vitest-main',
];

/** @param {Location} loc */
const placed = (loc) =>
  loc.start?.line !== undefined && loc.end?.line !== undefined;

/** @param {Location} loc */
const keyOf = (loc) =>
  `${loc.start?.line}:${loc.start?.column}-${loc.end?.line}:${loc.end?.column}`;

/**
 * @param {Record<string, Counted>} into
 * @param {string} key
 * @param {Location} loc
 * @param {number} count
 */
const add = (into, key, loc, count) => {
  const seen = into[key];
  if (seen) seen.count += count;
  else
    into[key] = {
      start: loc.start?.line ?? 0,
      end: loc.end?.line ?? 0,
      count,
    };
};

/**
 * One report's statements, or its branch arms, in the report's own order.
 *
 * @typedef {{ key: string, loc: Location, count: number }} Place
 * @param {FileCoverage} coverage
 * @returns {{ statements: Place[], branches: Place[] }}
 */
const placesOf = (coverage) => ({
  statements: Object.entries(coverage.statementMap).map(([id, loc]) => ({
    key: keyOf(loc),
    loc,
    count: coverage.s[id] ?? 0,
  })),
  // An implicit arm's key says it has no place of its own: in an `else if`,
  // the outer `else` is placed on the inner `if`, whose implicit `else` takes
  // that same place at the same index (#960).
  branches: Object.entries(coverage.branchMap).flatMap(([id, branch]) =>
    branch.locations.map((arm, index) => {
      const own = placed(arm);
      const loc = own ? arm : branch.loc;
      return {
        key: `${keyOf(loc)}#${index}${own ? '' : ':implicit'}`,
        loc,
        count: coverage.b[id]?.[index] ?? 0,
      };
    }),
  ),
});

/**
 * The first key one report gives two of its places, if any: their counts
 * would be summed into one, so an arm no test ran could read as run (#960).
 *
 * @param {readonly Place[]} from
 */
const placedTwice = (from) => {
  const seen = new Set();
  return from.find(({ key }) => seen.size === seen.add(key).size)?.key;
};

/**
 * Adds one report's places to a file's join. Every report of a file lists the
 * same places, since each suite's is Vitest's own conversion of Vitest's own
 * transform (the process reports too, #913), so a place one report lists and
 * another does not is refused, never paired by order.
 *
 * @param {Record<string, Counted>} into
 * @param {readonly Place[]} from
 * @param {string} file
 * @param {'statement' | 'branch arm'} what
 * @returns {string | undefined} the refusal, if they cannot be joined
 */
const join = (into, from, file, what) => {
  const twice = placedTwice(from);
  if (twice !== undefined)
    return `coverage-merge: ${file} places two ${what}s at ${twice} in one report, so their counts cannot be told apart`;
  const keys = Object.keys(into);
  if (keys.length > 0) {
    const listed = new Set(from.map(({ key }) => key));
    const alone =
      from.find(({ key }) => !(key in into))?.key ??
      keys.find((key) => !listed.has(key));
    if (alone !== undefined)
      return `coverage-merge: ${file} lists the ${what} at ${alone} in one report and not in another, so their counts cannot be joined`;
  }
  for (const { key, loc, count } of from) add(into, key, loc, count);
  return undefined;
};

/**
 * @param {readonly Record<string, FileCoverage>[]} maps
 * @param {string} root the repository, absolute
 * @returns {{ merged: Record<string, LocatedCoverage> } | { refusal: string }}
 */
export const mergeMaps = (maps, root) => {
  if (maps.length === 0)
    return { refusal: 'coverage-merge: no report to merge' };
  /** @type {Record<string, LocatedCoverage>} */
  const merged = {};
  // Every file that cannot be joined is named, so one run lists them all.
  /** @type {string[]} */
  const refusals = [];
  for (const map of maps)
    for (const [file, coverage] of Object.entries(map)) {
      const relative = path.posix.relative(root, file);
      if (relative.startsWith('..') || path.posix.isAbsolute(relative))
        return {
          refusal: `coverage-merge: ${file} is outside ${root}, so no change can be judged against it`,
        };
      const into = (merged[relative] ??= { statements: {}, branches: {} });
      const places = placesOf(coverage);
      const refusal =
        join(into.statements, places.statements, relative, 'statement') ??
        join(into.branches, places.branches, relative, 'branch arm');
      if (refusal) refusals.push(refusal);
    }
  return refusals.length > 0 ? { refusal: refusals.join('\n') } : { merged };
};

/**
 * Every report the merge reads: the Vitest suites', then each Playwright
 * run's under `coverage/playwright/<run>/` (#913), when the run names them.
 * A run that names them and holds none is refused, never merged as if
 * Playwright ran nothing.
 *
 * @param {readonly string[] | undefined} playwrightRuns the folders under coverage/playwright, or undefined when the run has none
 * @returns {{ reports: string[] } | { refusal: string }}
 */
export const reportPaths = (playwrightRuns) => {
  const suites = SUITES.map((suite) =>
    path.posix.join('coverage', suite, 'coverage-final.json'),
  );
  if (playwrightRuns === undefined) return { reports: suites };
  if (playwrightRuns.length === 0)
    return {
      refusal:
        'coverage-merge: --playwright names no run under coverage/playwright, so what Playwright ran would read as unmeasured',
    };
  return {
    reports: [
      ...suites,
      ...[...playwrightRuns]
        .sort()
        .map((run) =>
          path.posix.join('coverage', 'playwright', run, 'coverage-final.json'),
        ),
    ],
  };
};

const main = () => {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--playwright'))
    die('usage: coverage-merge.mjs [--playwright]');
  const root = process.cwd();
  /** @type {string[] | undefined} */
  let runs;
  if (args[0] === '--playwright')
    try {
      runs = nonEmpty(
        readdirSync(path.join('coverage', 'playwright')),
        'Playwright runs under coverage/playwright',
      );
    } catch (error) {
      die(`coverage-merge: --playwright: ${messageOf(error)}`);
    }
  const paths = reportPaths(runs);
  if ('refusal' in paths) die(paths.refusal);
  const { reports } = paths;
  const missing = reports.filter((report) => !existsSync(report));
  if (missing.length > 0)
    die(
      `coverage-merge: no report at ${missing.join(', ')}. A suite that failed writes none; run it with --coverage first.`,
    );
  const result = mergeMaps(
    reports.map(
      (report) =>
        /** @type {Record<string, FileCoverage>} */ (
          JSON.parse(readFileSync(report, 'utf8'))
        ),
    ),
    root,
  );
  if ('refusal' in result) die(result.refusal);
  mkdirSync(path.join('coverage', 'merged'), { recursive: true });
  writeFileSync(
    path.join('coverage', 'merged', 'coverage.json'),
    `${JSON.stringify(result.merged)}\n`,
  );
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
    encoding: 'utf8',
  }).trim();
  writeFileSync(path.join('coverage', 'merged', 'tree.txt'), `${tree}\n`);
  console.log(
    `coverage-merge: ${reports.length} reports, ${Object.keys(result.merged).length} files, tree ${tree}`,
  );
};

if (import.meta.main) main();
