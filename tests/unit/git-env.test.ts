import { describe, expect, it } from 'vitest';
import {
  LOCAL_GIT_VARS,
  localGitVars,
  scratchGitEnv,
  withoutLocalGit,
} from '../git-env';
import { searched } from '../source-files';
import { floorBreach } from '../floors';

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

  // The list is asked of git once per run, in global setup, and handed to the
  // workers through the environment (#632): a worker's setup file starts no
  // process, so it can sit beside the setup that refuses every process.
  it('reach the worker from the run, which asked git once', () => {
    expect(process.env[LOCAL_GIT_VARS]).toBeDefined();
    const handed = JSON.parse(process.env[LOCAL_GIT_VARS] ?? '[]') as string[];
    expect(handed).toContain('GIT_DIR');
    expect(localGitVars()).toEqual(handed);
  });
});

/**
 * A scratch repository starts no git maintenance (#788). Since git 2.47 a
 * commit or merge starts `git maintenance run --auto --detach`, a background
 * process that outlives the test that made the repository; measured with
 * GIT_TRACE on git 2.54. `tests/integration/git-env.test.ts` runs it.
 */
describe('the environment git runs with in a scratch repository (#788)', () => {
  it('turns automatic maintenance off', () => {
    expect(scratchGitEnv({ PATH: '/usr/bin' })).toEqual({
      PATH: '/usr/bin',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'maintenance.auto',
      GIT_CONFIG_VALUE_0: 'false',
    });
  });

  it('removes the variables that point git at a repository first', () => {
    expect(
      scratchGitEnv({ GIT_DIR: '/elsewhere/.git', PATH: '/usr/bin' }).GIT_DIR,
    ).toBeUndefined();
  });

  it('replaces settings a repository was handed, as git counts them local', () => {
    // git lists GIT_CONFIG_COUNT among the variables that point it at one
    // repository, so a handed count goes with the rest and only ours is read.
    expect(localGitVars()).toContain('GIT_CONFIG_COUNT');
    expect(
      scratchGitEnv({
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.hooksPath',
        GIT_CONFIG_VALUE_0: '/elsewhere/hooks',
      }),
    ).toEqual({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'maintenance.auto',
      GIT_CONFIG_VALUE_0: 'false',
    });
  });
});
