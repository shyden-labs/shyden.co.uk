import { afterEach, describe, expect, it, vi } from 'vitest';
import { cpuBreach, cpuReport, startOwnCpu } from '../unit-cpu-limit';

/**
 * The unit suite fails a test whose own CPU passes 1 s (#632). The figures are
 * literals: a limit asserted against the constant it was computed from pins
 * nothing. The wiring (a real test that burns CPU goes RED) is planted by hand
 * and recorded in the pull request, since a permanent failing test cannot live
 * in the suite.
 */
describe('the CPU limit of one unit test', () => {
  it('passes a test that used 999 999 microseconds', () => {
    expect(cpuBreach(999_999, 'a test')).toBeUndefined();
  });

  it('passes a test that used exactly 1 000 000 microseconds', () => {
    expect(cpuBreach(1_000_000, 'a test')).toBeUndefined();
  });

  it('fails a test that used 1 000 001 microseconds, naming the test and the figure', () => {
    const breach = cpuBreach(1_000_001, 'a slow test');
    expect(breach).toContain('"a slow test"');
    expect(breach).toContain('1000 ms');
  });

  it('names the figure in milliseconds, rounded', () => {
    expect(cpuBreach(2_345_678, 'a test')).toContain('2346 ms');
  });
});

/**
 * Whose CPU is counted. `process.cpuUsage()` sums every thread in the worker,
 * and V8 collects garbage on helper threads: measured on the operator's Mac, a
 * test that allocated for 500 ms of its own thread (552 ms wall) read 1 489 ms
 * process-wide and failed. The test's own figure is its thread's.
 */
describe('the CPU a unit test is charged with', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is its own thread's, user plus system, since the clock started", () => {
    const start = { user: 7, system: 3 };
    const thread = vi
      .spyOn(process, 'threadCpuUsage')
      .mockReturnValueOnce(start)
      .mockReturnValueOnce({ user: 400_000, system: 100_000 });
    vi.spyOn(process, 'cpuUsage').mockReturnValue({
      user: 9_000_000,
      system: 0,
    });
    const stop = startOwnCpu();
    expect(stop()).toBe(500_000);
    expect(thread).toHaveBeenLastCalledWith(start);
  });

  it('never reads the whole process', () => {
    vi.spyOn(process, 'threadCpuUsage').mockReturnValue({ user: 0, system: 0 });
    const whole = vi.spyOn(process, 'cpuUsage');
    startOwnCpu()();
    expect(whole).not.toHaveBeenCalled();
  });
});

describe('the report of every unit test own CPU (#645)', () => {
  const row = (name: string, microseconds: number) => ({
    name,
    file: 'tests/unit/a.test.ts',
    microseconds,
  });

  it('lists the heaviest first, as many as asked for, each named with its file and figure', () => {
    expect(
      cpuReport(
        [row('light', 1_000), row('heavy', 193_400), row('middle', 50_000)],
        0,
        2,
      ).slice(1),
    ).toEqual([
      '     193 ms  tests/unit/a.test.ts > heavy',
      '      50 ms  tests/unit/a.test.ts > middle',
    ]);
  });

  it('counts the tests over 300 ms and over 200 ms, and exactly 300 ms is not over', () => {
    expect(
      cpuReport(
        [
          row('a', 300_001),
          row('b', 300_000),
          row('c', 200_001),
          row('d', 200_000),
        ],
        0,
        0,
      ),
    ).toEqual([
      'Own CPU of each unit test (#645): 4 measured, 0 unmeasured; over 300 ms: 1; over 200 ms: 3; the heaviest 0:',
    ]);
  });

  it('says how many tests that ran carried no figure, so a report missing its tests is seen', () => {
    expect(cpuReport([row('a', 10)], 7, 0)[0]).toContain(
      '1 measured, 7 unmeasured',
    );
  });
});
