import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workflowsRunningTheRule } from '../closing-keywords-shared';
import { scratchDir } from '../scratch-dir';
import { scratchGit, withoutLocalGit } from '../git-env';

/**
 * The command line, which is how BOTH media reach the rule: `.githooks/
 * commit-msg` hands it a message file, and `pr-body.yml` hands it the pull
 * request body. A script that exits 0 in silence is indistinguishable from
 * one whose entry point never ran, so its refusals are asserted too (#221,
 * #276).
 */
describe('the closing-keyword command line', () => {
  const CLI = 'scripts/closing-keywords.mjs';

  function runCli(args: readonly string[]): { ok: boolean; output: string } {
    try {
      execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: 'pipe' });
      return { ok: true, output: '' };
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  }

  function fileHolding(text: string): string {
    const file = join(scratchDir('closing-keywords-'), 'MSG');
    writeFileSync(file, text);
    return file;
  }

  it('refuses no argument at all, rather than exiting 0 in silence', () => {
    const { ok, output } = runCli([]);
    expect(ok).toBe(false);
    expect(output).toContain('usage:');
  });

  it('refuses a second file, which would be checked and never reported', () => {
    const { ok, output } = runCli([fileHolding('Refs #1'), 'a label', 'extra']);
    expect(ok).toBe(false);
    expect(output).toContain('usage:');
  });

  it('refuses a file it cannot read, naming the path', () => {
    const { ok, output } = runCli(['does/not/exist']);
    expect(ok).toBe(false);
    expect(output).toContain('does/not/exist');
  });

  it('names the medium it was given, so the author knows what to edit', () => {
    const { ok, output } = runCli([
      fileHolding('I will close #89 by hand once both are in'),
      'this pull request body',
    ]);
    expect(ok).toBe(false);
    expect(output).toContain('this pull request body');
  });

  it('passes a clean file', () => {
    expect(runCli([fileHolding('feat: x\n\nRefs #278\n')]).ok).toBe(true);
  });
});

/**
 * The medium that actually caused the second incident.
 *
 * `gh pr create` runs no git hook, so a pull request body never meets
 * `.githooks/commit-msg` -- and a body is what closed #89. The rule reaches
 * it from CI instead, which is the only place every author passes through.
 *
 * DERIVED, not named. The workflow that carries the check is found by looking
 * for the script, so moving or renaming the file cannot leave this guard
 * quietly passing over a workflow nobody runs (#49, #80).
 */
describe('the rule covers a pull request body, not only a commit message', () => {
  it("reads every commit the pull request adds, its merges too, and not the checkout's own", () => {
    // A pull_request checkout is a synthetic merge of the head into the base,
    // at HEAD. `--no-merges` left that one out, and with it every merge commit
    // the branch carries, which lands on develop, the default branch, with
    // its message intact (#390). The workflow's own command runs here,
    // against a branch shaped like that.
    const [only] = workflowsRunningTheRule();
    const [range] = (only?.commands ?? []).filter((command) =>
      command.startsWith('git log'),
    );
    expect(range, 'the step reads no commit range').toBeDefined();

    const dir = scratchDir('pr-range-');
    const git = scratchGit(dir);
    const commit = (message: string) =>
      git(['commit', '-q', '--allow-empty', '-m', message]);
    git(['init', '-q', '-b', 'develop']);
    git(['config', 'user.email', 'fixture@example.test']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'commit.gpgsign', 'false']);
    commit('already on the base');
    git(['checkout', '-q', '-b', 'feature']);
    commit('the branch work');
    git(['checkout', '-q', 'develop']);
    commit('the base moves on');
    git(['update-ref', 'refs/remotes/origin/develop', 'develop']);
    git(['checkout', '-q', 'feature']);
    git([
      'merge',
      '-q',
      '--no-ff',
      'develop',
      '-m',
      'Merge develop, closes #5',
    ]);
    git(['checkout', '-q', '--detach', 'develop']);
    git(['merge', '-q', '--no-ff', 'feature', '-m', 'the checkout merge']);

    const out = scratchDir('pr-range-out-');
    execFileSync('bash', ['-c', range!], {
      cwd: dir,
      env: {
        ...withoutLocalGit(process.env),
        BASE_REF: 'develop',
        RUNNER_TEMP: out,
      },
    });
    // Every message, whole: the base's commit and the checkout's merge are
    // absent, and the branch's merge is present.
    const messages = readFileSync(join(out, 'commits.txt'), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .sort();
    expect(messages).toEqual(['Merge develop, closes #5', 'the branch work']);
  });
});
