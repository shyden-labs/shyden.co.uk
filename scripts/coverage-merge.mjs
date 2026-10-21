/**
 * Joins the Vitest suites' V8 coverage reports into one (#896).
 *
 * Each suite (`npm run test:coverage`, `test:coverage:<suite>`) writes
 * `coverage/<suite>/coverage-final.json` in Istanbul's shape. A suite
 * transforms each file on its own, so one statement can carry a different id
 * in two reports: counts are joined by WHERE the code is (`line:col-line:col`),
 * never by id. Branch arms are keyed the same way, plus their index; an arm
 * with no place of its own (an implicit `else`) takes its branch's.
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { die } from './errors.mjs';

/** @typedef {{ line?: number, column?: number }} Position */
/** @typedef {{ start?: Position, end?: Position }} Location */
/**
 * One file as Istanbul writes it.
 * @typedef {{
 *   path: string,
 *   statementMap: Record<string, Location>,
 *   s: Record<string, number>,
 *   branchMap: Record<string, { loc: Location, locations: Location[] }>,
 *   b: Record<string, number[]>,
 *   fnMap: Record<string, unknown>,
 *   f: Record<string, number>,
 * }} FileCoverage
 */
/** @typedef {{ start: number, end: number, count: number }} Counted */
/**
 * One file, joined: every statement and branch arm by where it is.
 * @typedef {{ statements: Record<string, Counted>, branches: Record<string, Counted> }} LocatedCoverage
 */

/** The suites whose reports are joined, in the order they are read. */
export const SUITES = ['unit', 'guards', 'simulation', 'integration'];

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
 * @param {readonly Record<string, FileCoverage>[]} maps
 * @param {string} root the repository, absolute
 * @returns {{ merged: Record<string, LocatedCoverage> } | { refusal: string }}
 */
export const mergeMaps = (maps, root) => {
  if (maps.length === 0)
    return { refusal: 'coverage-merge: no report to merge' };
  /** @type {Record<string, LocatedCoverage>} */
  const merged = {};
  for (const map of maps)
    for (const [file, coverage] of Object.entries(map)) {
      const relative = path.posix.relative(root, file);
      if (relative.startsWith('..') || path.posix.isAbsolute(relative))
        return {
          refusal: `coverage-merge: ${file} is outside ${root}, so no change can be judged against it`,
        };
      const into = (merged[relative] ??= { statements: {}, branches: {} });
      for (const [id, loc] of Object.entries(coverage.statementMap))
        add(into.statements, keyOf(loc), loc, coverage.s[id] ?? 0);
      for (const [id, branch] of Object.entries(coverage.branchMap))
        branch.locations.forEach((arm, index) => {
          const loc = placed(arm) ? arm : branch.loc;
          add(
            into.branches,
            `${keyOf(loc)}#${index}`,
            loc,
            coverage.b[id]?.[index] ?? 0,
          );
        });
    }
  return { merged };
};

const main = () => {
  const root = process.cwd();
  const reports = SUITES.map((suite) =>
    path.join('coverage', suite, 'coverage-final.json'),
  );
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
