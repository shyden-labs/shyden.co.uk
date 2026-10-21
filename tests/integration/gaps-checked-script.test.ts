import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { scratchGit, withoutLocalGit } from '../git-env';
import { scratchDir } from '../scratch-dir';

/**
 * `scripts/gaps-checked.mjs --range`, the pull request half of #897, in a
 * real repository: every commit in the range is judged by its own message
 * and its own files against its first parent. `tests/unit/gaps-checked.test.ts`
 * holds the rule; `commit-msg-hook.test.ts` holds the hook half.
 */
const SCRIPT = resolve('scripts/gaps-checked.mjs');

const GAPS =
  '\n\nGaps checked:\n- Before: a commit without its section, planted first.\n- After: the range read commit by commit, each verdict seen.\n- New passes: none.\n';

let repo: string;
let written = 0;
let git: (args: readonly string[]) => string;

/** Commits `file` with `message` in the scratch repository, which has no hooks of its own. */
const commit = (file: string, message: string) => {
  written += 1;
  writeFileSync(join(repo, file), `${file} ${written}\n`);
  git(['add', file]);
  git(['commit', '-q', '-m', message]);
  return git(['rev-parse', '--short=8', 'HEAD']).trim();
};

const range = () =>
  spawnSync(process.execPath, [SCRIPT, '--range', 'base..HEAD'], {
    cwd: repo,
    encoding: 'utf8',
    env: withoutLocalGit(process.env),
  });

beforeEach(() => {
  repo = scratchDir('gaps-checked-');
  git = scratchGit(repo);
  git(['init', '-q', '-b', 'develop']);
  git(['config', 'user.email', 'gaps@example.invalid']);
  git(['config', 'user.name', 'Gaps']);
  commit('base.ts', 'base');
  git(['tag', 'base']);
});

describe('gaps-checked.mjs --range in a real repository', () => {
  it('passes a range whose code commits carry the section and whose .md commit needs none', () => {
    commit('a.ts', `feat: a${GAPS}`);
    commit('notes.md', 'docs: notes');
    const run = range();
    expect([run.status, run.stderr]).toEqual([0, '']);
    expect(run.stdout).toBe(
      'gaps-checked: 2 commits in base..HEAD, each with its section or only .md files\n',
    );
  });

  it('refuses a code commit without the section, naming that commit and only it', () => {
    commit('a.ts', `feat: a${GAPS}`);
    const bad = commit('b.ts', 'feat: b');
    const run = range();
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      `commit ${bad} (feat: b) has no complete Gaps checked section:\n\n  no \`Gaps checked:\` heading`,
    );
    expect(run.stderr.match(/^✗ commit |^commit /gm)).toHaveLength(1);
  });

  it('judges a code file renamed to .md, never exempting it as only .md', () => {
    commit('a.ts', `feat: a${GAPS}`);
    git(['mv', 'a.ts', 'notes.md']);
    git(['commit', '-q', '-m', 'docs: rename']);
    const renamed = git(['rev-parse', '--short=8', 'HEAD']).trim();
    const run = range();
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      `commit ${renamed} (docs: rename) has no complete`,
    );
  });

  it('refuses an empty range, naming it, never passing it as clean', () => {
    const run = range();
    expect([run.status, run.stderr]).toEqual([
      1,
      '✗ gaps-checked: no commit in base..HEAD: the range is wrong, not the pull request clean\n',
    ]);
  });
});
