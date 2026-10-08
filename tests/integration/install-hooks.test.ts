import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scratchGit, withoutLocalGit } from '../git-env';

/**
 * `scripts/install-hooks.mjs`, run by `npm install` (`prepare`) in a clone,
 * in a source tarball and in a container checkout.
 *
 * Its success line once named only the pre-push hook while `.githooks/`
 * installed `commit-msg` too, which is the closing-keyword refusal. It now
 * names the directory and no hook in it, so there is no list to fall behind.
 */

const SCRIPT = path.resolve(
  import.meta.dirname,
  '../../scripts/install-hooks.mjs',
);

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'install-hooks-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const install = () => {
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: 'utf8',
    env: withoutLocalGit(process.env),
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
};

describe('install-hooks', () => {
  it('points git at .githooks, and names no hook it could leave out', () => {
    const git = scratchGit(dir);
    git(['init', '-q']);

    const { code, out, err } = install();

    expect(err).toBe('');
    expect(out).toBe(
      'install-hooks: git will run the hooks in .githooks/. ' +
        'Bypass one with --no-verify.\n',
    );
    expect(git(['config', 'core.hooksPath']).trim()).toBe('.githooks');
    expect(code).toBe(0);
  });

  it('installs nothing, and says so, where there is no .git', () => {
    const { code, out } = install();

    // The whole output: without its exit, this branch would go on to ask
    // git, and print git's refusal after it.
    expect(out).toBe(
      'install-hooks: no .git here, so no git hooks were installed. ' +
        'Run this again from a clone to install its hooks.\n',
    );
    expect(code).toBe(0);
  });

  it('never fails an install when git refuses the config, and says why', () => {
    writeFileSync(path.join(dir, '.git'), 'not a repository\n');

    const { code, out } = install();

    // One line, and it is the refusal: git's own wording varies by version,
    // so the line is matched by its shape rather than spelled out, and a
    // success line printed after it would be a second line.
    expect(out.split('\n').filter((line) => line !== '')).toEqual([
      expect.stringMatching(
        /^install-hooks: git would not accept a config here \(fatal: .+\), so no hooks were installed\./,
      ),
    ]);
    expect(code).toBe(0);
  });
});
