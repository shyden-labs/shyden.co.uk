import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../scripts/waiting-reports.mjs';

/**
 * The entry point of scripts/waiting-reports.mjs, with its two jobs stood in: which
 * one an argument list runs, the usage it refuses, and the one line a
 * failure prints before the non-zero exit.
 */
describe('waiting-reports main(): one job per argument list', () => {
  afterEach(() => vi.restoreAllMocks());

  const jobs = () => ({
    count: vi.fn(async () => {}),
    reportFailure: vi.fn(async () => {}),
  });

  it('runs the count with no argument', async () => {
    const run = jobs();
    expect(await main([], run)).toBe(0);
    expect(run.count).toHaveBeenCalledOnce();
    expect(run.reportFailure).not.toHaveBeenCalled();
  });

  it('reports the failure when asked to', async () => {
    const run = jobs();
    expect(await main(['report-failure'], run)).toBe(0);
    expect(run.reportFailure).toHaveBeenCalledOnce();
    expect(run.count).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown mode', ['report']],
    ['a second argument', ['report-failure', 'extra']],
  ])('refuses %s with the usage, running nothing', async (_, argv) => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = jobs();
    expect(await main(argv, run)).toBe(2);
    expect(said).toHaveBeenCalledWith(
      'usage: node scripts/waiting-reports.mjs [report-failure]',
    );
    expect(run.count).not.toHaveBeenCalled();
    expect(run.reportFailure).not.toHaveBeenCalled();
  });

  it("prints a failed job's message and exits 1", async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = jobs();
    run.count.mockRejectedValueOnce(new Error('the list did not arrive'));
    expect(await main([], run)).toBe(1);
    expect(said).toHaveBeenCalledWith('✗ the list did not arrive');
  });
});
