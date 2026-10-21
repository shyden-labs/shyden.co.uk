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
 * Code a test runs in a child process is measured (#899 AC3): a throwaway
 * project whose Vitest config spreads this repository's own
 * `coverageFor('integration')` runs one test that starts a planted script as
 * a child. Its report says which arm of the script ran, both ways round, so
 * dropping `autoAttachSubprocess` from the options turns this red (the
 * child's file then reads 0, measured 2026-10-21).
 */
const ROOT = path.resolve(import.meta.dirname, '../..');
const VITEST = path.join(ROOT, 'node_modules/vitest/vitest.mjs');
const OPTIONS = path.join(ROOT, 'tests/coverage-options.ts');

const PLANTED = [
  "const take = process.argv[2] === 'yes';",
  'if (take) {',
  "  process.stdout.write('taken');",
  '} else {',
  "  process.stdout.write('not taken');",
  '}',
  '',
].join('\n');

let project: string;

beforeEach(() => {
  project = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'coverage-subprocess-')),
  );
  mkdirSync(path.join(project, 'scripts'));
  writeFileSync(path.join(project, 'scripts/planted.mjs'), PLANTED);
  writeFileSync(
    path.join(project, 'vitest.config.mjs'),
    [
      `import { coverageFor } from ${JSON.stringify(OPTIONS)};`,
      'export default {',
      '  test: {',
      "    include: ['child.test.mjs'],",
      '    coverage: {',
      "      ...coverageFor('integration'),",
      "      include: ['scripts/*.mjs'],",
      "      reporter: ['json'],",
      "      reportsDirectory: 'coverage',",
      '    },',
      '  },',
      '};',
      '',
    ].join('\n'),
  );
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

/** Runs the throwaway project's one test, its child answering `answer`. */
const measure = (answer: 'yes' | 'no') => {
  writeFileSync(
    path.join(project, 'child.test.mjs'),
    [
      "import { execFileSync } from 'node:child_process';",
      "import { expect, test } from 'vitest';",
      "test('the planted script runs as a child', () => {",
      `  expect(execFileSync(process.execPath, ['scripts/planted.mjs', ${JSON.stringify(answer)}], { cwd: import.meta.dirname, encoding: 'utf8' })).toBe(${JSON.stringify(answer === 'yes' ? 'taken' : 'not taken')});`,
      '});',
      '',
    ].join('\n'),
  );
  return spawnSync(
    process.execPath,
    [VITEST, 'run', '--root', project, '--coverage'],
    { cwd: project, encoding: 'utf8' },
  );
};

/** Each statement of the planted script as `line=count`. */
const lines = () => {
  const report = JSON.parse(
    readFileSync(path.join(project, 'coverage/coverage-final.json'), 'utf8'),
  ) as Record<
    string,
    {
      statementMap: Record<string, { start: { line: number } }>;
      s: Record<string, number>;
    }
  >;
  const planted = report[path.join(project, 'scripts/planted.mjs')];
  if (!planted) throw new Error('the planted script is not in the report');
  return Object.entries(planted.statementMap).map(
    ([id, { start }]) => `${start.line}=${planted.s[id]}`,
  );
};

describe('a child process’s code is measured under the repository’s own coverage options', () => {
  it('the arm the child took reads run, the other unrun', () => {
    const run = measure('yes');
    expect(run.status, run.stderr).toBe(0);
    expect(lines()).toEqual(['1=1', '2=1', '3=1', '5=0']);
  });

  it('the other answer turns the verdict round', () => {
    const run = measure('no');
    expect(run.status, run.stderr).toBe(0);
    expect(lines()).toEqual(['1=1', '2=1', '3=0', '5=1']);
  });
});
