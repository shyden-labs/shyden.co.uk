import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { listSuite } from '../../scripts/test-e2e.mjs';
import { NODE, PLAYWRIGHT_CLI } from '../../scripts/programs.mjs';

describe('running `playwright test --list`', () => {
  // #438: the listing grows with the suite, about 150 bytes a test, and
  // passed spawnSync's 1 MiB default at 7039 tests. Node then kills the
  // child, and all eight shards of PR #437 failed with every test green.
  it('reads a listing larger than spawnSync’s 1 MiB default whole', () => {
    const size = 2 * 1024 * 1024;
    const run = listSuite([], (_command, _args, options) =>
      spawnSync(
        process.execPath,
        ['-e', `process.stdout.write('x'.repeat(${size}))`],
        options,
      ),
    );

    expect(run.error?.message).toBeUndefined();
    expect(run.status).toBe(0);
    expect(run.stdout).toHaveLength(size);
  });

  it('lists the whole suite through playwright, with what it may inherit', () => {
    const calls: string[][] = [];
    listSuite(
      ['--config=playwright.dev.config.ts', '--project=chromium'],
      (command, args) => {
        calls.push([command, ...args]);
        return spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
      },
    );

    // Playwright's own entry file under node, never `npx` on PATH (#1295).
    expect(calls).toEqual([
      [
        NODE,
        PLAYWRIGHT_CLI,
        'test',
        '--list',
        '--config=playwright.dev.config.ts',
      ],
    ]);
  });
});
