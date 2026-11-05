import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scratchGit } from '../git-env';
import { scratchDir } from '../scratch-dir';
import { filesUnder } from '../source-files';

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
  });

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
        [
          '--config',
          'vitest.integration.config.ts',
          'tests/integration/release-inventory.test.ts',
        ],
        join(sentinel, 'child-run.json'),
      );
      expect(report.numFailedTests, stderr).toBe(0);
      expect(fingerprint(sentinel)).toEqual(before);
    } finally {
      rmSync(sentinel, { recursive: true, force: true });
    }
  });
});

/**
 * A scratch repository's commit or merge starts no git maintenance (#788):
 * since git 2.47 each starts `git maintenance run --auto --detach`, a
 * background process that outlives the test. GIT_TRACE writes every command
 * git runs to a file; a commit allowed maintenance on its own command line
 * shows the trace would see it.
 */
describe('git in a scratch repository (#788)', () => {
  it('starts no maintenance after a commit or a merge', () => {
    const dir = scratchDir('git-env-maintenance-');
    const trace = join(scratchDir('git-env-trace-'), 'trace.txt');
    const git = scratchGit(dir);
    const handed = process.env.GIT_TRACE;
    /** Runs git `args`, whose command is `command`, and counts that command and any maintenance in its trace. */
    const traced = (command: string, args: readonly string[]) => {
      writeFileSync(trace, '');
      process.env.GIT_TRACE = trace;
      try {
        git(args);
      } finally {
        if (handed === undefined) delete process.env.GIT_TRACE;
        else process.env.GIT_TRACE = handed;
      }
      const lines = readFileSync(trace, 'utf8').split('\n');
      const count = (needle: string) =>
        lines.filter((line) => line.includes(needle)).length;
      return {
        ran: count(`built-in: git ${command}`),
        maintenance: count('built-in: git maintenance'),
      };
    };
    git(['init', '-q', '-b', 'base']);
    git(['config', 'user.email', 'fixture@example.test']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(dir, 'a'), 'a\n');
    git(['add', '-A']);
    expect(
      traced('commit', [
        '-c',
        'maintenance.auto=true',
        'commit',
        '-q',
        '-m',
        'allowed',
      ]),
      'a commit allowed maintenance starts it, and the trace sees it',
    ).toEqual({ ran: 1, maintenance: 1 });
    git(['switch', '-q', '-c', 'pull']);
    expect(
      traced('commit', ['commit', '-q', '--allow-empty', '-m', 'head']),
    ).toEqual({
      ran: 1,
      maintenance: 0,
    });
    git(['switch', '-q', 'base']);
    expect(
      traced('merge', ['merge', '-q', '--no-ff', '--no-edit', 'pull']),
    ).toEqual({
      ran: 1,
      maintenance: 0,
    });
  });
});
