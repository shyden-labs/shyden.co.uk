import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../scripts/access-expiry.mjs';

/**
 * The entry point of scripts/access-expiry.mjs, with its two jobs stood in: which
 * one an argument list runs, the usage it refuses, and the one line a
 * failure prints before the non-zero exit.
 */
describe('access-expiry main(): one job per argument list', () => {
  afterEach(() => vi.restoreAllMocks());

  const jobs = () => ({
    check: vi.fn(async () => {}),
    reportFailure: vi.fn(async () => {}),
  });

  it('runs the check with no argument', async () => {
    const run = jobs();
    expect(await main([], run)).toBe(0);
    expect(run.check).toHaveBeenCalledOnce();
    expect(run.reportFailure).not.toHaveBeenCalled();
  });

  it('reports the failure when asked to', async () => {
    const run = jobs();
    expect(await main(['report-failure'], run)).toBe(0);
    expect(run.reportFailure).toHaveBeenCalledOnce();
    expect(run.check).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown mode', ['report']],
    ['a second argument', ['report-failure', 'extra']],
  ])('refuses %s with the usage, running nothing', async (_, argv) => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = jobs();
    expect(await main(argv, run)).toBe(2);
    expect(said).toHaveBeenCalledWith(
      'usage: node scripts/access-expiry.mjs [report-failure]',
    );
    expect(run.check).not.toHaveBeenCalled();
    expect(run.reportFailure).not.toHaveBeenCalled();
  });

  it("prints a failed job's message and exits 1", async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = jobs();
    run.check.mockRejectedValueOnce(new Error('the list did not arrive'));
    expect(await main([], run)).toBe(1);
    expect(said).toHaveBeenCalledWith('✗ the list did not arrive');
  });
});
