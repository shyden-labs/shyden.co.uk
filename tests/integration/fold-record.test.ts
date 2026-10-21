import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scratchGit, withoutLocalGit } from '../git-env';

/**
 * `scripts/fold-record.mjs` as a session runs it after a dispatched record
 * (#889): in a real checkout with a real `origin`, so the amend, the parents
 * and the "already pushed" check are git's own answers. Only GitHub is a
 * stand-in: a `gh` first on PATH that hands `gh run download` a fixture
 * artifact. `tests/unit/fold-record.test.ts` holds every refusal's wording.
 */

const SCRIPT = path.resolve(
  import.meta.dirname,
  '../../scripts/fold-record.mjs',
);

let root: string;
let repo: string;
let artifact: string;
let bin: string;
let git: (args: readonly string[]) => string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'fold-record-'));
  const origin = path.join(root, 'origin.git');
  repo = path.join(root, 'repo');
  artifact = path.join(root, 'artifact');
  bin = path.join(root, 'bin');
  mkdirSync(repo);
  mkdirSync(bin);
  scratchGit(root)(['init', '-q', '--bare', '-b', 'develop', origin]);
  git = scratchGit(repo);
  git(['init', '-q', '-b', 'develop']);
  git(['config', 'user.email', 'fold@example.invalid']);
  git(['config', 'user.name', 'Fold']);
  git(['remote', 'add', 'origin', origin]);
  mkdirSync(path.join(repo, 'tests'));
  writeFileSync(path.join(repo, 'tests/floors.json'), '{"a/b": 1}\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  git(['push', '-q', 'origin', 'develop']);
  git(['checkout', '-q', '-b', 'feature']);
  writeFileSync(path.join(repo, 'page.txt'), 'the change\n');
  git(['add', 'page.txt']);
  git(['commit', '-q', '-m', 'The change']);
  // The stand-in gh: `gh run download <id> -D <dir>` copies the fixture in.
  writeFileSync(
    path.join(bin, 'gh'),
    `#!/bin/sh\n[ "$1 $2" = "run download" ] && [ "$4" = "-D" ] || exit 9\ncp -R "${artifact}/." "$5"\n`,
  );
  chmodSync(path.join(bin, 'gh'), 0o755);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const head = () => git(['rev-parse', 'HEAD']).trim();

/** A floor record of the commit `sha`, as record-floors.yml uploads it. */
const recorded = (sha: string) => {
  const dir = path.join(artifact, 'floors-record');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'floors.json'), '{"a/b": 2}\n');
  writeFileSync(
    path.join(dir, 'message.txt'),
    'The change\n\nFloors recorded in CI: a/b 1 -> 2\n',
  );
  writeFileSync(path.join(dir, 'sha.txt'), `${sha}\n`);
  writeFileSync(path.join(dir, 'ref.txt'), 'refs/floors/feature\n');
};

const runFold = () =>
  spawnSync(process.execPath, [SCRIPT, '42'], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...withoutLocalGit(process.env),
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    },
  });

describe('fold-record.mjs in a real checkout', () => {
  it('folds the record into the unpushed commit, keeping its parent, and pushes nothing', () => {
    const measured = head();
    const parent = git(['rev-parse', 'HEAD^']).trim();
    recorded(measured);
    const run = runFold();
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(readFileSync(path.join(repo, 'tests/floors.json'), 'utf8')).toBe(
      '{"a/b": 2}\n',
    );
    expect(git(['log', '-1', '--format=%B']).trim()).toBe(
      'The change\n\nFloors recorded in CI: a/b 1 -> 2',
    );
    expect(git(['rev-parse', 'HEAD^']).trim()).toBe(parent);
    expect(head()).not.toBe(measured);
    expect(
      git(['show', '--name-only', '--format=', 'HEAD']).trim().split('\n'),
    ).toEqual(['page.txt', 'tests/floors.json']);
    expect(git(['ls-remote', '--heads', 'origin']).trim()).toMatch(
      /^[0-9a-f]{40}\trefs\/heads\/develop$/,
    );
    expect(run.stdout).toContain(
      'Push it once, normally: git push origin feature',
    );
  });

  it('refuses a commit already pushed, and leaves it as it was', () => {
    git(['push', '-q', 'origin', 'feature']);
    const measured = head();
    recorded(measured);
    const run = runFold();
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('HEAD is already on origin/feature');
    expect(head()).toBe(measured);
    expect(readFileSync(path.join(repo, 'tests/floors.json'), 'utf8')).toBe(
      '{"a/b": 1}\n',
    );
  });

  it('refuses a dirty tree, and leaves it as it was', () => {
    const measured = head();
    recorded(measured);
    writeFileSync(path.join(repo, 'page.txt'), 'an unsaved edit\n');
    const run = runFold();
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(' M page.txt');
    expect(head()).toBe(measured);
  });

  it('refuses a record of another commit', () => {
    const measured = head();
    recorded(git(['rev-parse', 'HEAD^']).trim());
    const run = runFold();
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      'a record folds only into the commit it measured',
    );
    expect(head()).toBe(measured);
  });
});
