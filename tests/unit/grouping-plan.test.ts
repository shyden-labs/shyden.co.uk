import { describe, expect, it } from 'vitest';
import {
  buildGroups,
  plannedGroups,
  type GroupingInput,
  type Student,
} from '../../src/lib/grouping';
import { seeded, student } from './factories';

/**
 * How many groups the deal will make, known before it runs (#743): the
 * board shows one empty card per group while it waits for the first
 * shuffle, so the count must be the deal's own. Each case pins the planned
 * count to a literal AND checks the deal makes exactly that many, so the
 * two can never be computed two ways.
 */
type Plan = Omit<GroupingInput, 'random' | 'searchNodeCap'>;

const plan = (over: Partial<Plan> = {}): Plan => ({
  students: 22,
  mode: { kind: 'perGroup', size: 4 },
  leftovers: 'spread',
  sexMode: 'off',
  pinned: [],
  ...over,
});

/** Numbers 1..n, each shaped by `over`. */
const roster = (
  n: number,
  over: (number: number) => Partial<Student> = () => ({}),
): Student[] =>
  Array.from({ length: n }, (_, i) =>
    student({ number: i + 1, ...over(i + 1) }),
  );

/** A roster of `boys` boys then `girls` girls. */
const bySex = (boys: number, girls: number): Student[] =>
  roster(boys + girls, (n) => ({ sex: n <= boys ? 'M' : 'F' }));

const pinnedOf = (students: Student[], ...groups: number[][]): Student[][] =>
  groups.map((numbers) =>
    numbers.map((n) => students.find((s) => s.number === n) as Student),
  );

const ten = roster(10);

describe('plannedGroups: the deal’s groups, before it runs (#743)', () => {
  it.each<[string, Plan, number | null]>([
    ['22 by fours, leftovers spread', plan(), 5],
    ['22 by fours, leftovers bunched', plan({ leftovers: 'bunch' }), 5],
    ['3 by fours: one group, never none', plan({ students: 3 }), 1],
    ['22 into 6 groups', plan({ mode: { kind: 'groupCount', count: 6 } }), 6],
    [
      '10 with 2 absent, by fours: the absent are not dealt',
      plan({ students: roster(10, (n) => ({ absent: n > 8 })) }),
      2,
    ],
    [
      '10 by threes with one group of 3 pinned',
      plan({
        students: ten,
        mode: { kind: 'perGroup', size: 3 },
        pinned: pinnedOf(ten, [1, 2, 3]),
      }),
      3,
    ],
    [
      'every present student pinned: the pinned groups alone',
      plan({
        students: ten,
        pinned: pinnedOf(ten, [1, 2, 3, 4, 5], [6, 7, 8, 9, 10]),
      }),
      2,
    ],
    [
      '10 into 4 groups with one pinned',
      plan({
        students: ten,
        mode: { kind: 'groupCount', count: 4 },
        pinned: pinnedOf(ten, [1, 2]),
      }),
      4,
    ],
    [
      'more groups pinned than asked for: the deal refuses',
      plan({
        students: ten,
        mode: { kind: 'groupCount', count: 2 },
        pinned: pinnedOf(ten, [1, 2], [3, 4]),
      }),
      null,
    ],
    [
      'single-sex groups by threes, 7 boys and 5 girls',
      plan({
        students: bySex(7, 5),
        mode: { kind: 'perGroup', size: 3 },
        sexMode: 'separate',
      }),
      3,
    ],
    [
      'single-sex groups by fours, 9 boys and 2 girls: the girls join the boys’ groups',
      plan({
        students: bySex(9, 2),
        sexMode: 'separate',
      }),
      2,
    ],
    [
      'single-sex groups by fives, 3 boys and 4 girls: too few of either for a group',
      plan({
        students: bySex(3, 4),
        mode: { kind: 'perGroup', size: 5 },
        sexMode: 'separate',
      }),
      1,
    ],
    [
      'single-sex groups into 4 groups, 7 boys and 5 girls',
      plan({
        students: bySex(7, 5),
        mode: { kind: 'groupCount', count: 4 },
        sexMode: 'separate',
      }),
      4,
    ],
    [
      'single-sex groups with a student whose sex is not set: the deal refuses',
      plan({
        students: roster(6, (n) => ({ sex: n === 6 ? null : 'M' })),
        sexMode: 'separate',
      }),
      null,
    ],
    [
      'everyone absent: the deal refuses',
      plan({ students: roster(4, () => ({ absent: true })) }),
      null,
    ],
  ])('%s', (_, input, expected) => {
    expect(plannedGroups(input)?.length ?? null).toBe(expected);
    const dealt = buildGroups({ ...input, random: seeded(7) });
    expect(dealt.ok ? dealt.result.groups.length : null).toBe(expected);
  });
});

describe('plannedGroups: what the waiting board shows (#743)', () => {
  it('puts each pinned group’s members in its card, ahead of the empty ones', () => {
    const planned = plannedGroups(
      plan({
        students: ten,
        mode: { kind: 'perGroup', size: 3 },
        pinned: pinnedOf(ten, [1, 2, 3]),
      }),
    );
    expect(planned?.map((g) => g.map((s) => s.number))).toEqual([
      [1, 2, 3],
      [],
      [],
    ]);
  });
});
