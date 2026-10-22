import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scratchGit, withoutLocalGit } from '../git-env';

/**
 * `scripts/coverage-merge.mjs` as CI runs it after the three suites (#896): in
 * a real repository, so the tree it records is git's own answer.
 * `tests/unit/coverage-merge.test.ts` holds the joining itself.
 */

const SCRIPT = path.resolve(
  import.meta.dirname,
  '../../scripts/coverage-merge.mjs',
);
const SUITES = ['unit', 'simulation', 'integration', 'processes'];

let repo: string;
let git: (args: readonly string[]) => string;

/** One report, as a suite writes it: the one statement of `src/a.ts`, run `count` times. */
const report = (suite: string, count: number) => {
  mkdirSync(path.join(repo, 'coverage', suite), { recursive: true });
  const file = path.join(repo, 'src/a.ts');
  writeFileSync(
    path.join(repo, 'coverage', suite, 'coverage-final.json'),
    JSON.stringify({
      [file]: {
        path: file,
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } },
        },
        s: { '0': count },
        branchMap: {},
        b: {},
        fnMap: {},
        f: {},
      },
    }),
  );
};

beforeEach(() => {
  repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'coverage-merge-')));
  git = scratchGit(repo);
  git(['init', '-q', '-b', 'develop']);
  git(['config', 'user.email', 'merge@example.invalid']);
  git(['config', 'user.name', 'Merge']);
  mkdirSync(path.join(repo, 'src'));
  writeFileSync(path.join(repo, 'src/a.ts'), 'run(1);\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

const merge = () =>
  spawnSync(process.execPath, [SCRIPT], {
    cwd: repo,
    encoding: 'utf8',
    env: withoutLocalGit(process.env),
  });

describe('coverage-merge.mjs in a real repository', () => {
  it('joins the four reports and records the tree they measured', () => {
    SUITES.forEach((suite, index) => report(suite, index));
    const run = merge();
    expect([run.status, run.stderr]).toEqual([0, '']);
    expect(
      JSON.parse(
        readFileSync(path.join(repo, 'coverage/merged/coverage.json'), 'utf8'),
      ),
    ).toEqual({
      'src/a.ts': {
        statements: { '1:0-1:9': { start: 1, end: 1, count: 6 } },
        branches: {},
      },
    });
    expect(
      readFileSync(path.join(repo, 'coverage/merged/tree.txt'), 'utf8'),
    ).toBe(`${git(['rev-parse', 'HEAD^{tree}']).trim()}\n`);
  });

  it('refuses when a suite wrote no report, naming it', () => {
    SUITES.filter((suite) => suite !== 'simulation').forEach((suite) =>
      report(suite, 1),
    );
    const run = merge();
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ coverage-merge: no report at coverage/simulation/coverage-final.json. A suite that failed writes none; run it with --coverage first.\n',
    );
  });
});
