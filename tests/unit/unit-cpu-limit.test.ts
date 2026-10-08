import { describe, expect, it } from 'vitest';
import { cpuBreach } from '../unit-cpu-limit';

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
