/**
 * The changed-line verdict (#896): every line a change adds to code, checked
 * against the joined coverage of every suite (`scripts/coverage-merge.mjs`).
 *
 * A changed line inside a statement no test ran is "unrun", as is a branch arm
 * no test took that holds a changed line (once, at its first). A changed line
 * in a code file no suite measured is "unmeasured", never counted as run.
 * Tests (`*.test.ts`, `*.spec.ts`) and type declarations are not judged; a
 * changed line with no statement, such as a comment, is not judged either.
 *
 *   node scripts/coverage-changed.mjs [--report-only]
 *
 * prints the verdict as markdown for the job summary. It judges HEAD against
 * its merge base with origin/develop, and only a report recorded for HEAD's
 * tree: a missing or stale report fails, naming which, in either mode. With
 * `--report-only` the findings do not fail the run, which is how CI runs it
 * until #899-#901 measure everything and #902 makes it a gate (Shyden
 * 2026-10-21, "Measure all first"). `tests/unit/coverage-changed.test.ts`
 * holds the verdict; `tests/integration/coverage-changed-script.test.ts` runs
 * it against a real repository.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { argv } from 'node:process';
import { die } from './errors.mjs';

/**
 * @typedef {import('./coverage-merge.mjs').LocatedCoverage} LocatedCoverage
 * @typedef {{ file: string, line: number, kind: 'line' | 'branch' }} Finding
 * @typedef {{ unrun: Finding[], unmeasured: Finding[], judged: number }} Verdict
 */

const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs|astro)$/;
const NOT_JUDGED = /(\.d\.ts|\.test\.ts|\.spec\.ts)$/;

/**
 * Whether a changed file is code a test should run.
 * @param {string} file
 */
export const isJudged = (file) => CODE.test(file) && !NOT_JUDGED.test(file);

/**
 * The lines each file gains, from `git diff --unified=0`, keyed by the path
 * after the change. A deleted file, a binary file and a hunk that only
 * removes lines give nothing. A path git quoted is refused, not guessed.
 * @param {string} diff
 * @returns {Map<string, Set<number>>}
 */
export const changedLines = (diff) => {
  /** @type {Map<string, Set<number>>} */
  const changed = new Map();
  /** @type {string | undefined} */
  let file;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) file = undefined;
    else if (line.startsWith('+++ ')) {
      const target = line.slice(4);
      if (target.startsWith('"'))
        throw new Error(
          `coverage-changed: git quoted the path ${target}; run git with core.quotePath=false`,
        );
      file = target === '/dev/null' ? undefined : target.replace(/^b\//, '');
    } else if (line.startsWith('@@ ') && file !== undefined) {
      const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!hunk)
        throw new Error(`coverage-changed: cannot read hunk "${line}"`);
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (count === 0) continue;
      const set = changed.get(file) ?? new Set();
      for (let at = start; at < start + count; at += 1) set.add(at);
      changed.set(file, set);
    }
  }
  return changed;
};

/**
 * @param {ReadonlyMap<string, ReadonlySet<number>>} changed
 * @param {Readonly<Record<string, LocatedCoverage>>} merged
 * @returns {Verdict}
 */
export const judge = (changed, merged) => {
  /** @type {Verdict} */
  const verdict = { unrun: [], unmeasured: [], judged: 0 };
  for (const [file, set] of [...changed].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!isJudged(file)) continue;
    const at = [...set].sort((a, b) => a - b);
    const coverage = merged[file];
    if (coverage === undefined) {
      for (const line of at)
        verdict.unmeasured.push({ file, line, kind: 'line' });
      verdict.judged += at.length;
      continue;
    }
    const statements = Object.values(coverage.statements);
    /** @type {Finding[]} */
    const found = [];
    for (const line of at) {
      const holding = statements.filter(
        (s) => s.start <= line && line <= s.end,
      );
      if (holding.length === 0) continue;
      verdict.judged += 1;
      if (holding.some((s) => s.count === 0))
        found.push({ file, line, kind: 'line' });
    }
    for (const arm of Object.values(coverage.branches)) {
      if (arm.count > 0) continue;
      const first = at.find((line) => arm.start <= line && line <= arm.end);
      if (first !== undefined)
        found.push({ file, line: first, kind: 'branch' });
    }
    found.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
    verdict.unrun.push(
      ...found.filter(
        (f, i) =>
          i === 0 ||
          f.line !== found[i - 1]?.line ||
          f.kind !== found[i - 1]?.kind,
      ),
    );
  }
  return verdict;
};

/**
 * The verdict as markdown, for the job summary.
 * @param {Verdict} verdict
 */
export const render = ({ unrun, unmeasured, judged }) => {
  const out = [
    '### Coverage of the changed lines (#896)',
    '',
    `${judged} changed lines judged: ${unrun.length} unrun, ${unmeasured.length} unmeasured.`,
  ];
  if (unrun.length > 0)
    out.push(
      '',
      '**Unrun** (no test ran these):',
      ...unrun.map(({ file, line, kind }) => `- \`${file}:${line}\` (${kind})`),
    );
  if (unmeasured.length > 0)
    out.push(
      '',
      '**Unmeasured** (no suite measured these files):',
      ...unmeasured.map(({ file, line }) => `- \`${file}:${line}\``),
    );
  return `${out.join('\n')}\n`;
};

const TREE_FILE = 'coverage/merged/tree.txt';
const REPORT_FILE = 'coverage/merged/coverage.json';

/**
 * Which of the merged report and the tree it measured is missing, named, or
 * undefined when both are there (#969: a missing tree was reported as a
 * missing report).
 *
 * @param {(file: string) => boolean} exists
 * @returns {string | undefined}
 */
export const missingMerged = (exists) => {
  const tree = exists(TREE_FILE);
  const report = exists(REPORT_FILE);
  if (tree && report) return undefined;
  if (report)
    return `coverage-changed: no ${TREE_FILE} beside the merged report, so the tree it measured is unknown; run node scripts/coverage-merge.mjs, which writes both`;
  const also = tree ? '' : `, nor ${TREE_FILE}`;
  return `coverage-changed: no merged report at ${REPORT_FILE}${also}; run the suites with coverage, then node scripts/coverage-merge.mjs`;
};

/** @param {readonly string[]} args */
const git = (args) =>
  execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

const main = () => {
  const flags = argv.slice(2);
  if (flags.some((flag) => flag !== '--report-only'))
    die('usage: coverage-changed.mjs [--report-only]');
  const missing = missingMerged(existsSync);
  if (missing !== undefined) die(missing);
  const measured = readFileSync(TREE_FILE, 'utf8').trim();
  const tree = git(['rev-parse', 'HEAD^{tree}']).trim();
  if (measured !== tree)
    die(
      `coverage-changed: the report measured tree ${measured}, but HEAD's tree is ${tree}: it is stale, so nothing is judged`,
    );
  const base = git(['merge-base', 'origin/develop', 'HEAD']).trim();
  const verdict = judge(
    changedLines(
      git([
        'diff',
        '--unified=0',
        '--no-color',
        '--find-renames',
        base,
        'HEAD',
      ]),
    ),
    /** @type {Record<string, LocatedCoverage>} */ (
      JSON.parse(readFileSync(REPORT_FILE, 'utf8'))
    ),
  );
  process.stdout.write(render(verdict));
  if (
    !flags.includes('--report-only') &&
    verdict.unrun.length + verdict.unmeasured.length > 0
  )
    process.exitCode = 1;
};

if (import.meta.main) main();
