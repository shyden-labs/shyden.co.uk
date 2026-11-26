import { afterEach, describe, expect, it, vi } from 'vitest';
import { GIT } from '../../scripts/programs.mjs';
import { main } from '../../scripts/install-hooks.mjs';

/**
 * install-hooks' main() points git at the repository's hooks with git named
 * by its absolute path, never `git` found on PATH (SonarCloud S4036, #1275).
 * git and the process are stood in, so nothing starts and nothing exits.
 */

const calls: { command: string; args: readonly string[] }[] = [];

vi.mock('node:child_process', () => ({
  execFileSync: (command: string, args: readonly string[]) => {
    calls.push({ command, args });
    return '';
  },
}));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  existsSync: (file: string) => file === '.git',
}));
vi.mock('node:process', async (original) => ({
  ...(await original<typeof import('node:process')>()),
  argv: ['node', 'install-hooks.mjs'],
  exit: (code: number) => {
    throw new Error(`exit ${code}`);
  },
}));

afterEach(() => {
  calls.length = 0;
  vi.restoreAllMocks();
});

describe('install-hooks sets the hooks path through git by its full path (#1275)', () => {
  it('runs git config core.hooksPath .githooks, and says so', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    main();

    expect(calls).toEqual([
      { command: GIT, args: ['config', 'core.hooksPath', '.githooks'] },
    ]);
    expect(log).toHaveBeenCalledWith(
      'install-hooks: git will run the hooks in .githooks/.',
    );
  });
});
