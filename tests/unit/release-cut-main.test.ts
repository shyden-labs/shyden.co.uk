import { afterEach, describe, expect, it, vi } from 'vitest';
import { GIT } from '../../scripts/programs.mjs';

/**
 * release-cut's main() fetches the refs it judges through git named by its
 * absolute path, never `git` found on PATH (SonarCloud S4036, #1275). The
 * stand-in git records its call and refuses, so the run posts an error status
 * (to a stood-in fetch) and exits 1: nothing starts and nothing leaves.
 */

const calls: { command: string; args: readonly string[]; options: unknown }[] =
  [];

vi.mock('node:child_process', () => ({
  execFileSync: (
    command: string,
    args: readonly string[],
    options: unknown,
  ) => {
    calls.push({ command, args, options });
    throw new Error('the stand-in git stops here');
  },
}));

afterEach(() => {
  calls.length = 0;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('release-cut fetches through git by its full path (#1275)', () => {
  it("fetches develop, main and the pull request's merge, as data", async () => {
    for (const [name, value] of Object.entries({
      HEAD_REF: 'release/2026-11-26-x',
      HEAD_SHA: 'a'.repeat(40),
      GITHUB_REPOSITORY: 'o/r',
      PR_NUMBER: '7',
      GITHUB_API_URL: 'https://api.test',
      GITHUB_TOKEN: 't',
      GITHUB_SERVER_URL: 'https://github.test',
      GITHUB_RUN_ID: '1',
    }))
      vi.stubEnv(name, value);
    const posted: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      posted.push(url);
      return { ok: true, status: 201, text: async () => '' };
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    const { main } = await import('../../scripts/release-cut.mjs');

    await expect(main()).rejects.toThrow('exit 1');
    expect(calls[0]).toEqual({
      command: GIT,
      args: [
        'fetch',
        '--no-tags',
        'origin',
        '+refs/heads/develop:refs/remotes/origin/develop',
        '+refs/heads/main:refs/remotes/origin/main',
        '+refs/pull/7/merge:refs/remotes/pull/merge',
      ],
      options: { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    });
    expect(posted).toHaveLength(1);
  });
});
