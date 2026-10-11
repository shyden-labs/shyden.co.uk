#!/usr/bin/env node
/**
 * What the CI visual capture (#654) folds back into a branch: the baselines a
 * `--update-snapshots=all` run changed, and nothing else.
 *
 *   node scripts/visual-capture.mjs <status> <head-message> <message-out> <list-out>
 *
 * `<status>` is `git status --porcelain=v1 --untracked-files=all` taken after
 * the capture. A capture renders byte-identically where nothing moved
 * (measured: two consecutive `all` runs rewrote every baseline identically,
 * browser-matrix.test.ts), so that status IS the list of changed baselines.
 * Anything else it shows is refused: the job that commits runs no branch code
 * and must not carry branch code's side effects either.
 *
 * Writes the measured commit's message with the list added to
 * `<message-out>`, the paths one per line to `<list-out>`, the summary to
 * `$GITHUB_STEP_SUMMARY`, and `changed=true|false` to `$GITHUB_OUTPUT`.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { argv, env } from 'node:process';
import { die } from './errors.mjs';
import { withBlock } from './floors-diff.mjs';

/** Where `playwright.config.ts`'s `snapshotPathTemplate` keeps baselines. */
export const BASELINE_DIR = 'tests/e2e/__screenshots__/';

/**
 * A rewritten or new PNG directly in the baseline folder. A path git had to
 * quote starts with `"`, so it misses the folder and is refused as `other`.
 */
const BASELINE = new RegExp(
  `^( M|M |MM|\\?\\?) (${BASELINE_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^/\\s]+\\.png)$`,
);

/**
 * The baselines a capture changed, and every other line of the status, which
 * the caller refuses. Fails closed: a line this does not recognise is `other`.
 *
 * @param {string} porcelain
 * @returns {{ baselines: string[], other: string[] }}
 */
export const baselineChanges = (porcelain) => {
  const baselines = [];
  const other = [];
  for (const entry of porcelain.split('\n')) {
    if (entry === '') continue;
    const match = BASELINE.exec(entry);
    if (match) baselines.push(match[2]);
    else other.push(entry);
  }
  return { baselines, other };
};

/**
 * The measured commit's message with the captured baselines named, ahead of
 * its trailers (the same fold as the floor recorder's, one home).
 *
 * @param {string} original
 * @param {readonly string[]} files
 * @returns {string}
 */
export const captureMessage = (original, files) =>
  withBlock(
    original,
    [
      `Visual baselines captured in CI (visual-capture.yml), ${files.length} changed:`,
      ...files,
    ].join('\n'),
  );

const main = () => {
  const [statusPath, headMessagePath, messagePath, listPath, ...rest] =
    argv.slice(2);
  if (
    rest.length > 0 ||
    statusPath === undefined ||
    headMessagePath === undefined ||
    messagePath === undefined ||
    listPath === undefined
  )
    die(
      'usage: visual-capture.mjs <status> <head-message> <message-out> <list-out>',
    );
  const { baselines, other } = baselineChanges(
    readFileSync(statusPath, 'utf8'),
  );
  if (other.length > 0)
    die(
      `visual-capture: the capture changed files that are not baselines, so nothing is committed:\n${other.join('\n')}`,
    );
  writeFileSync(listPath, baselines.map((file) => `${file}\n`).join(''));
  writeFileSync(
    messagePath,
    captureMessage(readFileSync(headMessagePath, 'utf8'), baselines),
  );
  const summary =
    baselines.length === 0
      ? 'No baseline changed: nothing committed, nothing dispatched.'
      : [
          `${baselines.length} baseline${baselines.length === 1 ? '' : 's'} changed:`,
          ...baselines.map((file) => `- \`${file}\``),
        ].join('\n');
  console.log(summary);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (env.GITHUB_OUTPUT)
    appendFileSync(env.GITHUB_OUTPUT, `changed=${baselines.length > 0}\n`);
};

if (import.meta.main) main();
