#!/usr/bin/env node
/**
 * Whether a pull request changes documentation and nothing else (#582).
 *
 * Every pull request ran the whole pipeline: #581, a change to one review
 * ledger under `docs/`, ran all 14 jobs in 15 minutes and about 83
 * runner-minutes, while only `checks` (prettier, the typecheck and the unit
 * suite) could have caught anything a Markdown file does. This decides, from
 * the diff alone, whether the browser jobs may be skipped. `checks` always
 * runs, because tests read documentation and meta-guards walk every tracked
 * file.
 *
 * FAIL CLOSED. Anything it cannot place, an event that is not a pull request,
 * a ref that is not GitHub's merge commit, a status it does not know, an empty
 * diff, or any error at all is "not docs-only", which runs everything.
 *
 *   node scripts/docs-only.mjs   # writes docs_only=true|false to $GITHUB_OUTPUT
 *
 * It writes `capture=true|false` beside it, from the same diff: whether the
 * release capture runs (`scripts/capture-scope.mjs`, #774). And
 * `release=true|false`: whether this run is the release pull request, the one
 * run the logs suite starts on by itself (#822).
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { env, exit } from 'node:process';
import { captureFromDiff } from './capture-scope.mjs';

/** The files outside `docs/` that are documentation and nothing reads. */
export const DOCS_ONLY_FILES = Object.freeze(['HANDOVER.md']);

/** The tree that is documentation, less what code reads (below). */
export const DOCS_TREE = 'docs/';

/**
 * The parts of `docs/` that code reads by name, so a change there is not
 * documentation alone. Derived from the repository by
 * `tests/guards/docs-only.test.ts`, which fails when this disagrees with it.
 */
export const DOCS_READ_BY_CODE = Object.freeze([
  'docs/releases/',
  'docs/runbooks/',
  'docs/superpowers/',
]);

/**
 * The ci.yml jobs a docs-only verdict skips: the ones that build or serve the
 * site. `checks` always runs, and `visual` too, because it is required by
 * name and `scripts/deploy-gate.mjs` refuses it skipped (operator,
 * 2026-10-06). `tests/guards/pipeline-wiring.test.ts` holds the workflow to
 * exactly this list.
 */
export const SKIPPED_WHEN_DOCS_ONLY = Object.freeze([
  'e2e',
  'functions',
  'sanity-on-build',
]);

/** The ci.yml jobs build-and-test needs to have SUCCEEDED on a docs-only verdict. */
export const RUN_WHEN_DOCS_ONLY = Object.freeze(['checks', 'scope']);

/**
 * @typedef {{ status: string, paths: string[] }} Change
 * @typedef {{ docsOnly: boolean, reasons: string[] }} Verdict
 */

/**
 * Whether one path is documentation that nothing reads: the handover, or a
 * file under `docs/` outside every tree code reads. A path that is not in
 * git's own normal form (a `.` or `..` segment, an empty one, a leading `/`)
 * is not placed, so it is refused.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isDocsOnlyPath(path) {
  const segments = path.split('/');
  if (segments.some((segment) => ['', '.', '..'].includes(segment)))
    return false;
  if (DOCS_ONLY_FILES.includes(path)) return true;
  if (!path.startsWith(DOCS_TREE)) return false;
  return !DOCS_READ_BY_CODE.some((tree) => `${path}/`.startsWith(tree));
}

/** git's statuses, and how many paths each one carries. */
const PATHS_PER_STATUS = Object.freeze({
  A: 1,
  B: 1,
  C: 2,
  D: 1,
  M: 1,
  R: 2,
  T: 1,
  U: 1,
  X: 1,
});

/** The statuses that leave a docs-only diff docs-only, when every path is. */
const DOCS_STATUSES = Object.freeze(['A', 'D', 'M', 'R']);

/**
 * The changes `git diff --name-status -z` reports: a status, with its score
 * when it has one (`R087`), then one path, or two for a rename or a copy,
 * every field ending in NUL. Anything else is refused by name.
 *
 * @param {string} output
 * @returns {Change[]}
 */
export function parseNameStatus(output) {
  if (output === '') return [];
  if (!output.endsWith('\0'))
    throw new Error('git diff --name-status -z output does not end in NUL');
  const fields = output.slice(0, -1).split('\0');
  /** @type {Change[]} */
  const changes = [];
  while (fields.length > 0) {
    const token = /** @type {string} */ (fields.shift());
    const status = /^([A-Z])\d*$/.exec(token)?.[1] ?? token;
    const count =
      PATHS_PER_STATUS[/** @type {keyof typeof PATHS_PER_STATUS} */ (status)];
    if (count === undefined) throw new Error(`unknown status "${token}"`);
    if (fields.length < count)
      throw new Error(
        fields.length === 0
          ? `${token} has no path`
          : `${token} needs ${count} paths, and ${fields.length} remain`,
      );
    changes.push({ status, paths: fields.splice(0, count) });
  }
  return changes;
}

/**
 * Docs-only when there is at least one change, every change is an addition,
 * a modification, a deletion or a rename, and every path it names is
 * documentation. Otherwise every change that is not, by name.
 *
 * @param {readonly Change[]} changes
 * @returns {Verdict}
 */
export function docsOnlyVerdict(changes) {
  if (changes.length === 0)
    return {
      docsOnly: false,
      reasons: ['the diff is empty, and an empty diff is not documentation'],
    };
  const reasons = changes.flatMap(({ status, paths }) => {
    const line = `${status} ${paths.join(' -> ')}`;
    if (!DOCS_STATUSES.includes(status))
      return [`${line}: a change of type ${status} is never docs-only`];
    const outside = paths.filter((path) => !isDocsOnlyPath(path));
    return outside.length === 0
      ? []
      : [`${line}: ${outside.join(', ')} is not documentation alone`];
  });
  return { docsOnly: reasons.length === 0, reasons };
}

/**
 * What the checkout a `pull_request` run holds would land: GitHub's merge
 * commit, whose first parent is the base, so its diff from that parent is
 * exactly the pull request. Any other event, a checkout that is not a merge,
 * or a git that fails gives reasons instead of changes. One home for both
 * verdicts the scope job hands on: docs-only here, and whether the capture
 * runs (`scripts/capture-scope.mjs`, #774).
 *
 * @param {{ event: string | undefined, git: (args: readonly string[]) => string }} input
 * @returns {{ changes: Change[] } | { reasons: string[] }}
 */
export function pullRequestChanges({ event, git }) {
  if (event !== 'pull_request')
    return {
      reasons: [
        event
          ? `a ${event} run is not a pull request, so it has no diff to judge`
          : 'no event named, so there is no diff to judge',
      ],
    };
  try {
    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD'])
      .trim()
      .split(' ')
      .slice(1);
    if (parents.length !== 2)
      return {
        reasons: [
          `HEAD has ${parents.length} parent${parents.length === 1 ? '' : 's'}, ` +
            "so it is not GitHub's merge commit for a pull request",
        ],
      };
    return {
      changes: parseNameStatus(
        git([
          '-c',
          'core.quotePath=false',
          'diff',
          '--name-status',
          '-z',
          '--no-ext-diff',
          '-M',
          'HEAD^1',
          'HEAD',
        ]),
      ),
    };
  } catch (error) {
    return {
      reasons: [
        `the diff could not be judged: ${/** @type {Error} */ (error).message}`,
      ],
    };
  }
}

/**
 * The docs-only verdict on the checkout a run holds. Anything
 * `pullRequestChanges` cannot read as a pull request's diff is not docs-only.
 *
 * @param {{ event: string | undefined, git: (args: readonly string[]) => string }} input
 * @returns {Verdict}
 */
export function verdictFromGit(input) {
  const diff = pullRequestChanges(input);
  return 'changes' in diff
    ? docsOnlyVerdict(diff.changes)
    : { docsOnly: false, reasons: diff.reasons };
}

/**
 * Whether a run is the release (#822): a pull request into `main`, whose head
 * is the release head. The logs suite runs there and nowhere else by itself
 * (Shyden, 2026-10-16: "a release cannot be cut until all checks are
 * complete, including this one. and this is the only time that suite is run
 * automatically"). Anything else, a workflow_call from deploy-dev included,
 * is not a release.
 *
 * @param {{ event: string | undefined, base: string | undefined }} input
 * @returns {boolean}
 */
export function releaseVerdict({ event, base }) {
  return event === 'pull_request' && base === 'main';
}

export function main() {
  const output = env.GITHUB_OUTPUT;
  if (!output) {
    console.error(
      '::error::GITHUB_OUTPUT is not set, so no verdict can be handed on',
    );
    exit(1);
  }
  /** @param {readonly string[]} args */
  const git = (args) =>
    execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const event = env.GITHUB_EVENT_NAME;
  const verdict = verdictFromGit({ event, git });
  // The second verdict on the same diff: whether it can move a release
  // picture, so the capture job runs (#774).
  const capture = captureFromDiff({
    diff: pullRequestChanges({ event, git }),
    git,
    read: (path) => readFileSync(path, 'utf8'),
    exists: existsSync,
  });
  const release = releaseVerdict({ event, base: env.GITHUB_BASE_REF });
  appendFileSync(
    output,
    `docs_only=${verdict.docsOnly}\ncapture=${capture.capture}\nrelease=${release}\n`,
  );
  console.log(
    verdict.docsOnly
      ? 'docs-only: every change is documentation that nothing reads, so the browser jobs are skipped.'
      : `not docs-only, so every job runs:\n${verdict.reasons.map((reason) => `  - ${reason}`).join('\n')}`,
  );
  console.log(
    capture.capture
      ? `the capture runs:\n${capture.reasons.map((reason) => `  - ${reason}`).join('\n')}`
      : 'the capture is skipped: no change reaches a file it reads.',
  );
  console.log(
    release
      ? 'a release pull request into main, so the logs suite runs.'
      : 'not a release pull request, so the logs suite is skipped.',
  );
}

if (import.meta.main) main();
