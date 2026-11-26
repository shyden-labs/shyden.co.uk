import { describe, expect, it, vi } from 'vitest';
import { GIT } from '../../scripts/programs.mjs';
import { main } from '../../scripts/docs-only.mjs';

/**
 * docs-only's main() reads the diff through git named by its absolute path,
 * never `git` found on PATH (SonarCloud S4036, #1275). The stand-in git
 * records each call and refuses; the verdict file is stood in too, so
 * nothing starts and nothing is written.
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
const written: string[] = [];
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  appendFileSync: (_file: string, text: string) => {
    written.push(text);
  },
}));
vi.mock('node:process', async (original) => ({
  ...(await original<typeof import('node:process')>()),
  env: {
    GITHUB_OUTPUT: '/nowhere/output',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_BASE_REF: 'develop',
  },
  exit: (code: number) => {
    throw new Error(`exit ${code}`);
  },
}));

describe('docs-only reads git by its full path (#1275)', () => {
  it('asks git for the diff, its output read as text', async () => {
    // docs-only reads a refusing git as "not docs-only" and still hands on a
    // verdict, so every job runs.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    main();

    expect(written.join('')).toContain('docs_only=false');
    expect(calls[0]).toMatchObject({
      command: GIT,
      options: { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    });
  });
});
