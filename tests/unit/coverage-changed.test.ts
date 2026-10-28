import { describe, expect, it } from 'vitest';
import {
  changedLines,
  isJudged,
  judge,
  missingMerged,
  render,
} from '../../scripts/coverage-changed.mjs';
import type { LocatedCoverage } from '../../scripts/coverage-merge.mjs';

/**
 * The changed-line verdict (#896): every line a pull request adds or changes
 * in code, checked against the joined coverage of every suite. A line no test
 * ran is "unrun"; a line in a file no suite measured is "unmeasured", never
 * counted as run. It prints on every pull request and gates none until #902.
 */
const lines = (diff: string) =>
  Object.fromEntries(
    [...changedLines(diff)].map(([file, set]) => [file, [...set]]),
  );

const modified = (file: string, ...hunks: string[]) =>
  [
    `diff --git a/${file} b/${file}`,
    'index 1111111..2222222 100644',
    `--- a/${file}`,
    `+++ b/${file}`,
    ...hunks,
  ].join('\n');

describe('the lines a change adds (#896)', () => {
  it('reads the added lines of a modified file', () => {
    expect(
      lines(
        modified('src/a.ts', '@@ -3,2 +3,3 @@', '-x', '-y', '+x', '+y', '+z'),
      ),
    ).toEqual({ 'src/a.ts': [3, 4, 5] });
  });

  it('reads one added line from a hunk with no count', () => {
    expect(lines(modified('src/a.ts', '@@ -7 +7 @@', '-a', '+b'))).toEqual({
      'src/a.ts': [7],
    });
  });

  it('reads every line of a new file', () => {
    expect(
      lines(
        [
          'diff --git a/src/new.ts b/src/new.ts',
          'new file mode 100644',
          'index 0000000..3333333',
          '--- /dev/null',
          '+++ b/src/new.ts',
          '@@ -0,0 +1,2 @@',
          '+one',
          '+two',
        ].join('\n'),
      ),
    ).toEqual({ 'src/new.ts': [1, 2] });
  });

  it('keys a renamed file by its new path', () => {
    expect(
      lines(
        [
          'diff --git a/src/old.ts b/src/renamed.ts',
          'similarity index 90%',
          'rename from src/old.ts',
          'rename to src/renamed.ts',
          'index 1111111..2222222 100644',
          '--- a/src/old.ts',
          '+++ b/src/renamed.ts',
          '@@ -2 +2 @@',
          '-a',
          '+b',
        ].join('\n'),
      ),
    ).toEqual({ 'src/renamed.ts': [2] });
  });

  it('gives a deleted file no lines', () => {
    expect(
      lines(
        [
          'diff --git a/src/gone.ts b/src/gone.ts',
          'deleted file mode 100644',
          '--- a/src/gone.ts',
          '+++ /dev/null',
          '@@ -1,2 +0,0 @@',
          '-a',
          '-b',
        ].join('\n'),
      ),
    ).toEqual({});
  });

  it('gives a hunk that only removes lines nothing to judge', () => {
    expect(lines(modified('src/a.ts', '@@ -4,2 +3,0 @@', '-a', '-b'))).toEqual(
      {},
    );
  });

  it('skips a binary file', () => {
    expect(
      lines(
        [
          'diff --git a/src/assets/x.png b/src/assets/x.png',
          'index 1111111..2222222 100644',
          'Binary files a/src/assets/x.png and b/src/assets/x.png differ',
        ].join('\n'),
      ),
    ).toEqual({});
  });

  it('keeps a path with a space whole', () => {
    expect(lines(modified('src/a b.ts', '@@ -1 +1 @@', '-a', '+b'))).toEqual({
      'src/a b.ts': [1],
    });
  });

  it('refuses a quoted path rather than guessing it', () => {
    expect(() =>
      changedLines(
        [
          'diff --git "a/src/\\303\\251.ts" "b/src/\\303\\251.ts"',
          '--- "a/src/\\303\\251.ts"',
          '+++ "b/src/\\303\\251.ts"',
          '@@ -1 +1 @@',
        ].join('\n'),
      ),
    ).toThrow(
      'coverage-changed: git quoted the path "b/src/\\303\\251.ts"; run git with core.quotePath=false',
    );
  });
});

describe('which changed files are judged (#896)', () => {
  it.each([
    'src/lib/a.ts',
    'scripts/b.mjs',
    'functions/api/c.js',
    'tests/helper.ts',
    'tests/e2e/fixtures.ts',
    'vitest.config.ts',
    'src/components/Card.astro',
  ])('judges code: %s', (file) => {
    expect(isJudged(file)).toBe(true);
  });

  it.each([
    'tests/unit/a.test.ts',
    'tests/e2e/b.spec.ts',
    'src/env.d.ts',
    'README.md',
    'src/lib/i18n/.translations.json',
    'src/styles/tokens.css',
    '.github/workflows/ci.yml',
  ])('leaves out tests, declarations and non-code: %s', (file) => {
    expect(isJudged(file)).toBe(false);
  });
});

const covered = (
  statements: [number, number, number][],
  branches: [number, number, number][] = [],
): LocatedCoverage => ({
  statements: Object.fromEntries(
    statements.map(([start, end, count], i) => [
      `s${i}`,
      { start, end, count },
    ]),
  ),
  branches: Object.fromEntries(
    branches.map(([start, end, count], i) => [`b${i}`, { start, end, count }]),
  ),
});

const changed = (file: string, ...at: number[]) =>
  new Map([[file, new Set(at)]]);

describe('the verdict on the changed lines (#896)', () => {
  it('finds a changed line no test ran', () => {
    expect(
      judge(changed('src/a.ts', 2), { 'src/a.ts': covered([[2, 2, 0]]) }),
    ).toEqual({
      unrun: [{ file: 'src/a.ts', line: 2, kind: 'line' }],
      unmeasured: [],
      judged: 1,
    });
  });

  it('passes a changed line a test ran', () => {
    expect(
      judge(changed('src/a.ts', 2), { 'src/a.ts': covered([[2, 2, 1]]) }),
    ).toEqual({
      unrun: [],
      unmeasured: [],
      judged: 1,
    });
  });

  it('finds an unrun line in the middle of a statement that starts earlier', () => {
    expect(
      judge(changed('src/a.ts', 5), { 'src/a.ts': covered([[3, 7, 0]]) }).unrun,
    ).toEqual([{ file: 'src/a.ts', line: 5, kind: 'line' }]);
  });

  it('finds an unrun inner statement inside an outer one that ran', () => {
    expect(
      judge(changed('src/a.ts', 5), {
        'src/a.ts': covered([
          [3, 7, 1],
          [5, 5, 0],
        ]),
      }).unrun,
    ).toEqual([{ file: 'src/a.ts', line: 5, kind: 'line' }]);
  });

  it('finds a branch arm no test took, once, at its first changed line', () => {
    expect(
      judge(changed('src/a.ts', 4, 5), {
        'src/a.ts': covered(
          [
            [4, 4, 1],
            [5, 5, 1],
          ],
          [[4, 6, 0]],
        ),
      }).unrun,
    ).toEqual([{ file: 'src/a.ts', line: 4, kind: 'branch' }]);
  });

  it('reports two untaken arms first met on the same changed line once', () => {
    expect(
      judge(changed('src/a.ts', 4), {
        'src/a.ts': covered(
          [[4, 4, 1]],
          [
            [4, 6, 0],
            [4, 9, 0],
          ],
        ),
      }).unrun,
    ).toEqual([{ file: 'src/a.ts', line: 4, kind: 'branch' }]);
  });

  it('does not judge a changed line with no statement, such as a comment', () => {
    expect(
      judge(changed('src/a.ts', 1), { 'src/a.ts': covered([[2, 2, 0]]) }),
    ).toEqual({
      unrun: [],
      unmeasured: [],
      judged: 0,
    });
  });

  it('calls every changed line of a code file no suite measured unmeasured', () => {
    expect(judge(changed('src/components/Card.astro', 1, 2), {})).toEqual({
      unrun: [],
      unmeasured: [
        { file: 'src/components/Card.astro', line: 1, kind: 'line' },
        { file: 'src/components/Card.astro', line: 2, kind: 'line' },
      ],
      judged: 2,
    });
  });

  it('calls a line of a file measured with every count at zero unrun, never skipped', () => {
    expect(
      judge(changed('src/scripts/page.ts', 9), {
        'src/scripts/page.ts': covered([[9, 9, 0]]),
      }).unrun,
    ).toEqual([{ file: 'src/scripts/page.ts', line: 9, kind: 'line' }]);
  });

  it('leaves a changed test file out', () => {
    expect(judge(changed('tests/unit/a.test.ts', 1), {})).toEqual({
      unrun: [],
      unmeasured: [],
      judged: 0,
    });
  });
});

describe('the verdict as the job summary prints it (#896)', () => {
  it('says so when every judged line ran', () => {
    expect(render({ unrun: [], unmeasured: [], judged: 12 })).toBe(
      '### Coverage of the changed lines (#896)\n\n12 changed lines judged: 0 unrun, 0 unmeasured.\n',
    );
  });

  it('lists each finding by file and line', () => {
    expect(
      render({
        unrun: [
          { file: 'src/a.ts', line: 4, kind: 'branch' },
          { file: 'src/a.ts', line: 9, kind: 'line' },
        ],
        unmeasured: [{ file: 'src/b.astro', line: 1, kind: 'line' }],
        judged: 3,
      }),
    ).toBe(
      [
        '### Coverage of the changed lines (#896)',
        '',
        '3 changed lines judged: 2 unrun, 1 unmeasured.',
        '',
        '**Unrun** (no test ran these):',
        '- `src/a.ts:4` (branch)',
        '- `src/a.ts:9` (line)',
        '',
        '**Unmeasured** (no suite measured these files):',
        '- `src/b.astro:1`',
        '',
      ].join('\n'),
    );
  });
});

describe('a missing merged file is named (#969)', () => {
  const present =
    (...files: string[]) =>
    (file: string) =>
      files.includes(file);

  it('names nothing when the report and its tree are both there', () => {
    expect(
      missingMerged(
        present('coverage/merged/coverage.json', 'coverage/merged/tree.txt'),
      ),
    ).toBeUndefined();
  });

  it('names the tree file when only it is missing', () => {
    expect(missingMerged(present('coverage/merged/coverage.json'))).toBe(
      'coverage-changed: no coverage/merged/tree.txt beside the merged report, so the tree it measured is unknown; run node scripts/coverage-merge.mjs, which writes both',
    );
  });

  it('names the report when only it is missing', () => {
    expect(missingMerged(present('coverage/merged/tree.txt'))).toBe(
      'coverage-changed: no merged report at coverage/merged/coverage.json; run the suites with coverage, then node scripts/coverage-merge.mjs',
    );
  });

  it('names both when both are missing', () => {
    expect(missingMerged(present())).toBe(
      'coverage-changed: no merged report at coverage/merged/coverage.json, nor coverage/merged/tree.txt; run the suites with coverage, then node scripts/coverage-merge.mjs',
    );
  });
});
