#!/usr/bin/env node
/**
 * What the CI visual capture (#654) folds back into a branch: the baselines a
 * `--update-snapshots=all` run changed, and nothing else.
 *
 *   node scripts/visual-capture.mjs <status> <head-message> <message-out> <list-out>
 *
 * `<status>` is `git status --porcelain=v1 --untracked-files=all` taken after
 * the capture: every baseline the run rewrote. A capture does NOT render
 * byte-identically where nothing moved (#678: run 38122176791 rewrote four
 * pages its change never touched, by 1 to 17 pixels), so each rewrite is
 * judged by `capturedBaselines` against the committed picture at `HEAD`, and
 * only one past `CAPTURE_PIXEL_RULE` is committed. Anything in the status that
 * is not a baseline is refused: the job that commits runs no branch code and
 * must not carry branch code's side effects either.
 *
 * Writes the measured commit's message with the committed baselines added to
 * `<message-out>`, their paths one per line to `<list-out>`, the summary
 * (every page committed and every page kept, each with its count) to
 * `$GITHUB_STEP_SUMMARY`, and `changed=true|false` to `$GITHUB_OUTPUT`.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { argv, env } from 'node:process';
import { die } from './errors.mjs';
import { withBlock } from './floors-diff.mjs';
import { decodePng, differingPixels } from './png-pixels.mjs';

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

/**
 * A rewritten baseline is committed only when MORE than this many pixels
 * differ from the committed one at zero tolerance (#678). Operator 2026-10-11,
 * from every baseline rewrite on develop, 294 over 31 commits: pages a change
 * never touched differed by 1 to 17 pixels; every real change by 210 or more.
 * Neither the largest channel step (noise reached 31, a real recapture 2) nor
 * the visual gate's own threshold (#371's dot grid moved up to 8,584 pixels,
 * none of them over it) told the two apart, so a stale-but-passing baseline
 * (#134) is still refreshed when its page changed.
 */
export const CAPTURE_PIXEL_RULE = 60;

/**
 * @typedef {{ file: string, differing: number | 'new' | 'size' }} Judged
 * @typedef {{ commit: Judged[], kept: Judged[] }} Capture
 */

/**
 * Which of the rewritten `files` a capture commits: a baseline with no
 * committed picture (`'new'`), one whose size changed (`'size'`), or one where
 * more than `CAPTURE_PIXEL_RULE` pixels differ. The rest are kept out, each
 * with its count, so the summary can name them.
 *
 * @param {readonly string[]} files
 * @param {{ committed: (file: string) => Uint8Array | undefined, captured: (file: string) => Uint8Array }} read
 * @returns {Capture}
 */
export const capturedBaselines = (files, { committed, captured }) => {
  /** @type {Capture} */
  const result = { commit: [], kept: [] };
  for (const file of files) {
    const before = committed(file);
    if (before === undefined) {
      result.commit.push({ file, differing: 'new' });
      continue;
    }
    const differing = differingPixels(
      decodePng(before),
      decodePng(captured(file)),
    );
    if (differing === undefined)
      result.commit.push({ file, differing: 'size' });
    else if (differing > CAPTURE_PIXEL_RULE)
      result.commit.push({ file, differing });
    else result.kept.push({ file, differing });
  }
  return result;
};

/**
 * @param {Judged} judged
 * @returns {string}
 */
const judgedLine = ({ file, differing }) =>
  `- \`${file}\`: ${
    differing === 'new'
      ? 'new'
      : differing === 'size'
        ? 'size changed'
        : plural(differing, 'pixel differs', 'pixels differ')
  }`;

/**
 * `count` beside the word that fits it.
 *
 * @param {number} count
 * @param {string} one
 * @param {string} many
 * @returns {string}
 */
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * What a capture says it did: every page committed and every page kept out,
 * each with its count, so a page near the rule is seen on the next run.
 *
 * @param {Capture} capture
 * @returns {string}
 */
export const captureSummary = ({ commit, kept }) => {
  if (commit.length === 0 && kept.length === 0)
    return 'No baseline changed: nothing committed, nothing dispatched.';
  return [
    `${plural(commit.length, 'baseline', 'baselines')} committed (more than ${CAPTURE_PIXEL_RULE} pixels differ, new, or a new size; #678):`,
    ...commit.map(judgedLine),
    ...(kept.length === 0
      ? []
      : [
          `${plural(kept.length, 'rewrite', 'rewrites')} kept out (${CAPTURE_PIXEL_RULE} pixels or fewer differ):`,
          ...kept.map(judgedLine),
        ]),
  ].join('\n');
};

/**
 * The committed picture of `file` at `HEAD`, or `undefined` when `HEAD` has
 * none (a baseline captured for the first time). Any other failure of git is
 * a refusal: an unread picture is never read as new.
 *
 * @param {string} file
 * @returns {Uint8Array | undefined}
 */
const committedAtHead = (file) => {
  const exists = spawnSync('git', ['cat-file', '-e', `HEAD:${file}`]);
  if (exists.error !== undefined)
    die(`visual-capture: git did not start: ${exists.error.message}`);
  if (exists.status !== 0) return undefined;
  const shown = spawnSync('git', ['show', `HEAD:${file}`], {
    maxBuffer: 1 << 28,
  });
  if (shown.error !== undefined || shown.status !== 0)
    die(`visual-capture: could not read HEAD:${file} (exit ${shown.status})`);
  return shown.stdout;
};

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
  const capture = capturedBaselines(baselines, {
    committed: committedAtHead,
    captured: (file) => readFileSync(file),
  });
  const committed = capture.commit.map(({ file }) => file);
  writeFileSync(listPath, committed.map((file) => `${file}\n`).join(''));
  writeFileSync(
    messagePath,
    captureMessage(readFileSync(headMessagePath, 'utf8'), committed),
  );
  const summary = captureSummary(capture);
  console.log(summary);
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (env.GITHUB_OUTPUT)
    appendFileSync(env.GITHUB_OUTPUT, `changed=${committed.length > 0}\n`);
};

if (import.meta.main) main();
