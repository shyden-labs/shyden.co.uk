import { afterEach, describe, expect, it, vi } from 'vitest';
import { GIT } from '../../scripts/programs.mjs';
import { main as releaseInventory } from '../../scripts/release-inventory.mjs';
import { main as buildReleaseContent } from '../../scripts/build-release-content.mjs';

/**
 * release-inventory's and build-release-content's main() read git named by
 * its absolute path, never `git` found on PATH (SonarCloud S4036, #1275). The
 * stand-in git records its first call and refuses, so the script refuses too:
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

const READS_LARGE_OUTPUT = { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 };

const runAs = (script: string, ...args: string[]) => {
  vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', script, ...args]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
};

afterEach(() => {
  calls.length = 0;
  vi.restoreAllMocks();
});

describe('the release scripts read git by its full path (#1275)', () => {
  it("release-inventory --tests lists git's tracked specs", async () => {
    runAs('release-inventory.mjs', '--tests');

    expect(() => releaseInventory()).toThrow('the stand-in git stops here');
    expect(calls[0]).toEqual({
      command: GIT,
      args: ['ls-files', '-z', '--', 'tests/e2e/*.spec.ts'],
      options: READS_LARGE_OUTPUT,
    });
  });

  it("build-release-content reads the release's commits through git", async () => {
    runAs(
      'build-release-content.mjs',
      '--release',
      'docs/releases/a3a5adb.json',
      '--head',
      'HEAD',
      '--check',
      '--manifest',
      'package.json',
    );

    // The release file is read before git, so this names a real one; the
    // stand-in git's refusal is reported and the script exits 1.
    expect(() => buildReleaseContent()).toThrow('exit 1');
    expect(calls[0]).toMatchObject({
      command: GIT,
      options: READS_LARGE_OUTPUT,
    });
  });
});
