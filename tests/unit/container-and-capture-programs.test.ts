import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GIT, NODE, NPM_CLI, PLAYWRIGHT_CLI } from '../../scripts/programs.mjs';
import { inside } from '../../scripts/desktop-container.mjs';
import { committedAtHead } from '../../scripts/visual-capture.mjs';

/**
 * The desktop container's run and the visual capture's read of HEAD start
 * their programs by absolute path, never by a name found on PATH (SonarCloud
 * S4036, #1275). Every program is stood in, so nothing starts.
 */

const calls: { command: string; args: readonly string[] }[] = [];
let answers: Record<string, unknown>[] = [];
const child = new EventEmitter();

vi.mock('node:child_process', () => ({
  spawnSync: (command: string, args: readonly string[]) => {
    calls.push({ command, args });
    return answers.shift() ?? { status: 0 };
  },
  spawn: (command: string, args: readonly string[]) => {
    calls.push({ command, args });
    return child;
  },
}));
vi.mock('node:process', async (original) => ({
  ...(await original<typeof import('node:process')>()),
  exit: (code: number) => {
    throw new Error(`exit ${code}`);
  },
}));

afterEach(() => {
  calls.length = 0;
  answers = [];
  child.removeAllListeners();
  vi.restoreAllMocks();
});

describe('the desktop container runs npm and Playwright by path (#1275)', () => {
  it('installs with npm, then runs Playwright with the arguments it was given', async () => {
    const closed: string[] = [];

    await inside(['--project=chromium'], {
      forward: async () => ({ close: () => closed.push('forward') }) as never,
    });

    expect(calls).toEqual([
      { command: NODE, args: [NPM_CLI, 'ci', '--no-audit', '--no-fund'] },
      {
        command: NODE,
        args: [PLAYWRIGHT_CLI, 'test', '--project=chromium'],
      },
    ]);
    expect(() => child.emit('close', 0, null)).toThrow('exit 0');
    expect(closed).toEqual(['forward']);
  });
});

describe("the visual capture reads HEAD's picture through git by path (#1275)", () => {
  it('asks git whether HEAD has the file, then reads it', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    answers = [{ status: 0 }, { status: 0, stdout: bytes }];

    expect(committedAtHead('a.png')).toBe(bytes);
    expect(calls).toEqual([
      { command: GIT, args: ['cat-file', '-e', 'HEAD:a.png'] },
      { command: GIT, args: ['show', 'HEAD:a.png'] },
    ]);
  });

  it('is undefined for a picture HEAD does not have', async () => {
    answers = [{ status: 128 }];

    expect(committedAtHead('new.png')).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});
