import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verdictFromGit } from '../../scripts/docs-only.mjs';
import { scratchGit, withoutLocalGit } from '../git-env';
import { scratchDir, writeUnder } from '../scratch-dir';

/**
 * Whether a pull request changes documentation and nothing else (#582). A
 * docs-only verdict skips the browser jobs, so every way to reach it is
 * pinned here, and every way to miss it falls back to the whole pipeline.
 */

const SCRIPT = resolve('scripts/docs-only.mjs');

/**
 * A scratch repository holding what GitHub checks out for a pull request: a
 * merge commit whose first parent is the base and whose second is the head.
 * The branch is not called `head`: on a case-insensitive filesystem that name
 * is `HEAD`.
 */
function pullRequest(edit: (dir: string) => void, { merge = true } = {}) {
  const dir = scratchDir('docs-only-');
  const git = scratchGit(dir);
  const put = writeUnder(dir);
  git(['init', '-q', '-b', 'base']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'commit.gpgsign', 'false']);
  put('HANDOVER.md', 'handover\n');
  put('src/a.ts', 'export const a = 1;\n');
  put('docs/reviews/r.md', 'a review\n');
  put('docs/releases/a.json', '{}\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  git(['switch', '-q', '-c', 'pull']);
  edit(dir);
  git(['add', '-A']);
  git(['commit', '-q', '--allow-empty', '-m', 'head']);
  if (merge) {
    git(['switch', '-q', 'base']);
    git(['merge', '-q', '--no-ff', '--no-edit', 'pull']);
  }
  return { dir, git, put };
}

describe('the verdict on a pull request checkout', () => {
  const at = (dir: string, path: string) => join(dir, path);

  it.each([
    [
      'a modified review',
      (dir: string) => writeFileSync(at(dir, 'docs/reviews/r.md'), 'changed\n'),
    ],
    [
      'the handover',
      (dir: string) => writeFileSync(at(dir, 'HANDOVER.md'), 'changed\n'),
    ],
    [
      'a new doc with a space in its name',
      (dir: string) => writeFileSync(at(dir, 'docs/reviews/a b.md'), 'new\n'),
    ],
    ['a deleted review', (dir: string) => rmSync(at(dir, 'docs/reviews/r.md'))],
    [
      'a rename within docs/',
      (dir: string) =>
        renameSync(at(dir, 'docs/reviews/r.md'), at(dir, 'docs/r.md')),
    ],
  ])('%s is docs-only', (_, edit) => {
    const { git } = pullRequest(edit);
    expect(verdictFromGit({ event: 'pull_request', git })).toMatchObject({
      docsOnly: true,
      reasons: [],
    });
  });

  it('reads a rename as a rename, so both of its paths are judged', () => {
    const { git } = pullRequest((dir) => {
      mkdirSync(at(dir, 'docs/moved'));
      renameSync(at(dir, 'src/a.ts'), at(dir, 'docs/moved/a.ts'));
    });
    const verdict = verdictFromGit({ event: 'pull_request', git });
    expect(verdict.docsOnly).toBe(false);
    expect(verdict.reasons.join('\n')).toMatch(/^R .*src\/a\.ts/m);
  });

  it.each([
    [
      'a rename out of docs/',
      (dir: string) =>
        renameSync(at(dir, 'docs/reviews/r.md'), at(dir, 'src/r.md')),
      /src\/r\.md/,
    ],
    [
      'a deleted source file',
      (dir: string) => rmSync(at(dir, 'src/a.ts')),
      /src\/a\.ts/,
    ],
    [
      'a changed read doc',
      (dir: string) => writeFileSync(at(dir, 'docs/releases/a.json'), '[]\n'),
      /docs\/releases\/a\.json/,
    ],
    ['no change at all', () => undefined, /empty/],
  ])('%s is not docs-only', (_, edit, reason) => {
    const { git } = pullRequest(edit);
    const verdict = verdictFromGit({ event: 'pull_request', git });
    expect(verdict.docsOnly).toBe(false);
    expect(verdict.reasons.join('\n')).toMatch(reason);
  });

  it.each([
    ['workflow_dispatch', /workflow_dispatch/],
    ['push', /push/],
    [undefined, /no event/],
  ])('an event of %s runs everything', (event, reason) => {
    const { git } = pullRequest((dir) =>
      writeFileSync(at(dir, 'docs/reviews/r.md'), 'changed\n'),
    );
    const verdict = verdictFromGit({ event, git });
    expect(verdict.docsOnly).toBe(false);
    expect(verdict.reasons.join('\n')).toMatch(reason);
  });

  it('a checkout that is not a merge commit runs everything', () => {
    const { git } = pullRequest(
      (dir) => writeFileSync(at(dir, 'docs/reviews/r.md'), 'changed\n'),
      { merge: false },
    );
    const verdict = verdictFromGit({ event: 'pull_request', git });
    expect(verdict.docsOnly).toBe(false);
    expect(verdict.reasons.join('\n')).toMatch(/1 parent/);
  });
});

describe('the script, as the workflow runs it', () => {
  const run = (dir: string, env: Record<string, string>) => {
    const output = join(dir, '.github-output');
    writeFileSync(output, '');
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...withoutLocalGit(process.env), GITHUB_OUTPUT: output, ...env },
    });
    return { ...result, written: readFileSync(output, 'utf8') };
  };

  it('writes docs_only=true for a docs-only pull request', () => {
    const { dir } = pullRequest((at) =>
      writeFileSync(join(at, 'docs/reviews/r.md'), 'changed\n'),
    );
    const result = run(dir, { GITHUB_EVENT_NAME: 'pull_request' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.written).toBe('docs_only=true\n');
  });

  it('writes docs_only=false, with the reason, for anything else', () => {
    const { dir } = pullRequest((at) =>
      writeFileSync(join(at, 'src/a.ts'), 'export const a = 2;\n'),
    );
    const result = run(dir, { GITHUB_EVENT_NAME: 'pull_request' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.written).toBe('docs_only=false\n');
    expect(result.stdout).toMatch(
      /^ {2}- M src\/a\.ts: src\/a\.ts is not documentation alone$/m,
    );
  });

  it('writes docs_only=false outside a repository, and still succeeds', () => {
    const dir = scratchDir('docs-only-bare-');
    const result = run(dir, { GITHUB_EVENT_NAME: 'pull_request' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.written).toBe('docs_only=false\n');
  });

  it('fails, rather than deciding nothing, when it has nowhere to write', () => {
    const { dir } = pullRequest((at) =>
      writeFileSync(join(at, 'docs/reviews/r.md'), 'changed\n'),
    );
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...withoutLocalGit(process.env),
        GITHUB_OUTPUT: '',
        GITHUB_EVENT_NAME: 'pull_request',
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/GITHUB_OUTPUT/);
  });
});
