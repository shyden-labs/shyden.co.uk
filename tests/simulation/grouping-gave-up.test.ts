import { describe, it, expect } from 'vitest';
import { buildGroups, ERROR_CODES } from '../../src/lib/grouping';
import { student, seeded } from '../unit/factories';

/**
 * The real-budget runs of the unit suite's three heaviest gave-up tests (#714).
 * In `tests/unit/grouping.test.ts` each passes `GAVE_UP_TEST_NODE_CAP` and
 * proves the logic: the search reports "gave up", never "impossible", once
 * its budget is spent. Here the same rosters meet the real budget, 200,000
 * nodes per pass, which cost 124-145 ms of own CPU on the runner: proof that
 * the real budget is still defeated by these shapes, so the code the page
 * shows a teacher is still the one these rosters produce.
 */
describe('the search gives up under the real budget, and says so (#714)', () => {
  it('six uneven apart-letter cliques of 100 students into 20 groups exhaust both passes', () => {
    const students = [20, 19, 18, 17, 16, 10].flatMap((size, ci) =>
      Array.from({ length: size }, (_, j) =>
        student({ number: ci * 100 + j + 1, apart: `C${ci}` }),
      ),
    );
    const out = buildGroups({
      students,
      mode: { kind: 'groupCount', count: 20 },
      leftovers: 'spread',
      sexMode: 'off',
      pinned: [],
      random: seeded(1),
    });
    expect(out.ok ? 'placed' : out.error).toEqual({
      code: ERROR_CODES.keepApartSearchGaveUp,
    });
  });

  it('the same shape beside a pinned pair, 100 students into 21 groups, exhausts it too', () => {
    const students = [20, 19, 18, 17, 16, 8].flatMap((size, ci) =>
      Array.from({ length: size }, (_, j) =>
        student({ number: ci * 100 + j + 1, apart: `C${ci}` }),
      ),
    );
    const pinnedPair = [student({ number: 701 }), student({ number: 702 })];
    const out = buildGroups({
      students: [...students, ...pinnedPair],
      mode: { kind: 'groupCount', count: 21 },
      leftovers: 'spread',
      sexMode: 'off',
      pinned: [pinnedPair],
      random: seeded(1),
    });
    expect(out.ok ? 'placed' : out.error).toEqual({
      code: ERROR_CODES.keepApartSearchGaveUp,
    });
  });

  it('fifteen buddy pairs into 10 groups exhaust the together-block search', () => {
    // The unit stand-in reached 68 ms of own CPU at the real budget, 2 ms
    // from the cut line, over 8 CI runs (#714).
    const pairs = Array.from({ length: 30 }, (_, i) =>
      student({
        number: i + 1,
        together: String.fromCharCode(65 + Math.floor(i / 2)),
      }),
    );
    const out = buildGroups({
      students: pairs,
      mode: { kind: 'groupCount', count: 10 },
      leftovers: 'spread',
      sexMode: 'off',
      pinned: [],
      random: seeded(1),
    });
    expect(out.ok ? 'placed' : out.error).toEqual({
      code: ERROR_CODES.togetherSearchGaveUp,
    });
  });
});
