#!/usr/bin/env node
/**
 * Folds a dispatched record into the commit it measured (#889).
 *
 *   node scripts/fold-record.mjs <run-id>
 *
 * The bots push nothing (operator, 2026-10-21: "a CI bot never pushes to a
 * branch"). The session pushes its finished, still-unpushed commit to a
 * scratch ref (`refs/floors/<branch>` or `refs/visual/<branch>`), dispatches
 * `record-floors.yml` or `visual-capture.yml` from `develop` naming that ref,
 * and the run uploads what moved as an artifact. This downloads it, copies the
 * files into the tree and amends the local commit with the message the run
 * composed. That commit was never pushed, so the branch is then pushed once,
 * normally, and the scratch ref deleted: the two commands are printed, and
 * this pushes nothing itself.
 *
 * It refuses, before it copies anything: a run that left no artifact or more
 * than one, a run that measured another commit, a dirty tree, a HEAD a remote
 * branch already holds (the amend would need a force-push), a detached HEAD,
 * a ref outside the artifact's own namespace, and a capture listing anything
 * but baselines. `tests/unit/fold-record.test.ts` holds each refusal, with git
 * and gh stood in; `tests/integration/fold-record.test.ts` runs it against a
 * real repository.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { argv } from 'node:process';

import { die, nonEmpty } from './errors.mjs';
import { BASELINE_PATH } from './visual-capture.mjs';

/**
 * @typedef {{
 *   tempDir: () => string,
 *   download: (runId: string, dir: string) => void,
 *   list: (dir: string) => string[],
 *   read: (file: string) => string,
 *   copy: (from: string, to: string) => void,
 *   git: (args: readonly string[]) => string,
 * }} FoldIo
 */

/** The artifacts a record uploads, each with the scratch refs it may measure. */
const KINDS = {
  'floors-record': 'refs/floors/',
  'visual-capture': 'refs/visual/',
};

/**
 * A full record's browser shards each upload their observations (#608), and
 * the join reads them; they are the record's inputs, never folded. Set aside
 * only beside a `floors-record`, so a run of anything else still refuses them.
 */
const SHARD_INPUT = /^floors-browser-\d+$/;

/**
 * The files an artifact folds in, `from` inside the artifact and `to` in the
 * tree, or why it may not be folded.
 *
 * @param {keyof typeof KINDS} kind
 * @param {string} artifact the artifact's directory
 * @param {string} runId
 * @param {(file: string) => string} read
 * @returns {{ from: string, to: string }[] | string}
 */
const filesOf = (kind, artifact, runId, read) => {
  if (kind === 'floors-record')
    return [
      { from: path.join(artifact, 'floors.json'), to: 'tests/floors.json' },
    ];
  const listed = read(path.join(artifact, 'baselines.txt'))
    .split('\n')
    .filter((line) => line !== '');
  const strays = listed.filter((file) => !BASELINE_PATH.test(file));
  if (strays.length > 0)
    return `run ${runId} listed paths that are not baselines, so nothing is folded:\n${strays.join('\n')}`;
  if (listed.length === 0)
    return `run ${runId} listed no baseline, so there is nothing to fold`;
  return listed.map((file) => ({
    from: path.join(artifact, 'files', file),
    to: file,
  }));
};

/**
 * @param {string} runId
 * @param {FoldIo} io
 * @returns {{ folded: string[] } | { refusal: string }}
 */
export const fold = (runId, io) => {
  const refuse = (/** @type {string} */ why) => ({
    refusal: `fold-record: ${why}`,
  });
  if (!/^\d+$/.test(runId))
    return refuse(`a run id is digits only, not "${runId}"`);

  const dir = io.tempDir();
  io.download(runId, dir);
  const found = io.list(dir).sort();
  const artifacts = found.includes('floors-record')
    ? found.filter((name) => !SHARD_INPUT.test(name))
    : found;
  const known = Object.keys(KINDS);
  const kind = /** @type {keyof typeof KINDS | undefined} */ (
    artifacts.length === 1 && known.includes(artifacts[0] ?? '')
      ? artifacts[0]
      : undefined
  );
  if (kind === undefined)
    return refuse(
      `run ${runId} holds ${found.length === 0 ? 'no artifact' : found.join(', ')}; expected exactly one of ${known.join(', ')}`,
    );
  const artifact = path.join(dir, kind);
  const measured = io.read(path.join(artifact, 'sha.txt')).trim();
  const ref = io.read(path.join(artifact, 'ref.txt')).trim();
  if (!ref.startsWith(KINDS[kind]))
    return refuse(
      `run ${runId} recorded ${ref}, which is not under ${KINDS[kind]}`,
    );
  const files = filesOf(kind, artifact, runId, io.read);
  if (typeof files === 'string') return refuse(files);

  const head = io.git(['rev-parse', 'HEAD']).trim();
  if (head !== measured)
    return refuse(
      `run ${runId} measured ${measured}, but HEAD is ${head}: a record folds only into the commit it measured`,
    );
  const dirty = io
    .git(['status', '--porcelain=v1', '--untracked-files=all'])
    .replace(/\n+$/, '');
  if (dirty !== '')
    return refuse(
      `the tree is dirty, so the amend would carry more than the record; commit or remove these first:\n${dirty}`,
    );
  io.git(['fetch', '--quiet', 'origin']);
  const pushedOn = io
    .git(['branch', '-r', '--contains', 'HEAD', '--format=%(refname:short)'])
    .split('\n')
    .filter((line) => line !== '');
  if (pushedOn.length > 0)
    return refuse(
      `HEAD is already on ${pushedOn.join(', ')}, so an amend would need a force-push; fold only into an unpushed commit`,
    );
  const branch = io.git(['branch', '--show-current']).trim();
  if (branch === '')
    return refuse('HEAD is detached; check out the branch the record is for');

  const parents = io.git(['log', '-1', '--format=%P', 'HEAD']).trim();
  for (const { from, to } of files) io.copy(from, to);
  io.git(['add', '--', ...files.map(({ to }) => to)]);
  io.git(['commit', '--amend', '-F', path.join(artifact, 'message.txt')]);
  const after = io.git(['log', '-1', '--format=%P', 'HEAD']).trim();
  if (after !== parents)
    return refuse(
      `the amend changed the parents from ${parents} to ${after}: push nothing, and read git reflog`,
    );
  const folded = io.git(['rev-parse', 'HEAD']).trim();
  return {
    folded: [
      `Folded ${files.length} file${files.length === 1 ? '' : 's'} from run ${runId} (${kind}) into ${folded}.`,
      `Push it once, normally: git push origin ${branch}`,
      `Then delete the scratch ref: git push origin --delete ${ref}`,
    ],
  };
};

/**
 * The fold's processes and files, for real. `made` hears of the download
 * directory it makes, so `main` can remove it whatever the fold decides.
 *
 * @param {string} runId
 * @param {(dir: string) => string} made
 * @returns {FoldIo}
 */
const realIo = (runId, made) => ({
  tempDir: () => made(mkdtempSync(path.join(tmpdir(), 'fold-record-'))),
  download: (id, dir) => {
    execFileSync('gh', ['run', 'download', id, '-D', dir], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  },
  // gh refuses a run with no artifact itself, so an empty download is a
  // broken one, never a clean answer.
  list: (dir) => nonEmpty(readdirSync(dir), `artifacts in run ${runId}`),
  read: (file) => readFileSync(file, 'utf8'),
  copy: (from, to) => copyFileSync(from, to),
  git: (args) => execFileSync('git', args, { encoding: 'utf8' }),
});

const main = () => {
  const [runId, ...rest] = argv.slice(2);
  if (runId === undefined || rest.length > 0)
    die('usage: fold-record.mjs <run-id>');
  /** @type {string | undefined} */
  let downloaded;
  /** @type {ReturnType<typeof fold>} */
  let result;
  // Removed before any refusal is printed: `die` exits, which skips a finally.
  try {
    result = fold(
      runId,
      realIo(runId, (dir) => (downloaded = dir)),
    );
  } finally {
    if (downloaded !== undefined)
      rmSync(downloaded, { recursive: true, force: true });
  }
  if ('refusal' in result) die(result.refusal);
  console.log(result.folded.join('\n'));
};

if (import.meta.main) main();
