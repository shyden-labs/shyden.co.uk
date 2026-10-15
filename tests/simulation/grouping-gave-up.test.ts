import { describe, it, expect } from 'vitest';
import { buildGroups, ERROR_CODES } from '../../src/lib/grouping';
import { student, seeded } from '../unit/factories';

const M = (number: number) => student({ number, sex: 'M' });
const F = (number: number) => student({ number, sex: 'F' });

/**
 * The real-budget runs of the unit suite's gave-up tests (#714, #794).
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

/**
 * The real-budget runs of six more gave-up unit tests (#794), which reached
 * 102-119 ms of own CPU on a loaded laptop at the real budget. Each roster is
 * its unit test's, kept exactly; the two unit tests on the eight-boys roster
 * (its code, and its rendered sentence) share the one run below, since the
 * sentence is rendered from the code alone.
 */
describe('the search gives up under the real budget beside pins, both rules and separate sexes (#794)', () => {
  const buddyPairs = (apartPair: boolean) =>
    Array.from({ length: 30 }, (_, i) =>
      student({
        number: i + 1,
        together: String.fromCharCode(65 + Math.floor(i / 2)),
        apart: apartPair && (i === 0 || i === 16) ? 'X' : null,
      }),
    );

  const eightBoysFifteenGirlsFiveApart = () => [
    ...Array.from({ length: 8 }, (_, i) => M(i + 1)),
    ...Array.from({ length: 5 }, (_, i) =>
      student({ number: i + 9, sex: 'F' as const, apart: 'X' }),
    ),
    ...Array.from({ length: 10 }, (_, i) => F(i + 14)),
  ];

  it('fifteen buddy pairs and one apart-letter into 10 groups exhaust it with both rules live', () => {
    const out = buildGroups({
      students: buddyPairs(true),
      mode: { kind: 'groupCount', count: 10 },
      leftovers: 'spread',
      sexMode: 'off',
      pinned: [],
      random: seeded(1),
    });
    expect(out.ok ? 'placed' : out.error).toEqual({
      code: ERROR_CODES.bothRulesSearchGaveUp,
    });
  });

  it('eight boys and fifteen girls, five of them apart, into 6 separate groups exhaust it', () => {
    const out = buildGroups({
      students: eightBoysFifteenGirlsFiveApart(),
      mode: { kind: 'groupCount', count: 6 },
      leftovers: 'spread',
      sexMode: 'separate',
      pinned: [],
      random: seeded(1),
    });
    expect(out.ok ? 'placed' : out.error).toEqual({
      code: ERROR_CODES.sexSeparateSearchGaveUp,
    });
  });

  it('fifteen buddy pairs beside a pinned pair, into 11 groups, exhaust the together-block search', () => {
    const pinnedPair = [student({ number: 31 }), student({ number: 32 })];
    const out = buildGroups({
      students: [...buddyPairs(false), ...pinnedPair],
      mode: { kind: 'groupCount', count: 11 },
      leftovers: 'spread',
      sexMode: 'off',
      pinned: [pinnedPair],
      random: seeded(1),
    });
    expect(out.ok ? 'placed' : out.error).toEqual({
      code: ERROR_CODES.togetherSearchGaveUp,
    });
  });

  it('fifteen buddy pairs and one apart-letter beside a pinned pair, into 11 groups, exhaust it with both rules live', () => {
    const pinnedPair = [student({ number: 31 }), student({ number: 32 })];
    const out = buildGroups({
      students: [...buddyPairs(true), ...pinnedPair],
      mode: { kind: 'groupCount', count: 11 },
      leftovers: 'spread',
      sexMode: 'off',
      pinned: [pinnedPair],
      random: seeded(1),
    });
    expect(out.ok ? 'placed' : out.error).toEqual({
      code: ERROR_CODES.bothRulesSearchGaveUp,
    });
  });

  it('the eight-boys roster beside a pinned pair of boys, into 7 separate groups, exhausts it', () => {
    const pinnedPair = [M(24), M(25)];
    const out = buildGroups({
      students: [...eightBoysFifteenGirlsFiveApart(), ...pinnedPair],
      mode: { kind: 'groupCount', count: 7 },
      leftovers: 'spread',
      sexMode: 'separate',
      pinned: [pinnedPair],
      random: seeded(1),
    });
    expect(out.ok ? 'placed' : out.error).toEqual({
      code: ERROR_CODES.sexSeparateSearchGaveUp,
    });
  });
});
