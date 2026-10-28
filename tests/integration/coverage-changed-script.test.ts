import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runScriptIn, scratchGit } from '../git-env';

/**
 * `scripts/coverage-changed.mjs` as CI runs it (#896): in a real repository
 * whose `origin/develop` is the base, so the diff, the merge base and the tree
 * are git's own answers. `tests/unit/coverage-changed.test.ts` holds the
 * verdict itself.
 */

const SCRIPT = path.resolve(
  import.meta.dirname,
  '../../scripts/coverage-changed.mjs',
);

let repo: string;
let git: (args: readonly string[]) => string;

beforeEach(() => {
  repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'coverage-changed-')));
  git = scratchGit(repo);
  git(['init', '-q', '-b', 'develop']);
  git(['config', 'user.email', 'changed@example.invalid']);
  git(['config', 'user.name', 'Changed']);
  mkdirSync(path.join(repo, 'src'));
  writeFileSync(path.join(repo, 'src/a.ts'), 'one();\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  git(['update-ref', 'refs/remotes/origin/develop', 'HEAD']);
  git(['checkout', '-q', '-b', 'feature']);
  writeFileSync(path.join(repo, 'src/a.ts'), 'one();\nran();\nnever();\n');
  git(['commit', '-q', '-am', 'two lines']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** The joined report: line 2 ran, line 3 did not, measured on `tree`. */
const report = (tree: string) => {
  mkdirSync(path.join(repo, 'coverage/merged'), { recursive: true });
  writeFileSync(
    path.join(repo, 'coverage/merged/coverage.json'),
    JSON.stringify({
      'src/a.ts': {
        statements: {
          '1:0-1:6': { start: 1, end: 1, count: 1 },
          '2:0-2:6': { start: 2, end: 2, count: 1 },
          '3:0-3:8': { start: 3, end: 3, count: 0 },
        },
        branches: {},
      },
    }),
  );
  writeFileSync(path.join(repo, 'coverage/merged/tree.txt'), `${tree}\n`);
};

const verdict = (...flags: string[]) => runScriptIn(repo, SCRIPT, flags);

const PRINTED =
  '### Coverage of the changed lines (#896)\n\n2 changed lines judged: 1 unrun, 0 unmeasured.\n\n**Unrun** (no test ran these):\n- `src/a.ts:3` (line)\n';

describe('coverage-changed.mjs in a real repository', () => {
  it('prints the unrun line and passes while it only reports', () => {
    report(git(['rev-parse', 'HEAD^{tree}']).trim());
    const run = verdict('--report-only');
    expect([run.status, run.stdout, run.stderr]).toEqual([0, PRINTED, '']);
  });

  it('fails on the unrun line once it is a gate', () => {
    report(git(['rev-parse', 'HEAD^{tree}']).trim());
    const run = verdict();
    expect([run.status, run.stdout]).toEqual([1, PRINTED]);
  });

  it('refuses a report measured on another tree, even while it only reports', () => {
    report('0000000000000000000000000000000000000000');
    const run = verdict('--report-only');
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      `✗ coverage-changed: the report measured tree 0000000000000000000000000000000000000000, but HEAD's tree is ${git(['rev-parse', 'HEAD^{tree}']).trim()}: it is stale, so nothing is judged\n`,
    );
  });

  it('refuses when there is no report, even while it only reports', () => {
    const run = verdict('--report-only');
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      '✗ coverage-changed: no merged report at coverage/merged/coverage.json; run the suites with coverage, then node scripts/coverage-merge.mjs\n',
    );
  });
});
