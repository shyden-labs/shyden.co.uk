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
