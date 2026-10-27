import { describe, expect, it } from 'vitest';
import {
  mergeMaps,
  reportPaths,
  type FileCoverage,
} from '../../scripts/coverage-merge.mjs';

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

  it('keys an arm with no place of its own by its branch, its index, and that it has none', () => {
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
          branches: { '5:0-6:1#1:implicit': { start: 5, end: 6, count: 0 } },
        },
      },
    });
  });

  // `if (a) { … } else if (b) { … }`: the outer `else` is placed on the inner
  // `if`, whose own implicit `else` takes the inner `if`'s place at the same
  // index (#960, measured in 11 files of the unit report).
  it('keeps an else-if’s placed else and its implicit else apart', () => {
    const elseIf = file({
      branchMap: {
        '0': {
          loc: at(1, 0, 5, 1),
          locations: [at(1, 7, 2, 1), at(2, 7, 5, 1)],
        },
        '1': { loc: at(2, 7, 5, 1), locations: [at(2, 14, 3, 1), {}] },
      },
      b: { '0': [3, 2], '1': [2, 0] },
    });
    expect(
      mergeMaps([{ [`${ROOT}/src/lib/a.ts`]: elseIf }], ROOT),
    ).toMatchObject({
      merged: {
        'src/lib/a.ts': {
          branches: {
            '1:7-2:1#0': { start: 1, end: 2, count: 3 },
            '2:7-5:1#1': { start: 2, end: 5, count: 2 },
            '2:14-3:1#0': { start: 2, end: 3, count: 2 },
            '2:7-5:1#1:implicit': { start: 2, end: 5, count: 0 },
          },
        },
      },
    });
  });

  it('refuses two branch arms one report places alike, naming the file and the place', () => {
    const twins = file({
      branchMap: {
        '0': { loc: at(5, 0, 6, 1), locations: [at(5, 4, 5, 8), {}] },
        '1': { loc: at(5, 0, 6, 1), locations: [at(5, 9, 5, 12), {}] },
      },
      b: { '0': [1, 0], '1': [1, 1] },
    });
    expect(mergeMaps([{ [`${ROOT}/src/lib/a.ts`]: twins }], ROOT)).toEqual({
      refusal:
        'coverage-merge: src/lib/a.ts places two branch arms at 5:0-6:1#1:implicit in one report, so their counts cannot be told apart',
    });
  });

  it('refuses two statements one report places alike, naming the file and the place', () => {
    const twins = file({
      statementMap: { '0': at(1, 0, 1, 10), '1': at(1, 0, 1, 10) },
      s: { '0': 1, '1': 0 },
    });
    expect(mergeMaps([{ [`${ROOT}/src/lib/a.ts`]: twins }], ROOT)).toEqual({
      refusal:
        'coverage-merge: src/lib/a.ts places two statements at 1:0-1:10 in one report, so their counts cannot be told apart',
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
 * Every report of a file lists the same places, since each is Vitest's own
 * conversion of Vitest's own transform, the process reports' too (#913). A
 * place one lists and another does not is refused, never paired by order:
 * before #913 the process reports were converted on the file's own text and
 * joined by order, with allowances where Vitest moved a parenthesis.
 */
describe('every report of a file lists the same places (#913)', () => {
  const two = file({
    statementMap: { '0': at(1, 13, 1, 30), '1': at(2, 2, 2, 20) },
    s: { '0': 0, '1': 0 },
  });
  const one = file({ statementMap: { '0': at(1, 13, 1, 30) }, s: { '0': 1 } });

  it('refuses a statement only the later report lists, naming it', () => {
    expect(
      mergeMaps(
        [{ [`${ROOT}/src/lib/a.ts`]: one }, { [`${ROOT}/src/lib/a.ts`]: two }],
        ROOT,
      ),
    ).toEqual({
      refusal:
        'coverage-merge: src/lib/a.ts lists the statement at 2:2-2:20 in one report and not in another, so their counts cannot be joined',
    });
  });

  it('refuses a statement only the earlier report lists, naming it', () => {
    expect(
      mergeMaps(
        [{ [`${ROOT}/src/lib/a.ts`]: two }, { [`${ROOT}/src/lib/a.ts`]: one }],
        ROOT,
      ),
    ).toEqual({
      refusal:
        'coverage-merge: src/lib/a.ts lists the statement at 2:2-2:20 in one report and not in another, so their counts cannot be joined',
    });
  });

  // PR #926's allowance: Vitest ended `return (` … `);` a line early.
  it('refuses a statement whose end moved a line, as the order join once allowed', () => {
    const own = file({
      statementMap: { '0': at(1, 13, 1, 30), '1': at(2, 2, 4, 3) },
      s: { '0': 1, '1': 1 },
    });
    expect(
      mergeMaps(
        [{ [`${ROOT}/src/lib/a.ts`]: two }, { [`${ROOT}/src/lib/a.ts`]: own }],
        ROOT,
      ),
    ).toEqual({
      refusal:
        'coverage-merge: src/lib/a.ts lists the statement at 2:2-4:3 in one report and not in another, so their counts cannot be joined',
    });
  });

  it('refuses a branch arm one report lists and another does not, naming it', () => {
    const arms = (second: number) =>
      file({
        branchMap: {
          '0': {
            loc: at(2, 0, 4, 1),
            locations: [at(2, 4, 2, 9), at(3, second, 4, 1)],
          },
        },
        b: { '0': [0, 0] },
      });
    expect(
      mergeMaps(
        [
          { [`${ROOT}/src/lib/a.ts`]: arms(4) },
          { [`${ROOT}/src/lib/a.ts`]: arms(7) },
        ],
        ROOT,
      ),
    ).toEqual({
      refusal:
        'coverage-merge: src/lib/a.ts lists the branch arm at 3:7-4:1#1 in one report and not in another, so their counts cannot be joined',
    });
  });

  it('names every file it cannot join, not only the first', () => {
    expect(
      mergeMaps(
        [
          {
            [`${ROOT}/src/lib/a.ts`]: two,
            [`${ROOT}/src/lib/b.ts`]: two,
          },
          {
            [`${ROOT}/src/lib/a.ts`]: one,
            [`${ROOT}/src/lib/b.ts`]: one,
          },
        ],
        ROOT,
      ),
    ).toEqual({
      refusal: [
        'coverage-merge: src/lib/a.ts lists the statement at 2:2-2:20 in one report and not in another, so their counts cannot be joined',
        'coverage-merge: src/lib/b.ts lists the statement at 2:2-2:20 in one report and not in another, so their counts cannot be joined',
      ].join('\n'),
    });
  });
});

/**
 * The reports the merge reads (#913): each Vitest suite's, then, when the
 * run says Playwright ran, one per Playwright run, of which there must be one.
 */
describe('the reports the merge reads', () => {
  it('reads the four suites alone when no Playwright run is named', () => {
    expect(reportPaths(undefined)).toEqual({
      reports: [
        'coverage/unit/coverage-final.json',
        'coverage/simulation/coverage-final.json',
        'coverage/integration/coverage-final.json',
        'coverage/processes/coverage-final.json',
      ],
    });
  });

  it('adds each Playwright run after them, in name order', () => {
    expect(
      reportPaths(['coverage-playwright-sanity', 'coverage-playwright-1']),
    ).toEqual({
      reports: [
        'coverage/unit/coverage-final.json',
        'coverage/simulation/coverage-final.json',
        'coverage/integration/coverage-final.json',
        'coverage/processes/coverage-final.json',
        'coverage/playwright/coverage-playwright-1/coverage-final.json',
        'coverage/playwright/coverage-playwright-sanity/coverage-final.json',
      ],
    });
  });

  it('refuses a run that says Playwright ran and holds no Playwright report', () => {
    expect(reportPaths([])).toEqual({
      refusal:
        'coverage-merge: --playwright names no run under coverage/playwright, so what Playwright ran would read as unmeasured',
    });
  });
});
