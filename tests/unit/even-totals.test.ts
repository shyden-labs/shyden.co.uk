import { describe, it, expect } from 'vitest';
import {
  countByProject,
  deviceTargets,
  evenTotals,
  totalLine,
  vitestCounts,
} from '../../scripts/even-totals.mjs';

const target = (name: string, passed: number, failed = 0, skipped = 0) => ({
  target: name,
  passed,
  failed,
  skipped,
});

describe('totalLine', () => {
  it('prints one line with passed, failed, skipped and the total', () => {
    expect(totalLine(target('webkit', 7, 1, 2))).toBe(
      'webkit: 7 passed, 1 failed, 2 skipped (total 10)',
    );
  });
});

describe('evenTotals', () => {
  it('is ok when every target has the same total and nothing is skipped', () => {
    const result = evenTotals([target('a', 5), target('b', 4, 1)]);
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('prints one line per target, in order', () => {
    const result = evenTotals([target('a', 5), target('b', 5)]);
    expect(result.lines).toEqual([
      'a: 5 passed, 0 failed, 0 skipped (total 5)',
      'b: 5 passed, 0 failed, 0 skipped (total 5)',
    ]);
  });

  it('fails when totals differ, naming every target and its total', () => {
    const result = evenTotals([
      target('a', 5),
      target('b', 80),
      target('c', 5),
    ]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('uneven totals');
    expect(result.reason).toContain('a: 5');
    expect(result.reason).toContain('b: 80');
    expect(result.reason).toContain('c: 5');
  });

  it('fails on any skipped test even when the totals match', () => {
    const result = evenTotals([target('a', 4, 0, 1), target('b', 5)]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('a: 1 skipped');
    expect(result.reason).not.toContain('b: 0 skipped');
  });

  it('fails when there are no targets, since nothing was measured', () => {
    expect(evenTotals([]).ok).toBe(false);
  });
});

const test = (projectName: string, status: string) => ({
  projectName,
  status,
});

describe('countByProject', () => {
  it('counts each project from its own tests, not the run-wide stats', () => {
    const report = {
      stats: { expected: 99, unexpected: 99, skipped: 99, flaky: 99 },
      suites: [
        {
          specs: [
            {
              tests: [
                test('chromium', 'expected'),
                test('firefox', 'expected'),
              ],
            },
          ],
          suites: [
            {
              specs: [
                {
                  tests: [
                    test('chromium', 'unexpected'),
                    test('chromium', 'skipped'),
                    test('firefox', 'flaky'),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(countByProject(report)).toEqual({
      chromium: { passed: 1, failed: 1, skipped: 1 },
      firefox: { passed: 1, failed: 1, skipped: 0 },
    });
  });

  it('returns nothing for a report with no suites', () => {
    expect(countByProject({})).toEqual({});
  });
});

describe('vitestCounts', () => {
  it('reads passed, failed and pending plus todo as skipped', () => {
    expect(
      vitestCounts({
        numPassedTests: 70,
        numFailedTests: 2,
        numPendingTests: 3,
        numTodoTests: 5,
      }),
    ).toEqual({ passed: 70, failed: 2, skipped: 8 });
  });
});

const report = (...tests: ReturnType<typeof test>[]) => ({
  suites: [{ specs: [{ tests }] }],
});

describe('deviceTargets', () => {
  const desktop = report(
    test('chromium', 'expected'),
    test('webkit', 'expected'),
    test('content', 'expected'),
  );
  const android = report(
    test('android-preflight', 'expected'),
    test('android-chrome', 'expected'),
    test('android-chrome', 'unexpected'),
    test('android-chrome-clock', 'expected'),
  );
  const ios = {
    numPassedTests: 80,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
  };

  it('makes one target per browser project, leaving out content', () => {
    const names = deviceTargets({ desktop, android: null, ios: null }).map(
      (t: { target: string }) => t.target,
    );
    expect(names).toEqual(['chromium', 'webkit']);
  });

  it('makes android one target without its set-up project, and counts the tests excluded by design as skipped', () => {
    const [target] = deviceTargets({
      desktop: null,
      android,
      ios: null,
      excludedByDesign: 400,
    });
    expect(target).toEqual({
      target: 'android',
      passed: 2,
      failed: 1,
      skipped: 400,
    });
  });

  it('makes ios one target from the vitest report', () => {
    expect(deviceTargets({ desktop: null, android: null, ios })).toEqual([
      { target: 'ios', passed: 80, failed: 0, skipped: 0 },
    ]);
  });

  it('leaves out a group that produced no report', () => {
    expect(deviceTargets({ desktop: null, android: null, ios: null })).toEqual(
      [],
    );
  });
});
