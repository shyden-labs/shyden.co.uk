import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withoutLocalGit } from './git-env';
import { docsNamingArgs, docsPathspec, ignoreQuestions } from './git-questions';
import { RUN_TMPDIR } from './temporary-files';
import { TREE_READING, type TreeReading } from './tree-reading';

/**
 * The run's one reading of the repository (#631), as vitest's `globalSetup`:
 * every question the suite puts to git, asked once, here, and written to a
 * file in the run's own temporary directory for the workers to read
 * (`tests/tree-reading.ts`). This is the only place the suite starts git to
 * look at the checkout; a unit test starts no process.
 */

/** The snapshot's name inside the run's temporary directory. */
export const SNAPSHOT_NAME = 'tree-reading.json';

const git = (args: readonly string[], input?: string) => {
  // Without the variables that point git at a repository (#377): a run handed
  // a GIT_DIR (a pre-push hook in a linked worktree) reads the checkout it is
  // in, as the workers' git calls do after `tests/git-env-setup.ts`.
  const run = spawnSync('git', [...args], {
    encoding: 'utf8',
    input,
    env: withoutLocalGit(process.env),
  });
  if (run.error !== undefined)
    throw new Error(`git ${args[0]} did not run: ${String(run.error)}`);
  return run;
};

/** A NUL-separated git listing, with the empty tail dropped. */
const listed = (args: readonly string[]): string[] => {
  const run = git(args);
  if (run.status !== 0)
    throw new Error(
      `git ${args.join(' ')} failed (${run.status}): ${run.stderr}`,
    );
  return run.stdout.split('\0').filter((path) => path !== '');
};

/** Of `paths`, which git ignores; `check-ignore` exits 1 when it ignores none. */
function ignoredAnswers(paths: readonly string[]): Record<string, boolean> {
  const run = git(['check-ignore', '--stdin'], paths.join('\n'));
  if (run.status !== 0 && run.status !== 1)
    throw new Error(`git check-ignore failed (${run.status}): ${run.stderr}`);
  const ignored = new Set(run.stdout.split('\n').filter((line) => line !== ''));
  return Object.fromEntries(paths.map((path) => [path, ignored.has(path)]));
}

export function buildTreeReading(): TreeReading {
  const grep = git(docsNamingArgs());
  if (grep.status !== 0)
    throw new Error(`git grep failed (${grep.status}): ${grep.stderr}`);
  return {
    tracked: listed(['ls-files', '-z']),
    committable: listed([
      'ls-files',
      '-z',
      '--others',
      '--exclude-standard',
      '--cached',
    ]),
    ignored: ignoredAnswers(ignoreQuestions()),
    docsPathspecSelected: listed(['ls-files', '-z', '--', ...docsPathspec()]),
    docsNaming: grep.stdout.split('\0').filter((path) => path !== ''),
  };
}

let snapshot = '';

export function setup(): void {
  const dir = process.env[RUN_TMPDIR];
  if (dir === undefined)
    throw new Error(
      `${RUN_TMPDIR} is not set: tests/temporary-files.ts must be listed before this setup`,
    );
  snapshot = join(dir, SNAPSHOT_NAME);
  writeFileSync(snapshot, JSON.stringify(buildTreeReading()));
  process.env[TREE_READING] = snapshot;
}

export function teardown(): void {
  rmSync(snapshot, { force: true });
}
