import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

/**
 * The one home for running git in a scratch repository (#377).
 *
 * A pre-push hook in a linked worktree runs with an absolute GIT_DIR, and every
 * process it starts inherits it. A unit test that ran `git init` and `git
 * config` in a temp directory under that hook acted on the real repository:
 * it set `core.bare`, appended a fixture identity, and moved `develop`.
 * `tests/guards/scratch-git-home.test.ts` holds every such call to this file.
 */

/**
 * Where the run hands its workers the list below (#632): the run asks git once,
 * in global setup (`tests/tree-reading-setup.ts`), and the answer travels in
 * the environment as JSON, so a unit worker starts no process to learn it.
 */
export const LOCAL_GIT_VARS = 'SHYDEN_LOCAL_GIT_VARS';

let listed: string[] | undefined;

/** Asks git for the list, with no GIT_* variable at all and from outside any repository. */
export const askGitForLocalVars = (): string[] =>
  execFileSync('git', ['rev-parse', '--local-env-vars'], {
    cwd: tmpdir(),
    encoding: 'utf8',
    env: Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
    ),
  })
    .split('\n')
    .filter(Boolean);

/**
 * The variables git sets to point a process at one repository, as git itself
 * lists them: `git rev-parse --local-env-vars`, the list its own submodule
 * code clears before stepping into another repository. Asked with no GIT_*
 * variable at all and from outside any repository, so the answer cannot
 * depend on the repository this process was handed. Read from the run's one
 * asking when there is one (`LOCAL_GIT_VARS`), else asked here.
 */
export const localGitVars = (): string[] => {
  const handed = process.env[LOCAL_GIT_VARS];
  listed ??=
    handed === undefined
      ? askGitForLocalVars()
      : (JSON.parse(handed) as string[]);
  return [...listed];
};

/** A copy of `env` without the variables that point git at a repository. */
export const withoutLocalGit = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const local = new Set(localGitVars());
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !local.has(name)),
  );
};

/** Runs git in `dir`, and only ever in `dir`, whatever repository this process was handed. */
export const scratchGit =
  (dir: string) =>
  (args: readonly string[]): string =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: withoutLocalGit(process.env),
    });
