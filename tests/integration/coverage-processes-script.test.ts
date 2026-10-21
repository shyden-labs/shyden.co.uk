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

/**
 * `scripts/coverage-processes.mjs` on a real child process (#899 AC3): a
 * script run under `NODE_V8_COVERAGE` takes one arm of an `if`, and the
 * converted report says which line ran and which did not, both ways round.
 * `tests/unit/coverage-processes.test.ts` holds the conversion itself.
 */
const SCRIPT = path.resolve(
  import.meta.dirname,
  '../../scripts/coverage-processes.mjs',
);

const PLANTED = [
  "const take = process.argv[2] === 'yes';",
  'if (take) {',
  "  process.stdout.write('taken');",
  '} else {',
  "  process.stdout.write('not taken');",
  '}',
  '',
].join('\n');

let repo: string;

beforeEach(() => {
  repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'coverage-processes-')));
  mkdirSync(path.join(repo, 'scripts'));
  writeFileSync(path.join(repo, 'scripts/planted.mjs'), PLANTED);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** Runs the planted script as a child under NODE_V8_COVERAGE, then converts. */
const measure = (answer: 'yes' | 'no') => {
  const raw = path.join(repo, 'raw');
  const child = spawnSync(process.execPath, ['scripts/planted.mjs', answer], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, NODE_V8_COVERAGE: raw },
  });
  const convert = spawnSync(process.execPath, [SCRIPT, raw, 'processes'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, NODE_V8_COVERAGE: '' },
  });
  return { child, convert };
};

/** Each statement of the planted file as `line=count`. */
const lines = () => {
  const report = JSON.parse(
    readFileSync(
      path.join(repo, 'coverage/processes/coverage-final.json'),
      'utf8',
    ),
  ) as Record<
    string,
    {
      statementMap: Record<string, { start: { line: number } }>;
      s: Record<string, number>;
    }
  >;
  const planted = report[path.join(repo, 'scripts/planted.mjs')];
  if (!planted) throw new Error('the planted script is not in the report');
  return Object.entries(planted.statementMap).map(
    ([id, { start }]) => `${start.line}=${planted.s[id]}`,
  );
};

describe('coverage-processes.mjs on a real child process', () => {
  it('the taken arm’s line reads run and the other unrun', () => {
    const { child, convert } = measure('yes');
    expect([
      child.status,
      child.stdout,
      convert.status,
      convert.stderr,
    ]).toEqual([0, 'taken', 0, '']);
    expect(lines()).toEqual(['1=1', '2=1', '3=1', '5=0']);
  });

  it('the other answer turns the verdict round', () => {
    const { child, convert } = measure('no');
    expect([
      child.status,
      child.stdout,
      convert.status,
      convert.stderr,
    ]).toEqual([0, 'not taken', 0, '']);
    expect(lines()).toEqual(['1=1', '2=1', '3=0', '5=1']);
  });

  it('a directory no process wrote to is refused, naming it', () => {
    mkdirSync(path.join(repo, 'empty'));
    const run = spawnSync(
      process.execPath,
      [SCRIPT, path.join(repo, 'empty'), 'processes'],
      {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, NODE_V8_COVERAGE: '' },
      },
    );
    expect([run.status, run.stderr]).toEqual([
      1,
      `✗ coverage-processes: no process ran a measured file, so there is nothing to report (read ${path.join(repo, 'empty')})\n`,
    ]);
  });
});
