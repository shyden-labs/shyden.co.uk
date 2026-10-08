import { afterEach, describe, expect, it, vi } from 'vitest';
import { cpuBreach, startOwnCpu } from '../unit-cpu-limit';

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
