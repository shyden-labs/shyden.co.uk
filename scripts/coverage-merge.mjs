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
// scripts/coverage-processes.mjs (#899).
export const SUITES = ['unit', 'simulation', 'integration', 'processes'];

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
  branches: Object.entries(coverage.branchMap).flatMap(([id, branch]) =>
    branch.locations.map((arm, index) => {
      const loc = placed(arm) ? arm : branch.loc;
      return {
        key: `${keyOf(loc)}#${index}`,
        loc,
        count: coverage.b[id]?.[index] ?? 0,
      };
    }),
  ),
});

/**
 * Whether one report's place and another's, paired by order, are one node.
 * Lines that agree are; lines that differ are only where Vitest's remap moved
 * a parenthesis. Vitest re-prints a module with its parentheses dropped and
 * printed back with no mapping, so a node that opens with `(` is placed on
 * the token before it, and one whose last line opens with `)` ends a line
 * early (PR #926, runs 39715493288 and 39729419429: back-translate.ts's
 * `return (` … `);` 284-287 against Vitest's 284-286, its arm
 * `(sorted[…] + …) / 2` at 525:6 against 524:13, message.ts's
 * `(kind === …) ?? …` at 171:8 against 170:12). The process report, joined
 * last, holds the file's own places; with no text read, no line may move.
 *
 * @param {Counted} seen the place joined so far (Vitest's)
 * @param {Location} loc the place being joined (the process report's)
 * @param {readonly string[] | undefined} lines
 */
const sameNode = (seen, loc, lines) => {
  const start = loc.start?.line ?? 0;
  const end = loc.end?.line ?? 0;
  const opensWithParen = lines?.[start - 1]?.[loc.start?.column ?? -1] === '(';
  const closesWithParen = /^\s*\)/.test(lines?.[end - 1] ?? '');
  return (
    (seen.start === start || (seen.start < start && opensWithParen)) &&
    (seen.end === end || (seen.end < end && closesWithParen))
  );
};

/**
 * Adds one report's places to a file's join: by place when the join already
 * holds every one of them, otherwise by order (#899), which a report converted
 * outside Vitest needs, since Vitest's transform shifts columns. By order only
 * when both hold as many and every pair shares its lines, or differs only
 * where Vitest's remap moves a parenthesis (`movedByParens`).
 *
 * @param {Record<string, Counted>} into
 * @param {readonly Place[]} from
 * @param {string} file
 * @param {'statement' | 'branch arm'} what
 * @param {readonly string[] | undefined} lines the file's own text, if it was read
 * @returns {string | undefined} the refusal, if they cannot be joined
 */
const join = (into, from, file, what, lines) => {
  const keys = Object.keys(into);
  if (keys.length === 0 || from.every(({ key }) => key in into)) {
    for (const { key, loc, count } of from) add(into, key, loc, count);
    return undefined;
  }
  if (keys.length !== from.length)
    return `coverage-merge: ${file} holds a different number of ${what}s in two reports (${keys.length} and ${from.length}), so their counts cannot be joined`;
  for (const [index, { key, loc, count }] of from.entries()) {
    const ours = keys[index] ?? '';
    const seen = /** @type {Counted} */ (into[ours]);
    if (!sameNode(seen, loc, lines))
      return `coverage-merge: ${file} ${what} ${ours} in one report is ${key} in another, on other lines, so their counts cannot be joined`;
    seen.count += count;
  }
  return undefined;
};

/**
 * @param {readonly Record<string, FileCoverage>[]} maps
 * @param {string} root the repository, absolute
 * @param {(file: string) => string | undefined} [read] a file's own text, by its relative path; none read by default
 * @returns {{ merged: Record<string, LocatedCoverage> } | { refusal: string }}
 */
export const mergeMaps = (maps, root, read = () => undefined) => {
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
      const lines = read(relative)?.split('\n');
      const refusal =
        join(
          into.statements,
          places.statements,
          relative,
          'statement',
          lines,
        ) ??
        join(into.branches, places.branches, relative, 'branch arm', lines);
      if (refusal) refusals.push(refusal);
    }
  return refusals.length > 0 ? { refusal: refusals.join('\n') } : { merged };
};

const main = () => {
  if (process.argv.length > 2) die('usage: coverage-merge.mjs');
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
    // The file's own text, for the parenthesis Vitest's remap moves; a file
    // not in this checkout gets no such allowance.
    (file) => {
      const own = path.join(root, file);
      return existsSync(own) ? readFileSync(own, 'utf8') : undefined;
    },
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
