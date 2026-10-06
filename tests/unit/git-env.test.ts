import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localGitVars, scratchGit, withoutLocalGit } from '../git-env';
import { filesUnder, searched } from '../source-files';
import { floorBreach } from '../floors';

/**
 * A unit run cannot act on the repository git hands it (#377).
 *
 * A push from a linked worktree ran the pre-push hook with an absolute
 * GIT_DIR. The release inventory's scratch-repository tests inherited it, and
 * their `git init`, `git config` and `git commit` landed on the real
 * repository: `core.bare = true`, a `Fixture` identity, `develop` moved onto
 * the fixture's octopus merge.
 */

/** A repository in a temp directory, with one commit, made through the home. */
const sentinelRepository = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'git-env-sentinel-'));
  const git = scratchGit(dir);
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'sentinel@example.test']);
  git(['config', 'user.name', 'Sentinel']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'kept'), 'kept\n');
  git(['add', 'kept']);
  git(['commit', '-q', '-m', 'the sentinel']);
  return dir;
};

/**
 * Every file git keeps about the repository, objects aside, with a hash of
 * its bytes: config, HEAD, the index, every ref and every reflog.
 */
const fingerprint = (dir: string): string[] => {
  const gitDir = join(dir, '.git');
  return filesUnder(
    gitDir,
    (path) => !relative(gitDir, path).split(sep).includes('objects'),
  ).map(
    (path) =>
      `${relative(gitDir, path)} ${createHash('sha256').update(readFileSync(path)).digest('hex')}`,
  );
};

describe('the variables that point git at one repository (#377)', () => {
  it('are the ones git itself lists, the dangerous ones among them', () => {
    const vars = localGitVars();
    expect(vars).toEqual(
      expect.arrayContaining([
        'GIT_DIR',
        'GIT_WORK_TREE',
        'GIT_INDEX_FILE',
        'GIT_COMMON_DIR',
        'GIT_OBJECT_DIRECTORY',
      ]),
    );
    expect(vars.every((name) => /^GIT_[A-Z_]+$/.test(name))).toBe(true);
  });

  it('are removed, and nothing else is', () => {
    expect(
      withoutLocalGit({
        GIT_DIR: '/elsewhere/.git',
        GIT_WORK_TREE: '/elsewhere',
        GIT_INDEX_FILE: '/elsewhere/.git/index',
        GIT_EDITOR: 'true',
        PATH: '/usr/bin',
      }),
    ).toEqual({ GIT_EDITOR: 'true', PATH: '/usr/bin' });
  });

  // Vacuous in a run that was handed no repository, which is every run by
  // hand. It is the target of the next test, which hands a child run one.
  it('are unset before any test file runs', () => {
    const vars = localGitVars();
    expect(
      searched(
        vars.filter((name) => process.env[name] !== undefined),
        { of: vars, what: 'variables that point git at a repository' },
      ),
    ).toEqual([]);
    expect(floorBreach('git-env/local-git-vars', vars.length)).toBeUndefined();
  });
});

/** Runs vitest in a child handed `gitDir` as its GIT_DIR, and reads its report. */
const childRun = (
  gitDir: string,
  args: readonly string[],
  reportFile: string,
) => {
  const run = spawnSync(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      ...args,
      '--reporter=json',
      `--outputFile=${reportFile}`,
    ],
    { encoding: 'utf8', env: { ...process.env, GIT_DIR: gitDir } },
  );
  return {
    stderr: run.stderr,
    report: JSON.parse(readFileSync(reportFile, 'utf8')) as {
      numPassedTests: number;
      numFailedTests: number;
    },
  };
};

describe('a run handed a repository (#377)', () => {
  it('forgets it before any test file runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'git-env-child-'));
    try {
      const { report, stderr } = childRun(
        join(dir, '.git'),
        [
          'tests/unit/git-env.test.ts',
          '-t',
          'are unset before any test file runs',
        ],
        join(dir, 'child-run.json'),
      );
      expect(report.numFailedTests, stderr).toBe(0);
      expect(report.numPassedTests, 'the child ran exactly that test').toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('cannot reach it through scratchGit, even before the setup has run', () => {
    const control = sentinelRepository();
    const scratch = mkdtempSync(join(tmpdir(), 'git-env-scratch-'));
    const handed = process.env.GIT_DIR;
    try {
      const before = fingerprint(control);
      process.env.GIT_DIR = join(control, '.git');
      scratchGit(scratch)(['init', '-q']);
      scratchGit(scratch)(['config', 'user.name', 'Fixture']);
      delete process.env.GIT_DIR;
      expect(fingerprint(control)).toEqual(before);
      expect(scratchGit(scratch)(['config', 'user.name']).trim()).toBe(
        'Fixture',
      );
    } finally {
      if (handed === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = handed;
      rmSync(control, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('a repository named by a hostile GIT_DIR (#377)', () => {
  it('is what git acts on when a child inherits it', () => {
    const control = sentinelRepository();
    try {
      // No cwd: the hostile variable alone decides which repository this is.
      spawnSync('git', ['config', 'user.name', 'Hostile'], {
        env: { ...process.env, GIT_DIR: join(control, '.git') },
      });
      expect(scratchGit(control)(['config', 'user.name']).trim()).toBe(
        'Hostile',
      );
    } finally {
      rmSync(control, { recursive: true, force: true });
    }
  });

  it('comes through the scratch-repository tests untouched', () => {
    const sentinel = sentinelRepository();
    try {
      const before = fingerprint(sentinel);
      const { report, stderr } = childRun(
        join(sentinel, '.git'),
        ['tests/unit/release-inventory.test.ts'],
        join(sentinel, 'child-run.json'),
      );
      expect(report.numFailedTests, stderr).toBe(0);
      expect(
        floorBreach('git-env/child-tests-passed', report.numPassedTests),
      ).toBeUndefined();
      expect(fingerprint(sentinel)).toEqual(before);
    } finally {
      rmSync(sentinel, { recursive: true, force: true });
    }
  }, 120_000);
});
