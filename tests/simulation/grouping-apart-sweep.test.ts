import { describe, it, expect } from 'vitest';
import { apartSweep } from '../apart-sweep';

/**
 * The full apart-letters sweep (#650): the real case the unit stand-in in
 * `tests/unit/grouping.test.ts` ('apart letters -- a stand-in of the sweep')
 * cannot afford. Every class size, eight seeds for each of three modes.
 *
 * Measured per size (attempts, successes): 4: 16, 16; 6, 9, 12, 16 and 20:
 * 24, 24 each; 25: 24, 21; 30: 24, 22. Together 184 attempts and 179
 * successes. The sweep is seeded, so each size's whole result is pinned in one
 * verdict: the attempts and successes beside the empty breach list are the
 * population that list was read over, so no size can pass on an empty run.
 */
describe('apart letters — the guarantee holds broadly, not just on hand-picked rosters (debt a)', () => {
  const apartSweepSizes: [n: number, attempts: number, successes: number][] = [
    [4, 16, 16],
    [6, 24, 24],
    [9, 24, 24],
    [12, 24, 24],
    [16, 24, 24],
    [20, 24, 24],
    [25, 24, 21],
    [30, 24, 22],
  ];
  it.each(apartSweepSizes)(
    'holds across group-count and per-group modes and eight seeds for a class of %i',
    (n, attempts, successes) => {
      expect(apartSweep(n, 8)).toEqual({ attempts, successes, breaches: [] });
    },
  );
});
