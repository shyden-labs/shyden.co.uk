import { describe, it, expect } from 'vitest';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import {
  anonymousStudent,
  buildGroups,
  ERROR_CODES,
  WARNING_CODES,
  MAX_STUDENTS,
  type GroupingInput,
  type Mode,
  type Student,
} from '../../src/lib/grouping';
import * as grouping from '../../src/lib/grouping';
import { student, shape, groupOf, seeded } from './factories';
// Fix round 1, F-2: closing the reviewer's named gap -- nothing in this
// file, before this fix, ever piped a `separate`-mode failure through
// `renderError`, so a structurally-correct error code with a wrong-number
// or badly-worded sentence would have passed every test in this file.
// `renderWarning` (whole-branch review, I-5): the same gap existed for
// WARNINGS -- the pinned describe block and the sex-both-too-small fixture
// below never rendered one at all before this fix, which is exactly why
// I-2's contradiction survived per-task review.
import { renderError, renderWarning, getStrings } from '../../src/lib/i18n';

// The catalogues as a page receives them: every message compiled into a
// function of its named slots (#136). A raw catalogue holds templates.
const en = getStrings('en');
const id = getStrings('id');

const base = (over: Partial<GroupingInput> = {}): GroupingInput => ({
  students: 22,
  mode: { kind: 'perGroup', size: 4 },
  leftovers: 'spread',
  sexMode: 'off',
  pinned: [],
  random: seeded(1),
  ...over,
});

const ok = (input: GroupingInput) => {
  const out = buildGroups(input);
  if (!out.ok) throw new Error(`expected success, got ${out.error.code}`);
  return out.result;
};

// Task 11, the final sweep. The brief this describe block was drafted from
// listed 4 runtime exports and 14 error codes -- both counts are stale: the
// tasks that actually ran added codes and an export the plan never named.
// The three checklists below are built from what `grouping.ts` really
// exports today, not copied from the brief, and are re-derivable by anyone:
// `grep -n "^export " src/lib/grouping.ts` for the surface, `grep -c
// "^  [a-zA-Z]*:" src/lib/grouping.ts` inside `ERROR_CODES`/`WARNING_CODES`
// for the codes.
describe('the module surface', () => {
  it('exports nothing that nothing uses', () => {
    // FAILS when a runtime export is added to or removed from grouping.ts
    // without this list changing -- type-only exports (Student, Mode,
    // Leftovers, SexMode, GroupingInput, ErrorCode, GroupingError,
    // GroupingWarning, GroupingOutcome) are erased at build time and never
    // appear in `Object.keys`, so they are correctly absent here by
    // construction, not by omission.
    //
    // A new entry belongs in this array ONLY if something outside
    // grouping.ts actually reaches it -- a page script, or (like
    // `weaveBySex` below) a test that cannot otherwise prove a guarantee
    // through the public `buildGroups` surface. Add the export AND a
    // one-line reason next to it, the way `weaveBySex` has one, so the next
    // person does not have to re-derive why it is public.
    //
    // If this fails because an export appears here that NOTHING in src/ or
    // tests/ actually calls: that is dead code. Delete the export from
    // grouping.ts, not the entry here -- do not just widen the list to make
    // the test pass.
    expect(Object.keys(grouping).sort()).toEqual(
      [
        'ERROR_CODES',
        'MAX_STUDENTS',
        'WARNING_CODES',
        // The blank record, reached by `roster-ui.ts` (a teacher adding a
        // row), `numberSets.ts` (the number-set builder) and the test
        // factory. It was a private `anonymous` here and an exported
        // `anonymousStudent` in roster-ui.ts, character-identical, until
        // #277 — a second definition of what an empty field means.
        'anonymousStudent',
        'buildGroups',
        // Exported ONLY so 'weaveBySex never drops a block, whatever `sex`
        // holds' below can call it directly. `buildGroups`'s own public
        // surface cannot exercise this guarantee with bad data: the
        // unset-sex guard (ERROR_CODES.sexNeedsAllSet) refuses every
        // off-domain `sex` value before `mix` ever reaches this function,
        // so there is no roster shape that reaches it through `buildGroups`
        // alone. See weaveBySex's own doc comment in grouping.ts. A
        // deliberate test-only export, not an accident -- if a future
        // change makes `buildGroups` able to exercise it directly, remove
        // the export and this entry together.
        'weaveBySex',
      ].sort(),
    );
  });

  it('has a test that reaches every error code', () => {
    // A code with no test is a message a teacher could see that nobody has
    // ever read. Kept as a checklist that fails when a code is added --
    // or removed -- without this list changing.
    //
    // grep is NOT proof that a code is covered: a code named in an
    // expected-value table or an i18n sample is not the same as a code
    // `buildGroups` has actually been made to RETURN. When this fails on a
    // genuinely new code: write a test that drives `buildGroups` to
    // PRODUCE it (see 'apart letters -- three cliques whose sizes and
    // capacities collide' below for the shape of test that does this for a
    // code with no small hand-picked fixture), THEN add the code here. When
    // it fails because a code was deleted: remove it from here and grep the
    // whole file for its old name -- a leftover test still asserting on a
    // retired code would silently stop testing anything real.
    expect(Object.values(ERROR_CODES).sort()).toEqual(
      [
        'NO_STUDENTS',
        'TOO_MANY_STUDENTS',
        'DUPLICATE_NUMBER',
        'INVALID_GROUP_SIZE',
        'INVALID_GROUP_COUNT',
        'TOO_MANY_GROUPS',
        'TOGETHER_APART_CLASH',
        'TOGETHER_UNIT_TOO_LARGE',
        'TOGETHER_NO_ARRANGEMENT',
        'TOGETHER_SEARCH_GAVE_UP',
        'KEEP_APART_IMPOSSIBLE',
        'KEEP_APART_NO_ARRANGEMENT',
        'KEEP_APART_SEARCH_GAVE_UP',
        'BOTH_RULES_NO_ARRANGEMENT',
        'BOTH_RULES_SEARCH_GAVE_UP',
        'SEX_NEEDS_ALL_SET',
        'SEX_SEPARATE_SPLITS_UNIT',
        'SEX_SEPARATE_IMPOSSIBLE',
        'SEX_SEPARATE_SEARCH_GAVE_UP',
        'PINNED_SPLITS_UNIT',
        'PINNED_APART_CLASH',
        'PINNED_IN_TWO_GROUPS',
        'PINNED_TOO_MANY_GROUPS',
      ].sort(),
    );
  });

  it('has a test that reaches every warning code', () => {
    // Same rule, same failure-mode guidance as the error-code checklist
    // immediately above -- applied to WARNING_CODES, which the brief this
    // block was drafted from did not check at all. When this fails: write a
    // test proving `buildGroups` actually returns the new code inside
    // `result.warnings` on a SUCCESSFUL outcome (warnings only ever
    // accompany `ok: true` -- see GroupingOutcome), then add it here.
    expect(Object.values(WARNING_CODES).sort()).toEqual(
      ['SEX_SPILLOVER', 'PINNED_MIXED_SEX', 'SEX_BOTH_TOO_SMALL'].sort(),
    );
  });
});

describe('buildGroups — the worked examples from the design spec', () => {
  it.each([
    // students, mode,                          leftovers, expected shape
    [
      22,
      { kind: 'perGroup', size: 4 } as const,
      'spread' as const,
      [5, 5, 4, 4, 4],
    ],
    [
      22,
      { kind: 'perGroup', size: 4 } as const,
      'bunch' as const,
      [6, 4, 4, 4, 4],
    ],
    [
      22,
      { kind: 'groupCount', count: 5 } as const,
      'spread' as const,
      [5, 5, 4, 4, 4],
    ],
  ])('%i students, %o, %s leftovers', (students, mode, leftovers, expected) => {
    expect(shape(ok(base({ students, mode, leftovers })).groups)).toEqual(
      expected,
    );
  });

  it('7 students in groups of 4 makes ONE group of 7, not a group of 3', () => {
    // The rule the operator stated: never fewer than the specified size.
    // Splitting into 4+3 would break it, so the correct answer is a single
    // group that is too big rather than two where one is too small.
    expect(shape(ok(base({ students: 7 })).groups)).toEqual([7]);
  });

  it('fewer students than one full group still produces one group', () => {
    expect(shape(ok(base({ students: 3 })).groups)).toEqual([3]);
  });
});

describe('buildGroups — invariants that must hold for ANY input', () => {
  const sizes = [1, 2, 3, 5, 7, 12, 13, 22, 29, 30, 40];
  const perGroup = [2, 3, 4, 5, 6];

  it.each(sizes.flatMap((s) => perGroup.map((g) => [s, g] as const)))(
    '%i students / %i per group: nobody lost, nobody invented, no group below the minimum',
    (students, size) => {
      for (const leftovers of ['spread', 'bunch'] as const) {
        const { groups } = ok(
          base({
            students,
            mode: { kind: 'perGroup', size },
            leftovers,
            random: seeded(students * 31 + size),
          }),
        );

        const numbers = groups.flat().map((s) => s.number);
        expect(new Set(numbers).size).toBe(students); // nobody duplicated
        expect(numbers).toHaveLength(students); // nobody lost or invented

        // The minimum applies unless there simply are not enough students for
        // even one full group, in which case a single short group is correct.
        if (students >= size) {
          for (const g of groups) expect(g.length).toBeGreaterThanOrEqual(size);
        } else {
          expect(groups).toHaveLength(1);
        }
      }
    },
  );

  it('spreading leftovers never leaves two groups differing by more than one', () => {
    for (let students = 5; students <= 40; students++) {
      const { groups } = ok(
        base({
          students,
          mode: { kind: 'perGroup', size: 4 },
          leftovers: 'spread',
          random: seeded(students),
        }),
      );
      const s = shape(groups);
      // Only meaningful when more than one group exists.
      if (s.length > 1) expect(s[0] - s[s.length - 1]).toBeLessThanOrEqual(1);
    }
  });

  it('bunching puts every leftover in ONE group, so exactly one group is oversized', () => {
    const { groups } = ok(
      base({
        students: 23,
        mode: { kind: 'perGroup', size: 4 },
        leftovers: 'bunch',
      }),
    );
    const s = shape(groups); // 23 = 5 groups of 4, 3 spare -> 7,4,4,4,4
    expect(s).toEqual([7, 4, 4, 4, 4]);
    expect(s.filter((n) => n > 4)).toHaveLength(1);
  });

  // Fix round 1, F-5. Every invariant above calls `base()`, whose default
  // `pinned: []` never exercises the pinned path at all -- so the
  // strongest property in this file was never actually checked against a
  // pin, even though a pin is exactly where a student is easiest to lose
  // or duplicate (each pinned group is matched against the current roster
  // independently -- see buildGroups's own comments on `presentByNumber`
  // and `pinnedInTwoGroups`). This is also the `groupCount` shape F-1
  // needed and never had: one pinned group of `pinSize`, requesting
  // `count` groups in total, leaves `count - 1` groups for the
  // `students - pinSize` students left in the pool -- valid only when that
  // is between 1 and however many are actually left, exactly the
  // inequality `buildGroups` itself now checks (Fix round 1, F-1/F-2).
  // `expectValid` is computed independently here, from that same rule
  // stated in the spec, not by calling the engine and trusting its answer.
  //
  // Proven to catch F-1, not just assumed to: reverting the guard that
  // closes it reddens this test on its very first invalid row (`[10, 4,
  // 8]`, F-1's own numbers) -- see the Fix round 1 report for the mutant.
  describe('invariants hold with a pinned group too, under groupCount mode (F-5)', () => {
    const shapes: Array<[number, number, number]> = [
      [10, 4, 8], // F-1's own numbers: poolGroupsNeeded 3 > pool 2 -- invalid
      [9, 8, 3], // reviewer's 3rd reachable shape -- invalid
      [12, 6, 10], // poolGroupsNeeded 5 > pool 2 -- invalid
      [9, 1, 5], // pins alone already claim the only group requested -- invalid
      [10, 4, 7], // poolGroupsNeeded 3 == pool 3, exact fit -- valid
      [10, 4, 4], // poolGroupsNeeded 3 < pool 6 -- valid
      [12, 6, 5], // poolGroupsNeeded 5 < pool 7 -- valid
      [9, 3, 3], // poolGroupsNeeded 2 < pool 6 -- valid
      [30, 7, 20], // poolGroupsNeeded 6 < pool 10 -- valid
      [15, 3, 1], // poolGroupsNeeded 2 < pool 14 -- valid
      [40, 10, 25], // poolGroupsNeeded 9 < pool 15 -- valid
      [6, 3, 3], // poolGroupsNeeded 2 < pool 3 -- valid
    ];

    it.each(shapes)(
      '%i students / groupCount %i / one pinned group of %i',
      (students, count, pinSize) => {
        const pinRoster = Array.from({ length: students }, (_, i) =>
          student({ number: i + 1 }),
        );
        const poolGroupsNeeded = count - 1;
        const remaining = students - pinSize;
        const expectValid =
          poolGroupsNeeded >= 1 && poolGroupsNeeded <= remaining;

        const out = buildGroups(
          base({
            students: pinRoster,
            mode: { kind: 'groupCount', count },
            pinned: [pinRoster.slice(0, pinSize)],
            random: seeded(students * 31 + count),
          }),
        );

        expect(out.ok).toBe(expectValid);
        if (!out.ok) return;
        const numbers = out.result.groups.flat().map((s) => s.number);
        expect(new Set(numbers).size).toBe(students); // nobody duplicated
        expect(numbers).toHaveLength(students); // nobody lost or invented
        // The F-1 regression itself: a phantom empty group. Neither
        // "nobody lost" nor "nobody invented" above would notice one -- the
        // roster total is unaffected by an empty SLOT -- so this is the
        // assertion that actually catches it.
        expect(out.result.groups.every((g) => g.length > 0)).toBe(true);
      },
    );
  });
});

describe('buildGroups — students with and without names', () => {
  it('a bare count produces numbered students with no name', () => {
    const { groups } = ok(
      base({ students: 5, mode: { kind: 'perGroup', size: 2 } }),
    );
    const all = groups.flat();
    expect(all.map((s) => s.name)).toEqual([null, null, null, null, null]);
    // Numbered 1..n so the UI can render "Student 7" — the DEFAULT mode, not
    // a fallback, so it is asserted rather than assumed.
    expect(all.map((s) => s.number).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('a bare count produces a fully-defaulted record, field for field', () => {
    // A LITERAL, not a comparison against `student()` in factories.ts.
    //
    // This assertion used to compare the two, because they were independent
    // definitions of "a student with nothing set" and a whole-object
    // comparison catches a field one side gains and the other misses (Fix
    // round 1, F-2). #277 gave the blank record one home —
    // `anonymousStudent` below — which both now build on, and a value
    // compared against the thing it is computed from is green at any value
    // (#117). The independence that made the old form work is gone, so the
    // pin has to come from outside the code: these six fields, spelled out,
    // are what a record with no teacher behind it means.
    const { groups } = ok(
      base({ students: 1, mode: { kind: 'perGroup', size: 1 } }),
    );
    expect(groups.flat()[0]).toEqual({
      number: 1,
      name: null,
      sex: null,
      absent: false,
      together: null,
      apart: null,
    });
  });

  it('builds that record through the one home every other caller uses', () => {
    // The seam the literal above protects: `roster-ui.ts`, `numberSets.ts`
    // and the test factory all reach this constructor, so a seventh field
    // added to `Student` is defaulted once and the typechecker names the one
    // place that has to decide what it defaults to.
    const { groups } = ok(
      base({ students: 1, mode: { kind: 'perGroup', size: 1 } }),
    );
    expect(groups.flat()[0]).toEqual(anonymousStudent(1));
  });

  it('keeps every student, including two who share a name, because identity is the number', () => {
    // Was 'a name list keeps every name, including genuine duplicates',
    // written against `students: string[]`. That input mode is gone --
    // records are taken as given rather than parsed from a name list -- so
    // the duplicate is now expressed the only way that still exists: two
    // records, two different numbers, one shared name. Silently merging them
    // would be a worse failure than it ever was, because it would now also
    // have to throw away one of two distinct identities, not just a string.
    const out = buildGroups(
      base({
        students: [
          student({ number: 1, name: 'Ana' }),
          student({ number: 2, name: 'Budi' }),
          student({ number: 3, name: 'Ana' }),
          student({ number: 4, name: 'Citra' }),
        ],
        mode: { kind: 'perGroup', size: 2 },
      }),
    );
    if (!out.ok) throw new Error(`expected success, got ${out.error.code}`);
    const { groups } = out.result;
    expect(
      groups
        .flat()
        .map((s) => s.name)
        .sort(),
    ).toEqual(['Ana', 'Ana', 'Budi', 'Citra']);
    // Both Anas kept their own number rather than one being dropped or the
    // two being collapsed into one.
    expect(groupOf(groups, 1)?.find((s) => s.number === 1)?.name).toBe('Ana');
    expect(groupOf(groups, 3)?.find((s) => s.number === 3)?.name).toBe('Ana');
  });
});

describe('students are records identified by a number', () => {
  it("keeps the teacher's numbers rather than renumbering from 1", () => {
    const out = buildGroups(
      base({
        students: [
          student({ number: 4, name: 'Dewi' }),
          student({ number: 9, name: 'Gita' }),
        ],
        mode: { kind: 'groupCount', count: 1 },
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(
      out.result.groups[0].map((s) => s.number).sort((a, b) => a - b),
    ).toEqual([4, 9]);
  });

  it('accepts gaps in the numbers', () => {
    const out = buildGroups(
      base({
        students: [1, 2, 3, 5, 8].map((n) => student({ number: n })),
        mode: { kind: 'groupCount', count: 1 },
      }),
    );
    expect(out.ok).toBe(true);
  });

  it('refuses two students sharing a number, naming it', () => {
    const out = buildGroups(
      base({
        students: [
          student({ number: 5, name: 'Eko' }),
          student({ number: 5, name: 'Ana' }),
        ],
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({ code: ERROR_CODES.duplicateNumber, number: 5 });
  });

  it('still takes a bare count, and numbers those 1..N', () => {
    const out = buildGroups(
      base({ students: 3, mode: { kind: 'groupCount', count: 1 } }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // A bare .sort() sorts lexicographically -- correct here only by luck,
    // because every number involved is a single digit. Fix round 1, F-5.
    expect(
      out.result.groups[0].map((s) => s.number).sort((a, b) => a - b),
    ).toEqual([1, 2, 3]);
    expect(out.result.groups[0].every((s) => s.name === null)).toBe(true);
  });

  it('counts a record list before building it, so 501 records is refused', () => {
    const many = Array.from({ length: MAX_STUDENTS + 1 }, (_, i) =>
      student({ number: i + 1 }),
    );
    const out = buildGroups(base({ students: many }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({
      code: ERROR_CODES.tooManyStudents,
      maxStudents: MAX_STUDENTS,
    });
  });
});

describe('absence', () => {
  const roster = [
    student({ number: 1, name: 'Ana' }),
    student({ number: 2, name: 'Budi' }),
    student({ number: 3, name: 'Citra', absent: true }),
    student({ number: 4, name: 'Dewi' }),
  ];

  it('leaves an absent student out of the results entirely', () => {
    const out = buildGroups(
      base({ students: roster, mode: { kind: 'groupCount', count: 2 } }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const numbers = out.result.groups.flat().map((s) => s.number);
    expect(numbers).not.toContain(3);
    expect(numbers.sort((a, b) => a - b)).toEqual([1, 2, 4]);
  });

  it('sizes the groups from those present, not from the roster', () => {
    // 4 on the roster, 3 present, groups of 3 -> one group of 3, not of 4.
    const out = buildGroups(
      base({ students: roster, mode: { kind: 'perGroup', size: 3 } }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(shape(out.result.groups)).toEqual([3]);
  });

  it('refuses when everybody is absent, as if there were no students', () => {
    const out = buildGroups(
      base({
        students: roster.map((s) => ({ ...s, absent: true })),
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({ code: ERROR_CODES.noStudents });
  });

  it('counts absent students against MAX_STUDENTS, because the roster is built first', () => {
    // The cap exists to stop a mis-keyed number allocating until the tab dies.
    // That allocation happens before anyone is filtered, so the guard must too.
    const many = Array.from({ length: MAX_STUDENTS + 1 }, (_, i) =>
      student({ number: i + 1, absent: true }),
    );
    const out = buildGroups(base({ students: many }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe(ERROR_CODES.tooManyStudents);
  });

  it('refuses too many groups using the number PRESENT, not the roster size', () => {
    // 4 on the roster, 3 present. Asking for 4 groups from 3 must be refused,
    // and the count offered back must be 3 -- present.length, not the 4 on
    // the roster. A silent revert to students.length here would read
    // `4 > 4` as false, let the guard pass, and hand the teacher a group of
    // size 0. Fix round 1, F-1.
    const out = buildGroups(
      base({ students: roster, mode: { kind: 'groupCount', count: 4 } }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({
      code: ERROR_CODES.tooManyGroups,
      maxGroups: 3,
    });
  });

  it('still refuses a duplicate number when the duplicate is the absent row', () => {
    // The duplicate-number loop runs over the whole roster, before absence is
    // applied, precisely so a duplicate in a row marked absent today is still
    // caught -- the teacher unticks that row tomorrow (see the comment above
    // `present` in grouping.ts). Fix round 1, F-2.
    const out = buildGroups(
      base({
        students: [
          student({ number: 7, name: 'Eko' }),
          student({ number: 7, name: 'Fitri', absent: true }),
        ],
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({
      code: ERROR_CODES.duplicateNumber,
      number: 7,
    });
  });
});

describe('buildGroups — refusals', () => {
  it.each([
    ['no students at all', base({ students: 0 }), ERROR_CODES.noStudents],
    ['an empty student list', base({ students: [] }), ERROR_CODES.noStudents],
    [
      'a group size below 1',
      base({ mode: { kind: 'perGroup', size: 0 } }),
      ERROR_CODES.invalidGroupSize,
    ],
    [
      'a group count below 1',
      base({ mode: { kind: 'groupCount', count: 0 } }),
      ERROR_CODES.invalidGroupCount,
    ],
    [
      'more groups than students',
      base({ students: 4, mode: { kind: 'groupCount', count: 9 } }),
      ERROR_CODES.tooManyGroups,
    ],
  ])('refuses %s', (_label, input, code) => {
    const out = buildGroups(input);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe(code);
  });

  it('says how many groups were actually possible when too many were asked for', () => {
    const out = buildGroups(
      base({ students: 4, mode: { kind: 'groupCount', count: 9 } }),
    );
    if (out.ok) throw new Error('expected refusal');
    // Asserting the code is what makes `maxGroups` reachable on the union,
    // and it is also the assertion this test was missing: it checked the
    // number without ever checking WHICH refusal carried it.
    expect(out.error.code).toBe(ERROR_CODES.tooManyGroups);
    if (out.error.code !== ERROR_CODES.tooManyGroups) return;
    expect(out.error.maxGroups).toBe(4);
  });
});

describe('buildGroups — no input may hang or crash the browser tab', () => {
  it('refuses a class bigger than it will attempt, and says what the limit is', () => {
    // The tab-killer: Array.from({ length: 1e8 }) before any guard runs.
    const out = buildGroups(base({ students: 100_000_000 }));
    if (out.ok) throw new Error('expected refusal');
    expect(out.error.code).toBe(ERROR_CODES.tooManyStudents);
    if (out.error.code !== ERROR_CODES.tooManyStudents) return;
    expect(out.error.maxStudents).toBe(MAX_STUDENTS);
  });

  it('accepts a class of exactly the limit — the cap is a ceiling, not a fence', () => {
    const result = ok(base({ students: MAX_STUDENTS }));
    expect(result.groups.flat()).toHaveLength(MAX_STUDENTS);
  });

  it('reads an infinite count as too many, not as an empty class', () => {
    // "Not a finite number" is true of Infinity and of NaN, but they mean
    // opposite things to the teacher who typed them.
    const out = buildGroups(base({ students: Number.POSITIVE_INFINITY }));
    if (out.ok) throw new Error('expected refusal');
    expect(out.error.code).toBe(ERROR_CODES.tooManyStudents);
  });

  it('reads a nonsense count as an empty class', () => {
    const out = buildGroups(base({ students: Number.NaN }));
    if (out.ok) throw new Error('expected refusal');
    expect(out.error.code).toBe(ERROR_CODES.noStudents);
  });
});

describe('buildGroups — the edges of a class size', () => {
  it('floors a fractional count rather than inventing a part-student', () => {
    expect(
      ok(
        base({ students: 2.7, mode: { kind: 'perGroup', size: 1 } }),
      ).groups.flat(),
    ).toHaveLength(2);
  });

  it.each([[-1], [0], [-0.5]])('refuses a count of %i', (students) => {
    const out = buildGroups(base({ students }));
    if (out.ok) throw new Error('expected refusal');
    expect(out.error.code).toBe(ERROR_CODES.noStudents);
  });

  it('one group per student is allowed; one more is not', () => {
    // The boundary itself. Only `count > students` was covered, so an
    // off-by-one either way would have gone unnoticed.
    expect(
      ok(base({ students: 4, mode: { kind: 'groupCount', count: 4 } })).groups,
    ).toHaveLength(4);

    const out = buildGroups(
      base({ students: 4, mode: { kind: 'groupCount', count: 5 } }),
    );
    if (out.ok) throw new Error('expected refusal');
    expect(out.error.code).toBe(ERROR_CODES.tooManyGroups);
  });

  it('bunches leftovers in groupCount mode too, not only perGroup', () => {
    // The two settings are independent controls on the page and their
    // combination was never exercised.
    const { groups } = ok(
      base({
        students: 11,
        mode: { kind: 'groupCount', count: 3 },
        leftovers: 'bunch',
      }),
    );
    expect(shape(groups)).toEqual([5, 3, 3]);
  });

  it.each([
    ['always 0', () => 0],
    ['always just under 1', () => 0.999999999],
    // A source that returns exactly 1 is out of contract, but it is a
    // PARAMETER: nothing stops a caller supplying one, and the swap would
    // then read past the end of the array and seat `undefined` in a group.
    ['always exactly 1', () => 1],
  ])('survives a random source that %s', (_label, random) => {
    const { groups } = ok(base({ students: 12, random }));
    const all = groups.flat();
    expect(all).toHaveLength(12);
    expect(all.every((s) => s !== undefined)).toBe(true);
    expect(new Set(all.map((s) => s.number)).size).toBe(12);
  });
});

describe('buildGroups — names that are not plain ASCII', () => {
  it('normalises a name to one Unicode form for display, regardless of which form it arrived in', () => {
    // Was 'matches a name typed in a different Unicode form'. A name can
    // have two encodings that look identical: an accented letter as one
    // code point (NFC), or as a plain letter plus a combining accent (NFD).
    // macOS keyboards and file pastes produce different ones. That used to
    // matter for MATCHING: a roster pasted one way and a keep-apart rule
    // typed the other had to reach the same key, or the rule would silently
    // fail to fire. That matching is gone with the free-text keepApart
    // field -- identity is the number now, so nothing is matched on a name
    // at all.
    //
    // What survives is display: nameKey still runs on every name in
    // normaliseStudents (see its comment), so a name typed in NFD form must
    // still come back in NFC form, or the teacher's own roster renders
    // subtly different glyphs depending on which keyboard pasted it.
    const nfd = 'José'.normalize('NFD');
    const nfc = 'José'.normalize('NFC');
    expect(nfd).not.toBe(nfc);

    const out = buildGroups(
      base({ students: [student({ number: 1, name: nfd })] }),
    );
    if (!out.ok) throw new Error(`expected success, got ${out.error.code}`);
    expect(out.result.groups.flat()[0].name).toBe(nfc);
  });

  it('a roster of non-Latin names comes back intact through display normalisation', () => {
    // Restores coverage dropped when the free-text keepApart matching tests
    // were retired (see Fix round 1, F-5) -- this is NOT a matching test,
    // matching by name is gone for good. It is an NFC-stability check: all
    // four samples are already one Unicode form with no padding, so nameKey
    // is a no-op on them today -- that's the point. The value is future: it
    // fails the day nameKey gains a transform that reshapes a real name
    // silently. Decomposition (NFD) is the proven case -- it lengthens the
    // Arabic sample, which is how this test was shown to be load-bearing.
    // NFKC is NOT guarded here: all four samples were measured unchanged
    // under it, so swapping NFC for NFKC would leave this test green. If you
    // need that guarded, add a compatibility-form sample -- do not assume
    // this one covers it.
    const names = ['张伟', 'أحمد', 'דוד', 'สมชาย'];
    const out = buildGroups(
      base({
        students: names.map((name, i) => student({ number: i + 1, name })),
        mode: { kind: 'perGroup', size: 2 },
      }),
    );
    if (!out.ok) throw new Error(`expected success, got ${out.error.code}`);
    expect(
      out.result.groups
        .flat()
        .sort((a, b) => a.number - b.number)
        .map((s) => s.name),
    ).toEqual(names);
  });
});

describe('buildGroups — display normalisation preserves case', () => {
  it('renders a name with the exact case it was given, not folded to lowercase', () => {
    // Was 'treats a difference of case as a different child', which pinned
    // that nameKey does not fold case, so "ana" and "Ana" stayed two
    // different children for keep-apart MATCHING purposes.
    //
    // That half of the invariant is superseded now, not just unfed: identity
    // is the number, so two children both called "Ana" are simply two
    // numbers. Case-folding one of them can no longer merge them with
    // another, because nothing merges on the name at all any more.
    //
    // What is still live, on every call, is display: nameKey still runs on
    // every name in normaliseStudents (see its comment). If it folded case,
    // a teacher who typed "Ana" would see "ana" on their own roster.
    const out = buildGroups(
      base({ students: [student({ number: 1, name: 'Ana' })] }),
    );
    if (!out.ok) throw new Error(`expected success, got ${out.error.code}`);
    expect(out.result.groups.flat()[0].name).toBe('Ana');
  });
});

describe('buildGroups — a blank name collapses to null', () => {
  it('a whitespace-only name normalises to null, not to an empty string', () => {
    // The contract is two states: a name, or null meaning "no name". Without
    // collapsing the empty result back to null, a whitespace-only name would
    // land in a third, undocumented state -- '' is not nullish, so a
    // consumer reading `name ?? 'Student N'` would render a blank label
    // instead of falling back to it. Fix round 1, F-1.
    const out = buildGroups(
      base({ students: [student({ number: 1, name: '   ' })] }),
    );
    if (!out.ok) throw new Error(`expected success, got ${out.error.code}`);
    expect(out.result.groups.flat()[0].name).toBeNull();
  });

  it('nameKey trims padding around a real name', () => {
    // Zero trim coverage existed anywhere in this file before this test --
    // nameKey has three behaviours (NFC normalisation, case preservation,
    // trimming) and only the first two had a test. Fix round 1, F-1.
    const out = buildGroups(
      base({ students: [student({ number: 1, name: '  Ana  ' })] }),
    );
    if (!out.ok) throw new Error(`expected success, got ${out.error.code}`);
    expect(out.result.groups.flat()[0].name).toBe('Ana');
  });
});

describe('buildGroups — a blank together (or apart) collapses to null, not a shared letter', () => {
  // Same field shape as name, same defect, same fix (Fix round 1, F-4):
  // normaliseStudents used to pass `together` and `apart` through untouched,
  // so a blank cell was a LIVE letter rather than "no letter".
  it('a whitespace-only together forms no block', () => {
    // If '   ' were a real, shared letter, six students who all typed only
    // spaces would collapse into one block of 6 and trip
    // togetherUnitTooLarge against a group size of 3 (6 > 3). Succeeding,
    // with every student free to land in either group, is the proof a
    // blank forms no block at all.
    const out = buildGroups(
      base({
        students: Array.from({ length: 6 }, (_, i) =>
          student({ number: i + 1, together: '   ' }),
        ),
        mode: { kind: 'perGroup', size: 3 },
      }),
    );
    expect(out.ok).toBe(true);
  });

  it('two students with different-looking blank values are not merged into one block', () => {
    // The failure mode a naive fix (trim, but forget to collapse the empty
    // result to null) would still have: '' and '   ' both trim to '', so
    // they would become the SAME map key in buildBlocks and wrongly share a
    // block of 2 -- which trips togetherUnitTooLarge against a group size of
    // 1 (2 > 1). Succeeding, with each student alone in their own group of
    // 1, is the proof both collapsed to null rather than to a shared ''.
    const out = buildGroups(
      base({
        students: [
          student({ number: 1, together: '' }),
          student({ number: 2, together: '   ' }),
        ],
        mode: { kind: 'perGroup', size: 1 },
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.groups).toHaveLength(2);
  });

  it('a whitespace-only apart also normalises to null, not to an empty string', () => {
    // apart has no grouping behaviour yet (Task 5) -- normalisation is a
    // field-level fix applied to name, together and apart identically in
    // normaliseStudents, so this is observable only as the returned field,
    // not through any placement decision.
    const out = buildGroups(
      base({ students: [student({ number: 1, apart: '   ' })] }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.groups.flat()[0].apart).toBeNull();
  });
});

describe('buildGroups — randomness is real but reproducible', () => {
  it('the same seed gives the same arrangement', () => {
    const a = ok(base({ random: seeded(7) }));
    const b = ok(base({ random: seeded(7) }));
    expect(a.groups.map((g) => g.map((s) => s.number))).toEqual(
      b.groups.map((g) => g.map((s) => s.number)),
    );
  });

  it('different seeds actually shuffle — the engine is not returning a fixed order', () => {
    // Guards against a "shuffle" that does nothing, which every other test here
    // would happily pass.
    const arrangements = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((s) =>
        JSON.stringify(
          ok(base({ random: seeded(s) })).groups.map((g) =>
            g.map((x) => x.number),
          ),
        ),
      ),
    );
    expect(arrangements.size).toBeGreaterThan(1);
  });
});

describe('the name-based keep-apart surface is gone', () => {
  it('no longer exports parseKeepApart', () => {
    expect(
      (grouping as Record<string, unknown>).parseKeepApart,
    ).toBeUndefined();
  });

  it('no longer has error codes that only free text could produce', () => {
    // A letter needs no names and cannot be misspelt, so neither failure can
    // occur. Leaving the codes would leave dead branches that no test reaches.
    const codes = Object.values(ERROR_CODES);
    expect(codes).not.toContain('KEEP_APART_NEEDS_NAMES');
    expect(codes).not.toContain('KEEP_APART_UNKNOWN_NAME');
  });
});

describe('together letters', () => {
  it('places everyone sharing a letter in the same group', () => {
    const out = buildGroups(
      base({
        students: [
          student({ number: 1, name: 'Ana', together: 'A' }),
          student({ number: 2, name: 'Budi', together: 'A' }),
          student({ number: 3, name: 'Citra' }),
          student({ number: 4, name: 'Dewi' }),
          student({ number: 5, name: 'Eko' }),
          student({ number: 6, name: 'Gita' }),
        ],
        mode: { kind: 'groupCount', count: 3 },
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const g = groupOf(out.result.groups, 1);
    expect(g?.map((s) => s.number)).toContain(2);
  });

  it('lets two different letters share a group when nothing says they must not', () => {
    // Was 'keeps two different letters apart from each other only by
    // chance, not by rule', asserted with groupCount: 1. With one group,
    // "may A and B share a group" is true by construction -- everyone is in
    // the one group regardless of whether `together` is read at all -- so
    // that test passed even with the feature switched off. It asserted a
    // 4-member group under this test's name, which is coverage the name
    // promised and the body never gave. Fix round 1, F-5.
    //
    // groupCount: 2 makes it observable: two equal-sized groups (sizes
    // [4, 4]) large enough to hold A-with-B or to keep them apart, so
    // whether they ever share is a real question the search answers rather
    // than a foregone conclusion.
    //
    // Fix round 2: this test passed trivially for a second, different
    // reason than the one it was rewritten for -- Fix round 1's
    // first-fit-decreasing sort made A and B share EVERY seed,
    // deterministically (block A always fills group 0 first, and block B
    // still fits in group 0, so it lands there too, regardless of
    // shuffle). "At least one seed together" cannot see "every seed
    // together" as a problem; it was true both before and after the
    // regression. Measured on this build: of these 30 seeds, 12 seated A
    // with B and 18 kept them apart, so the test now also requires the
    // opposite outcome to show up at least once -- it fails immediately if
    // the always-together collapse comes back. The dedicated regression
    // test below (same roster, 200 seeds) is the direct guard; this
    // strengthening is so THIS test's own name stays true.
    const students = [
      student({ number: 1, together: 'A' }),
      student({ number: 2, together: 'A' }),
      student({ number: 3, together: 'B' }),
      student({ number: 4, together: 'B' }),
      student({ number: 5 }),
      student({ number: 6 }),
      student({ number: 7 }),
      student({ number: 8 }),
    ];
    const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
    const outcomes = seeds.map((seed) => {
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'groupCount', count: 2 },
          random: seeded(seed),
        }),
      );
      if (!out.ok) return 'failed';
      return groupOf(out.result.groups, 1)?.some((s) => s.number === 3)
        ? 'together'
        : 'apart';
    });
    expect(outcomes.some((o) => o === 'together')).toBe(true);
    // Fix round 2: and not ALWAYS together, or the collapse is back.
    expect(outcomes.some((o) => o === 'apart')).toBe(true);
  });

  it('refuses a unit larger than the group, naming the letter and both numbers', () => {
    const out = buildGroups(
      base({
        students: Array.from({ length: 8 }, (_, i) =>
          student({ number: i + 1, together: i < 6 ? 'A' : null }),
        ),
        mode: { kind: 'perGroup', size: 4 },
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({
      code: ERROR_CODES.togetherUnitTooLarge,
      letter: 'A',
      unit: 6,
      groupSize: 4,
    });
  });

  it('refuses the same clash reached by shrinking the groups instead', () => {
    // Same contradiction, opposite direction. One check has to catch both or
    // the teacher meets it from one side and not the other.
    const out = buildGroups(
      base({
        students: Array.from({ length: 8 }, (_, i) =>
          student({ number: i + 1, together: i < 3 ? 'A' : null }),
        ),
        mode: { kind: 'groupCount', count: 4 }, // 8 into 4 -> groups of 2
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe(ERROR_CODES.togetherUnitTooLarge);
  });

  it('ignores the letter of an absent student', () => {
    const out = buildGroups(
      base({
        students: [
          student({ number: 1, name: 'Ana', together: 'A', absent: true }),
          student({ number: 2, name: 'Budi', together: 'A' }),
          student({ number: 3, name: 'Citra' }),
        ],
        // Brief says count: 3, but that is against the ROSTER (3 students). Task
        // 3 changed the too-many-groups guard to compare against PRESENT
        // students (2, since Ana is absent), so count: 3 trips TOO_MANY_GROUPS
        // before this test's own logic is ever reached -- confirmed by running
        // the brief's version unmodified (see
        // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
        // "Why the absent-student test uses count: 2"). count: 2 keeps
        // the test's actual purpose -- Budi's unit collapses to a block of one
        // once Ana's letter is ignored -- while staying under present.length.
        mode: { kind: 'groupCount', count: 2 },
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Budi's unit is now one student, so he can go anywhere.
    expect(out.result.groups.flat()).toHaveLength(2);
  });

  // Fix round 1, F-3: `gaveUp` vs "no arrangement exists" is the spec's
  // honesty promise -- until together-blocks existed it was unreachable
  // through the public API, and therefore untested. Both cases below assert
  // the CODE, not just `out.ok === false`: the defect these close was a
  // wrong code with a right verdict, so a test that only checks the verdict
  // would pass on the very bug being fixed.
  it('proves no arrangement exists when three together-pairs cannot all fit', () => {
    // 3 blocks of 2 into 2 groups of 3: each group can hold only ONE block
    // of 2 (two would need 4 of 3), so at most 2 of the 3 blocks ever fit,
    // and the third never does, however the search orders them. Small
    // enough that the search runs to genuine exhaustion, nowhere near
    // SEARCH_NODE_CAP -- this is "proven impossible", not "gave up".
    const out = buildGroups(
      base({
        students: [
          student({ number: 1, together: 'A' }),
          student({ number: 2, together: 'A' }),
          student({ number: 3, together: 'B' }),
          student({ number: 4, together: 'B' }),
          student({ number: 5, together: 'C' }),
          student({ number: 6, together: 'C' }),
        ],
        mode: { kind: 'perGroup', size: 3 },
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({
      code: ERROR_CODES.togetherNoArrangement,
      groupsTried: 2,
    });
  });

  it('says it gave up, not that no arrangement exists, once the search budget is exhausted', () => {
    // The reviewer's own repro (see
    // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
    // "The 15-buddy-pairs gave-up input, timed across two engine shapes"):
    // 15 buddy-pairs (30 students) into 10 groups. Re-measured after the
    // F-2 sort fix rather than assumed correct -- all 15 blocks are the
    // SAME size (2), so first-fit-decreasing has no size difference to sort
    // on here and this input still exhausts SEARCH_NODE_CAP exactly as it
    // did before F-2. Confirmed by measurement, not by carrying the number
    // over: gaveUp in 11ms post-F-2 (correcting an earlier version of this
    // comment, which claimed "single-digit milliseconds" -- 11 never was).
    //
    // Fix round 2 re-measured again, because the placer changed again: pass
    // 1 (now the unsorted, varied order) and pass 2 (first-fit-decreasing)
    // BOTH run here and BOTH exhaust the budget -- confirmed by temporary
    // instrumentation on this exact test (pass1: gaveUp=true, groups=null;
    // pass2: gaveUp=true, groups=null), not assumed from the arithmetic
    // alone. All 15 blocks being the SAME size means sorting by size is a
    // no-op, so pass 2's order is byte-identical to pass 1's and it re-runs
    // an already-exhausted search a second time -- measured at 17-23ms
    // across repeated runs, roughly double the single-pass number above,
    // as two equal exhaustions predict.
    const pairs = Array.from({ length: 30 }, (_, i) =>
      student({
        number: i + 1,
        together: String.fromCharCode(65 + Math.floor(i / 2)), // A,A,B,B,...,O,O
      }),
    );
    const out = buildGroups(
      base({ students: pairs, mode: { kind: 'groupCount', count: 10 } }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({ code: ERROR_CODES.togetherSearchGaveUp });
  });

  it('varies which students land together across seeds, not just the group sizes', () => {
    // Fix round 2 regression guard. Nothing previously pinned arrangement
    // VARIETY -- every existing assertion here either checks `shape()`
    // (group SIZES, permutation-invariant) or "at least one seed does X",
    // and Fix round 1's first-fit-decreasing sort collapsed this exact
    // roster to a SINGLE partition on every one of 200 seeds without
    // failing a single existing test: shape() stayed [4, 4] regardless, and
    // "at least one seed together" stayed true because it was true on
    // EVERY seed. Only the partition -- which student landed with which --
    // can see the collapse, so that is what this test asserts on.
    //
    // Same roster and mode as the "lets two different letters share a
    // group" test above, reused so these numbers are directly comparable
    // to what was measured before this fix: two together-pairs (A, A) and
    // (B, B) plus four unlettered students, into two groups of four. Block
    // sizes [2, 2, 1, 1, 1, 1] -- the exact shape whose collapse was
    // reported (1 distinct partition over 200 seeds, always {1,2,3,4} |
    // {5,6,7,8}, confirmed by re-measuring the pre-Fix-round-2 build here).
    //
    // Measured on THIS build (Fix round 2, two-pass placement): 7 distinct
    // partitions over these exact 200 seeds -- the mathematical maximum for
    // this roster (either A and B share a group and all four singles share
    // the other -- 1 way -- or A and B split across groups and the four
    // singles divide 2-and-2 between them -- C(4,2) = 6 ways -- 1 + 6 = 7
    // total). Asserting > 3 leaves more than half of that headroom, so an
    // implementation that still varies, just not maximally, does not turn
    // this test flaky.
    const students = [
      student({ number: 1, together: 'A' }),
      student({ number: 2, together: 'A' }),
      student({ number: 3, together: 'B' }),
      student({ number: 4, together: 'B' }),
      student({ number: 5 }),
      student({ number: 6 }),
      student({ number: 7 }),
      student({ number: 8 }),
    ];
    const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
    const partitions = new Set(
      seeds.map((seed) => {
        const { groups } = ok(
          base({
            students,
            mode: { kind: 'groupCount', count: 2 },
            random: seeded(seed),
          }),
        );
        // The partition: which students share a group, independent of
        // which output slot the group landed in (that slot is itself
        // shuffled -- see "randomise which group is oversized" in
        // grouping.ts -- and carries no meaning of its own). Sorted within
        // a group, and the groups sorted against each other, so "A with B"
        // and "B with A" collapse to the one partition they actually are.
        return groups
          .map((g) =>
            g
              .map((s) => s.number)
              .sort((a, b) => a - b)
              .join('.'),
          )
          .sort()
          .join(' | ');
      }),
    );
    expect(partitions.size).toBeGreaterThan(3);
  });

  // Fix round 3: pass 2 (first-fit-decreasing) exists solely to rescue
  // rosters pass 1 (the shuffled, unsorted order) gives up on -- see
  // `placeBlocks`'s docstring. Nothing before this test exercised that
  // rescue: the gave-up test above uses 15 SAME-size blocks, so sorting by
  // size is a no-op and pass 2 replays pass 1's exhausted search node for
  // node; the variety test above resolves entirely inside pass 1. So the one
  // capability the two-pass design exists to provide had no regression
  // guard -- a change that broke "reuse pass 1's order, do not reshuffle"
  // could silently reintroduce give-ups and nothing would catch it.
  //
  // Provenance (see
  // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
  // "Together letters: pass-2 rescue, proven on a real input" for the full
  // sweep). This roster -- five together-letters of 3 students (A-E), five
  // of 2 (F-J),
  // five unlettered singles; 15 blocks, 30 students -- into groupCount: 10
  // (ten groups of exactly 3) is the classic "a block of 2 needs exactly one
  // block of 1 to fill its group" bin-packing shape, mixed block sizes so
  // the FFD sort is not a no-op.
  //
  // PASS 1 ALONE GIVES UP on this input: established by temporarily
  // disabling pass 2 in grouping.ts (`return pass1;` before the FFD branch)
  // and running this exact roster/mode through the real engine for seeds
  // 1..300. Result: pass 1 hit SEARCH_NODE_CAP and returned
  // TOGETHER_SEARCH_GAVE_UP on 63 of the 300 (seed 1 -- used below -- among
  // them: 1, 6, 9, 12, 15, 20, 22, 35, 40, 41, 47, 56, 59, 60, 65, 67, 71,
  // 77, 79, 85, 90, 91, 93, 96, 106, 107, 108, 110, 114, 122, 123, 124, 128,
  // 132, 133, 135, 139, 148, 152, 159, 173, 179, 187, 192, 199, 203, 216,
  // 217, 219, 222, 224, 226, 238, 247, 256, 261, 263, 264, 265, 267, 277,
  // 286, 297) and NEVER ONCE proved no arrangement exists (0 of 300) -- this
  // is real search exhaustion on a feasible input, not a fixture that
  // happens to be impossible.
  //
  // NOT A LUCKY SEED: with pass 2 restored (the real, committed engine),
  // ALL 63 of those give-up seeds succeed, each one checked for validity
  // (every letter's block intact, exactly 30 students, no duplicates, no
  // invented numbers, every group size 3) -- 63/63, zero exceptions. Seed 1
  // is an arbitrary pick from a uniform 63-wide spread, not the one seed
  // that happens to work.
  //
  // Timing, measured on this machine, not a guarantee: the full call at
  // seed 1 took ~12-14ms (pass 1 spends its ~200,000-node budget before
  // giving up; pass 2's sorted order then succeeds quickly) -- roughly what
  // the existing gave-up test measures for ONE exhausted pass, consistent
  // with pass 1 here also running to exhaustion before pass 2 rescues it.
  it('is rescued by pass 2 when pass 1 alone would give up, without losing or inventing anyone', () => {
    const students = [
      ...['A', 'B', 'C', 'D', 'E'].flatMap((letter, gi) =>
        Array.from({ length: 3 }, (_, k) =>
          student({ number: gi * 3 + k + 1, together: letter }),
        ),
      ),
      ...['F', 'G', 'H', 'I', 'J'].flatMap((letter, gi) =>
        Array.from({ length: 2 }, (_, k) =>
          student({ number: 15 + gi * 2 + k + 1, together: letter }),
        ),
      ),
      ...Array.from({ length: 5 }, (_, k) => student({ number: 26 + k })),
    ];
    const out = buildGroups(
      base({
        students,
        mode: { kind: 'groupCount', count: 10 },
        random: seeded(1),
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const { groups } = out.result;

    // Nobody lost, nobody invented -- scoped to this test's own roster, not
    // a general claim (the general block-path version is the next task's).
    const numbers = groups.flat().map((s) => s.number);
    expect(numbers.length).toBe(30);
    expect(new Set(numbers)).toEqual(new Set(students.map((s) => s.number)));

    // Every together-letter's students share one group -- the property pass
    // 2 exists to preserve while rescuing the search.
    for (const letter of 'ABCDEFGHIJ') {
      const withLetter = students.filter((s) => s.together === letter);
      const host = groupOf(groups, withLetter[0].number);
      for (const s of withLetter) {
        expect(host?.map((m) => m.number)).toContain(s.number);
      }
    }
  });
});

describe('apart letters', () => {
  it('separates everyone sharing a letter from everyone else sharing it', () => {
    // Swept across seeds, not asserted once (Fix round 1, F-3): a single
    // arbitrary seed leaves this holding by LUCK, not by the feature -- with
    // apart-letters completely ignored, this exact roster's assertion still
    // holds on 23 of 50 seeds (confirmed by mutation below), and seed 1
    // (base()'s default) is one of the lucky ones. This is the feature's
    // headline promise, so it gets real search pressure: 25 seeds, every one
    // checked, not "at least one".
    for (let seed = 1; seed <= 25; seed++) {
      const out = buildGroups(
        base({
          students: [
            student({ number: 1, apart: 'X' }),
            student({ number: 2, apart: 'X' }),
            student({ number: 3, apart: 'X' }),
            student({ number: 4 }),
            student({ number: 5 }),
            student({ number: 6 }),
          ],
          mode: { kind: 'groupCount', count: 3 },
          random: seeded(seed),
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) continue;
      for (const g of out.result.groups) {
        expect(g.filter((s) => s.apart === 'X')).toHaveLength(1);
      }
    }
  });

  it('treats two different letters as unrelated', () => {
    // What this actually guards: with a single group, "does X end up with Y"
    // is true by construction regardless of whether apart-letters are read
    // at all -- everyone is in the one group either way. So this test cannot
    // go RED for the reason its name suggests (confirmed: it already passes
    // before buildConflicts reads `apart` at all -- see
    // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
    // "The five original tests: which passed structurally, not by
    // feature"). Its real job is narrower and still real: it guards against
    // OVER-separation, i.e. a bug that conflicted every letter-holder with
    // every other regardless of which letter they hold -- that bug WOULD
    // turn this impossible (two mutually-conflicting singletons cannot both
    // fit in one group) and this test would catch it. Proven by mutation,
    // not asserted: see
    // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
    // "Mutation evidence for the structural claim" for the mutant and its
    // failure.
    const out = buildGroups(
      base({
        students: [
          student({ number: 1, apart: 'X' }),
          student({ number: 2, apart: 'Y' }),
        ],
        mode: { kind: 'groupCount', count: 1 },
      }),
    );
    expect(out.ok).toBe(true); // X and Y have no rule between them
  });

  it('proves impossibility by naming the students, as numbers', () => {
    const out = buildGroups(
      base({
        students: Array.from({ length: 6 }, (_, i) =>
          student({ number: i + 1, apart: i < 4 ? 'X' : null }),
        ),
        mode: { kind: 'groupCount', count: 3 },
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe(ERROR_CODES.keepApartImpossible);
    if (out.error.code !== ERROR_CODES.keepApartImpossible) return;
    expect(out.error.students.sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(out.error.groupsNeeded).toBe(4);
  });

  it('ignores the letter of an absent student', () => {
    // Structurally unbreakable as apart-COVERAGE, not just weak: 2 present
    // students into sizes [1, 1] separate by CAPACITY alone, whether or not
    // `apart` (or absence-filtering) is read at all -- confirmed, no mutant
    // of the apart logic reddens this (Fix round 1, F-4). Kept anyway as a
    // cheap boundary check that an absent letter-holder does not otherwise
    // disrupt sizing. The real guarantee -- that an absent student's letter
    // cannot inflate the clique -- is the test below.
    const out = buildGroups(
      base({
        students: [
          student({ number: 1, apart: 'X' }),
          student({ number: 2, apart: 'X' }),
          student({ number: 3, apart: 'X', absent: true }),
        ],
        mode: { kind: 'groupCount', count: 2 },
      }),
    );
    expect(out.ok).toBe(true); // two present, two groups
  });

  // Fix round 1, F-4: sits on the refusal boundary instead. Four X-holders
  // (1-4) plus two plain students; student 4 is absent. The PRESENT clique
  // is exactly {1, 2, 3} -- 3 blocks -- which equals sizes.length (3), so
  // the clique gate does not fire and this succeeds. If absence ever leaked
  // into `buildConflicts` (the failure the test above cannot see: it has no
  // slack between "separates" and "does not"), the clique would include the
  // absent student 4 too -- 4 > 3 -- and this would fail with
  // KEEP_APART_IMPOSSIBLE instead. Proven by mutation: see
  // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
  // "The absence boundary: proven by mutation".
  it('an absent letter-holder does not inflate the clique past the group count', () => {
    const out = buildGroups(
      base({
        students: [
          student({ number: 1, apart: 'X' }),
          student({ number: 2, apart: 'X' }),
          student({ number: 3, apart: 'X' }),
          student({ number: 4, apart: 'X', absent: true }),
          student({ number: 5 }),
          student({ number: 6 }),
        ],
        mode: { kind: 'groupCount', count: 3 },
      }),
    );
    expect(out.ok).toBe(true);
  });

  // 'separates whole units, not just the students carrying the letter' used
  // to live here (Ana+Budi together, Ana apart from Citra, expecting Budi
  // never ends up with Citra) and was deleted (Fix round 1, F-3): with 4
  // students into 2 groups of 2, the together-block {Ana, Budi} has size 2,
  // which can ONLY ever be placed as an entire group on its own -- there is
  // no OTHER group it could partially share -- so Citra ends up with Dewi by
  // CAPACITY ALONE, whether or not the block-level conflict check runs at
  // all. Confirmed by mutation: it stayed green under both an ignored-apart
  // mutant and a disabled-conflict mutant (see
  // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
  // "The deleted separates-whole-units test"). Adding filler
  // students to relieve that capacity pressure -- the obvious repair -- was
  // tried and it still passed at seed 1, so no repair was found, not for
  // lack of trying.
  //
  // The guarantee it meant to protect -- a together-block moves as one, so
  // its apart-conflict moves with it -- is properly covered, under real
  // search pressure across 100 attempts with multiple modes and seeds, by
  // 'holds even when together-letters merge students into multi-student
  // blocks' below (debt (a) sweep 2), independently reconfirmed here to go
  // red under the disabled-conflict mutant (`expected 2 to be less than or
  // equal to 1`) where this deleted test stayed green under the identical
  // mutation.
});

// Debt (a) from the task-5 brief's opening notice: "two students who must be
// apart never share a group" is the headline promise of the whole feature,
// and until this task it had zero cover -- `assign`'s conflict check has
// been unreachable since Task 2. The five tests above each pin one small,
// hand-picked roster; this proves the same guarantee broadly, with an
// invariant re-checked directly against the raw `apart` field (never via
// buildConflicts or any other engine internal, so this cannot pass merely
// because the test and the implementation share a bug).
describe('apart letters — the guarantee holds broadly, not just on hand-picked rosters (debt a)', () => {
  // One test per class size (the one-test-per-case rule), each with eight
  // seeds for every mode, the seeds `seeded(seed * 97 + n)` as before #638.
  // Measured per size (attempts, successes): 4: 16, 16; 6, 9, 12, 16 and 20:
  // 24, 24 each; 25: 24, 21; 30: 24, 22. Together the original 184 attempts and
  // 179 successes. Each size must clear its own floor below (a margin under the
  // measurement); the floors sum to 120 attempts and 133 successes, above the
  // original sweep's > 100 and > 80, so no size can fail silently.
  const apartSweepSizes: [
    n: number,
    minAttempts: number,
    minSuccesses: number,
  ][] = [
    [4, 12, 12],
    [6, 18, 18],
    [9, 18, 18],
    [12, 18, 18],
    [16, 18, 18],
    [20, 18, 18],
    [25, 18, 15],
    [30, 18, 16],
  ];
  it.each(apartSweepSizes)(
    'holds across group-count and per-group modes and eight seeds for a class of %i',
    (n, minAttempts, minSuccesses) => {
      const letters = ['X', 'Y', 'Z'];
      let successes = 0;
      let attempts = 0;
      const students = Array.from({ length: n }, (_, i) =>
        student({ number: i + 1, apart: letters[i % letters.length] }),
      );
      // Cyclic assignment balances each letter's membership to
      // ceil(n/3) at most, so this is the largest clique the search can
      // ever meet for this roster -- used to keep every mode comfortably
      // feasible (a few groups of slack) rather than accidentally
      // constructing a SECOND pathological-search fixture here; that is
      // debt (b)'s job, deliberately, in its own dedicated test below.
      const largestLetterGroup = Math.ceil(n / letters.length);
      const modes: Mode[] = [
        { kind: 'groupCount', count: largestLetterGroup + 2 },
        { kind: 'groupCount', count: largestLetterGroup + 4 },
        {
          kind: 'perGroup',
          size: Math.max(2, Math.floor(n / (largestLetterGroup + 3))),
        },
      ];
      for (const mode of modes) {
        if (mode.kind === 'groupCount' && mode.count > n) continue;
        for (let seed = 1; seed <= 8; seed++) {
          attempts++;
          const out = buildGroups(
            base({ students, mode, random: seeded(seed * 97 + n) }),
          );
          if (!out.ok) continue;
          successes++;
          // The invariant, re-derived from `apart` directly rather than
          // trusting any engine internal: no group holds two present
          // students who share a non-null apart letter.
          for (const g of out.result.groups) {
            for (const letter of letters) {
              expect(
                g.filter((s) => s.apart === letter).length,
              ).toBeLessThanOrEqual(1);
            }
          }
        }
      }
      // The invariant must actually be exercised on real successes, not hold
      // vacuously because every attempt for this size happened to fail.
      expect(attempts).toBeGreaterThan(minAttempts);
      expect(successes).toBeGreaterThan(minSuccesses);
    },
  );

  it('holds even when together-letters merge students into multi-student blocks', () => {
    // A pure apart-only sweep cannot see a block-index/student-index
    // substitution bug (the exact class of bug the pre-Task-5 comment above
    // `pairs` warned about): with no together-letters every block is a
    // singleton, so block index and student index are the same sequence of
    // numbers and a swap between them is invisible. Together-letters here
    // make blocks of size 2, so block index and student index diverge from
    // student 3 onward, giving this sweep something a same-index bug cannot
    // hide from.
    const students = [
      student({ number: 1, together: 'A', apart: 'X' }),
      student({ number: 2, together: 'A' }),
      student({ number: 3, together: 'B', apart: 'X' }),
      student({ number: 4, together: 'B' }),
      student({ number: 5, together: 'C', apart: 'Y' }),
      student({ number: 6, together: 'C' }),
      student({ number: 7, apart: 'Y' }),
      student({ number: 8, apart: 'Z' }),
      student({ number: 9, apart: 'Z' }),
      student({ number: 10 }),
      student({ number: 11 }),
      student({ number: 12 }),
    ];
    const modes: Mode[] = [
      { kind: 'groupCount', count: 4 },
      { kind: 'groupCount', count: 6 },
      { kind: 'perGroup', size: 3 },
      { kind: 'perGroup', size: 4 },
    ];
    let successes = 0;
    for (const mode of modes) {
      for (let seed = 1; seed <= 25; seed++) {
        const out = buildGroups(base({ students, mode, random: seeded(seed) }));
        if (!out.ok) continue;
        successes++;
        for (const g of out.result.groups) {
          for (const letter of ['X', 'Y', 'Z']) {
            expect(
              g.filter((s) => s.apart === letter).length,
            ).toBeLessThanOrEqual(1);
          }
          // The together-units still move as whole blocks under this mix.
          for (const letter of ['A', 'B', 'C']) {
            const withLetter = g.filter((s) => s.together === letter);
            expect(withLetter.length === 0 || withLetter.length === 2).toBe(
              true,
            );
          }
        }
      }
    }
    // Measured (see
    // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
    // "The guarantee holds broadly: two sweeps"): 100 successes out of 100
    // attempts.
    expect(successes).toBeGreaterThan(20);
  });
});

// Debt (b): exhausting SEARCH_NODE_CAP must never be reported as "no
// arrangement exists" -- the old engine once shipped exactly that bug,
// reporting five students mutually inseparable when it had merely stopped
// looking, and its regression tests were deleted with the free-text
// `keepApart` field. Re-proven here against a REAL apart-only input that
// exhausts the budget on the CURRENT (two-pass, block-based) engine --
// re-measured, not cited from the SEARCH_NODE_CAP comment's old numbers,
// because those were taken against a since-retired engine shape (see that
// comment for how far off they turned out to be: disjoint same-size
// cliques, the literal old shape, no longer exhaust the budget at all on
// this engine, up to 484 students -- see
// docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
// "Re-measured against the current engine: a negative result" for the full
// search that established that before this shape was found).
describe('apart letters — exhausting the search budget is never reported as "no arrangement exists" (debt b)', () => {
  it('says it gave up, not that no arrangement exists, once BOTH passes exhaust the budget', () => {
    // Six disjoint apart-letter cliques of UNEVEN size (20, 19, 18, 17, 16,
    // 15 -- 105 students) into exactly 20 groups. Even sizes (e.g. many
    // same-size disjoint triangles, or several cliques each exactly matching
    // the group count) measured trivially fast on this engine regardless of
    // scale -- greedy first-fit essentially self-balances a perfectly
    // regular shape. Unevenness is what defeats it: with no slack capacity
    // and clique sizes that do not divide the groups evenly, the shuffled
    // first-fit search paints itself into corners that need deep
    // backtracking to escape, 334 of 400 seeds measured exhausting the
    // budget outright with the remaining 66 succeeding (see
    // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
    // "The shape that does defeat it") -- this is a common outcome for this
    // shape, not a hand-picked unlucky seed. No `random` override is
    // passed, so this
    // runs on `base()`'s default `seeded(1)`, confirmed to land in the
    // gave-up set and to reproduce identically across repeated runs (both
    // properties are deterministic, not a matter of luck at test-run time).
    //
    // Every block here is a singleton (no `together`), so pass 2's
    // first-fit-decreasing sort has no size difference to act on -- a
    // stable sort over equal keys is a no-op, so pass 2's order is
    // byte-identical to pass 1's and it replays the same exhausted search
    // node for node. Confirmed by temporary instrumentation on this exact
    // input (reverted before commit, not left in the source): pass 1
    // gaveUp=true/found=false; pass 2 gaveUp=true/found=false, and its order
    // was verified byte-identical to pass 1's. BOTH passes are defeated,
    // not just one, and the earlier "same shape, all-equal-size blocks"
    // together-test (the 15-buddy-pairs one, above) establishes the general
    // pattern this instantiates for apart letters specifically.
    // Was [20, 19, 18, 17, 16, 15] = 105 students. MAX_STUDENTS dropped from
    // 500 to 100 (operator, 2026-08-13), so that input is now refused with
    // TOO_MANY_STUDENTS before the search ever runs — the test would have
    // passed its `ok === false` check while proving nothing about the search
    // at all. The last clique is shortened to land on exactly 100; the shape
    // (six singleton apart-cliques of unequal size, group count 20) is
    // unchanged, and this input was verified to still return
    // KEEP_APART_SEARCH_GAVE_UP under the same default seed.
    //
    // The budget is comfortably reachable inside the new ceiling: a sweep of
    // seven shapes at 87-100 students found this code at every one of them,
    // so the lowered limit did not orphan this path.
    const students = [20, 19, 18, 17, 16, 10].flatMap((size, ci) =>
      Array.from({ length: size }, (_, j) =>
        student({ number: ci * 100 + j + 1, apart: `C${ci}` }),
      ),
    );
    expect(students).toHaveLength(100);

    const out = buildGroups(
      base({ students, mode: { kind: 'groupCount', count: 20 } }),
    );

    expect(out.ok).toBe(false);
    if (out.ok) return;
    // The specific code, not just `ok === false`: the historical bug this
    // guards had the right verdict (refused) and the WRONG code (claimed
    // impossibility when it had only given up), so a test that stopped at
    // the verdict would have passed on that exact bug. That code has exactly
    // one producer (KEEP_APART_SEARCH_GAVE_UP), so this assertion alone
    // already proves the cap was hit -- no separate timing check is needed
    // to establish that (Fix round 1, F-5: a wall-clock assertion
    // (`expect(ms).toBeGreaterThan(5)`) was removed here; this codebase does
    // not allow tests whose pass/fail depends on wall-clock time, since it
    // turns a slow or loaded CI machine into a mystery failure). Measured,
    // as a record rather than an assertion: ~51-57ms on repeated local runs
    // (matches the SEARCH_NODE_CAP comment in grouping.ts, which has the
    // full sweep this input was drawn from).
    expect(out.error).toEqual({ code: ERROR_CODES.keepApartSearchGaveUp });
  });
});

// Task 11, the final sweep. KEEP_APART_NO_ARRANGEMENT -- the sibling of the
// gave-up code just above, for when the search runs to genuine exhaustion
// rather than hitting SEARCH_NODE_CAP -- had a hand-built fixture in
// i18n.test.ts's SAMPLES table (rendering coverage: does the sentence come
// out right when given this shape of data) but no producer anywhere in
// THIS file: confirmed absent by grep across the whole suite before this
// test was added. A sample is not proof of reachability -- see this
// describe block's own name and Correction 2 of the Task 11 brief.
//
// The shape: three apart-letters, X and Y sized 3 each and Z sized 2 (8
// students), into groupCount 3 with leftovers 'bunch' -- sizes [4, 2, 2]
// (base 2, remainder 2, all bunched into slot 0 by `targetSizes`). X and Y
// are each a clique of exactly 3, matching the group count exactly (3 is
// NOT greater than 3), so the fast `keepApartImpossible` clique gate does
// not fire for either -- the same boundary the "clique-equals-group-count"
// case in task-8b-report.md's own sweep sits at. Each clique of 3 needs one
// member in EVERY one of the 3 groups (nobody may share a group with their
// own letter), so the two size-2 groups are already full from X and Y
// alone before Z is even considered. Z's own 2 members still need two
// DIFFERENT groups, and only the one size-4 group has spare room left,
// which can hold at most one of them -- the other has nowhere to go. No
// arrangement fits, and nothing here is oversized enough to trip
// `togetherUnitTooLarge` (there are no together-letters at all) or the
// clique gate, so this is a search-space question, not a capacity or
// clique one -- exactly what distinguishes KEEP_APART_NO_ARRANGEMENT from
// its sibling codes.
//
// Verified empirically before trusting the arithmetic above, not instead of
// it: a throwaway probe (`tests/unit/_scratch.test.ts`, never committed)
// ran this exact roster/mode through the real engine and printed the
// result. Swept across 8 seeds below, not asserted once -- this is a
// mathematical impossibility (the counting argument above holds regardless
// of which order the search tries things in), so every seed must agree; a
// seed-dependent result would mean the reasoning above is wrong, not that
// one seed got unlucky. All 8 resolve in low single-digit milliseconds,
// nowhere near SEARCH_NODE_CAP -- no budget needs lowering here, unlike the
// gave-up test above.
describe('apart letters — three cliques whose sizes and capacities collide, not just one oversized clique', () => {
  it('proves no arrangement exists, not merely that the search gave up', () => {
    const students = [
      ...['X', 'Y'].flatMap((letter, li) =>
        Array.from({ length: 3 }, (_, i) =>
          student({ number: li * 3 + i + 1, apart: letter }),
        ),
      ),
      student({ number: 7, apart: 'Z' }),
      student({ number: 8, apart: 'Z' }),
    ];
    for (const seed of [1, 2, 3, 7, 42, 99, 123, 999]) {
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'groupCount', count: 3 },
          leftovers: 'bunch',
          random: seeded(seed),
        }),
      );
      expect(out.ok, `seed ${seed}`).toBe(false);
      if (out.ok) continue;
      expect(out.error, `seed ${seed}`).toEqual({
        code: ERROR_CODES.keepApartNoArrangement,
        groupsTried: 3,
      });
    }
  });
});

// Debt (c): `largestMutualConflict` has been unreachable since Task 2, so
// nothing has ever proven it reports a genuine clique rather than merely
// "everyone who has some conflict". Two disjoint apart-letters below: X is a
// mutual triangle (a real 3-clique), Y is a mutual pair, and X and Y have no
// rule between them (a different letter is unrelated -- see "treats two
// different letters as unrelated" above). A certificate that named every
// conflicted student rather than the actual maximum clique would wrongly
// include 4 and 5 here.
describe('apart letters — the clique certificate names exactly the conflicting students (debt c)', () => {
  it('does not include a student who has some conflict but is not part of the reported clique', () => {
    const out = buildGroups(
      base({
        students: [
          student({ number: 1, apart: 'X' }),
          student({ number: 2, apart: 'X' }),
          student({ number: 3, apart: 'X' }),
          student({ number: 4, apart: 'Y' }),
          student({ number: 5, apart: 'Y' }),
        ],
        mode: { kind: 'groupCount', count: 2 }, // 2 groups cannot hold X's clique of 3
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe(ERROR_CODES.keepApartImpossible);
    if (out.error.code !== ERROR_CODES.keepApartImpossible) return;
    expect(out.error.students.sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(out.error.groupsNeeded).toBe(3);
  });

  // Fix round 1, F-1: every test above uses only singleton blocks (no
  // `together`), so block index and student index coincide and this cannot
  // see a bug that named every MEMBER of every block rather than one
  // representative per block. Three together-pairs below, with the
  // apart-letter on only one student per pair, close that gap: students 2,
  // 4 and 6 carry no apart-letter at all -- they are only in the clique's
  // blocks because a together-letter binds them to 1, 3 and 5 -- so naming
  // them would assert that 1 and 2 (who must be kept TOGETHER) also need to
  // be kept apart from each other, and would leave `students.length` at 6
  // against a `groupsNeeded` of 3.
  it('names one student per block, not every member of a multi-student block', () => {
    const out = buildGroups(
      base({
        students: [
          // The letter-holder is declared SECOND in every pair, deliberately.
          // With the holder first, `blocks[b][0]` and "the member carrying the
          // letter" are the same student, so this test would pass just as well
          // against a certificate that always named the block's first member --
          // the same lie in a quieter form. Declared second, that regression
          // reports [2, 4, 6]: three children with no apart-rule at all.
          student({ number: 2, together: 'P' }),
          student({ number: 1, together: 'P', apart: 'X' }),
          student({ number: 4, together: 'Q' }),
          student({ number: 3, together: 'Q', apart: 'X' }),
          student({ number: 6, together: 'R' }),
          student({ number: 5, together: 'R', apart: 'X' }),
        ],
        mode: { kind: 'groupCount', count: 2 }, // 2 groups cannot hold X's clique of 3
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe(ERROR_CODES.keepApartImpossible);
    if (out.error.code !== ERROR_CODES.keepApartImpossible) return;
    // students.length reconciles with groupsNeeded -- unlike the pre-fix
    // certificate, which named all 6.
    expect(out.error.groupsNeeded).toBe(3);
    expect(out.error.students).toHaveLength(3);
    // Exactly the three actual letter-holders -- never their blockmates.
    expect(out.error.students.sort((a, b) => a - b)).toEqual([1, 3, 5]);
  });
});

// Correction 2: Task 4 left "both a together- and an apart-letter are live
// when the search fails" as a stated placeholder, falling through to the
// keep-apart codes. This task makes apart-letters real, so that fallthrough
// is reachable for the first time -- this proves it now resolves to the
// neutral BOTH_RULES code rather than either single-rule guess.
describe('apart and together letters both in play — the failure names both rules, guesses neither', () => {
  it('reports BOTH_RULES_NO_ARRANGEMENT, not a single-rule code, when both kinds of rule are live and the search proves impossibility', () => {
    // Same shape as "refuses no arrangement exists when three together-pairs
    // cannot all fit" above (3 blocks of 2 into 2 groups of 3 -- provably
    // impossible on the together constraint alone: each group of 3 can hold
    // only ONE block of 2, so at most 2 of the 3 blocks ever fit), with an
    // apart-letter added ACROSS two of those blocks so a real keep-apart
    // conflict is live too. The together clash alone already makes this
    // impossible, and adding a strictly tighter constraint cannot make an
    // impossible problem possible again, so this stays a PROVEN
    // impossibility -- just with both rules live at once.
    const out = buildGroups(
      base({
        students: [
          student({ number: 1, together: 'A', apart: 'X' }),
          student({ number: 2, together: 'A' }),
          student({ number: 3, together: 'B', apart: 'X' }),
          student({ number: 4, together: 'B' }),
          student({ number: 5, together: 'C' }),
          student({ number: 6, together: 'C' }),
        ],
        mode: { kind: 'perGroup', size: 3 },
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({
      code: ERROR_CODES.bothRulesNoArrangement,
      groupsTried: 2,
    });
  });

  it('reports BOTH_RULES_SEARCH_GAVE_UP, not a single-rule code, when both kinds of rule are live and the search merely gave up', () => {
    // The exact roster from "says it gave up, not that no arrangement
    // exists, once the search budget is exhausted" (together letters,
    // above): 15 buddy-pairs (30 students) into 10 groups, the reviewer's
    // own repro from Task 4, confirmed there to exhaust SEARCH_NODE_CAP in
    // BOTH passes because all 15 blocks are the SAME size (2), so pass 2's
    // first-fit-decreasing sort is a no-op and replays pass 1 exactly.
    //
    // One apart-letter is added here, across two students in DIFFERENT
    // pairs (student 1, pair A; student 17, pair I) -- a real cross-block
    // keep-apart conflict, live alongside the together-letters, and one
    // that does not touch any block's SIZE (apart never does), so the
    // same-size argument for why pass 2 cannot rescue this input still
    // applies unchanged. Confirmed empirically (see
    // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
    // "Both rules at once: attribution, and the gave-up/proven split"), not
    // assumed from that argument alone: this exact roster reproducibly
    // returns BOTH_RULES_SEARCH_GAVE_UP, deterministically, on repeated
    // runs.
    const pairs = Array.from({ length: 30 }, (_, i) =>
      student({
        number: i + 1,
        together: String.fromCharCode(65 + Math.floor(i / 2)), // A,A,B,B,...,O,O
        apart: i === 0 || i === 16 ? 'X' : null, // student 1 (pair A) vs student 17 (pair I)
      }),
    );
    const out = buildGroups(
      base({ students: pairs, mode: { kind: 'groupCount', count: 10 } }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({ code: ERROR_CODES.bothRulesSearchGaveUp });
  });
});

describe('together and apart at the same time', () => {
  it('refuses two students kept together who are also kept apart', () => {
    const out = buildGroups(
      base({
        students: [
          student({ number: 1, name: 'Ana', together: 'A', apart: 'X' }),
          student({ number: 2, name: 'Budi', together: 'A', apart: 'X' }),
          student({ number: 3, name: 'Citra' }),
          student({ number: 4, name: 'Dewi' }),
        ],
        mode: { kind: 'groupCount', count: 2 },
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({
      code: ERROR_CODES.togetherApartClash,
      students: [1, 2],
    });
  });

  it('allows the same apart letter on students who are NOT kept together', () => {
    const out = buildGroups(
      base({
        students: [
          student({ number: 1, together: 'A', apart: 'X' }),
          student({ number: 2, together: 'A' }),
          student({ number: 3, apart: 'X' }),
          student({ number: 4 }),
        ],
        mode: { kind: 'groupCount', count: 2 },
      }),
    );
    expect(out.ok).toBe(true); // 1 and 3 share X but are in different units
  });

  it('does not fire when one of the pair is absent', () => {
    // WHAT THIS PROVES, AND WHAT IT DOES NOT.
    //
    // It does NOT prove the clash check is absence-aware, because the check
    // has no absence-aware branch to test. Student 2 is removed by the
    // `present` filter long before `buildBlocks` runs, so the block this code
    // actually sees is student 1 alone -- mechanically the same block-of-one
    // the test above already covers. Mutate the clash guard and this reddens
    // through that single-occurrence path, not through anything to do with
    // `absent`.
    //
    // It DOES pin that absence is resolved upstream. Measured: drop the filter
    // (`const present = students`) and this fails cleanly with `expected false
    // to be true` -- the absent student rejoins the block, the contradiction is
    // detected, and a teacher is refused over a child who is not even in today.
    // That is the regression this guards, and it is why the test stays.
    //
    // Note for whoever mutates this next: passing the unfiltered roster to
    // `buildBlocks` instead is NOT a faithful mutant. Block indices are into
    // `present`, so it dies with a TypeError -- a crash, which any test would
    // catch, proving nothing about this one.
    const out = buildGroups(
      base({
        students: [
          student({ number: 1, together: 'A', apart: 'X' }),
          student({ number: 2, together: 'A', apart: 'X', absent: true }),
          student({ number: 3 }),
        ],
        mode: { kind: 'groupCount', count: 2 },
      }),
    );
    expect(out.ok).toBe(true);
  });
});

describe('sex mode: mix', () => {
  const M = (number: number) => student({ number, sex: 'M' });
  const F = (number: number) => student({ number, sex: 'F' });

  it('spreads boys and girls as evenly as the numbers allow', () => {
    const out = buildGroups(
      base({
        students: [M(1), M(2), M(3), M(4), F(5), F(6), F(7), F(8)],
        mode: { kind: 'groupCount', count: 4 },
        sexMode: 'mix',
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    for (const g of out.result.groups) {
      expect(g.filter((s) => s.sex === 'M')).toHaveLength(1);
      expect(g.filter((s) => s.sex === 'F')).toHaveLength(1);
    }
  });

  // Correction 5: the brief's own version of this test used five boys and
  // ONE girl into three groups, asserting only that exactly one group
  // contains a girl -- true with a single girl no matter what the code
  // does, mix logic included or not, so it could never fail. Replaced with
  // a shape where the weave has real work to do: four boys, two girls,
  // three groups of two. Under the weave (see `weaveBySex`), pass 1's order
  // is [boy, girl, boy, girl, boy, boy] -- the girls sit at positions 1 and
  // 3 -- and with no conflicts live, `assign` fills groups strictly in
  // order (group 0 takes positions 0-1, group 1 takes 2-3, group 2 takes
  // 4-5; see the "fixed ascending order" comment on `assign`), so the two
  // girls land in group 0 and group 1 -- never the same group -- for every
  // seed, because the weave's ALTERNATION (not which student fills which
  // slot) is what fixes each girl's position. Swept across seeds rather
  // than trusting one, matching this file's own standing objection to
  // single-seed proof elsewhere ("NOT A LUCKY SEED").
  //
  // Verified this fails without the weave: this exact assertion, run
  // against the engine as it stood immediately before this task touched
  // `placeBlocks` (sexMode read nowhere, order = plain `shuffled`, sex
  // ignored entirely), reddens with `bothTogether` = [8, 12, 28, 29, 30] --
  // 5 of these 30 seeds put both girls in the same group. Full output
  // recorded in
  // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
  // "The alternation defect, and the first spread check".
  it('spreads the girls across different groups even when the numbers do not divide evenly', () => {
    const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
    const bothTogether = seeds.filter((seed) => {
      const out = buildGroups(
        base({
          students: [M(1), M(2), M(3), M(4), F(5), F(6)],
          mode: { kind: 'groupCount', count: 3 },
          sexMode: 'mix',
          random: seeded(seed),
        }),
      );
      if (!out.ok) throw new Error(`expected success, got ${out.error.code}`);
      return out.result.groups.some(
        (g) => g.filter((s) => s.sex === 'F').length === 2,
      );
    });
    expect(searched(bothTogether, { of: seeds, what: 'seeds' })).toEqual([]);
    expect(
      floorBreach('grouping/girl-spread-seeds', seeds.length),
    ).toBeUndefined();
  });

  // Correction 2: the dedicated variety regression guard the together-letters
  // section above already has one of ("varies which students land together
  // across seeds"). Nothing else in this describe block would notice the
  // weave collapsing to a single arrangement, because every other assertion
  // here checks a STRUCTURAL property (how many boys/girls per group, which
  // groups a girl is in) that is permutation-invariant: an implementation
  // that always paired the SAME boy with the SAME girl would satisfy every
  // test above this one and still be exactly the Fix-round-1-style
  // regression Task 4 spent two fix rounds recovering from. Only the
  // PARTITION -- which student landed with which -- can see that collapse.
  //
  // Same roster as "spreads boys and girls as evenly as the numbers allow"
  // above, which the weave forces into exactly one boy and one girl per
  // group. What is NOT forced is WHICH boy pairs with WHICH girl: a perfect
  // matching between 4 boys and 4 girls, of which there are mathematically
  // exactly 4! = 24 (girl 1 can pair with any of 4 boys, girl 2 with any of
  // the remaining 3, and so on). Measured on this build: 24 distinct
  // partitions over 200 seeds -- every one of the 24 possible matchings was
  // seen at least once. Asserting > 10 leaves more than half of that
  // headroom, so an implementation that still varies, just not maximally,
  // does not turn this test flaky.
  it('varies which boy pairs with which girl across seeds, not just the 1-and-1 split', () => {
    const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
    const partitions = new Set(
      seeds.map((seed) => {
        const { groups } = ok(
          base({
            students: [M(1), M(2), M(3), M(4), F(5), F(6), F(7), F(8)],
            mode: { kind: 'groupCount', count: 4 },
            sexMode: 'mix',
            random: seeded(seed),
          }),
        );
        return groups
          .map((g) =>
            g
              .map((s) => s.number)
              .sort((a, b) => a - b)
              .join('.'),
          )
          .sort()
          .join(' | ');
      }),
    );
    expect(partitions.size).toBeGreaterThan(10);
  });

  // Same measurement, on the uneven roster ("spreads the girls across
  // different groups" above): four boys, two girls, three groups of two.
  // The weave forces the two girls into different groups (proven above) and
  // leaves the third group as the two leftover boys -- what varies is WHICH
  // two boys pair with the girls and WHICH specific girl lands with WHICH
  // specific boy: an injective function from 2 girls to 4 boys, of which
  // there are mathematically exactly 4 x 3 = 12. Measured on this build: 12
  // distinct partitions over 200 seeds -- the mathematical maximum, every
  // one seen. Asserting > 5 leaves more than half of that headroom.
  it('varies pairings on the uneven roster too, not just the evenly-divided one', () => {
    const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
    const partitions = new Set(
      seeds.map((seed) => {
        const { groups } = ok(
          base({
            students: [M(1), M(2), M(3), M(4), F(5), F(6)],
            mode: { kind: 'groupCount', count: 3 },
            sexMode: 'mix',
            random: seeded(seed),
          }),
        );
        return groups
          .map((g) =>
            g
              .map((s) => s.number)
              .sort((a, b) => a - b)
              .join('.'),
          )
          .sort()
          .join(' | ');
      }),
    );
    expect(partitions.size).toBeGreaterThan(5);
  });

  it('refuses when a student being grouped has no sex set', () => {
    const out = buildGroups(
      base({
        students: [M(1), F(2), student({ number: 3 })],
        mode: { kind: 'groupCount', count: 1 },
        sexMode: 'mix',
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({
      code: ERROR_CODES.sexNeedsAllSet,
      students: [3],
    });
  });

  it('does not count an absent student with no sex', () => {
    const out = buildGroups(
      base({
        students: [M(1), F(2), student({ number: 3, absent: true })],
        mode: { kind: 'groupCount', count: 1 },
        sexMode: 'mix',
      }),
    );
    expect(out.ok).toBe(true);
  });

  it('ignores sex entirely when the mode is off', () => {
    const out = buildGroups(
      base({
        students: [M(1), F(2), student({ number: 3 })],
        mode: { kind: 'groupCount', count: 1 },
        sexMode: 'off',
      }),
    );
    expect(out.ok).toBe(true);
  });

  // HISTORICAL TRIPWIRE, DELIBERATELY FLIPPED BY TASK 8A. Task 7 scoped the
  // unset-sex guard to `sexMode === 'mix'` rather than the brief's own
  // `!== 'off'`, because at the time `separate` did not read `sex` anywhere
  // in this file -- refusing a `separate` roster over a field that mode
  // never consulted would have been a pure regression, and this test
  // existed to prove that regression did NOT happen.
  //
  // Task 8a is the deliberate widening Task 7 always meant to hand off (see
  // `ERROR_CODES.sexNeedsAllSet`'s doc comment in grouping.ts): the guard
  // now covers `separate` too, ahead of Task 8b's placement work landing.
  // So the specific claim this test pinned -- that THIS EXACT input
  // succeeds under `separate` -- is now the wrong thing to guarantee. The
  // assertion is flipped in place rather than the test deleted: the
  // history of why `separate` was ever exempt is worth keeping on record,
  // reusing the same input, in the same spot, rather than vanishing
  // silently. The surviving half of the old guarantee -- that PLACEMENT
  // under `separate` is still untouched -- is pinned separately, in the
  // "sex mode: separate" describe block below, on a roster this guard does
  // not refuse.
  it('separate now refuses when a student being grouped has no sex set, same as mix', () => {
    const out = buildGroups(
      base({
        students: [M(1), F(2), student({ number: 3 })],
        mode: { kind: 'groupCount', count: 1 },
        sexMode: 'separate',
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({
      code: ERROR_CODES.sexNeedsAllSet,
      students: [3],
    });
  });

  // Correction 1: `sexOf` reads only the block's FIRST present-order member
  // -- it does not check that every member of a together-block agrees on
  // sex. So this boy-girl buddy pair does NOT fall into `rest` (that only
  // happens for a NULL first-member sex, and the guard below has already
  // ruled out every present student having a null sex by the time
  // `weaveBySex` runs -- `rest` is provably unreachable from `mix`; see
  // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
  // "mix: sexOf and what rest actually means"). It is silently classified
  // by whichever sex its first
  // member is. This is the same "one representative member speaks for the
  // whole block" shortcut `keepApartImpossible`'s naming already takes
  // (`blocks[b].find(...) ?? blocks[b][0]`), not a new one this task
  // invents.
  //
  // WHAT THIS PROVES, AND WHAT IT DOES NOT. It proves a mixed-sex
  // together-block does not trip the unset-sex guard (both members here
  // have a sex, just different ones) and does not break the together
  // constraint. It does NOT prove which bucket (`boys` or `girls`)
  // `weaveBySex` put the block in -- that is an implementation detail this
  // test deliberately does not pin, because the brief only commits to "the
  // only honest thing to do", not to a specific classification.
  //
  // NO MUTATION OF THE CLASSIFICATION LOGIC MAKES THIS TEST FAIL. Tried:
  // reading the block's LAST member instead of the first (`sexOf` keyed off
  // `blocks[b][blocks[b].length - 1]`) -- still ok:true, together still
  // holds, because this test does not assert which bucket either member's
  // sex put the block in. Only a change that CRASHES (a null-unsafe read)
  // or that BREAKS the together invariant would redden this -- both of
  // which every other test that calls buildGroups would also catch, so
  // this test earns its place as documentation of the edge case and a
  // guard against a specific plausible bug (a per-MEMBER classification
  // that double-adds a block into both `boys` and `girls`, corrupting
  // `order` with a duplicate block index), not as a pin on `sexOf`'s
  // specific choice of representative.
  it('places a together-block spanning both sexes without crashing or refusing it', () => {
    const out = buildGroups(
      base({
        students: [
          student({ number: 1, sex: 'M', together: 'A' }),
          student({ number: 2, sex: 'F', together: 'A' }),
          student({ number: 3, sex: 'M' }),
          student({ number: 4, sex: 'F' }),
        ],
        mode: { kind: 'groupCount', count: 2 },
        sexMode: 'mix',
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const host = groupOf(out.result.groups, 1);
    expect(host?.map((s) => s.number)).toContain(2); // the together-letter still binds
  });

  // Correction 4: deliberate ordering, not the brief's position kept by
  // default -- see
  // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
  // "Why it fires before mode and rule validation" for the full reasoning.
  // In short: this
  // guard is a caller-contract violation (stage 2 disables the mix switch
  // until every present student already has a sex, so a real teacher
  // cannot reach it), while an invalid group count and a together/apart
  // clash are things a teacher can genuinely type. It still fires FIRST, on
  // the same footing as duplicateNumber and noStudents earlier in
  // buildGroups: all three ask "is this roster's data usable" before
  // anything downstream spends effort validating the requested shape or
  // the rules' self-consistency.
  describe('the unset-sex guard fires before checks a teacher can actually trigger', () => {
    it('wins over an invalid group count', () => {
      const out = buildGroups(
        base({
          students: [M(1), student({ number: 2 })],
          mode: { kind: 'groupCount', count: 0 }, // also invalid, on its own
          sexMode: 'mix',
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error.code).toBe(ERROR_CODES.sexNeedsAllSet);
    });

    it('wins over a together/apart clash', () => {
      const out = buildGroups(
        base({
          students: [
            student({ number: 1, sex: 'M', together: 'A', apart: 'X' }),
            student({ number: 2, sex: 'F', together: 'A', apart: 'X' }), // also a clash, on its own
            student({ number: 3 }), // unset sex
          ],
          mode: { kind: 'groupCount', count: 2 },
          sexMode: 'mix',
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error.code).toBe(ERROR_CODES.sexNeedsAllSet);
    });
  });

  // Fix round 1, F-1: the shipped weave's alternation (`woven[i] = boys[i],
  // girls[i]`) exhausts the shorter list partway through and appends the
  // REMAINDER of the longer one as one contiguous run, which `assign`'s
  // ascending first-fit then seats as a single-sex group -- every seed, not
  // an unlucky one. Both tests above this point use a group size of 2 with
  // balanced sexes, where the alternation period equals the group size, so
  // the tail can never span a whole group -- structurally blind to this
  // bug. These two are not: group sizes 3 and 4, sexes 2-and-4 and 4-and-8.
  //
  // Measured directly against the pre-fix build (commit 1a6a23e, before this
  // fix round touched `weaveBySex`): this exact roster landed the ideal
  // {1M2F, 1M2F} -- the only split these numbers allow -- ZERO times in 200
  // seeds under `mix`, while `off` (no weave at all) landed it 107 times.
  // The feature made its own goal LESS likely than not shipping it. Full
  // reproduction across all five roster shapes the review named (this one
  // plus four more) is in
  // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
  // "The five-shape table".
  it('reaches the split the numbers allow, at a group size the alternation bug could not hide behind', () => {
    const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
    for (const seed of seeds) {
      const out = buildGroups(
        base({
          students: [M(1), M(2), F(3), F(4), F(5), F(6)],
          mode: { kind: 'groupCount', count: 2 },
          sexMode: 'mix',
          random: seeded(seed),
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const boysPerGroup = out.result.groups
        .map((g) => g.filter((s) => s.sex === 'M').length)
        .sort((a, b) => a - b);
      expect(boysPerGroup).toEqual([1, 1]);
    }
  });

  // The uneven-division counterpart, at a group size the old bug could also
  // hide behind (this one is 4, not 2): 4 boys cannot split evenly across 3
  // groups of 4, so the best achievable is two groups with 1 boy and one
  // with 2 -- sorted, [1, 1, 2] -- never a group with none.
  //
  // Measured against the pre-fix build: this roster landed boys-per-group
  // [0, 2, 2] -- a group with NO boy at all -- on all 200 of 200 seeds under
  // `mix`; [1, 1, 2] is what it lands on 200 of 200 seeds now. `off` reaches
  // [1, 1, 2] only 115 of 200 times. Full table in
  // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
  // "The five-shape table".
  it('reaches the best achievable split when boys do not divide evenly, at a group size the bug could also hide behind', () => {
    const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
    for (const seed of seeds) {
      const out = buildGroups(
        base({
          students: [
            M(1),
            M(2),
            M(3),
            M(4),
            F(5),
            F(6),
            F(7),
            F(8),
            F(9),
            F(10),
            F(11),
            F(12),
          ],
          mode: { kind: 'groupCount', count: 3 },
          sexMode: 'mix',
          random: seeded(seed),
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const boysPerGroup = out.result.groups
        .map((g) => g.filter((s) => s.sex === 'M').length)
        .sort((a, b) => a - b);
      expect(boysPerGroup).toEqual([1, 1, 2]);
    }
  });

  // Fix round 1, F-3: both variety tests earlier in this file use
  // singleton-block rosters. The regression that cost this project two fix
  // rounds (Task 4, "varies which students land together across seeds") was
  // specifically a together-block roster collapsing to a single arrangement
  // -- nothing above this point would notice that happening again under
  // `mix`.
  //
  // Three boy-pairs and six girl-pairs (18 students, 9 blocks) into 3 groups
  // of 6: the ratio merge weaves 1 boy-block for every 2 girl-blocks (nb=3,
  // ng=6 divides evenly), so every group lands 2M4F, deterministically --
  // confirmed on this exact roster, all 200 seeds below, matching Fix round
  // 1's own point about a correct SHAPE. What varies is WHICH boy-pair and
  // WHICH two girl-pairs share a group: assigning 6 girl-blocks into 3
  // designated pairs (one per boy-block) is a multinomial count, 6! / (2! 2!
  // 2!) = 90 distinct partitions, the theoretical maximum. Measured on this
  // build: 78 distinct partitions over these 200 seeds. Asserting > 30
  // leaves well over half of that measured headroom, matching this file's
  // own convention elsewhere.
  //
  // PROVEN BY MUTATION, not by a pre-fix comparison: this roster's
  // boys-per-group shape is ALSO wrong before this fix round (that is Fix
  // round 1's own point, pinned by the two tests above), but the pre-fix
  // weave still produces plenty of distinct partitions on it -- 127 of 200,
  // even more than the fixed build's 78 -- because raw partition count and a
  // correct sex balance are different claims. A "reddens pre-fix" comparison
  // on partition count alone would not have caught a collapse here, so it
  // would not prove this test guards one.
  //
  // What DOES collapse it: weaving in fixed block-index order instead of the
  // shuffled order --
  //   weaveBySex(blocks, present, shuffledOrder.slice().sort((a, b) => a - b))
  // in place of `weaveBySex(blocks, present, shuffledOrder)` at the
  // `weaveBySex` call site in `placeBlocks` -- applied and run against
  // exactly this test: 1 distinct partition over these 200 seeds, not 78 (a
  // wrong-answer failure, not a crash). The shape stayed correct (2M4F every
  // group, every seed) because the shape comes from the ratio merge's
  // counting, not from the shuffle -- only WHO fills each slot collapsed,
  // which is exactly what this test exists to catch. Mutant reverted before
  // committing; see
  // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
  // "Together-block shapes, and mutation evidence" for this run recorded
  // alongside the others.
  it('varies which buddy-pairs share a group across seeds, under mix', () => {
    const students: Student[] = [
      ...['A', 'B', 'C'].flatMap((letter, gi) =>
        Array.from({ length: 2 }, (_, k) =>
          student({ number: gi * 2 + k + 1, sex: 'M', together: letter }),
        ),
      ),
      ...['D', 'E', 'F', 'G', 'H', 'I'].flatMap((letter, gi) =>
        Array.from({ length: 2 }, (_, k) =>
          student({ number: 6 + gi * 2 + k + 1, sex: 'F', together: letter }),
        ),
      ),
    ];
    const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
    const partitions = new Set(
      seeds.map((seed) => {
        const { groups } = ok(
          base({
            students,
            mode: { kind: 'groupCount', count: 3 },
            sexMode: 'mix',
            random: seeded(seed),
          }),
        );
        return groups
          .map((g) =>
            g
              .map((s) => s.number)
              .sort((a, b) => a - b)
              .join('.'),
          )
          .sort()
          .join(' | ');
      }),
    );
    expect(partitions.size).toBeGreaterThan(30);
  });

  // Fix round 1, F-2: `boys`/`girls`/`rest` were three FILTERS, not a
  // partition. `rest` only ever caught `sex === null`, so anything else off
  // the `'M' | 'F' | null` domain -- `undefined`, `''`, `'m'`, `'male'`, `0`,
  // anything a non-TypeScript caller might send; this repo has no runtime
  // type checker (see the module doc) -- fell into NONE of the three lists
  // and never reached `order`. `assign` only ever places what `order` hands
  // it, so that student was placed nowhere and simply did not appear in the
  // result: `ok: true`, one student short, no error to explain why.
  describe('a sex value outside M/F/null (Fix round 1, F-2)', () => {
    // This is the same "nobody lost, nobody invented" invariant the
    // "invariants that must hold for ANY input" describe block pins at the
    // buildGroups level, earlier in this file. Pointing that exact sweep at
    // this bug is not possible: it drives bare student COUNTS, where every
    // student's `sex` is `null` by construction (see the `anonymous` factory
    // in grouping.ts), and the guard below now refuses `null` under `mix`
    // same as any other off-domain value -- there is no roster shape that
    // sweep can express which would even reach `weaveBySex`. This pins the
    // same invariant directly on `weaveBySex`, which is where the loss
    // actually happened, using the identical assertion idiom.
    it('weaveBySex never drops a block, whatever `sex` holds', () => {
      const badSexes: unknown[] = [
        'M',
        'F',
        null,
        undefined,
        '',
        'm',
        'male',
        0,
      ];
      const present: Student[] = badSexes.map((sex, i) =>
        student({ number: i + 1, sex: sex as Student['sex'] }),
      );
      const blocks = present.map((_, i) => [i]);
      const indices = present.map((_, i) => i);

      const woven = grouping.weaveBySex(blocks, present, indices);

      expect(woven).toHaveLength(indices.length); // nobody lost or invented
      expect(new Set(woven).size).toBe(indices.length); // nobody duplicated
      expect([...woven].sort((a, b) => a - b)).toEqual(indices); // exactly this set
    });

    // Measured against the pre-fix build: `sex: undefined` on one student in
    // a 6-student roster returned `ok: true` with FIVE students -- student 3
    // simply gone, no error, a teacher would have printed that roster.
    // `''`, `'m'`, `'male'` and `0` all slipped past the OLD guard
    // (`s.sex === null`) the same way, for the same reason: none of them
    // `=== null`. Full output in
    // docs/superpowers/notes/2026-08-06-classroom-groups-v2-engine-measurements.md,
    // "What slipped through before the fix".
    it.each([
      ['undefined', undefined],
      ['an empty string', ''],
      ["'m'", 'm'],
      ["'male'", 'male'],
      ['0', 0],
    ])('refuses a sex of %s, not just literal null', (_label, badSex) => {
      const out = buildGroups(
        base({
          students: [
            M(1),
            F(2),
            student({ number: 3, sex: badSex as unknown as Student['sex'] }),
          ],
          mode: { kind: 'groupCount', count: 1 },
          sexMode: 'mix',
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.sexNeedsAllSet,
        students: [3],
      });
    });
  });
});

// Task 8a: the warnings channel. GroupingOutcome's success arm gains
// `warnings`, alongside `groups`. Task 8a itself never emitted one --
// WARNING_CODES.sexSpillover was defined but unreachable through
// buildGroups until Task 8b's separate-mode placement (below) landed. This
// specific roster (2 boys, 2 girls, 2 groups) still carries an empty list
// under every sexMode even after Task 8b: it divides evenly, so `separate`
// has nobody to spill. A roster that DOES spill is covered in "sex mode:
// separate" below, where `warnings` is no longer always `[]`.
describe('the warnings channel', () => {
  it.each(['off', 'mix', 'separate'] as const)(
    'every current success carries an empty warnings list (sexMode: %s)',
    (sexMode) => {
      const M = (number: number) => student({ number, sex: 'M' });
      const F = (number: number) => student({ number, sex: 'F' });
      const out = buildGroups(
        base({
          students: [M(1), M(2), F(3), F(4)],
          mode: { kind: 'groupCount', count: 2 },
          sexMode,
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      // The exact shape, not just an empty array wherever a caller happened
      // to look -- a stray extra key on `result` is not something the type
      // check promises to catch (excess keys are flagged only on some object
      // literals), so it is checked here.
      expect(Object.keys(out.result).sort()).toEqual(['groups', 'warnings']);
      expect(out.result.warnings).toEqual([]);
    },
  );
});

// Task 8a widened the unset-sex guard to cover `separate` (see the flipped
// tripwire in "sex mode: mix", 'separate now refuses when a student being
// grouped has no sex set, same as mix') and built the warnings channel
// ahead of time. Task 8b (this block) is the placement work itself:
// `sexSeparateSplitsUnit`, splitting each sex's blocks and running the
// existing machinery once per side, the proportional group-count
// allocation under `groupCount`, the spill, and the warning it emits.
//
// `separate` no longer places "exactly like off" -- that was Task 8a's
// deliberate placeholder (see its own now-superseded test, replaced here),
// not a guarantee this task keeps. The byte-identical guarantee that DOES
// still hold -- `off` and `mix` are unaffected by any of this -- is
// verified separately; see the report for the method and case count (a
// one-off before/after diff, not a permanent test here, because a test
// cannot diff itself against "the code before this commit").
describe('sex mode: separate', () => {
  const M = (number: number) => student({ number, sex: 'M' });
  const F = (number: number) => student({ number, sex: 'F' });

  describe('a together-unit spanning both sexes is a contradiction under separate', () => {
    // Ana and Budi are bound together (letter A) but marked different
    // sexes -- single-sex groups and "these two are one unit" cannot both
    // be honoured, so this is refused before placement runs, not resolved
    // by picking a side silently.
    it('refuses a together-unit that spans both sexes', () => {
      const out = buildGroups(
        base({
          students: [
            student({ number: 1, name: 'Ana', sex: 'F', together: 'A' }),
            student({ number: 2, name: 'Budi', sex: 'M', together: 'A' }),
            M(3),
            F(4),
          ],
          mode: { kind: 'groupCount', count: 2 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.sexSeparateSplitsUnit,
        students: [1, 2],
      });
    });

    // The same roster is fine under the OTHER two modes: `mix` places boys
    // and girls together on purpose, and `off` does not look at sex at
    // all, so a together-block spanning both sexes is not a contradiction
    // for either. This proves the new check is scoped to `separate`, not
    // leaking into the other two -- it does not go red before
    // implementation (neither mode is touched by this task), so it is a
    // scoping guard against a future regression, not a feature pin.
    it('allows that same mixed unit under mix, and under off', () => {
      for (const sexMode of ['mix', 'off'] as const) {
        const out = buildGroups(
          base({
            students: [
              student({ number: 1, sex: 'F', together: 'A' }),
              student({ number: 2, sex: 'M', together: 'A' }),
              M(3),
              F(4),
            ],
            mode: { kind: 'groupCount', count: 2 },
            sexMode,
          }),
        );
        expect(out.ok, `sexMode ${sexMode}`).toBe(true);
      }
    });
  });

  describe('perGroup: each sex forms its own groups of the requested size', () => {
    it('makes single-sex groups when the numbers divide', () => {
      const out = buildGroups(
        base({
          students: [M(1), M(2), M(3), M(4), F(5), F(6), F(7), F(8)],
          mode: { kind: 'perGroup', size: 4 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      for (const g of out.result.groups) {
        expect(new Set(g.map((s) => s.sex)).size).toBe(1);
      }
      expect(out.result.warnings).toEqual([]);
    });

    // Six boys and two girls into groups of 4: the boys make one group and
    // the girls cannot make one of their own, so the two girls join the
    // boys' single group and are named in a warning. Also pins the
    // resulting shape (one group of all eight), not just the warning --
    // the brief's own append-style description ("join the smallest
    // resulting group") reduces to "the only group" when the host side has
    // just one.
    it('warns and names who lands in a group of the other sex', () => {
      const out = buildGroups(
        base({
          students: [M(1), M(2), M(3), M(4), M(5), M(6), F(7), F(8)],
          mode: { kind: 'perGroup', size: 4 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.groups).toHaveLength(1);
      expect(
        out.result.groups[0].map((s) => s.number).sort((a, b) => a - b),
      ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(out.result.warnings).toEqual([
        { code: WARNING_CODES.sexSpillover, students: [7, 8], sex: 'F' },
      ]);
    });

    // An all-boys roster: girls simply have no members, which is not a
    // spill (nobody was left out of a group of their own -- there is no
    // "their own" to compare against). Regression guard for the fix noted
    // in the report: a side with a genuine allocation of zero groups
    // because it has zero MEMBERS must not be confused with a side that
    // has members but too few of them.
    //
    // Fix round 1, F-3: recorded here, not just in the report, that this
    // does NOT go red before implementation -- `off` already produces this
    // exact shape for an all-one-sex roster (no sex-based branch in
    // `buildSeparateGroups` has anything to DO when the other sex has zero
    // members: every warning gate in that function is conditioned on both
    // sexes having members), so this test was an early pass, not a proof
    // the feature works. It is kept as the regression guard the comment
    // above describes.
    it('a roster that is entirely one sex places with no warning', () => {
      const out = buildGroups(
        base({
          students: [M(1), M(2), M(3), M(4)],
          mode: { kind: 'perGroup', size: 2 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.groups).toHaveLength(2);
      expect(out.result.warnings).toEqual([]);
    });
  });

  describe('groupCount: the requested total is allocated between the sexes proportionally by headcount', () => {
    // The task's own worked example: 12 boys and 8 girls asked for 4
    // groups. Single-sex groups sized independently per side (12/5 and 8/5)
    // would want 3 boy-groups and 2 girl-groups -- five, not four. The
    // teacher typed 4, so 4 is what they get: largest-remainder allocation
    // by headcount gives boys 2.4 -> 2 and girls 1.6 -> 2 (girls' larger
    // fractional remainder claims the rounding unit), summing to exactly
    // 4. Every group single-sex, nobody spills.
    it('splits 2-and-2 by headcount share, not 3-and-2 by an independently sized per-sex group count', () => {
      const students = [
        ...Array.from({ length: 12 }, (_, i) => M(i + 1)),
        ...Array.from({ length: 8 }, (_, i) => F(i + 13)),
      ];
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'groupCount', count: 4 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.warnings).toEqual([]);
      expect(shape(out.result.groups)).toEqual([6, 6, 4, 4]);
      for (const g of out.result.groups) {
        expect(new Set(g.map((s) => s.sex)).size).toBe(1);
      }
    });

    // The allocation must sum to exactly what was typed, on every split --
    // not just the one worked example above. This is the property largest-
    // remainder exists to guarantee (plain rounding of each side
    // independently can under- or over-shoot the total). It does NOT go
    // red before implementation: today's `separate` (== `off`) also always
    // returns exactly `mode.count` groups, because `off` never splits by
    // sex in the first place, so the group COUNT this asserts is trivially
    // right for a reason that has nothing to do with sex. It is kept
    // anyway because it is the most direct check of the "sums exactly"
    // claim, and it is the guarantee the report cites; "splits 2-and-2..."
    // above and the spill test below are what actually distinguish this
    // implementation from the old placeholder.
    it('the allocated group counts always sum to exactly the number requested, swept across many splits', () => {
      const combos: Array<[boys: number, girls: number, count: number]> = [
        [12, 8, 4],
        [1, 99, 50],
        [1, 99, 1],
        [33, 17, 10],
        [5, 5, 3],
        [1, 1, 1],
        [7, 93, 25],
        [50, 50, 20],
        [3, 97, 40],
        [19, 81, 33],
      ];
      for (const [boys, girls, count] of combos) {
        const students = [
          ...Array.from({ length: boys }, (_, i) => M(i + 1)),
          ...Array.from({ length: girls }, (_, i) => F(i + 1 + boys)),
        ];
        const label = `boys=${boys} girls=${girls} count=${count}`;
        const out = buildGroups(
          base({
            students,
            mode: { kind: 'groupCount', count },
            sexMode: 'separate',
            random: seeded(1),
          }),
        );
        expect(out.ok, label).toBe(true);
        if (!out.ok) continue;
        expect(out.result.groups.length, label).toBe(count);
      }
    });

    // A concrete spill under `groupCount`, not just `perGroup`: 28 boys and
    // 2 girls asked for 5 groups. Girls' proportional share (5 * 2/30 =
    // 0.33) floors to zero, so they spill into the boys' 5 groups -- the
    // SAME rule as the perGroup spill above, just reached via the
    // allocation instead of a direct size comparison (see the report for
    // why one rule serves both).
    it('spills the smaller sex when its proportional share floors to zero groups', () => {
      const students = [
        ...Array.from({ length: 28 }, (_, i) => M(i + 1)),
        F(29),
        F(30),
      ];
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'groupCount', count: 5 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.groups).toHaveLength(5);
      expect(out.result.warnings).toEqual([
        { code: WARNING_CODES.sexSpillover, students: [29, 30], sex: 'F' },
      ]);
    });

    // A together-unit sized for its OWN side's largest group, but bigger
    // than the WHOLE ROSTER's -- proves togetherUnitTooLarge is checked
    // per side under `separate`, not against the whole-roster `sizes` the
    // way `off`/`mix` use. 33 boys and 17 girls asked for 10 groups: raw
    // shares are 6.6 and 3.4, both floors (6 and 3) sum to 9, leaving one
    // group to allocate; boys' fractional remainder (0.6) is the larger of
    // the two, and the one leftover group goes to whichever fraction is
    // LARGER, so boys claims it -- 7-and-3, not 6-and-4. Girls' own sizing
    // at count 3 (targetSizes(17, {count:3}, 'spread')) is [6, 6, 5] -- a
    // largest group of 6 -- while the whole roster's sizing at count 10
    // (targetSizes(50, {count:10})) is ten groups of 5, largest 5. A
    // together-block of exactly 6 girls fits the former and would be
    // wrongly refused by the latter.
    //
    // Fix round 1, F-3: recorded here, not just in the report, that this
    // test never went through a RED phase at all -- it was added AFTER
    // implementation, once reasoning through "each side's own sizes can
    // diverge from the whole roster's" surfaced the gap the comment above
    // describes. It is proven by mutation instead: removing the
    // `sexMode !== 'separate'` guard on the pre-existing whole-roster
    // `togetherUnitTooLarge` check reddens this test (the 6-girl unit gets
    // wrongly refused against the whole roster's largest group of 5), with
    // a genuine wrong-value failure, never a crash.
    it("checks a together-unit against its OWN side's largest group, not the whole roster's", () => {
      const students = [
        ...Array.from({ length: 33 }, (_, i) => M(i + 1)),
        student({ number: 34, sex: 'F' as const, together: 'Z' }),
        student({ number: 35, sex: 'F' as const, together: 'Z' }),
        student({ number: 36, sex: 'F' as const, together: 'Z' }),
        student({ number: 37, sex: 'F' as const, together: 'Z' }),
        student({ number: 38, sex: 'F' as const, together: 'Z' }),
        student({ number: 39, sex: 'F' as const, together: 'Z' }),
        ...Array.from({ length: 11 }, (_, i) => F(i + 40)),
      ];
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'groupCount', count: 10 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const host = groupOf(out.result.groups, 34);
      for (const n of [35, 36, 37, 38, 39]) {
        expect(host?.some((s) => s.number === n)).toBe(true);
      }
    });

    // Fix round 1, F-1. The reviewer's own counter-example to a single
    // proportional guess, and the case that motivated turning
    // `allocateSexGroups` into a search: 12 boys, 8 girls (5 of them bound
    // together), 4 groups requested. Proportional gives 2-and-2; 8 girls
    // over 2 groups is sizes [4, 4], and the 5-strong unit does not fit
    // either -- the OLD code refused here (confirmed against the pre-fix
    // engine as part of the report's before/after verification). 3-and-1
    // -- boys claim 3 groups of 4, girls get ONE group of all 8, which
    // holds the unit easily -- satisfies every rule the teacher stated,
    // and `allocationCandidates` finds it at distance 1 from proportional.
    // Proven by mutation, not just this test passing: see the report.
    it('finds 3-and-1 when proportional 2-and-2 would refuse a together-unit, instead of refusing (Fix round 1, F-1)', () => {
      const students = [
        ...Array.from({ length: 12 }, (_, i) => M(i + 1)),
        ...Array.from({ length: 5 }, (_, i) =>
          student({ number: i + 13, sex: 'F', together: 'Z' }),
        ),
        F(18),
        F(19),
        F(20),
      ];
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'groupCount', count: 4 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.warnings).toEqual([]);
      expect(shape(out.result.groups)).toEqual([8, 4, 4, 4]);
      const girlUnit = groupOf(out.result.groups, 13);
      for (const n of [13, 14, 15, 16, 17]) {
        expect(girlUnit?.some((s) => s.number === n)).toBe(true);
      }
      for (const g of out.result.groups) {
        expect(new Set(g.map((s) => s.sex)).size).toBe(1);
      }
    });
  });

  // Fix round 1, F-2. Every candidate `allocationCandidates` offers fails:
  // six boys who must all be kept apart from each other need six groups,
  // and no split of 3 requested groups between the sexes ever gives boys
  // more than 2 (see `allocationCandidates`'s own headcount bound). This
  // is the genuinely impossible remainder F-1's search does not rescue --
  // and it must not lie about why, the way a side-scoped
  // `keepApartImpossible` ("you need at least 6 groups") would once
  // several different splits have already been tried and rejected: the
  // teacher typed 3, not 6, and no single split is "the" reason every one
  // of them failed.
  describe('when every allocation fails: reports sexSeparateImpossible, not a side-scoped number (Fix round 1, F-2)', () => {
    const sixBoysMutuallyApart = [
      student({ number: 1, sex: 'M' as const, apart: 'X' }),
      student({ number: 2, sex: 'M' as const, apart: 'X' }),
      student({ number: 3, sex: 'M' as const, apart: 'X' }),
      student({ number: 4, sex: 'M' as const, apart: 'X' }),
      student({ number: 5, sex: 'M' as const, apart: 'X' }),
      student({ number: 6, sex: 'M' as const, apart: 'X' }),
      F(7),
      F(8),
      F(9),
      F(10),
      F(11),
      F(12),
    ];

    it("reports the number the teacher typed, not any side's own allocation", () => {
      const out = buildGroups(
        base({
          students: sixBoysMutuallyApart,
          mode: { kind: 'groupCount', count: 3 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.sexSeparateImpossible,
        groupsRequested: 3,
      });
    });

    // The assertion is on the SENTENCE, not the code -- a wrong number
    // reaching a teacher is exactly what this finding is about.
    it('renders the exact sentence naming the typed count and both remedies, in both languages', () => {
      const out = buildGroups(
        base({
          students: sixBoysMutuallyApart,
          mode: { kind: 'groupCount', count: 3 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(renderError(out.error, en)).toBe(
        'Boys and girls cannot be kept in separate groups across 3 groups while also satisfying your other rules. The search cannot tell which rule is the problem, so try either remedy: ask for a different number of groups, or turn this mode off.',
      );
      expect(renderError(out.error, id)).toBe(
        'Laki-laki dan perempuan tidak bisa tetap berada di kelompok terpisah dalam 3 kelompok sekaligus memenuhi aturan Anda yang lain. Pencarian ini tidak bisa memastikan aturan mana yang jadi masalah, jadi coba salah satu perbaikan ini: minta jumlah kelompok yang berbeda, atau matikan mode ini.',
      );
    });
  });

  // Fix round 2. This finding was raised, not decided unilaterally, in Fix
  // round 1's own report: `sexSeparateImpossible` fired whenever every
  // candidate had failed, without checking whether every failure was a
  // PROOF rather than the search merely giving up. Measured directly (see
  // task-8b-report.md, "Fix round 2"): re-running the reviewer's own
  // 1121-input sweep against the pre-this-fix engine found exactly 37
  // inputs reporting `sexSeparateImpossible`, and EVERY ONE of them had at
  // least one candidate whose own search hit SEARCH_NODE_CAP -- never a
  // case where all candidates were genuinely exhausted. This roster is the
  // smallest of those 37, kept exactly as the sweep generated it (8 boys,
  // 15 girls, 5 of the girls mutually apart, 6 groups requested) so this
  // test is grounded in a real measured input, not a hand-picked shape.
  //
  // Confirmed by temporary instrumentation on this exact input (reverted
  // before commit, not left in the source): five candidates are tried
  // (boys 2/1/3/4/5, girls 4/5/3/2/1). Four fail INSTANTLY on the fast
  // clique check (KEEP_APART_IMPOSSIBLE -- the girls' 5-clique does not fit
  // 4, 3, 2 or 1 groups, no search involved). Exactly one, boys=1/girls=5,
  // sits at the clique-equals-group-count boundary (5 <= 5) where the fast
  // gate does not fire, so the real backtracking search runs -- and at
  // `base()`'s default seed it hits SEARCH_NODE_CAP and gives up
  // (KEEP_APART_SEARCH_GAVE_UP). Four proofs and one gave-up: the fix must
  // report the gave-up, not let the four proofs outvote it -- exactly the
  // "prefer the weaker claim" rule in `buildSeparateGroups`'s own comment.
  // At other seeds (2 through 5, checked directly) that same boys=1/girls=5
  // candidate SUCCEEDS instead, which is why this test does not pass a
  // `random` override: it relies on `base()`'s own default seed, exactly
  // like this file's other SEARCH_GAVE_UP tests do (see "says it gave up,
  // not that no arrangement exists" above).
  describe('when at least one allocation candidate gives up rather than proving impossibility: reports sexSeparateSearchGaveUp, not the proof code (Fix round 2)', () => {
    const eightBoysFifteenGirlsFiveApart = [
      ...Array.from({ length: 8 }, (_, i) => M(i + 1)),
      ...Array.from({ length: 5 }, (_, i) =>
        student({ number: i + 9, sex: 'F' as const, apart: 'X' }),
      ),
      F(14),
      F(15),
      F(16),
      F(17),
      F(18),
      F(19),
      F(20),
      F(21),
      F(22),
      F(23),
    ];

    it('reports the gave-up code, not sexSeparateImpossible, when the search never fully explored every candidate', () => {
      const out = buildGroups(
        base({
          students: eightBoysFifteenGirlsFiveApart,
          mode: { kind: 'groupCount', count: 6 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({ code: ERROR_CODES.sexSeparateSearchGaveUp });
    });

    // The assertion is on the SENTENCE, not the code -- same reasoning as
    // sexSeparateImpossible's own rendered test above: a wrong CLAIM
    // reaching a teacher (a proof, when nothing was proven) is the whole
    // point of this finding, and a code-only check cannot see that.
    it('renders the exact sentence claiming nothing about possibility, offering fewer letters or the mode switch, in both languages', () => {
      const out = buildGroups(
        base({
          students: eightBoysFifteenGirlsFiveApart,
          mode: { kind: 'groupCount', count: 6 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(renderError(out.error, en)).toBe(
        'There are too many together- and apart-letters here to work through while also keeping boys and girls in separate groups. Try using fewer letters, or turn this mode off.',
      );
      expect(renderError(out.error, id)).toBe(
        'Huruf yang harus disatukan dan aturan pemisahan di sini terlalu banyak untuk dihitung sekaligus, sambil juga menjaga laki-laki dan perempuan di kelompok terpisah. Coba gunakan lebih sedikit huruf, atau matikan mode ini.',
      );
    });
  });

  // Reachable only under `perGroup` -- see the report for the proof that
  // largest-remainder allocation under `groupCount` can never give BOTH
  // sides zero groups while both have members (the single leftover group
  // always has somewhere to go). Under `perGroup`, a size bigger than
  // BOTH sexes' own headcount gives both a floored group count of zero.
  describe('when neither sex has enough for even one group of its own (perGroup only)', () => {
    // Whole-branch review, I-2. Before this fix, this test pinned TWO
    // `sexSpillover` warning objects -- one claiming the boys "joined a
    // group of girls", the other claiming the girls "joined a group of
    // boys" -- about the SAME single merged group, and never rendered
    // either one, so the suite could not see that the two sentences
    // contradict each other. Now a single `sexBothTooSmall` warning naming
    // everyone, rendered in both languages, which is what makes the
    // contradiction visible if it ever comes back.
    it('falls back to one combined group and warns ONCE, honestly, about both sexes (Fix, I-2)', () => {
      const students = [
        M(1),
        M(2),
        M(3),
        M(4),
        M(5),
        M(6),
        F(7),
        F(8),
        F(9),
        F(10),
        F(11),
        F(12),
      ];
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'perGroup', size: 10 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.groups).toHaveLength(1);
      expect(
        out.result.groups[0].map((s) => s.number).sort((a, b) => a - b),
      ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      // ONE warning, not two -- and it names everyone, boys then girls
      // (`[...boysIdx, ...girlsIdx]` at the construction site).
      expect(out.result.warnings).toEqual([
        {
          code: WARNING_CODES.sexBothTooSmall,
          students: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        },
      ]);
      // Rendered, not just structural -- a structurally-correct warning
      // object with two contradictory sentences behind it is exactly what
      // escaped review before this fix (renderWarning was never called on
      // this fixture at all). One sentence now, in both languages, naming
      // the whole roster via the default numbered resolver.
      const names = Array.from({ length: 12 }, (_, i) =>
        en.studentNumber({ n: i + 1 }),
      );
      expect(renderWarning(out.result.warnings[0], en)).toBe(
        'Student 1, Student 2, Student 3, Student 4, Student 5, Student 6, Student 7, Student 8, Student 9, Student 10, Student 11 and Student 12 were placed in one combined group because there were not enough of either sex to make a group of their own. That is simply how the numbers divided, not a mistake to fix.',
      );
      expect(renderWarning(out.result.warnings[0], en)).toBe(
        en.warnings.SEX_BOTH_TOO_SMALL({ names }),
      );
      const idNames = Array.from({ length: 12 }, (_, i) =>
        id.studentNumber({ n: i + 1 }),
      );
      expect(renderWarning(out.result.warnings[0], id)).toBe(
        'Siswa 1, Siswa 2, Siswa 3, Siswa 4, Siswa 5, Siswa 6, Siswa 7, Siswa 8, Siswa 9, Siswa 10, Siswa 11, dan Siswa 12 digabungkan menjadi satu kelompok karena jumlah laki-laki maupun perempuan tidak cukup untuk membentuk kelompok sendiri-sendiri. Ini murni soal angka, bukan kesalahan yang perlu diperbaiki.',
      );
      expect(renderWarning(out.result.warnings[0], id)).toBe(
        id.warnings.SEX_BOTH_TOO_SMALL({ names: idNames }),
      );
    });

    // The neighbouring case that must NOT be confused with the one above:
    // one sex is entirely absent, and the other is too small for the
    // requested size. Both sides still compute an allocation of zero
    // groups (the same condition that triggers the fallback above), but
    // there is no OTHER sex for anyone to have "spilled" into -- this is
    // just an undersized single-sex group, exactly what `off` would do
    // with the same roster. No warning: nobody's outcome changed because
    // of their sex. Does not go red before implementation -- old
    // `separate` (== `off`) already produces this exact shape, since
    // there is only one possible group either way; it pins the fix
    // described in the report (a naive "both allocations are zero" check,
    // without also requiring both sexes to have members, would have
    // wrongly warned a same-sex roster about a sex that is not there).
    it('a lone sex too small for the requested size places with no warning -- there is no other sex to have joined', () => {
      const out = buildGroups(
        base({
          students: [M(1), M(2), M(3)],
          mode: { kind: 'perGroup', size: 10 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.groups).toHaveLength(1);
      expect(
        out.result.groups[0].map((s) => s.number).sort((a, b) => a - b),
      ).toEqual([1, 2, 3]);
      expect(out.result.warnings).toEqual([]);
    });
  });

  // The apart-rule hole the brief leaves silent: placing each sex
  // independently makes a cross-sex apart-conflict satisfied for free,
  // EXCEPT for a spilled student, who joins the other sex's placement and
  // can be seated next to someone they must be kept apart from if that
  // conflict is not carried into the spill. See the report for the full
  // reasoning; these two tests are the evidence it holds.
  describe('the apart-rule at the spill boundary', () => {
    // Twelve boys (three groups of four) and two girls who must spill.
    // Multiple destination groups exist, so there is a real choice of
    // where the spill lands, not just one forced slot -- M1 and F13 are
    // marked apart, and across every seed the search must route around
    // that, never seat them together by chance.
    //
    // Does not go red before implementation FOR A SUBTLE REASON worth
    // recording: old `separate` (== `off`) already enforces apart-letters
    // for the whole roster, sex-blind, so M1 and F13 were never seated
    // together under the old code either -- just via a completely
    // different mechanism (one placement pass over everyone) than the one
    // this task builds (independent per-side placement, with the conflict
    // carried across at the spill). Mutation evidence in the report proves
    // THIS implementation's own carrying-across is what this test is
    // actually pinned on, not a coincidence inherited from the old code.
    it('never seats a spilled student beside someone they must be kept apart from, swept across seeds', () => {
      const students = [
        student({ number: 1, sex: 'M', apart: 'X' }),
        ...Array.from({ length: 11 }, (_, i) => M(i + 2)), // M2..M12
        student({ number: 13, sex: 'F', apart: 'X' }),
        F(14),
      ];
      for (let seed = 1; seed <= 30; seed++) {
        const out = buildGroups(
          base({
            students,
            mode: { kind: 'perGroup', size: 4 },
            sexMode: 'separate',
            random: seeded(seed),
          }),
        );
        expect(out.ok, `seed ${seed}`).toBe(true);
        if (!out.ok) continue;
        const g1 = groupOf(out.result.groups, 1);
        expect(g1, `seed ${seed}`).not.toBeUndefined();
        expect(
          g1?.some((s) => s.number === 13),
          `seed ${seed}`,
        ).toBe(false);
      }
    });

    // Four boys fill the one group their own size allows exactly (size 4,
    // 4 boys); one girl must spill, and that group is the ONLY group there
    // is -- so however she is routed, she lands beside every boy, and one
    // of them (M1) is exactly who she must be kept apart from. No
    // arrangement can honour the rule, so it must be REPORTED, not
    // silently ignored: reuses the same keepApartImpossible vocabulary
    // `off`/`mix` already use for "an exhaustive check proved this
    // impossible", now reached from the per-side search instead of the
    // whole-roster one.
    //
    // Also does not go red before implementation, for the same reason as
    // the sibling case immediately above: with only one group possible
    // either way, old `separate` (== `off`) already refuses this input via
    // its own whole-roster clique check. Mutation evidence in the report
    // shows this test's OWN per-side clique check firing, not a
    // hand-me-down from `off`'s.
    it('reports, not silently ignores, when the apart-rule cannot be honoured even after spilling', () => {
      const students = [
        student({ number: 1, sex: 'M', apart: 'X' }),
        M(2),
        M(3),
        M(4),
        student({ number: 5, sex: 'F', apart: 'X' }),
      ];
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'perGroup', size: 4 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error.code).toBe(ERROR_CODES.keepApartImpossible);
      if (out.error.code !== ERROR_CODES.keepApartImpossible) return;
      expect(new Set(out.error.students)).toEqual(new Set([1, 5]));
      expect(out.error.groupsNeeded).toBe(2);
    });
  });

  // Fix round 1: a gap this task's OWN verification found (not the
  // reviewer's, and not named in the brief) -- `allocationCandidates`
  // bounds every alternate split to each side's own headcount (see its
  // doc comment) specifically so a candidate can never hand a side more
  // groups than it has students. Nothing pinned that bound: mutating it
  // away (widening the range to the full, naive `[1, count - 1]`) passes
  // every other test in this file unchanged, and produces a REAL, silent
  // defect on the input below -- `ok: true` with six of ten groups empty
  // (three boys spread thin across the girls'-together-block-driven need
  // for nine boy-groups) -- proven directly, not assumed, before this test
  // was written.
  describe('allocationCandidates never proposes a split that would empty a group (Fix round 1, mutation-found gap)', () => {
    // 3 boys, no rules. 20 girls, 15 of them bound together -- that block
    // only fits a group of >= 15, which only ONE split gives girls (all 20
    // in a single group, i.e. girlsGroups = 1); every other girlsGroups
    // value shrinks the largest possible group below 15. girlsGroups = 1
    // needs boysGroups = 9 -- nine groups for three boys, six of them
    // necessarily empty. The naive, unbounded range would try exactly this
    // candidate (it IS one of the "count - 1 ways to divide"); the
    // headcount bound excludes it, so this must be refused, not silently
    // "succeed" with empty groups in the output.
    it('refuses rather than producing empty groups, when the only fit needs a side to exceed its own headcount', () => {
      const students = [
        M(1),
        M(2),
        M(3),
        ...Array.from({ length: 15 }, (_, i) =>
          student({ number: i + 4, sex: 'F', together: 'Z' }),
        ),
        F(19),
        F(20),
        F(21),
        F(22),
        F(23),
      ];
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'groupCount', count: 10 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.sexSeparateImpossible,
        groupsRequested: 10,
      });
    });
  });

  // Fix round 1: closes the gap the reviewer named -- before this fix,
  // nothing in this file ever piped a `separate`-mode failure through
  // `renderError`. Every refusal above was checked structurally (code,
  // `students`, `groupsNeeded`) but never as the sentence a teacher
  // actually reads -- and a wrong number reaching a teacher is exactly
  // what these findings are about, so the assertion here is on the
  // sentence, not the code. `sexSeparateImpossible`'s own rendered-message
  // test lives with the rest of F-2's coverage above; the two here cover
  // the other refusal shapes `separate` can still produce.
  describe('rendered messages: separate-mode refusals read correctly, in both languages (Fix round 1)', () => {
    it('sex-separate-splits-unit renders the pair and both remedies, in both languages', () => {
      const out = buildGroups(
        base({
          students: [
            student({ number: 1, name: 'Ana', sex: 'F', together: 'A' }),
            student({ number: 2, name: 'Budi', sex: 'M', together: 'A' }),
            M(3),
            F(4),
          ],
          mode: { kind: 'groupCount', count: 2 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(renderError(out.error, en)).toBe(
        'Student 1 and Student 2 are marked to stay together, but are not all the same sex, so they cannot form a single-sex group. Remove the together letter from one of them, or turn this mode off.',
      );
      expect(renderError(out.error, id)).toBe(
        'Siswa 1 dan Siswa 2 ditandai untuk disatukan, tetapi tidak semuanya berjenis kelamin sama, sehingga tidak bisa membentuk kelompok satu jenis kelamin. Hapus huruf yang menyatukan mereka, atau matikan mode ini.',
      );
    });

    // `perGroup`, unlike `groupCount`, has no single "number the teacher
    // asked for" to contradict -- the teacher stated a SIZE, and this
    // side-scoped `groupsNeeded: 2` is an honest, un-ambiguous fact about
    // the one attempt that was ever possible here (see the report). This
    // test is what shows that: the rendered sentence is correct as-is,
    // nothing about this refusal needed F-2's fix.
    it('keep-apart-impossible at the spill boundary renders correctly under perGroup, in both languages', () => {
      const students = [
        student({ number: 1, sex: 'M', apart: 'X' }),
        M(2),
        M(3),
        M(4),
        student({ number: 5, sex: 'F', apart: 'X' }),
      ];
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'perGroup', size: 4 },
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      const enMsg = renderError(out.error, en);
      expect(enMsg).toBe(
        'Student 1 and Student 5 all need to be kept apart from each other, so you would need at least 2 groups. Either make more groups or remove one of the rules.',
      );
      const idMsg = renderError(out.error, id);
      expect(idMsg).toBe(
        'Siswa 1 dan Siswa 5 semuanya harus dipisahkan satu sama lain, sehingga Anda membutuhkan minimal 2 kelompok. Tambah jumlah kelompok atau hapus salah satu aturannya.',
      );
    });
  });

  // Fix round 1, F-4. The spill's sizing threads `leftovers` through
  // (`sizesForCount` in `buildSeparateGroups`), but every existing spill
  // test above uses the default `'spread'` -- `'bunch'` was never
  // exercised under `separate` at all. No defect found; this closes the
  // gap.
  describe("leftovers: 'bunch' is exercised at the spill, not just 'spread' (Fix round 1, F-4)", () => {
    // 12 boys, 2 girls, groups of 4: boys make exactly 3 groups (12/4),
    // girls spill (2/4 floors to 0). `combined = sizesForCount(14, 3,
    // leftovers)` -- base 4 each, remainder 2 -- is where 'bunch' and
    // 'spread' actually diverge: with only 2 left over, a SINGLE-group
    // remainder (as every other spill test in this file happens to use)
    // cannot tell them apart at all ('spread' round-robins one leftover
    // into slot 0 exactly like 'bunch' does; they only disagree once the
    // remainder is 2 or more). Asserts the SIZE distribution only, not
    // which physical group the spilled girls land in -- `combined`'s sizes
    // are a pure function of (total, groupCount, leftovers), so this shape
    // is the same on every seed, but WHICH of the 14 same-cost,
    // conflict-free blocks fills the larger group is a first-fit-over-a-
    // shuffle question this test does not need to, and should not, pin.
    it("bunch: [6, 4, 4], not spread's [5, 5, 4], on the identical roster", () => {
      const students = [
        ...Array.from({ length: 12 }, (_, i) => M(i + 1)),
        F(13),
        F(14),
      ];
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'perGroup', size: 4 },
          leftovers: 'bunch',
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(shape(out.result.groups)).toEqual([6, 4, 4]);
      expect(out.result.warnings).toEqual([
        { code: WARNING_CODES.sexSpillover, students: [13, 14], sex: 'F' },
      ]);
    });

    // The contrasting case, same roster: 'spread' round-robins the
    // 2-student remainder across two DIFFERENT groups instead of piling
    // both into one. Confirms the fixture above actually distinguishes the
    // two `leftovers` values rather than producing the same shape either
    // way.
    it("contrasts with 'spread' on the identical roster", () => {
      const students = [
        ...Array.from({ length: 12 }, (_, i) => M(i + 1)),
        F(13),
        F(14),
      ];
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'perGroup', size: 4 },
          leftovers: 'spread',
          sexMode: 'separate',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(shape(out.result.groups)).toEqual([5, 5, 4]);
    });
  });
});

describe('pinned groups', () => {
  const roster = Array.from({ length: 9 }, (_, i) =>
    student({ number: i + 1 }),
  );

  it('returns pinned groups untouched and redeals the rest', () => {
    const pinned = [[roster[0], roster[1], roster[2]]];
    const out = buildGroups(
      base({
        students: roster,
        mode: { kind: 'groupCount', count: 3 },
        pinned,
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Task 11 sweep: the reviewer's own named gap (task-9-report.md) --
    // membership and the flat count alone do not prove the POOL was sized
    // to `mode.count - pinnedGroups.length` (2 groups here) rather than
    // `mode.count` unreduced (3): a mutant that drops the reduction still
    // seats everyone, still leaves group 1 as [1, 2, 3] untouched, and still
    // sums to 9 -- it only shows up as a FOURTH group in the output. The
    // `separate`/`mix` pin-threading tests below happen to catch that
    // mutant too, but this is the test whose own name claims the guarantee,
    // so it should not need a sibling test to actually prove it.
    expect(out.result.groups).toHaveLength(3);
    const first = out.result.groups.find((g) => g.some((s) => s.number === 1));
    expect(first?.map((s) => s.number).sort((a, b) => a - b)).toEqual([
      1, 2, 3,
    ]);
    expect(out.result.groups.flat()).toHaveLength(9);
  });

  it('never places a pinned student anywhere else as well', () => {
    const out = buildGroups(
      base({
        students: roster,
        mode: { kind: 'groupCount', count: 3 },
        pinned: [[roster[0], roster[1], roster[2]]],
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const numbers = out.result.groups.flat().map((s) => s.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('drops a pinned student who has since been marked absent', () => {
    const withAbsence = roster.map((s) =>
      s.number === 2 ? { ...s, absent: true } : s,
    );
    const out = buildGroups(
      base({
        students: withAbsence,
        mode: { kind: 'groupCount', count: 3 },
        pinned: [[roster[0], roster[1], roster[2]]],
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.groups.flat().map((s) => s.number)).not.toContain(2);
  });

  // A numbers fix to the brief's own worked example (see the Task 9
  // report): as originally given, this pinned 1 of a requested 3 groups
  // (leaving 2 pool groups -- "the group count reduced by
  // pinnedGroups.length", per the brief's own prose, confirmed the only
  // reading under which its degenerate-guard description is coherent at
  // all; see the report) while putting THREE mutually apart-lettered
  // students (4, 5 and 6 all sharing 'X') in that 2-group pool -- three
  // students who must all be kept apart from each other need three
  // DIFFERENT groups, so the original numbers asked for something no
  // implementation could satisfy. `count: 4` gives the pool its needed
  // third group (4 requested - 1 pinned = 3 pool groups) without changing
  // what the test is actually proving: apart-letters are still honoured
  // among the students being redealt around a pin.
  it('still honours apart letters among the students being redealt', () => {
    const withLetters = roster.map((s) =>
      s.number >= 4 && s.number <= 6 ? { ...s, apart: 'X' } : s,
    );
    const out = buildGroups(
      base({
        students: withLetters,
        mode: { kind: 'groupCount', count: 4 },
        pinned: [[withLetters[0], withLetters[1], withLetters[2]]],
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    for (const g of out.result.groups) {
      expect(g.filter((s) => s.apart === 'X').length).toBeLessThanOrEqual(1);
    }
  });

  it('refuses a together-unit split across a pinned boundary, naming both', () => {
    const split = roster.map((s) =>
      s.number === 1 || s.number === 7 ? { ...s, together: 'A' } : s,
    );
    const out = buildGroups(
      base({
        students: split,
        mode: { kind: 'groupCount', count: 3 },
        pinned: [[split[0], split[1], split[2]]],
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({
      code: ERROR_CODES.pinnedSplitsUnit,
      students: [1, 7],
    });
  });

  // Fix round 1, F-3. The gap flagged in the Task 9 report: each pinned
  // group was honoured independently, so a together-letter split between
  // two DIFFERENT pinned groups (rather than pool-vs-pinned, which the test
  // above covers) went through with no error and no warning. Reused, not a
  // new code -- see ERROR_CODES.pinnedSplitsUnit's doc comment for why the
  // "reported, not built" call at Task 9 did not survive review: `together`
  // is a hard constraint everywhere else this engine checks it, and the
  // brief's own rule text was never scoped to the pool.
  it('refuses a together-unit split between two DIFFERENT pinned groups, naming both', () => {
    const split = roster.map((s) =>
      s.number === 1 || s.number === 4 ? { ...s, together: 'A' } : s,
    );
    const out = buildGroups(
      base({
        students: split,
        mode: { kind: 'groupCount', count: 3 },
        pinned: [
          [split[0], split[1]], // 1, 2 -- student 1 carries the letter
          [split[3], split[4]], // 4, 5 -- student 4 carries the letter
        ],
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({
      code: ERROR_CODES.pinnedSplitsUnit,
      students: [1, 4],
    });
  });

  // Fix round 1, F-4. The original pool-vs-pinned check returned as soon as
  // ONE pool member's letter matched a pinned one, so a unit with a SECOND
  // pool member sharing the same letter left that second member unnamed --
  // {1 pinned, 7 pool, 8 pool} used to report `students: [1, 7]`, dropping
  // 8, while the copy says "only SOME of them are in a pinned group",
  // implying the rest are all named. Every member of the unit must appear,
  // regardless of which region (pool or pinned) it is in.
  it('names every member of a straddling unit, not just the first pool member found', () => {
    const split = roster.map((s) =>
      s.number === 1 || s.number === 7 || s.number === 8
        ? { ...s, together: 'A' }
        : s,
    );
    const out = buildGroups(
      base({
        students: split,
        mode: { kind: 'groupCount', count: 3 },
        pinned: [[split[0], split[1]]], // 1, 2 -- student 1 carries the letter
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({
      code: ERROR_CODES.pinnedSplitsUnit,
      students: [1, 7, 8],
    });
  });

  // Correction 1. A pinned record is a SNAPSHOT taken at a previous shuffle.
  // The absent case above is one kind of staleness; this is the general
  // case -- a name can be edited or a sex reassigned since. Matched by
  // NUMBER only, every other field must come from the CURRENT roster, never
  // the pinned copy: the pin fixes who is together, not what was true of
  // them last time. The stale copy claims 'OldName'/'F'; the current
  // roster (same number, looked up fresh) says 'NewName'/'M'. An
  // implementation that reads a field off the pinned record instead of
  // re-resolving by number resurrects the stale pair.
  it('a pinned record with a stale name and sex does not resurrect either -- current roster wins', () => {
    const stalePinnedCopy = student({ number: 1, name: 'OldName', sex: 'F' });
    const currentRoster = roster.map((s) =>
      s.number === 1 ? { ...s, name: 'NewName', sex: 'M' as const } : s,
    );
    const out = buildGroups(
      base({
        students: currentRoster,
        mode: { kind: 'groupCount', count: 3 },
        pinned: [[stalePinnedCopy, currentRoster[1], currentRoster[2]]],
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const placed = out.result.groups.flat().find((s) => s.number === 1);
    expect(placed?.name).toBe('NewName');
    expect(placed?.sex).toBe('M');
  });

  // Fix round 1, F-6 (gap 1). The test above pins staleness for `name` and
  // `sex` only -- `together`/`apart` are handled by the exact same
  // `presentByNumber` lookup (see buildGroups's own comment: "Every OTHER
  // field ... comes from this lookup too, never from the pinned record
  // itself"), already correct, but never actually exercised by a test. The
  // stakes are different from a cosmetic wrong name: a stale LETTER that
  // were honoured would cause a wrongful REFUSAL, not a quietly wrong
  // display value, because it feeds pinnedSplitsUnit/pinnedApartClash
  // directly. Student 1's stale pinned copy carries a together-letter that
  // collides with student 7's real, current one, and an apart-letter that
  // collides with student 2's stale pinned copy -- both would refuse if the
  // stale snapshot were honoured; neither does, because the current
  // roster's null/null wins.
  it('a pinned record with a stale together/apart letter does not resurrect either -- current roster wins', () => {
    const staleCopy1 = student({ number: 1, together: 'OLD', apart: 'OLDX' });
    const staleCopy2 = student({ number: 2, apart: 'OLDX' });
    const currentRoster = roster.map((s) => {
      if (s.number === 1 || s.number === 2)
        return { ...s, together: null, apart: null };
      if (s.number === 7) return { ...s, together: 'OLD' };
      return s;
    });
    const out = buildGroups(
      base({
        students: currentRoster,
        mode: { kind: 'groupCount', count: 3 },
        pinned: [[staleCopy1, staleCopy2, currentRoster[2]]],
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const placed1 = out.result.groups.flat().find((s) => s.number === 1);
    const placed2 = out.result.groups.flat().find((s) => s.number === 2);
    expect(placed1?.together).toBeNull();
    expect(placed1?.apart).toBeNull();
    expect(placed2?.apart).toBeNull();
  });

  // Correction 3, interaction 1 (decision -- flagged for the operator).
  // A pinned group can legitimately be mixed-sex under `separate`: the
  // engine's own spill mechanic already produces one (a few girls joining a
  // boys' group because there were not enough girls for their own), warned
  // about via sexSpillover rather than refused. A teacher re-pinning that
  // exact group is the expected workflow, not a mistake -- refusing it
  // would make the one group `separate` itself produced unrepinnable.
  // DECISION: warn, not refuse. A hard refusal (mirroring
  // sexSeparateSplitsUnit, which refuses a together-LETTER unit spanning
  // both sexes) would be wrong here because a pin, unlike a letter, is the
  // teacher's own direct, current instruction about this exact group --
  // overriding a PREFERENCE (single-sex groups) is what a pin is for.
  // "Silence is not an option" (per the brief): this warns explicitly
  // rather than letting a mixed group through with no word said.
  describe('a pinned group under separate that contains both sexes (decision: warn, not refuse)', () => {
    const M = (number: number) => student({ number, sex: 'M' as const });
    const F = (number: number) => student({ number, sex: 'F' as const });
    // 3 boys, 3 girls: pinning one of each leaves a pool of 2 boys + 2
    // girls, which `separate` splits evenly (1 pool group each, no
    // remainder) -- deliberately even so the pool's OWN placement produces
    // no incidental sexSpillover warning of its own, keeping this test
    // isolated to the one warning it means to check.
    const mixedPinRoster = [M(1), M(2), M(3), F(4), F(5), F(6)];

    it('succeeds, keeps the pin, and warns instead of refusing', () => {
      const out = buildGroups(
        base({
          students: mixedPinRoster,
          mode: { kind: 'groupCount', count: 3 },
          sexMode: 'separate',
          pinned: [[mixedPinRoster[0], mixedPinRoster[3]]], // M(1), F(4)
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const pinnedResult = groupOf(out.result.groups, 1);
      expect(pinnedResult?.map((s) => s.number).sort((a, b) => a - b)).toEqual([
        1, 4,
      ]);
      expect(out.result.warnings).toEqual([
        { code: WARNING_CODES.pinnedMixedSex, students: [1, 4] },
      ]);
    });

    // Scoping guard, same pattern as "allows that same mixed unit under mix,
    // and under off" above for sexSeparateSplitsUnit: `off` and `mix` never
    // claim single-sex groups, so a mixed PIN is not a contradiction of
    // anything under either -- no warning is owed. Does not go red before
    // implementation (today `pinned` is ignored, so there is trivially no
    // warning either way); kept as a scoping regression guard, not a
    // feature pin -- see the report for the explicit RED-count judgment.
    it('needs no warning outside separate mode', () => {
      for (const sexMode of ['off', 'mix'] as const) {
        const out = buildGroups(
          base({
            students: mixedPinRoster,
            mode: { kind: 'groupCount', count: 3 },
            sexMode,
            pinned: [[mixedPinRoster[0], mixedPinRoster[3]]],
          }),
        );
        expect(out.ok, sexMode).toBe(true);
        if (!out.ok) continue;
        expect(out.result.warnings, sexMode).toEqual([]);
      }
    });
  });

  // Correction 3, interaction 2 (decision -- flagged for the operator).
  // Two apart-lettered students pinned into the same group is a direct
  // contradiction: the apart letter says "never seat these two together",
  // the pin says "these two are in the same group, no matter what".
  // DECISION: refuse, not warn -- the opposite call from the mixed-sex
  // pin above, and deliberately so. `separate` is a PLACEMENT PREFERENCE
  // (the engine's own spill already produces exceptions to it, warned not
  // refused); an apart letter is a STUDENT-SAFETY/behaviour-management
  // signal, and every other apart-letter violation in this engine
  // (togetherApartClash, keepApartImpossible) is a hard refusal, never a
  // warning -- there is no warning-level precedent for seating two
  // apart-lettered students together anywhere in this file. Silently
  // seating them together because a pin said so is exactly the kind of
  // thing a teacher could miss in a warnings list and only discover in the
  // classroom.
  it('refuses two apart-lettered students pinned into the same group, naming both', () => {
    const withApart = roster.map((s) =>
      s.number === 1 || s.number === 2 ? { ...s, apart: 'X' } : s,
    );
    const out = buildGroups(
      base({
        students: withApart,
        mode: { kind: 'groupCount', count: 3 },
        pinned: [[withApart[0], withApart[1]]],
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({
      code: ERROR_CODES.pinnedApartClash,
      students: [1, 2],
    });
  });

  // Correction 3, interaction 3a: a pinned student not on the current
  // roster at all is a caller error. REPORTED, not built: matched by
  // number through the same `presentByNumber` lookup as the stale-field
  // and absent-student cases above, a number with no match is dropped --
  // exactly like an absent student, not a crash and not a corruption. Safe.
  it('a pinned student who is not on the roster at all is silently dropped, like an absent one', () => {
    const ghost = student({ number: 999 });
    const out = buildGroups(
      base({
        students: roster,
        mode: { kind: 'groupCount', count: 3 },
        pinned: [[roster[0], roster[1], ghost]],
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const numbers = out.result.groups.flat().map((s) => s.number);
    expect(numbers).not.toContain(999);
    expect(numbers.slice().sort((a, b) => a - b)).toEqual(
      Array.from({ length: 9 }, (_, i) => i + 1),
    );
    const g = groupOf(out.result.groups, 1);
    expect(g?.map((s) => s.number).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  // Correction 3, interaction 3b: a student pinned into two different
  // groups at once is a caller error too, but UNSAFE, not merely
  // surprising: without a guard, that number is resolved against the
  // current roster independently for EACH group it appears in and ends up
  // in the final output TWICE -- the same student physically listed in two
  // groups, and the roster's own foundational "identity is the number,
  // unique" invariant broken by the very feature meant to respect it. This
  // is the same class of defect duplicateNumber already refuses for the
  // raw roster; a pin claiming the same number twice is refused the same
  // way. BUILT, not just reported, per the brief's own "unless you find the
  // current behaviour is unsafe" clause.
  it('refuses a student pinned into two different groups at once', () => {
    const out = buildGroups(
      base({
        students: roster,
        mode: { kind: 'groupCount', count: 3 },
        pinned: [
          [roster[0], roster[1]],
          [roster[0], roster[3]],
        ],
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({
      code: ERROR_CODES.pinnedInTwoGroups,
      number: 1,
    });
  });

  // Same defect, narrower shape: the duplicate is within ONE pinned group's
  // own array rather than across two. Proves the guard is a general
  // "seen this number before" check across all of `pinnedGroups`, not a
  // check that only compares group-to-group.
  it('refuses the same student listed twice within a single pinned group too', () => {
    const out = buildGroups(
      base({
        students: roster,
        mode: { kind: 'groupCount', count: 3 },
        pinned: [[roster[0], roster[0], roster[1]]],
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toEqual({
      code: ERROR_CODES.pinnedInTwoGroups,
      number: 1,
    });
  });

  // Degenerate cases. The brief's own guard: if the pins alone already
  // claim every requested group, the pool must be empty or the input is
  // contradictory. Investigating that literally (see the report) found a
  // narrower hole it does not cover: pins can cover the WHOLE roster using
  // FEWER groups than requested (two big pinned groups against a
  // groupCount of 5), which must also succeed with just the pinned
  // groups -- not run the placer on an empty pool, which the naive
  // `targetSizes(0, ...)` reading below would turn into phantom empty
  // groups. Both are exercised, plus the ordinary "still contradictory"
  // case.
  describe('degenerate cases -- pins leave nothing, or too much, to deal', () => {
    it('the pins alone cover everyone, using fewer groups than requested -- no phantom empty groups', () => {
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'groupCount', count: 5 },
          pinned: [
            [roster[0], roster[1], roster[2], roster[3], roster[4]],
            [roster[5], roster[6], roster[7], roster[8]],
          ],
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.groups).toHaveLength(2);
      expect(shape(out.result.groups)).toEqual([5, 4]);
      expect(out.result.groups.flat()).toHaveLength(9);
    });

    it('the pins alone cover everyone, exactly matching the requested count -- succeeds cleanly', () => {
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'groupCount', count: 3 },
          pinned: [
            [roster[0], roster[1], roster[2]],
            [roster[3], roster[4], roster[5]],
            [roster[6], roster[7], roster[8]],
          ],
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.groups).toHaveLength(3);
      expect(shape(out.result.groups)).toEqual([3, 3, 3]);
      // Membership, not just shape: a plain (non-pin-aware) shuffle of 9
      // students into 3 groups of 3 also produces the [3,3,3] shape, so the
      // shape check alone would pass today whether or not pins are honoured
      // at all. Each pinned group's own membership is what only a real
      // implementation can get right.
      expect(
        out.result.groups.map((g) =>
          g.map((s) => s.number).sort((a, b) => a - b),
        ),
      ).toEqual([
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ]);
    });

    // Fix round 1, F-6 (gap 2). The mirror image of the two tests above:
    // pins can claim MORE groups than the teacher requested, not just fewer
    // or exactly as many, and the pool ends up empty either way -- the
    // `pool.length === 0` guard fires unconditionally, before `mode.count`
    // vs `pinnedGroups.length` is even compared, so this succeeds silently
    // with no error or warning. Brief-sanctioned (per the Task 9 report's
    // own framing of the degenerate case), but never pinned by a test --
    // this is that pin, so a future change cannot narrow the guard (for
    // example, to only fire when `pinnedGroups.length <= mode.count`)
    // without this reddening. Proven by mutation in the Fix round 1 report:
    // reordering the two guards below it turns this into a wrongful
    // refusal.
    it('pins claiming more groups than the teacher requested still succeed, with no warning or error', () => {
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'groupCount', count: 2 },
          pinned: [
            [roster[0], roster[1], roster[2]],
            [roster[3], roster[4], roster[5]],
            [roster[6], roster[7], roster[8]],
          ],
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.groups).toHaveLength(3); // not clamped to 2
      expect(out.result.warnings).toEqual([]);
      expect(
        out.result.groups.map((g) =>
          g.map((s) => s.number).sort((a, b) => a - b),
        ),
      ).toEqual([
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ]);
    });

    // Fix round 1, F-2: used to be `tooManyGroups` with `maxGroups: 1` --
    // and `maxGroups` was ALWAYS the number the teacher had just typed
    // under `groupCount` mode (see ERROR_CODES.pinnedTooManyGroups's doc
    // comment), so "the most you can have is 1" to a teacher who asked for
    // 1 was a tautology, not a fix. Now a code that carries all three
    // numbers the true sentence needs.
    it('refuses when the pins alone already claim every requested group and students still remain', () => {
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'groupCount', count: 1 },
          pinned: [[roster[0], roster[1], roster[2]]],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.pinnedTooManyGroups,
        requestedGroups: 1,
        pinnedGroupCount: 1,
        remainingStudents: 6,
      });
    });

    // Fix round 2. The reviewer's gap: none of the four PINNED_TOO_MANY_GROUPS
    // fixtures above ever set pinnedGroupCount > requestedGroups while pool
    // students remain -- pin three groups, then lower the count field to
    // two. The guard already refuses this correctly today (poolGroupsNeeded
    // = 2 - 3 = -1, caught by `poolGroupsNeeded < 1`); this pins that the
    // ENGINE's data is right. The bug was in the RENDERED SENTENCE ("fill 3
    // of the 2 groups"), not this decision -- see i18n.test.ts for that.
    it('refuses when the pins alone already claim MORE groups than requested and students still remain (Fix round 2)', () => {
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'groupCount', count: 2 },
          pinned: [
            [roster[0], roster[1]],
            [roster[2], roster[3]],
            [roster[4], roster[5]],
          ],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.pinnedTooManyGroups,
        requestedGroups: 2,
        pinnedGroupCount: 3,
        remainingStudents: 3,
      });
    });
  });

  // Fix round 1, F-1. The gap the degenerate-case guard above did not
  // cover: pins can also leave TOO FEW pool students for the groups still
  // requested, not just too many pinned groups. Unguarded before this fix
  // -- all three shapes below returned `ok: true` with at least one empty
  // group (see the Fix round 1 report). Reusing the SAME roster shape
  // (`roster`, `student()`, no letters) as the degenerate-case tests above
  // -- this is the same family of contradiction, not a new one.
  describe('refuses when the pins leave too FEW pool students for the groups still requested (F-1)', () => {
    it('10 students, groupCount 4, one pin of 8 -- the exact reported case', () => {
      const tenRoster = Array.from({ length: 10 }, (_, i) =>
        student({ number: i + 1 }),
      );
      const out = buildGroups(
        base({
          students: tenRoster,
          mode: { kind: 'groupCount', count: 4 },
          pinned: [tenRoster.slice(0, 8)],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.pinnedTooManyGroups,
        requestedGroups: 4,
        pinnedGroupCount: 1,
        remainingStudents: 2,
      });
    });

    it('12 students, groupCount 6, two pins of 5 -- two pinned groups, not one', () => {
      const twelveRoster = Array.from({ length: 12 }, (_, i) =>
        student({ number: i + 1 }),
      );
      const out = buildGroups(
        base({
          students: twelveRoster,
          mode: { kind: 'groupCount', count: 6 },
          pinned: [twelveRoster.slice(0, 5), twelveRoster.slice(5, 10)],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.pinnedTooManyGroups,
        requestedGroups: 6,
        pinnedGroupCount: 2,
        remainingStudents: 2,
      });
    });

    it('9 students, groupCount 8, one pin of 3 -- a shortfall of exactly one student', () => {
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'groupCount', count: 8 },
          pinned: [[roster[0], roster[1], roster[2]]],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.pinnedTooManyGroups,
        requestedGroups: 8,
        pinnedGroupCount: 1,
        remainingStudents: 6,
      });
    });
  });

  it('perGroup mode sizes the pool independently of the pinned group', () => {
    const out = buildGroups(
      base({
        students: roster,
        mode: { kind: 'perGroup', size: 3 },
        pinned: [[roster[0], roster[1], roster[2]]],
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.groups).toHaveLength(3);
    expect(shape(out.result.groups)).toEqual([3, 3, 3]);
    const first = groupOf(out.result.groups, 1);
    expect(first?.map((s) => s.number).sort((a, b) => a - b)).toEqual([
      1, 2, 3,
    ]);
  });

  describe('pins thread through every sexMode, not just off', () => {
    const M = (number: number) => student({ number, sex: 'M' as const });
    const F = (number: number) => student({ number, sex: 'F' as const });
    const sepRoster = [M(1), M(2), M(3), M(4), F(5), F(6)];

    it('separate mode places a single-sex pinned group and splits the pool by sex around it', () => {
      const out = buildGroups(
        base({
          students: sepRoster,
          mode: { kind: 'groupCount', count: 3 },
          sexMode: 'separate',
          pinned: [[sepRoster[0], sepRoster[1]]], // M(1), M(2)
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.groups).toHaveLength(3);
      expect(out.result.warnings).toEqual([]);
      const pinnedResult = groupOf(out.result.groups, 1);
      expect(pinnedResult?.map((s) => s.number).sort((a, b) => a - b)).toEqual([
        1, 2,
      ]);
      const boysGroup = groupOf(out.result.groups, 3);
      expect(boysGroup?.every((s) => s.sex === 'M')).toBe(true);
      const girlsGroup = groupOf(out.result.groups, 5);
      expect(girlsGroup?.every((s) => s.sex === 'F')).toBe(true);
      expect(boysGroup).not.toBe(girlsGroup);
    });

    // Fix round 1, F-6 (gap 3). At `count: 2` (the original number here),
    // one group is pinned and the pool -- 2 boys + 2 girls once M(1)/M(2)
    // are excluded -- has only ONE pool group left to fill (`poolMode.count
    // === 1`), so every pool student lands in it regardless of weave order:
    // no weaving across groups was ever observable, and none was asserted.
    // `count: 3` gives the pool TWO groups instead, which makes weaving
    // both observable and, at this exact shape, provable UNDER THE REAL
    // IMPLEMENTATION without depending on the seed: `assign`'s first-fit
    // fills each group to CAPACITY in the order it is handed before moving
    // to the next (see `assign`, `placeBlocks`), and `weaveBySex` alternates
    // boy/girl/boy/girl whenever the two counts are equal (see its own doc
    // comment) -- together that means positions [0,1] of the woven order
    // always fill pool group 1 and positions [2,3] always fill pool group
    // 2, REGARDLESS of shuffle, so one boy and one girl land in EACH pool
    // group every time, for every seed, once weaving is actually happening.
    //
    // `random: seeded(5)` is pinned explicitly rather than left to `base()`'s
    // default, because the MUTANT (weaving disabled -- see the Fix round 1
    // report) is not caught by every seed: an unweaved shuffle of 2
    // boy-blocks and 2 girl-blocks still lands "one of each" in the first
    // two positions 2 times out of 3 by chance alone (6 equally likely
    // pairs, 4 mixed), so `seeded(1)` -- this suite's usual default --
    // passes whether or not the weave runs at all, and would not actually
    // have caught a regression. `seeded(5)` was found by search to clump
    // both boys into the first two positions when unweaved, so it is the
    // seed used here specifically because it distinguishes "weave ran" from
    // "weave didn't run" -- verified by mutation, not assumed.
    it('mix mode places a pinned group and weaves the pool by sex around it', () => {
      const out = buildGroups(
        base({
          students: sepRoster,
          mode: { kind: 'groupCount', count: 3 },
          sexMode: 'mix',
          pinned: [[sepRoster[0], sepRoster[1]]],
          random: seeded(5),
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.groups).toHaveLength(3);
      const pinnedResult = groupOf(out.result.groups, 1);
      expect(pinnedResult?.map((s) => s.number).sort((a, b) => a - b)).toEqual([
        1, 2,
      ]);
      expect(out.result.groups.flat()).toHaveLength(6);
      const poolGroups = out.result.groups.filter(
        (g) => !g.some((s) => s.number === 1 || s.number === 2),
      );
      expect(poolGroups).toHaveLength(2);
      for (const g of poolGroups) {
        expect(g.filter((s) => s.sex === 'M')).toHaveLength(1);
        expect(g.filter((s) => s.sex === 'F')).toHaveLength(1);
      }
    });
  });

  // Whole-branch review, I-5. Every test above in this describe block drives
  // buildGroups with a real pin and checks the returned CODE and DATA -- but
  // none of them ever call renderError or renderWarning, so a structurally
  // correct code carrying the WRONG NUMBER (exactly what commit 82fa7de
  // fixed -- see restoreWholeClassCount's own doc comment in grouping.ts)
  // would have passed every one of them. `sex mode: separate`'s own
  // "rendered messages" sub-block, and its sexSeparateImpossible/
  // sexSeparateSearchGaveUp tests further up, already prove this pattern
  // catches real bugs; this block applies it to the PINNED path
  // specifically, because that is the one seam where a count gets computed
  // once over the pool and once over the whole class (see
  // restoreWholeClassCount) -- exactly what a code-only assertion cannot
  // see.
  //
  // Each fixture below drives a REAL buildGroups call with a REAL pin,
  // asserts the structural error/warning first (so the comment's arithmetic
  // is checkable against a concrete number), then renders the ACTUAL
  // returned value in both languages. Where the code names students, it
  // also renders with a supplied resolver -- proving the plumbing on a real
  // pinned outcome, not a hand-fed sample the way i18n.test.ts's own
  // "resolves student numbers to names" blocks do for the renderer in
  // isolation.
  describe('rendered messages: every pinned-path refusal and warning reads correctly, in both languages (I-5)', () => {
    const M = (number: number) => student({ number, sex: 'M' as const });
    const F = (number: number) => student({ number, sex: 'F' as const });

    // -- pin-exclusive codes: reuse the exact rosters the code-level tests
    // above already proved produce these codes; the only new work here is
    // the render step those tests never took. -------------------------

    const testPinnedSplitsUnit = () => {
      const split = roster.map((s) =>
        s.number === 1 || s.number === 7 ? { ...s, together: 'A' } : s,
      );
      const out = buildGroups(
        base({
          students: split,
          mode: { kind: 'groupCount', count: 3 },
          pinned: [[split[0], split[1], split[2]]],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.pinnedSplitsUnit,
        students: [1, 7],
      });
      expect(renderError(out.error, en)).toBe(
        'Student 1 and Student 7 are marked to stay together, but only some of them are in a pinned group. Unpin the group, or remove the together letter from whoever is outside it.',
      );
      expect(renderError(out.error, id)).toBe(
        'Siswa 1 dan Siswa 7 ditandai untuk disatukan, tetapi hanya sebagian dari mereka yang berada di kelompok yang dikunci. Batalkan kunci kelompok itu, atau hapus huruf penyatu itu dari yang berada di luar kelompok.',
      );
      expect(
        renderError(out.error, en, (n) => (n === 1 ? 'Wayan' : 'Made')),
      ).toBe(
        'Wayan and Made are marked to stay together, but only some of them are in a pinned group. Unpin the group, or remove the together letter from whoever is outside it.',
      );
    };

    const testPinnedApartClash = () => {
      const withApart = roster.map((s) =>
        s.number === 1 || s.number === 2 ? { ...s, apart: 'X' } : s,
      );
      const out = buildGroups(
        base({
          students: withApart,
          mode: { kind: 'groupCount', count: 3 },
          pinned: [[withApart[0], withApart[1]]],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.pinnedApartClash,
        students: [1, 2],
      });
      expect(renderError(out.error, en)).toBe(
        'Student 1 and Student 2 are marked to be kept apart from each other, but a pinned group puts them in the same one. Unpin the group, or remove the apart letter from one of them.',
      );
      expect(renderError(out.error, id)).toBe(
        'Siswa 1 dan Siswa 2 ditandai untuk dipisahkan satu sama lain, tetapi kelompok yang dikunci menempatkan mereka bersama. Batalkan kunci kelompok itu, atau hapus huruf pemisah itu dari salah satu siswa tersebut.',
      );
      expect(
        renderError(out.error, en, (n) => (n === 1 ? 'Ana' : 'Budi')),
      ).toBe(
        'Ana and Budi are marked to be kept apart from each other, but a pinned group puts them in the same one. Unpin the group, or remove the apart letter from one of them.',
      );
    };

    const testPinnedInTwoGroups = () => {
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'groupCount', count: 3 },
          pinned: [
            [roster[0], roster[1]],
            [roster[0], roster[3]],
          ],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.pinnedInTwoGroups,
        number: 1,
      });
      expect(renderError(out.error, en)).toBe(
        'Student 1 is pinned into two different groups at once. A student can only be pinned into one group. Remove them from one of the two.',
      );
      expect(renderError(out.error, id)).toBe(
        'Siswa 1 dikunci ke dalam dua kelompok berbeda sekaligus. Satu siswa hanya bisa dikunci ke dalam satu kelompok. Keluarkan dari salah satu kelompok tersebut.',
      );
      expect(renderError(out.error, en, () => 'Citra')).toBe(
        'Citra is pinned into two different groups at once. A student can only be pinned into one group. Remove them from one of the two.',
      );
    };

    // PINNED_TOO_MANY_GROUPS has THREE distinct sentence branches (see its
    // template in en.ts/id.ts), keyed on the sign of `poolGroupsNeeded =
    // requestedGroups - pinnedGroupCount` -- each gets its own fixture,
    // reusing the exact rosters the "degenerate cases" / "refuses when the
    // pins leave too FEW pool students" tests above already proved produce
    // this code.
    const testPinnedTooManyGroupsShortfall = () => {
      // Teacher typed 4 groups total; the pin alone already claims 1,
      // leaving only 2 pool students for the 3 pool groups that still need
      // filling (4 requested - 1 pinned = 3 needed, but only 2 remain).
      const tenRoster = Array.from({ length: 10 }, (_, i) =>
        student({ number: i + 1 }),
      );
      const out = buildGroups(
        base({
          students: tenRoster,
          mode: { kind: 'groupCount', count: 4 },
          pinned: [tenRoster.slice(0, 8)],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.pinnedTooManyGroups,
        requestedGroups: 4,
        pinnedGroupCount: 1,
        remainingStudents: 2,
      });
      expect(renderError(out.error, en)).toBe(
        'Your pins already fill 1 of the 4 groups you asked for, which only leaves 2 students — not enough for the 3 groups still needed. Unpin a group, or ask for fewer groups.',
      );
      expect(renderError(out.error, id)).toBe(
        'Kunci Anda sudah memakai 1 dari 4 kelompok yang Anda minta, sehingga hanya tersisa 2 siswa — tidak cukup untuk 3 kelompok yang masih dibutuhkan. Batalkan kunci salah satu kelompok, atau minta lebih sedikit kelompok.',
      );
    };

    const testPinnedTooManyGroupsExact = () => {
      // Teacher typed 1 group total; the pin alone already claims that one
      // group (1 requested - 1 pinned = 0 pool groups left), stranding the
      // 6 students who were never pinned.
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'groupCount', count: 1 },
          pinned: [[roster[0], roster[1], roster[2]]],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.pinnedTooManyGroups,
        requestedGroups: 1,
        pinnedGroupCount: 1,
        remainingStudents: 6,
      });
      expect(renderError(out.error, en)).toBe(
        'Your pins already fill 1 of the 1 group you asked for, which only leaves 6 students with no group left for them. Unpin a group, or ask for more groups.',
      );
      expect(renderError(out.error, id)).toBe(
        'Kunci Anda sudah memakai 1 dari 1 kelompok yang Anda minta, sehingga hanya tersisa 6 siswa tanpa kelompok tersisa untuk mereka. Batalkan kunci salah satu kelompok, atau minta lebih banyak kelompok.',
      );
    };

    const testPinnedTooManyGroupsSurplus = () => {
      // Teacher typed 2 groups total; the pins alone already claim 3 -- MORE
      // than was asked for (poolGroupsNeeded = 2 - 3 = -1) -- while still
      // leaving 3 students unpinned.
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'groupCount', count: 2 },
          pinned: [
            [roster[0], roster[1]],
            [roster[2], roster[3]],
            [roster[4], roster[5]],
          ],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.pinnedTooManyGroups,
        requestedGroups: 2,
        pinnedGroupCount: 3,
        remainingStudents: 3,
      });
      expect(renderError(out.error, en)).toBe(
        'Your pins already use 3 groups — more than the 2 groups you asked for — which leaves 3 students with no group left for them. Unpin a group, or ask for more groups.',
      );
      expect(renderError(out.error, id)).toBe(
        'Kunci Anda sudah memakai 3 kelompok — lebih banyak daripada 2 kelompok yang Anda minta — sehingga tersisa 3 siswa tanpa kelompok tersisa untuk mereka. Batalkan kunci salah satu kelompok, atau minta lebih banyak kelompok.',
      );
    };

    const testPinnedMixedSex = () => {
      const mixedPinRoster = [M(1), M(2), M(3), F(4), F(5), F(6)];
      const out = buildGroups(
        base({
          students: mixedPinRoster,
          mode: { kind: 'groupCount', count: 3 },
          sexMode: 'separate',
          pinned: [[mixedPinRoster[0], mixedPinRoster[3]]],
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.warnings).toEqual([
        { code: WARNING_CODES.pinnedMixedSex, students: [1, 4] },
      ]);
      const [warning] = out.result.warnings;
      expect(renderWarning(warning, en)).toBe(
        'Student 1 and Student 4 are pinned together as one group, but are not all the same sex, so this group was not split by sex like the others. That is what the pin asked for, not a mistake to fix.',
      );
      expect(renderWarning(warning, id)).toBe(
        'Siswa 1 dan Siswa 4 dikunci bersama dalam satu kelompok, tetapi tidak semuanya berjenis kelamin sama, sehingga kelompok ini tidak dipisahkan berdasarkan jenis kelamin seperti kelompok lainnya. Itu sesuai permintaan kunci kelompoknya, bukan kesalahan yang perlu diperbaiki.',
      );
      expect(
        renderWarning(warning, en, (n) => (n === 1 ? 'Dewi' : 'Eko')),
      ).toBe(
        'Dewi and Eko are pinned together as one group, but are not all the same sex, so this group was not split by sex like the others. That is what the pin asked for, not a mistake to fix.',
      );
    };

    // -- restored-count codes: the exact defect class commit 82fa7de fixed.
    // Each of these fires from a fresh pool-only conflict, WITH a pin also
    // in play, so the reported count only reads true if
    // restoreWholeClassCount actually ran. ------------------------------

    const testKeepApartImpossiblePinned = () => {
      // 2 students pinned together (no rules of their own) + a 3-student
      // mutual apart-clique left in the pool. Teacher asked for 3 groups
      // total (1 pinned + 2 requested for the pool); the pool's OWN clique
      // needs 3 of ITS OWN groups (poolSizes.length is only 2, since
      // poolMode.count = 3 - 1), so the true whole-class requirement is the
      // clique's 3 plus the 1 already pinned = 4 -- MORE than the 3 the
      // teacher typed, which is the honest, actionable claim. Pre-fix this
      // said 3: "you'd need at least 3", when the teacher had already typed
      // 3 -- self-contradicting.
      const students = [
        student({ number: 1 }),
        student({ number: 2 }),
        student({ number: 3, apart: 'X' }),
        student({ number: 4, apart: 'X' }),
        student({ number: 5, apart: 'X' }),
      ];
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'groupCount', count: 3 },
          pinned: [[students[0], students[1]]],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.keepApartImpossible,
        students: [3, 4, 5],
        groupsNeeded: 4,
      });
      expect(renderError(out.error, en)).toBe(
        'Student 3, Student 4 and Student 5 all need to be kept apart from each other, so you would need at least 4 groups. Either make more groups or remove one of the rules.',
      );
      expect(renderError(out.error, id)).toBe(
        'Siswa 3, Siswa 4, dan Siswa 5 semuanya harus dipisahkan satu sama lain, sehingga Anda membutuhkan minimal 4 kelompok. Tambah jumlah kelompok atau hapus salah satu aturannya.',
      );
      expect(
        renderError(
          out.error,
          en,
          (n) => ({ 3: 'Fitri', 4: 'Gita', 5: 'Hani' })[n] ?? `#${n}`,
        ),
      ).toBe(
        'Fitri, Gita and Hani all need to be kept apart from each other, so you would need at least 4 groups. Either make more groups or remove one of the rules.',
      );
    };

    const testTogetherNoArrangementPinned = () => {
      // The exact together-pair roster from "proves no arrangement exists
      // when three together-pairs cannot all fit" above (3 blocks of 2 into
      // 2 groups of 3 -- provably impossible), plus one pinned pair. Teacher
      // typed 3 groups total (2 for the pool's own letters + 1 already
      // pinned); poolSizes.length alone is only 2. Pre-fix this said 2,
      // silently pretending the pinned group was never asked for.
      const students = [
        student({ number: 1, together: 'A' }),
        student({ number: 2, together: 'A' }),
        student({ number: 3, together: 'B' }),
        student({ number: 4, together: 'B' }),
        student({ number: 5, together: 'C' }),
        student({ number: 6, together: 'C' }),
        student({ number: 7 }),
        student({ number: 8 }),
      ];
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'groupCount', count: 3 },
          pinned: [[students[6], students[7]]],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.togetherNoArrangement,
        groupsTried: 3,
      });
      expect(renderError(out.error, en)).toBe(
        'There is no way to fit your class into 3 groups while keeping everyone together who needs to be. Make the groups bigger, or give each letter to fewer students.',
      );
      expect(renderError(out.error, id)).toBe(
        'Tidak ada cara membagi kelas Anda menjadi 3 kelompok sambil tetap menyatukan siswa yang harus disatukan. Perbesar kelompoknya, atau berikan setiap huruf ke lebih sedikit siswa.',
      );
    };

    const testKeepApartNoArrangementPinned = () => {
      // The exact three-clique roster from "apart letters -- three cliques
      // whose sizes and capacities collide" above (X, Y sized 3 each, Z
      // sized 2, groupCount 3, leftovers 'bunch' -- a proven, not
      // exhausted, impossibility), plus one pinned pair. Teacher typed 4
      // groups total (3 for the pool's own letters + 1 already pinned);
      // poolSizes.length alone is only 3. Pre-fix this said 3, silently
      // pretending the pinned group was never asked for.
      const students = [
        ...['X', 'Y'].flatMap((letter, li) =>
          Array.from({ length: 3 }, (_, i) =>
            student({ number: li * 3 + i + 1, apart: letter }),
          ),
        ),
        student({ number: 7, apart: 'Z' }),
        student({ number: 8, apart: 'Z' }),
        student({ number: 9 }),
        student({ number: 10 }),
      ];
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'groupCount', count: 4 },
          leftovers: 'bunch',
          pinned: [[students[8], students[9]]],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.keepApartNoArrangement,
        groupsTried: 4,
      });
      expect(renderError(out.error, en)).toBe(
        'There is no way to fit your class into 4 groups while keeping everyone apart who needs to be. Either make more groups or remove one of the rules.',
      );
      expect(renderError(out.error, id)).toBe(
        'Tidak ada cara membagi kelas Anda menjadi 4 kelompok sambil tetap memisahkan siswa yang harus dipisahkan. Tambah jumlah kelompok atau hapus salah satu aturannya.',
      );
    };

    const testBothRulesNoArrangementPinned = () => {
      // The exact roster from "reports BOTH_RULES_NO_ARRANGEMENT..." above
      // (together clash alone already proves impossibility at perGroup size
      // 3), plus one pinned trio. perGroup has no explicit "count" the
      // teacher typed, but the true total groups in the arrangement is 3 (2
      // needed for the pool's own letters + 1 already pinned) -- pre-fix
      // this said 2, silently pretending the pinned group did not exist.
      const students = [
        student({ number: 1, together: 'A', apart: 'X' }),
        student({ number: 2, together: 'A' }),
        student({ number: 3, together: 'B', apart: 'X' }),
        student({ number: 4, together: 'B' }),
        student({ number: 5, together: 'C' }),
        student({ number: 6, together: 'C' }),
        student({ number: 7 }),
        student({ number: 8 }),
        student({ number: 9 }),
      ];
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'perGroup', size: 3 },
          pinned: [[students[6], students[7], students[8]]],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.bothRulesNoArrangement,
        groupsTried: 3,
      });
      expect(renderError(out.error, en)).toBe(
        'There is no way to fit your class into 3 groups while satisfying every together-letter and every apart-letter at once. The search cannot tell which kind of rule is the problem, so try either remedy: make the groups bigger or give a together-letter to fewer students, or make more groups or remove one of the apart-rules.',
      );
      expect(renderError(out.error, id)).toBe(
        'Tidak ada cara membagi kelas Anda menjadi 3 kelompok sambil tetap menyatukan siswa yang harus disatukan dan memisahkan siswa yang harus dipisahkan. Pencarian ini tidak bisa memastikan aturan mana yang jadi masalah, jadi coba salah satu perbaikan ini: untuk huruf yang harus disatukan, perbesar kelompoknya atau berikan hurufnya ke lebih sedikit siswa; untuk aturan pemisahan, tambah jumlah kelompoknya atau hapus salah satu aturan itu.',
      );
    };

    const testSexSeparateImpossiblePinned = () => {
      // 6 boys mutually apart (need 6 groups no matter how the total is
      // split between the sexes) + 4 pool girls, plus 2 more girls pinned
      // together. Teacher typed 4 groups total (3 for the pool + 1 already
      // pinned); buildSeparateGroups only ever sees poolMode.count = 3, the
      // number every failed candidate is measured against. Pre-fix this
      // said 3, contradicting the 4 the teacher actually typed.
      const students = [
        ...Array.from({ length: 6 }, (_, i) =>
          student({ number: i + 1, sex: 'M' as const, apart: 'X' }),
        ),
        F(7),
        F(8),
        F(9),
        F(10),
        F(11),
        F(12),
      ];
      const out = buildGroups(
        base({
          students,
          mode: { kind: 'groupCount', count: 4 },
          sexMode: 'separate',
          pinned: [[students[10], students[11]]],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.sexSeparateImpossible,
        groupsRequested: 4,
      });
      expect(renderError(out.error, en)).toBe(
        'Boys and girls cannot be kept in separate groups across 4 groups while also satisfying your other rules. The search cannot tell which rule is the problem, so try either remedy: ask for a different number of groups, or turn this mode off.',
      );
      expect(renderError(out.error, id)).toBe(
        'Laki-laki dan perempuan tidak bisa tetap berada di kelompok terpisah dalam 4 kelompok sekaligus memenuhi aturan Anda yang lain. Pencarian ini tidak bisa memastikan aturan mana yang jadi masalah, jadi coba salah satu perbaikan ini: minta jumlah kelompok yang berbeda, atau matikan mode ini.',
      );
    };

    // -- reachable-with-pins, but legitimately NOT restored: these carry
    // either no data at all, or a value that is correctly POOL-scoped even
    // with a pin present (see restoreWholeClassCount's own doc comment for
    // why it does not touch them). Rendered here anyway, both languages,
    // because the whole point of this describe block is that "zero
    // renderError/renderWarning calls" is what let the real defect through
    // -- and TOGETHER_UNIT_TOO_LARGE in particular is a guard against a
    // future, over-eager fix that copies the +pinnedGroups.length pattern
    // here where it does NOT belong (a together-unit can only ever land in
    // the pool, per that doc comment). --------------------------------

    const testTogetherSearchGaveUpPinned = () => {
      const pairs = Array.from({ length: 30 }, (_, i) =>
        student({
          number: i + 1,
          together: String.fromCharCode(65 + Math.floor(i / 2)),
        }),
      );
      // The pinned pair must be REAL roster members, not just numbers handed
      // to `pinned` -- a pin resolves by matching `presentByNumber` (see
      // buildGroups's own comment on `pinnedGroups`), so a number with no
      // matching student in `students` is silently dropped, exactly like the
      // "pinned student who is not on the roster at all" test above. Dropped
      // silently means `pinnedGroups.length` stays 0, and every fixture in
      // this block depends on it being 1 -- so the pinned pair is built once
      // here and spread into `students` too, not just referenced by number.
      const pinnedPair = [student({ number: 31 }), student({ number: 32 })];
      const out = buildGroups(
        base({
          students: [...pairs, ...pinnedPair],
          mode: { kind: 'groupCount', count: 11 },
          pinned: [pinnedPair],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({ code: ERROR_CODES.togetherSearchGaveUp });
      expect(renderError(out.error, en)).toBe(
        'There are too many together-letters here to work through. Try using fewer letters, or make the groups bigger.',
      );
      expect(renderError(out.error, id)).toBe(
        'Huruf yang harus disatukan di sini terlalu banyak untuk dihitung. Coba gunakan lebih sedikit huruf, atau perbesar kelompoknya.',
      );
    };

    const testKeepApartSearchGaveUpPinned = () => {
      // Was [20, 19, 18, 17, 16, 15] = 105, plus the pinned pair = 107.
      // MAX_STUDENTS is 100 now (operator, 2026-08-13), so that input is
      // refused with TOO_MANY_STUDENTS before the search runs. The last
      // clique is shortened so the total lands on exactly 100 WITH the pair;
      // the shape is otherwise unchanged.
      const students = [20, 19, 18, 17, 16, 8].flatMap((size, ci) =>
        Array.from({ length: size }, (_, j) =>
          student({ number: ci * 100 + j + 1, apart: `C${ci}` }),
        ),
      );
      // See testTogetherSearchGaveUpPinned's comment: the pinned pair must
      // be real roster members (numbers well clear of the 1-515 range the
      // six cliques above already use -- `ci` up to 5, `j` up to 14), or the
      // pin silently fails to resolve and `pinnedGroups.length` stays 0.
      const pinnedPair = [student({ number: 701 }), student({ number: 702 })];
      const out = buildGroups(
        base({
          students: [...students, ...pinnedPair],
          mode: { kind: 'groupCount', count: 21 },
          pinned: [pinnedPair],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({ code: ERROR_CODES.keepApartSearchGaveUp });
      expect(renderError(out.error, en)).toBe(
        'There are too many keep-apart rules here to work through. Try removing some of them.',
      );
      expect(renderError(out.error, id)).toBe(
        'Aturan pemisahan di sini terlalu banyak untuk dihitung. Coba hapus sebagian aturannya.',
      );
    };

    const testBothRulesSearchGaveUpPinned = () => {
      const pairs = Array.from({ length: 30 }, (_, i) =>
        student({
          number: i + 1,
          together: String.fromCharCode(65 + Math.floor(i / 2)),
          apart: i === 0 || i === 16 ? 'X' : null,
        }),
      );
      // See testTogetherSearchGaveUpPinned's comment.
      const pinnedPair = [student({ number: 31 }), student({ number: 32 })];
      const out = buildGroups(
        base({
          students: [...pairs, ...pinnedPair],
          mode: { kind: 'groupCount', count: 11 },
          pinned: [pinnedPair],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({ code: ERROR_CODES.bothRulesSearchGaveUp });
      expect(renderError(out.error, en)).toBe(
        'There are too many together- and apart-letters here to work through at once. Try using fewer letters of either kind, or make the groups bigger.',
      );
      expect(renderError(out.error, id)).toBe(
        'Huruf yang harus disatukan dan aturan pemisahan di sini terlalu banyak untuk dihitung sekaligus. Coba gunakan lebih sedikit huruf dari kedua jenis itu, atau perbesar kelompoknya.',
      );
    };

    const testSexSeparateSearchGaveUpPinned = () => {
      const students = [
        ...Array.from({ length: 8 }, (_, i) => M(i + 1)),
        ...Array.from({ length: 5 }, (_, i) =>
          student({ number: i + 9, sex: 'F' as const, apart: 'X' }),
        ),
        F(14),
        F(15),
        F(16),
        F(17),
        F(18),
        F(19),
        F(20),
        F(21),
        F(22),
        F(23),
      ];
      // See testTogetherSearchGaveUpPinned's comment. `sexMode: 'separate'`
      // additionally requires every PRESENT student to have a sex set (the
      // unset-sex guard runs on `present`, before pins are even resolved),
      // so the pinned pair must carry one too -- M() already does.
      const pinnedPair = [M(24), M(25)];
      const out = buildGroups(
        base({
          students: [...students, ...pinnedPair],
          mode: { kind: 'groupCount', count: 7 },
          sexMode: 'separate',
          pinned: [pinnedPair],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.sexSeparateSearchGaveUp,
      });
      expect(renderError(out.error, en)).toBe(
        'There are too many together- and apart-letters here to work through while also keeping boys and girls in separate groups. Try using fewer letters, or turn this mode off.',
      );
      expect(renderError(out.error, id)).toBe(
        'Huruf yang harus disatukan dan aturan pemisahan di sini terlalu banyak untuk dihitung sekaligus, sambil juga menjaga laki-laki dan perempuan di kelompok terpisah. Coba gunakan lebih sedikit huruf, atau matikan mode ini.',
      );
    };

    const testTogetherUnitTooLargePinned = () => {
      // The exact roster from "refuses a unit larger than the group, naming
      // the letter and both numbers" above (unit of 6 into groups of 4: 6 >
      // 4), plus one pinned pair drawn from students who carry no letter at
      // all. groupSize stays the POOL's own largest group (4) -- a
      // together-unit can only ever land in the pool, never inside an
      // already-fixed pinned group, so there is nothing here for
      // restoreWholeClassCount to add back (see its own doc comment).
      const students = Array.from({ length: 8 }, (_, i) =>
        student({ number: i + 1, together: i < 6 ? 'A' : null }),
      );
      // See testTogetherSearchGaveUpPinned's comment.
      const pinnedPair = [student({ number: 9 }), student({ number: 10 })];
      const out = buildGroups(
        base({
          students: [...students, ...pinnedPair],
          mode: { kind: 'perGroup', size: 4 },
          pinned: [pinnedPair],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.togetherUnitTooLarge,
        letter: 'A',
        unit: 6,
        groupSize: 4,
      });
      expect(renderError(out.error, en)).toBe(
        'The letter "A" has 6 students, but the largest group here only holds 4. Make the groups bigger, or give the letter "A" to fewer students.',
      );
      expect(renderError(out.error, id)).toBe(
        'Huruf "A" digunakan oleh 6 siswa, padahal kelompok terbesar di sini hanya menampung 4 siswa. Perbesar kelompoknya, atau berikan huruf "A" ke lebih sedikit siswa.',
      );
    };

    const testSexSeparateSplitsUnitPinned = () => {
      const students = [
        student({ number: 1, sex: 'F' as const, together: 'A' }),
        student({ number: 2, sex: 'M' as const, together: 'A' }),
        M(3),
        F(4),
      ];
      // See testTogetherSearchGaveUpPinned's comment.
      const pinnedPair = [M(5), M(6)];
      const out = buildGroups(
        base({
          students: [...students, ...pinnedPair],
          mode: { kind: 'groupCount', count: 3 },
          sexMode: 'separate',
          pinned: [pinnedPair],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.sexSeparateSplitsUnit,
        students: [1, 2],
      });
      expect(renderError(out.error, en)).toBe(
        'Student 1 and Student 2 are marked to stay together, but are not all the same sex, so they cannot form a single-sex group. Remove the together letter from one of them, or turn this mode off.',
      );
      expect(renderError(out.error, id)).toBe(
        'Siswa 1 dan Siswa 2 ditandai untuk disatukan, tetapi tidak semuanya berjenis kelamin sama, sehingga tidak bisa membentuk kelompok satu jenis kelamin. Hapus huruf yang menyatukan mereka, atau matikan mode ini.',
      );
      expect(
        renderError(out.error, en, (n) => (n === 1 ? 'Ika' : 'Joko')),
      ).toBe(
        'Ika and Joko are marked to stay together, but are not all the same sex, so they cannot form a single-sex group. Remove the together letter from one of them, or turn this mode off.',
      );
    };

    const testTogetherApartClashPinned = () => {
      const students = [
        student({ number: 1, together: 'A', apart: 'X' }),
        student({ number: 2, together: 'A', apart: 'X' }),
        student({ number: 3 }),
        student({ number: 4 }),
      ];
      // See testTogetherSearchGaveUpPinned's comment.
      const pinnedPair = [student({ number: 5 }), student({ number: 6 })];
      const out = buildGroups(
        base({
          students: [...students, ...pinnedPair],
          mode: { kind: 'groupCount', count: 3 },
          pinned: [pinnedPair],
        }),
      );
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.error).toEqual({
        code: ERROR_CODES.togetherApartClash,
        students: [1, 2],
      });
      expect(renderError(out.error, en)).toBe(
        'Student 1 and Student 2 are marked to stay together and to be kept apart from each other at the same time. Remove the together letter or the apart letter from one of them.',
      );
      expect(renderError(out.error, id)).toBe(
        'Siswa 1 dan Siswa 2 ditandai untuk disatukan sekaligus dipisahkan satu sama lain. Hapus huruf yang menyatukan mereka, atau huruf yang memisahkan mereka.',
      );
      expect(
        renderError(out.error, en, (n) => (n === 1 ? 'Kadek' : 'Luh')),
      ).toBe(
        'Kadek and Luh are marked to stay together and to be kept apart from each other at the same time. Remove the together letter or the apart letter from one of them.',
      );
    };

    const fixtures: Array<[string, string, () => void]> = [
      [
        'PINNED_SPLITS_UNIT',
        ERROR_CODES.pinnedSplitsUnit,
        testPinnedSplitsUnit,
      ],
      [
        'PINNED_APART_CLASH',
        ERROR_CODES.pinnedApartClash,
        testPinnedApartClash,
      ],
      [
        'PINNED_IN_TWO_GROUPS',
        ERROR_CODES.pinnedInTwoGroups,
        testPinnedInTwoGroups,
      ],
      [
        'PINNED_TOO_MANY_GROUPS (shortfall)',
        ERROR_CODES.pinnedTooManyGroups,
        testPinnedTooManyGroupsShortfall,
      ],
      [
        'PINNED_TOO_MANY_GROUPS (exact)',
        ERROR_CODES.pinnedTooManyGroups,
        testPinnedTooManyGroupsExact,
      ],
      [
        'PINNED_TOO_MANY_GROUPS (surplus)',
        ERROR_CODES.pinnedTooManyGroups,
        testPinnedTooManyGroupsSurplus,
      ],
      [
        'PINNED_MIXED_SEX (warning)',
        WARNING_CODES.pinnedMixedSex,
        testPinnedMixedSex,
      ],
      [
        'KEEP_APART_IMPOSSIBLE, pinned',
        ERROR_CODES.keepApartImpossible,
        testKeepApartImpossiblePinned,
      ],
      [
        'TOGETHER_NO_ARRANGEMENT, pinned',
        ERROR_CODES.togetherNoArrangement,
        testTogetherNoArrangementPinned,
      ],
      [
        'KEEP_APART_NO_ARRANGEMENT, pinned',
        ERROR_CODES.keepApartNoArrangement,
        testKeepApartNoArrangementPinned,
      ],
      [
        'BOTH_RULES_NO_ARRANGEMENT, pinned',
        ERROR_CODES.bothRulesNoArrangement,
        testBothRulesNoArrangementPinned,
      ],
      [
        'SEX_SEPARATE_IMPOSSIBLE, pinned',
        ERROR_CODES.sexSeparateImpossible,
        testSexSeparateImpossiblePinned,
      ],
      [
        'TOGETHER_SEARCH_GAVE_UP, pinned',
        ERROR_CODES.togetherSearchGaveUp,
        testTogetherSearchGaveUpPinned,
      ],
      [
        'KEEP_APART_SEARCH_GAVE_UP, pinned',
        ERROR_CODES.keepApartSearchGaveUp,
        testKeepApartSearchGaveUpPinned,
      ],
      [
        'BOTH_RULES_SEARCH_GAVE_UP, pinned',
        ERROR_CODES.bothRulesSearchGaveUp,
        testBothRulesSearchGaveUpPinned,
      ],
      [
        'SEX_SEPARATE_SEARCH_GAVE_UP, pinned',
        ERROR_CODES.sexSeparateSearchGaveUp,
        testSexSeparateSearchGaveUpPinned,
      ],
      [
        'TOGETHER_UNIT_TOO_LARGE, pinned',
        ERROR_CODES.togetherUnitTooLarge,
        testTogetherUnitTooLargePinned,
      ],
      [
        'SEX_SEPARATE_SPLITS_UNIT, pinned',
        ERROR_CODES.sexSeparateSplitsUnit,
        testSexSeparateSplitsUnitPinned,
      ],
      [
        'TOGETHER_APART_CLASH, pinned',
        ERROR_CODES.togetherApartClash,
        testTogetherApartClashPinned,
      ],
    ];

    it.each(fixtures)(
      '%s renders the whole sentence correctly',
      (_name, _code, run) => {
        run();
      },
    );

    // Whole-branch review, I-5's own closing guard. A list of tests can be
    // added to and forgotten -- this is what stops that, the same way the
    // module-surface checklists at the top of this file stop a code being
    // added with no test at all: FAILS when a fixture above is added or
    // removed without this list changing to match, so the fixture table and
    // the checklist cannot silently drift apart.
    //
    // What this does NOT catch: a brand-new code that becomes reachable via
    // pins getting no fixture at all. "Reachable via pins" is a fact about
    // buildGroups's CONTROL FLOW that no export exposes, so there is no
    // runtime source of truth this list could be compared against the way
    // the module-surface checklists above compare directly against
    // ERROR_CODES/WARNING_CODES. What DOES catch that: those same two
    // checklists, which fail the instant grouping.ts gains or loses ANY
    // code, pinned-reachable or not -- that failure is what puts a human
    // back in this file at all. When it does: reread "Task 9. Pinned groups
    // are matched..." in buildGroups (and, for a `separate`-mode code,
    // restoreWholeClassCount just above it) to decide whether the new
    // code's data is computed differently once a pin is present. If it is,
    // add a fixture above that pins a roster into producing it for real and
    // renders the ACTUAL result in both languages, THEN add its code here.
    it('has a rendered-sentence fixture for every pinned-path code that needs one', () => {
      expect([...new Set(fixtures.map(([, code]) => code))].sort()).toEqual(
        [
          ERROR_CODES.pinnedSplitsUnit,
          ERROR_CODES.pinnedApartClash,
          ERROR_CODES.pinnedInTwoGroups,
          ERROR_CODES.pinnedTooManyGroups,
          WARNING_CODES.pinnedMixedSex,
          ERROR_CODES.keepApartImpossible,
          ERROR_CODES.togetherNoArrangement,
          ERROR_CODES.keepApartNoArrangement,
          ERROR_CODES.bothRulesNoArrangement,
          ERROR_CODES.sexSeparateImpossible,
          ERROR_CODES.togetherSearchGaveUp,
          ERROR_CODES.keepApartSearchGaveUp,
          ERROR_CODES.bothRulesSearchGaveUp,
          ERROR_CODES.sexSeparateSearchGaveUp,
          ERROR_CODES.togetherUnitTooLarge,
          ERROR_CODES.sexSeparateSplitsUnit,
          ERROR_CODES.togetherApartClash,
        ].sort(),
      );
    });
  });
});

// Task 10. The leftovers choice ('spread' vs 'bunch') predates blocks,
// absence and pins. These prove it still means what it says now that
// `targetSizes` is reached from several different callers, not just the
// plain roster.
describe('leftovers, against the new constraints', () => {
  // Corrected from the brief's own worked example (11 students / groups of
  // 4). Derivation: groupCount = floor(11/4) = 2, base = floor(11/2) = 5,
  // remainder = 1. `targetSizes`'s 'spread' branch round-robins the
  // remainder one slot at a time; with a remainder of exactly 1 it visits
  // only slot 0 -- the IDENTICAL thing 'bunch' does with any remainder. So
  // 'spread' and 'bunch' compute the same [6, 5] at 11 students, and a
  // caller that silently substituted one for the other would still pass.
  // 14 students has remainder 2 (base 4, groupCount 3), the smallest
  // remainder where the two rules actually diverge: spread [5,5,4] vs
  // bunch [6,4,4] (which itself violates "within one"). Confirmed by
  // mutation below, not just this arithmetic -- see the report.
  it('spread still keeps the largest and smallest group within one', () => {
    const out = buildGroups(
      base({
        students: 14,
        mode: { kind: 'perGroup', size: 4 },
        leftovers: 'spread',
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(shape(out.result.groups)).toEqual([5, 5, 4]);
  });

  // Corrected from the brief's own worked example (9 students / groupCount
  // 4). Derivation: base = floor(9/4) = 2, remainder = 9 - 8 = 1 -- the
  // exact same coincidence as above: 'bunch' and 'spread' both put the
  // single leftover in slot 0, giving [3,2,2,2] either way. 10 students at
  // the same groupCount has remainder 2 (base 2): bunch [4,2,2,2] vs spread
  // [3,3,2,2] -- now capable of catching a caller that silently substitutes
  // 'spread'.
  it('bunch puts the remainder in one group', () => {
    const out = buildGroups(
      base({
        students: 10,
        mode: { kind: 'groupCount', count: 4 },
        leftovers: 'bunch',
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(shape(out.result.groups)).toEqual([4, 2, 2, 2]);
  });

  it('a spare student carrying a together letter goes where the unit goes', () => {
    const out = buildGroups(
      base({
        students: [
          student({ number: 1, together: 'A' }),
          student({ number: 2, together: 'A' }),
          student({ number: 3 }),
          student({ number: 4 }),
          student({ number: 5 }),
        ],
        mode: { kind: 'perGroup', size: 2 },
        leftovers: 'spread',
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(groupOf(out.result.groups, 1)?.map((s) => s.number)).toContain(2);
  });

  // Corrected from the brief's own worked example (5 students / groupCount
  // 2). A groupCount of 2 can never produce a remainder above 1 (remainder
  // < groupCount always), so no roster at groupCount 2 could ever make
  // 'bunch' build a leftover group any different from 'spread' -- the
  // "leftover group" this test's own title describes cannot exist there.
  // groupCount 3 with an 8-student roster has remainder 2 (base 2): bunch
  // builds a real two-student-larger group ([4,2,2]), which is the shape
  // the title is actually about.
  //
  // Swept across seeds, not pinned to `base()`'s default. Proven by
  // mutation: disabling `assign`'s adjacency check entirely (the check this
  // test exists to pin) does NOT redden this test at seed 1 -- the shuffled
  // order that seed happens to produce keeps the two apart-lettered singles
  // in different groups even with nothing enforcing it. A single seed is
  // therefore not a real proof; sweeping catches the violation at several
  // seeds once the check is disabled (confirmed while writing this test,
  // reverted before committing).
  it('bunch never builds a leftover group that violates an apart letter', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const out = buildGroups(
        base({
          students: [
            student({ number: 1, apart: 'X' }),
            student({ number: 2, apart: 'X' }),
            student({ number: 3 }),
            student({ number: 4 }),
            student({ number: 5 }),
            student({ number: 6 }),
            student({ number: 7 }),
            student({ number: 8 }),
          ],
          mode: { kind: 'groupCount', count: 3 },
          leftovers: 'bunch',
          random: seeded(seed),
        }),
      );
      expect(out.ok, `seed ${seed}`).toBe(true);
      if (!out.ok) continue;
      expect(shape(out.result.groups), `seed ${seed}`).toEqual([4, 2, 2]);
      for (const g of out.result.groups) {
        expect(
          g.filter((s) => s.apart === 'X').length,
          `seed ${seed}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it('counts only present students when sizing', () => {
    const out = buildGroups(
      base({
        students: [
          ...Array.from({ length: 11 }, (_, i) => student({ number: i + 1 })),
          student({ number: 99, absent: true }),
        ],
        mode: { kind: 'perGroup', size: 4 },
        leftovers: 'spread',
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(shape(out.result.groups)).toEqual([6, 5]);
  });

  // Correction 3: the five tests above all reach `targetSizes` through the
  // SAME call site -- the plain pool, no pins, sexMode 'off'
  // (`poolSizes = targetSizes(pool.length, poolMode, leftovers)` in
  // `buildGroups`). That call site is reached with a REDUCED pool and a
  // REDUCED group count once a pin is in play (Task 9's `poolMode`/`pool`).
  // The pre-existing pinned-group invariant test ("invariants hold with a
  // pinned group too, under groupCount mode (F-5)") never varies `leftovers`
  // away from `base()`'s default 'spread' and never asserts a shape, only
  // totals -- so a caller that dropped the pool's own `leftovers` and
  // hardcoded 'spread' at this call site would still pass every test in
  // this file before this addition.
  describe('leftovers on the pinned pool', () => {
    // 15 students, one pinned alone (pool = 14), groupCount 4 -> the pool
    // gets 3 groups (4 requested, 1 already claimed by the pin). base =
    // floor(14/3) = 4, remainder = 2 -- chosen, as above, so 'bunch' and
    // 'spread' provably diverge on the POOL's sizes: bunch [6,4,4], spread
    // [5,5,4]. The pinned student's own group of 1 rides along in
    // `shape()`'s output unchanged either way.
    const roster = Array.from({ length: 15 }, (_, i) =>
      student({ number: i + 1 }),
    );

    it('bunch bunches the POOL remainder, not the whole roster', () => {
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'groupCount', count: 4 },
          leftovers: 'bunch',
          pinned: [[roster[0]]],
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(shape(out.result.groups)).toEqual([6, 4, 4, 1]);
    });

    it('contrasts with spread on the identical pinned roster', () => {
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'groupCount', count: 4 },
          leftovers: 'spread',
          pinned: [[roster[0]]],
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(shape(out.result.groups)).toEqual([5, 5, 4, 1]);
    });
  });

  // Correction 3: "leftovers under separate (both sides)". Neither sex
  // spills here -- each gets its own independent `ownSizes` call from
  // `buildSeparateGroups`'s "neither sex spills" branch -- so this is the
  // one shape in this file that proves BOTH sides' own sizing receives the
  // teacher's `leftovers` choice, not just whichever side a spill test
  // happens to size (the pre-existing "Fix round 1, F-4" describe block
  // below only ever sizes the COMBINED spill total, never a side sized on
  // its own).
  describe('leftovers under separate mode, when neither sex spills', () => {
    const M = (number: number) => student({ number, sex: 'M' as const });
    const F = (number: number) => student({ number, sex: 'F' as const });
    // 14 boys / groups of 4 -> 3 groups, base 4, remainder 2: bunch
    // [6,4,4], spread [5,5,4]. 18 girls / groups of 4 -> 4 groups, base 4,
    // remainder 2: bunch [6,4,4,4], spread [5,5,4,4]. Both sides chosen
    // with remainder >= 2, for the same reason as every corrected test
    // above -- remainder 1 cannot distinguish the two rules.
    const roster = [
      ...Array.from({ length: 14 }, (_, i) => M(i + 1)),
      ...Array.from({ length: 18 }, (_, i) => F(i + 15)),
    ];

    it("bunches each side's own remainder separately", () => {
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'perGroup', size: 4 },
          sexMode: 'separate',
          leftovers: 'bunch',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.warnings).toEqual([]);
      const boysGroups = out.result.groups.filter((g) => g[0].sex === 'M');
      const girlsGroups = out.result.groups.filter((g) => g[0].sex === 'F');
      expect(shape(boysGroups)).toEqual([6, 4, 4]);
      expect(shape(girlsGroups)).toEqual([6, 4, 4, 4]);
    });

    it('contrasts with spread on the identical roster, on both sides', () => {
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'perGroup', size: 4 },
          sexMode: 'separate',
          leftovers: 'spread',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const boysGroups = out.result.groups.filter((g) => g[0].sex === 'M');
      const girlsGroups = out.result.groups.filter((g) => g[0].sex === 'F');
      expect(shape(boysGroups)).toEqual([5, 5, 4]);
      expect(shape(girlsGroups)).toEqual([5, 5, 4, 4]);
    });
  });

  // Correction 3 extension: every existing spill test in this file --
  // including the brief's own "Fix round 1, F-4" describe block below --
  // spills GIRLS into boys' groups. `buildSeparateGroups`'s OTHER spill
  // branch, boys spilling into girls (`boysCount > 0 && boysGroups === 0`),
  // has never been reached by any test in this file, with either
  // `leftovers` value. It is the same `sizesForCount` call as the
  // girls-spill branch, just sized from the girls' own group count instead
  // of the boys' -- a genuinely separate call site, covered here for the
  // same reason Correction 3 asks for "both sides".
  describe('leftovers under separate mode, at the spill boundary -- boys spilling into girls', () => {
    const M = (number: number) => student({ number, sex: 'M' as const });
    const F = (number: number) => student({ number, sex: 'F' as const });
    // 2 boys, 12 girls, groups of 4: girls make exactly 3 groups (12/4);
    // boys' 2/4 floors to 0, so boys spill into girls' 3 groups. combined =
    // sizesForCount(14, 3, leftovers) -- base 4, remainder 2 -- bunch
    // [6,4,4], spread [5,5,4].
    const roster = [
      M(1),
      M(2),
      ...Array.from({ length: 12 }, (_, i) => F(i + 3)),
    ];

    it('bunch: [6, 4, 4], boys named in the spillover warning', () => {
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'perGroup', size: 4 },
          sexMode: 'separate',
          leftovers: 'bunch',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(shape(out.result.groups)).toEqual([6, 4, 4]);
      expect(out.result.warnings).toEqual([
        { code: WARNING_CODES.sexSpillover, students: [1, 2], sex: 'M' },
      ]);
    });

    it('contrasts with spread on the identical roster', () => {
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'perGroup', size: 4 },
          sexMode: 'separate',
          leftovers: 'spread',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(shape(out.result.groups)).toEqual([5, 5, 4]);
    });
  });

  // Correction 3 extension: `ownSizes` has TWO branches -- `perGroup` calls
  // `targetSizes` directly (exercised above, "when neither sex spills"),
  // `groupCount` instead goes through `sizesForCount`, sizing each side at
  // its OWN allocated group count from `allocateSexGroups`. A textually
  // different call site from either branch above, and untouched by any
  // test in this file until now.
  describe('leftovers under separate mode, groupCount allocation, when neither sex spills', () => {
    const M = (number: number) => student({ number, sex: 'M' as const });
    const F = (number: number) => student({ number, sex: 'F' as const });
    // 14 boys, 9 girls, 5 groups requested. Proportional shares: boys
    // 14/23*5 = 3.043, girls 9/23*5 = 1.957 -- floors 3 and 1 sum to 4,
    // one group of remainder left over, and girls' fractional part (0.957)
    // is larger, so girls claim it: boys 3 groups, girls 2. Both sides
    // nonzero -- no spill. Boys' own sizing, `sizesForCount(14, 3,
    // leftovers)`: base = floor(14/3) = 4, remainder = 2 -- bunch [6,4,4],
    // spread [5,5,4]. (Girls' own sizing, sizesForCount(9, 2, leftovers),
    // has remainder 1 -- the same coincidence as the corrected brief tests
    // -- so only the boys' side is asserted; the boys' side alone is
    // enough to prove this call site threads `leftovers` through.)
    const roster = [
      ...Array.from({ length: 14 }, (_, i) => M(i + 1)),
      ...Array.from({ length: 9 }, (_, i) => F(i + 15)),
    ];

    it("bunches the boys' own allocated remainder", () => {
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'groupCount', count: 5 },
          sexMode: 'separate',
          leftovers: 'bunch',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.result.warnings).toEqual([]);
      const boysGroups = out.result.groups.filter((g) => g[0].sex === 'M');
      expect(boysGroups).toHaveLength(3);
      expect(shape(boysGroups)).toEqual([6, 4, 4]);
    });

    it('contrasts with spread on the identical roster', () => {
      const out = buildGroups(
        base({
          students: roster,
          mode: { kind: 'groupCount', count: 5 },
          sexMode: 'separate',
          leftovers: 'spread',
        }),
      );
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const boysGroups = out.result.groups.filter((g) => g[0].sex === 'M');
      expect(shape(boysGroups)).toEqual([5, 5, 4]);
    });
  });
});
