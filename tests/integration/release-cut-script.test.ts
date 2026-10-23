import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scratchGit, withoutLocalGit } from '../git-env';

/**
 * `scripts/release-cut.mjs` as ci.yml's release-cut job runs it (#941): in a
 * real repository holding `origin/develop`, `origin/main` and the pull
 * request's merge checked out as HEAD, so every ancestry, tree and parent it
 * reads is git's own answer. `tests/unit/release-cut.test.ts` holds every
 * finding's wording.
 */

const SCRIPT = path.resolve(
  import.meta.dirname,
  '../../scripts/release-cut.mjs',
);

let repo: string;
let git: (args: readonly string[]) => string;

/** Commits `file` with `text`, and returns the new commit. */
const commit = (file: string, text: string) => {
  writeFileSync(path.join(repo, file), text);
  git(['add', file]);
  git(['commit', '-q', '-m', file]);
  return git(['rev-parse', 'HEAD']).trim();
};

/** The release pull request's merge of `cut` into `main`, checked out as HEAD. */
const mergeInto = (main: string, cut: string) => {
  git(['checkout', '-q', '--detach', main]);
  git(['merge', '-q', '--no-ff', '--no-edit', cut]);
};

const run = (headRef: string, headSha: string) =>
  spawnSync(process.execPath, [SCRIPT], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...withoutLocalGit(process.env),
      HEAD_REF: headRef,
      HEAD_SHA: headSha,
    },
  });

let base: string;
let cut: string;

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'release-cut-'));
  git = scratchGit(repo);
  git(['init', '-q', '-b', 'develop']);
  git(['config', 'user.email', 'cut@example.invalid']);
  git(['config', 'user.name', 'Cut']);
  base = commit('page.txt', 'live\n');
  cut = commit('page.txt', 'the release\n');
  git(['update-ref', 'refs/remotes/origin/develop', cut]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('release-cut.mjs', () => {
  it('passes a release/ cut of develop merged into a main develop holds', () => {
    git(['update-ref', 'refs/remotes/origin/main', base]);
    mergeInto(base, cut);
    const result = run('release/2026-10-23-cut', cut);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      `release-cut: release/2026-10-23-cut at ${cut} is a cut of develop, and its merge lands exactly its tree\n`,
    );
  });

  it('passes the second cut, onto a main holding the first cut as a merge', () => {
    git(['checkout', '-q', '--detach', base]);
    git(['checkout', '-q', '-b', 'main']);
    git(['merge', '-q', '--no-ff', '--no-edit', cut]);
    const firstRelease = git(['rev-parse', 'HEAD']).trim();
    git(['checkout', '-q', 'develop']);
    const second = commit('page.txt', 'the next release\n');
    git(['update-ref', 'refs/remotes/origin/develop', second]);
    git(['update-ref', 'refs/remotes/origin/main', firstRelease]);
    mergeInto(firstRelease, second);
    const result = run('release/2026-10-30-next', second);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails a main holding a hotfix, naming it and the tree it changes', () => {
    git(['checkout', '-q', '--detach', base]);
    const hotfix = commit('hotfix.txt', 'straight onto main\n');
    git(['update-ref', 'refs/remotes/origin/main', hotfix]);
    mergeInto(hotfix, cut);
    const landed = git(['rev-parse', 'HEAD^{tree}']).trim();
    const cutTree = git(['rev-parse', `${cut}^{tree}`]).trim();
    const result = run('release/2026-10-23-cut', cut);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      [
        `::error::the merge lands tree ${landed}, not the cut's tree ${cutTree}: main holds something the cut does not, so the release would ship a tree no run tested`,
        `::error::main holds ${hotfix}, which is not the merge of a cut of develop: main takes release cuts and nothing else`,
        '',
      ].join('\n'),
    );
  });

  it('fails a head that is not a release/ branch, naming it', () => {
    git(['update-ref', 'refs/remotes/origin/main', base]);
    mergeInto(base, cut);
    const result = run('develop', cut);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "::error::the head is 'develop', not a release/ cut: a release comes from a release/<date>-<what> branch cut at the commit Shyden chose, frozen there\n",
    );
  });

  it('fails, naming git, when a ref it reads does not exist', () => {
    mergeInto(base, cut);
    const result = run('release/2026-10-23-cut', cut);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^::error::release-cut: .*origin\/main/);
  });
});
