import { describe, expect, it } from 'vitest';
import { mergeMaps, type FileCoverage } from '../../scripts/coverage-merge.mjs';

/**
 * Joining the suites' V8 reports into one (#896). Each suite transforms a file
 * on its own, so the same statement can carry a different id in each report:
 * counts are joined by where the code is, never by id.
 */
const ROOT = '/repo';

const at = (
  line: number,
  column: number,
  endLine: number,
  endColumn: number,
) => ({
  start: { line, column },
  end: { line: endLine, column: endColumn },
});

const file = (over: Partial<FileCoverage> = {}): FileCoverage => ({
  path: `${ROOT}/src/lib/a.ts`,
  statementMap: { '0': at(1, 0, 1, 10) },
  s: { '0': 0 },
  branchMap: {},
  b: {},
  fnMap: {},
  f: {},
  ...over,
});

describe('the suites’ reports join into one (#896)', () => {
  it('sums a statement found at the same place in two reports', () => {
    expect(
      mergeMaps(
        [
          { [`${ROOT}/src/lib/a.ts`]: file({ s: { '0': 2 } }) },
          { [`${ROOT}/src/lib/a.ts`]: file({ s: { '0': 3 } }) },
        ],
        ROOT,
      ),
    ).toEqual({
      merged: {
        'src/lib/a.ts': {
          statements: { '1:0-1:10': { start: 1, end: 1, count: 5 } },
          branches: {},
        },
      },
    });
  });

  it('sums a statement whose id differs between the reports', () => {
    const second = file({
      statementMap: { '7': at(1, 0, 1, 10) },
      s: { '7': 4 },
    });
    expect(
      mergeMaps(
        [
          { [`${ROOT}/src/lib/a.ts`]: file({ s: { '0': 1 } }) },
          { [`${ROOT}/src/lib/a.ts`]: second },
        ],
        ROOT,
      ),
    ).toMatchObject({
      merged: {
        'src/lib/a.ts': {
          statements: { '1:0-1:10': { start: 1, end: 1, count: 5 } },
        },
      },
    });
  });

  it('sums each branch arm by its own place', () => {
    const branchy = (counts: [number, number]) =>
      file({
        branchMap: {
          '0': {
            loc: at(2, 0, 4, 1),
            locations: [at(2, 4, 2, 9), at(3, 4, 4, 1)],
          },
        },
        b: { '0': counts },
      });
    expect(
      mergeMaps(
        [
          { [`${ROOT}/src/lib/a.ts`]: branchy([1, 0]) },
          { [`${ROOT}/src/lib/a.ts`]: branchy([2, 0]) },
        ],
        ROOT,
      ),
    ).toMatchObject({
      merged: {
        'src/lib/a.ts': {
          branches: {
            '2:4-2:9#0': { start: 2, end: 2, count: 3 },
            '3:4-4:1#1': { start: 3, end: 4, count: 0 },
          },
        },
      },
    });
  });

  it('keys an arm with no place of its own by its branch, and its index', () => {
    const implicitElse = file({
      branchMap: {
        '0': { loc: at(5, 0, 6, 1), locations: [at(5, 4, 5, 8), {}] },
      },
      b: { '0': [1, 0] },
    });
    expect(
      mergeMaps([{ [`${ROOT}/src/lib/a.ts`]: implicitElse }], ROOT),
    ).toMatchObject({
      merged: {
        'src/lib/a.ts': {
          branches: { '5:0-6:1#1': { start: 5, end: 6, count: 0 } },
        },
      },
    });
  });

  it('keeps a file only one report has', () => {
    expect(
      mergeMaps(
        [
          { [`${ROOT}/src/lib/a.ts`]: file({ s: { '0': 1 } }) },
          {
            [`${ROOT}/scripts/b.mjs`]: file({ path: `${ROOT}/scripts/b.mjs` }),
          },
        ],
        ROOT,
      ),
    ).toMatchObject({
      merged: {
        'src/lib/a.ts': { statements: { '1:0-1:10': { count: 1 } } },
        'scripts/b.mjs': { statements: { '1:0-1:10': { count: 0 } } },
      },
    });
  });

  it('refuses a file outside the repository, naming it', () => {
    expect(
      mergeMaps(
        [{ '/elsewhere/x.ts': file({ path: '/elsewhere/x.ts' }) }],
        ROOT,
      ),
    ).toEqual({
      refusal:
        'coverage-merge: /elsewhere/x.ts is outside /repo, so no change can be judged against it',
    });
  });

  it('refuses an empty list of reports', () => {
    expect(mergeMaps([], ROOT)).toEqual({
      refusal: 'coverage-merge: no report to merge',
    });
  });
});

/**
 * A process's report and Vitest's describe the same statements at shifted
 * columns (#899, measured: Vitest's transform moves `export const`'s start and
 * drops end columns), in the same order and on the same lines. They join by
 * order, and only when every pair agrees on its lines.
 */
describe('reports whose places differ join by order (#899)', () => {
  const vitestLike = file({
    statementMap: { '0': at(1, 13, 1, 30), '1': at(2, 2, 2, 20) },
    s: { '0': 0, '1': 0 },
  });
  const processLike = (over: Partial<FileCoverage> = {}) =>
    file({
      statementMap: { '0': at(1, 32, 1, 30), '1': at(2, 2, 2, 40) },
      s: { '0': 1, '1': 0 },
      ...over,
    });

  it('sums each statement onto the first report’s place, pairing them by order', () => {
    expect(
      mergeMaps(
        [
          { [`${ROOT}/src/lib/a.ts`]: vitestLike },
          { [`${ROOT}/src/lib/a.ts`]: processLike() },
        ],
        ROOT,
      ),
    ).toEqual({
      merged: {
        'src/lib/a.ts': {
          statements: {
            '1:13-1:30': { start: 1, end: 1, count: 1 },
            '2:2-2:20': { start: 2, end: 2, count: 0 },
          },
          branches: {},
        },
      },
    });
  });

  it('refuses reports holding different numbers of statements, naming the file', () => {
    expect(
      mergeMaps(
        [
          { [`${ROOT}/src/lib/a.ts`]: vitestLike },
          {
            [`${ROOT}/src/lib/a.ts`]: processLike({
              statementMap: { '0': at(1, 32, 1, 30) },
              s: { '0': 1 },
            }),
          },
        ],
        ROOT,
      ),
    ).toEqual({
      refusal:
        'coverage-merge: src/lib/a.ts holds a different number of statements in two reports (2 and 1), so their counts cannot be joined',
    });
  });

  it('refuses a pair that disagrees on its lines, naming both places', () => {
    expect(
      mergeMaps(
        [
          { [`${ROOT}/src/lib/a.ts`]: vitestLike },
          {
            [`${ROOT}/src/lib/a.ts`]: processLike({
              statementMap: { '0': at(1, 32, 1, 30), '1': at(3, 2, 3, 40) },
            }),
          },
        ],
        ROOT,
      ),
    ).toEqual({
      refusal:
        'coverage-merge: src/lib/a.ts statement 2:2-2:20 in one report is 3:2-3:40 in another, on other lines, so their counts cannot be joined',
    });
  });

  // Measured on PR #926 (runs 39715493288, 39729419429): Vitest re-prints a
  // module with its parentheses dropped and printed back unmapped, so its
  // remap puts a node that opens with `(` on the token before it and ends one
  // closed by a `)` line early: back-translate.ts's `return (` … `);` (284-287
  // in its own text, 284-286 in Vitest's), its arm `(sorted[…] + …) / 2`
  // (525:6, Vitest 524:13), and message.ts's `(kind === …) ?? …` (171:8,
  // Vitest 170:12). A pair that differs only that way is one node.
  const SOURCE = [
    'const a = 1;',
    '  return (',
    '    total',
    '  );',
    '  const b = 2;',
  ];
  const reading = (lines: readonly string[]) => (file: string) =>
    file === 'src/lib/a.ts' ? lines.join('\n') : undefined;
  const pair = (process: ReturnType<typeof at>) =>
    mergeMaps(
      [
        { [`${ROOT}/src/lib/a.ts`]: vitestLike },
        {
          [`${ROOT}/src/lib/a.ts`]: processLike({
            statementMap: { '0': at(1, 32, 1, 30), '1': process },
            s: { '0': 1, '1': 4 },
          }),
        },
      ],
      ROOT,
      reading(SOURCE),
    );
  const joined = {
    merged: {
      'src/lib/a.ts': {
        statements: {
          '1:13-1:30': { start: 1, end: 1, count: 1 },
          '2:2-2:20': { start: 2, end: 2, count: 4 },
        },
        branches: {},
      },
    },
  };

  it('joins a pair whose end Vitest placed a line early, where its own last line opens with )', () => {
    expect(pair(at(2, 2, 4, 3))).toEqual(joined);
  });

  it('refuses a pair whose end differs where its own last line does not open with )', () => {
    expect(pair(at(2, 2, 3, 9))).toEqual({
      refusal:
        'coverage-merge: src/lib/a.ts statement 2:2-2:20 in one report is 2:2-3:9 in another, on other lines, so their counts cannot be joined',
    });
  });

  it('joins a pair whose start Vitest placed a line early only where its own text opens with (', () => {
    const startMoved = (column: number) =>
      mergeMaps(
        [
          {
            [`${ROOT}/src/lib/a.ts`]: file({
              statementMap: { '0': at(1, 13, 1, 30), '1': at(1, 30, 3, 9) },
              s: { '0': 0, '1': 0 },
            }),
          },
          {
            [`${ROOT}/src/lib/a.ts`]: processLike({
              statementMap: { '0': at(1, 32, 1, 30), '1': at(2, column, 3, 9) },
              s: { '0': 1, '1': 4 },
            }),
          },
        ],
        ROOT,
        reading(['const a = 1;', '  return (total', ' + 1);']),
      );
    // Column 9 is the `(`; column 3 is the `e` of `return`, with the same end.
    expect(startMoved(9)).toMatchObject({
      merged: { 'src/lib/a.ts': { statements: { '1:30-3:9': { count: 4 } } } },
    });
    expect(startMoved(3)).toEqual({
      refusal:
        'coverage-merge: src/lib/a.ts statement 1:30-3:9 in one report is 2:3-3:9 in another, on other lines, so their counts cannot be joined',
    });
  });

  it('refuses a pair whose start Vitest placed LATER than the process did, even at a (', () => {
    expect(
      mergeMaps(
        [
          { [`${ROOT}/src/lib/a.ts`]: vitestLike },
          {
            [`${ROOT}/src/lib/a.ts`]: processLike({
              statementMap: { '0': at(1, 32, 1, 30), '1': at(1, 10, 2, 20) },
            }),
          },
        ],
        ROOT,
        reading(['const a = (1);', '  const b = 2;']),
      ),
    ).toEqual({
      refusal:
        'coverage-merge: src/lib/a.ts statement 2:2-2:20 in one report is 1:10-2:20 in another, on other lines, so their counts cannot be joined',
    });
  });

  it('allows no moved line when the source cannot be read', () => {
    expect(
      mergeMaps(
        [
          { [`${ROOT}/src/lib/a.ts`]: vitestLike },
          {
            [`${ROOT}/src/lib/a.ts`]: processLike({
              statementMap: { '0': at(1, 32, 1, 30), '1': at(2, 2, 4, 3) },
            }),
          },
        ],
        ROOT,
      ),
    ).toEqual({
      refusal:
        'coverage-merge: src/lib/a.ts statement 2:2-2:20 in one report is 2:2-4:3 in another, on other lines, so their counts cannot be joined',
    });
  });

  it('names every file it cannot join, not only the first', () => {
    const twoPlaces = (path: string) => ({ [`${ROOT}/${path}`]: vitestLike });
    const onePlace = (path: string) => ({
      [`${ROOT}/${path}`]: processLike({
        statementMap: { '0': at(1, 32, 1, 30) },
        s: { '0': 1 },
      }),
    });
    expect(
      mergeMaps(
        [
          { ...twoPlaces('src/lib/a.ts'), ...twoPlaces('src/lib/b.ts') },
          { ...onePlace('src/lib/a.ts'), ...onePlace('src/lib/b.ts') },
        ],
        ROOT,
      ),
    ).toEqual({
      refusal: [
        'coverage-merge: src/lib/a.ts holds a different number of statements in two reports (2 and 1), so their counts cannot be joined',
        'coverage-merge: src/lib/b.ts holds a different number of statements in two reports (2 and 1), so their counts cannot be joined',
      ].join('\n'),
    });
  });

  it('pairs branch arms by order too', () => {
    const arms = (first: number, second: number, counts: [number, number]) =>
      file({
        branchMap: {
          '0': {
            loc: at(2, 0, 4, 1),
            locations: [at(2, first, 2, 9), at(3, second, 4, 1)],
          },
        },
        b: { '0': counts },
      });
    expect(
      mergeMaps(
        [
          { [`${ROOT}/src/lib/a.ts`]: arms(4, 4, [0, 0]) },
          { [`${ROOT}/src/lib/a.ts`]: arms(6, 7, [2, 0]) },
        ],
        ROOT,
      ),
    ).toMatchObject({
      merged: {
        'src/lib/a.ts': {
          branches: {
            '2:4-2:9#0': { start: 2, end: 2, count: 2 },
            '3:4-4:1#1': { start: 3, end: 4, count: 0 },
          },
        },
      },
    });
  });

  it('refuses reports holding different numbers of branch arms, naming the file', () => {
    expect(
      mergeMaps(
        [
          {
            [`${ROOT}/src/lib/a.ts`]: file({
              branchMap: {
                '0': { loc: at(2, 0, 4, 1), locations: [at(2, 4, 2, 9)] },
              },
              b: { '0': [0] },
            }),
          },
          {
            [`${ROOT}/src/lib/a.ts`]: file({
              statementMap: { '0': at(1, 2, 1, 10) },
              branchMap: {
                '0': {
                  loc: at(2, 0, 4, 1),
                  locations: [at(2, 6, 2, 9), at(3, 4, 4, 1)],
                },
              },
              b: { '0': [1, 0] },
            }),
          },
        ],
        ROOT,
      ),
    ).toEqual({
      refusal:
        'coverage-merge: src/lib/a.ts holds a different number of branch arms in two reports (1 and 2), so their counts cannot be joined',
    });
  });
});
