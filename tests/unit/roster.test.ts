import { describe, it, expect } from 'vitest';
import {
  MAX_ROSTER,
  availableLetters,
  nextNumber,
  rosterAtLimit,
  rosterCounts,
  rosterOpenProblem,
  rosterProblems,
  rosterRoomProblem,
  rosterWarnings,
  serialiseForCompare,
  studentsBoxLocked,
} from '../../src/lib/roster';
import * as roster from '../../src/lib/roster';
import { student } from './factories';
import type { Student } from '../../src/lib/grouping';
import { floorBreach } from '../floors';
import { searched } from '../source-files';
import { getStrings } from '../../src/lib/i18n';

// The catalogues as a page receives them: every message compiled into a
// function of its named slots (#136). A raw catalogue holds templates.
const en = getStrings('en');
const id = getStrings('id');

// Mirrors grouping.test.ts's own "the module surface" test (F-2 there):
// pins exactly what this module exports, so an addition or a removal has
// to change this list deliberately rather than slide through unnoticed. A
// new entry belongs here only once something outside this file actually
// calls it.
describe('the module surface', () => {
  it('exports nothing that nothing uses', () => {
    expect(Object.keys(roster).sort()).toEqual([
      'LETTERS',
      'MAX_ROSTER',
      'availableLetters',
      'nextNumber',
      'rosterAtLimit',
      'rosterCounts',
      'rosterOpenProblem',
      'rosterProblems',
      'rosterRoomProblem',
      'rosterWarnings',
      'serialiseForCompare',
      'studentsBoxLocked',
    ]);
  });
});

// Stage 3, Task 7 (design spec section 4, "The Students box -- an input,
// then a read-out"). The only fact that decides whether #cg-count can still
// be typed into: whether a roster exists at all. Deliberately blind to
// MAX_ROSTER, absence, names or anything else about the roster's CONTENTS --
// this is what closes X-08 ("there is no way to type the box past
// MAX_ROSTER with a list present") more strongly than the letter of that
// requirement asks for: a box that cannot be typed into AT ALL can never
// disagree with a list that exists, at any size.
describe('studentsBoxLocked', () => {
  it('is false on an empty roster -- the box stays the input', () => {
    expect(studentsBoxLocked([])).toBe(false);
  });

  it('is true the moment even one student exists', () => {
    expect(studentsBoxLocked([student({ number: 1 })])).toBe(true);
  });

  // Not just true at one size -- true regardless of it, including AT
  // MAX_ROSTER's own ceiling. A mutant that swapped `> 0` for a bounds
  // check tied to MAX_ROSTER would still pass the test above but fail this
  // one.
  it('stays true at any roster size, including MAX_ROSTER', () => {
    const full = Array.from({ length: MAX_ROSTER }, (_, i) =>
      student({ number: i + 1 }),
    );
    expect(studentsBoxLocked(full)).toBe(true);
  });
});

// Stage 3, Task 6 (design spec section 4, "Two size limits, not one" /
// "Adding a row at 100"). The two ROSTER-side outcomes MAX_ROSTER has:
// `rosterAtLimit` gates `+ Add student`/`+ Add several…`'s own `disabled`
// (roster-ui.ts's buildToolbar); `rosterRoomProblem`, below, is the other
// -- refusing a BATCH that would cross the ceiling even while under it.
// `rosterOpenProblem`, further below, is the THIRD outcome (opening
// Student details with no list yet, over a too-high count) -- a different
// question again, so it gets its own describe block.
describe('rosterAtLimit', () => {
  it('is false below the limit', () => {
    const full = Array.from({ length: 99 }, (_, i) =>
      student({ number: i + 1 }),
    );
    expect(rosterAtLimit(full)).toBe(false);
  });

  it('is true exactly at the limit', () => {
    const full = Array.from({ length: 100 }, (_, i) =>
      student({ number: i + 1 }),
    );
    expect(rosterAtLimit(full)).toBe(true);
  });

  // Not reachable through this stage's own UI (both add controls are
  // disabled at exactly 100, and `+ Add several…`'s own refusal --
  // `rosterRoomProblem` -- never lets a batch land the roster past it
  // either), but pinned anyway: a future caller (a CSV import over 100
  // rows, say) must not read an over-full roster as merely "not at the
  // limit".
  it('is true past the limit', () => {
    const over = Array.from({ length: 101 }, (_, i) =>
      student({ number: i + 1 }),
    );
    expect(rosterAtLimit(over)).toBe(true);
  });

  it('is false on an empty roster', () => {
    expect(rosterAtLimit([])).toBe(false);
  });
});

describe('rosterRoomProblem', () => {
  it('is quiet when the whole batch fits with room to spare', () => {
    expect(rosterRoomProblem([student({ number: 1 })], 5, en)).toBeNull();
  });

  // The boundary itself: exactly filling the remaining room is NOT a
  // refusal -- "would CROSS it" (design spec section 4), not "would reach
  // it". A mutant that used `<` instead of `<=` for the fits-check would
  // fail this by refusing a batch that lands EXACTLY on 100.
  it('is quiet when the batch exactly fills the remaining room', () => {
    const roster90 = Array.from({ length: 90 }, (_, i) =>
      student({ number: i + 1 }),
    );
    expect(rosterRoomProblem(roster90, 10, en)).toBeNull();
  });

  it('refuses a batch that would cross the limit, naming how many rows are free', () => {
    const roster90 = Array.from({ length: 90 }, (_, i) =>
      student({ number: i + 1 }),
    );
    expect(rosterRoomProblem(roster90, 20, en)).toBe(
      'There is room for 10 more students.',
    );
  });

  // One past the boundary -- the smallest possible refusal, distinguishing
  // this from a mutant that only refuses a batch far larger than the room.
  it('refuses a batch that is just one over the room', () => {
    const roster90 = Array.from({ length: 90 }, (_, i) =>
      student({ number: i + 1 }),
    );
    expect(rosterRoomProblem(roster90, 11, en)).toBe(
      'There is room for 10 more students.',
    );
  });

  // English inflects (this file's established convention, e.g.
  // rosterCountLine/rosterGapWarning) -- exactly one free row needs its own
  // grammatical branch: "1 more student", never "1 more students".
  it('uses singular grammar for exactly one free row', () => {
    const roster99 = Array.from({ length: 99 }, (_, i) =>
      student({ number: i + 1 }),
    );
    expect(rosterRoomProblem(roster99, 2, en)).toBe(
      'There is room for 1 more student.',
    );
  });

  it('is quiet on an empty roster requesting fewer than MAX_ROSTER', () => {
    expect(rosterRoomProblem([], 50, en)).toBeNull();
  });

  // Already at the ceiling -- design spec section 4's own point that
  // `+ Add several…` "refuses a number that would cross it" applies even
  // to the smallest possible request once there is no room left at all.
  // (Unreachable through the page's own UI, since both add controls are
  // already `disabled` by `rosterAtLimit` at this point -- pinned at the
  // unit level regardless, since nothing here enforces that precondition.)
  it('refuses even a single student once already at the limit', () => {
    const roster100 = Array.from({ length: 100 }, (_, i) =>
      student({ number: i + 1 }),
    );
    expect(rosterRoomProblem(roster100, 1, en)).toBe(
      'There is room for 0 more students.',
    );
  });

  it('renders in Indonesian too, not a copy of the English sentence', () => {
    const roster90 = Array.from({ length: 90 }, (_, i) =>
      student({ number: i + 1 }),
    );
    const msg = rosterRoomProblem(roster90, 20, id);
    expect(msg).toContain('10');
    expect(msg).not.toContain('There is room');
  });
});

// Design spec section 4: "Opening Student details with the count above 100
// -- the section refuses to open and says why... The count itself is left
// alone." Reachable only with NO roster yet (`rosterLength === 0`) --
// `rosterAtLimit`, above, is what governs a roster that already exists.
describe('rosterOpenProblem', () => {
  it('is quiet when there is no roster and the count is within the limit', () => {
    expect(rosterOpenProblem(0, 24, en)).toBeNull();
  });

  // The boundary: exactly 100 is not "above" it.
  it('is quiet when there is no roster and the count is exactly at the limit', () => {
    expect(rosterOpenProblem(0, 100, en)).toBeNull();
  });

  it('refuses when there is no roster and the count is above the limit', () => {
    expect(rosterOpenProblem(0, 300, en)).toBe(
      'Student details holds up to 100 students. Lower the number to ' +
        'list this class individually.',
    );
  });

  // A roster already exists -- a different question than the bare count,
  // and one `rosterAtLimit` answers instead. A mutant that dropped the
  // `rosterLength === 0` half of the guard would refuse this too.
  it('is quiet once a roster already exists, regardless of the count', () => {
    expect(rosterOpenProblem(1, 300, en)).toBeNull();
  });

  it('renders in Indonesian too, not a copy of the English sentence', () => {
    const msg = rosterOpenProblem(0, 300, id);
    expect(msg).toContain('100');
    expect(msg).not.toContain('Student details holds up');
  });
});

// Design spec section 4, "Two size limits, not one": Student details holds
// up to 100 -- twice the largest real class, so no teacher meets it by
// accident. MAX_STUDENTS (grouping.ts, 500) is the other limit and is
// pinned in its own file; this one belongs here because Student details is
// what it governs. Nothing in this task enforces it yet (opening the
// section above the limit, and the two add controls, are a later task's
// job) -- exported now so every later call site imports the same number
// rather than each hard-coding 100 by hand.
describe('MAX_ROSTER', () => {
  it('is 100', () => {
    expect(MAX_ROSTER).toBe(100);
  });
});

describe('nextNumber', () => {
  it('starts at 1', () => expect(nextNumber([])).toBe(1));

  it('takes one past the highest, not the first free gap', () => {
    // A gap is usually the number of a child who has left. Filling it would
    // quietly hand their number to somebody else.
    const roster = [1, 2, 3, 5].map((n) => student({ number: n }));
    expect(nextNumber(roster)).toBe(6);
  });

  it('is not fooled by an unsorted roster', () => {
    expect(nextNumber([5, 1, 3].map((n) => student({ number: n })))).toBe(6);
  });

  it('counts absent students — their number is still taken', () => {
    expect(nextNumber([student({ number: 9, absent: true })])).toBe(10);
  });
});

describe('rosterCounts', () => {
  it('counts names, absences and each letter kind', () => {
    expect(
      rosterCounts([
        student({ number: 1, name: 'Ana', together: 'A' }),
        student({ number: 2, name: 'Budi', together: 'A' }),
        student({ number: 3, absent: true, apart: 'X' }),
        student({ number: 4 }),
      ]),
    ).toEqual({ named: 2, absent: 1, together: 2, apart: 1 });
  });

  it('counts a student carrying both letters under both', () => {
    expect(
      rosterCounts([student({ number: 1, together: 'A', apart: 'X' })]),
    ).toMatchObject({ together: 1, apart: 1 });
  });

  it('is all zero for an empty roster', () => {
    // The `▸ Student details · none added` branch (sections.ts) is chosen
    // on `rosterSize === 0` before it ever looks at these four counts, but
    // this pins that an empty INPUT to rosterCounts itself is inert rather
    // than, say, throwing or returning NaN from a reduce with no seed.
    expect(rosterCounts([])).toEqual({
      named: 0,
      absent: 0,
      together: 0,
      apart: 0,
    });
  });

  // A name typed and then fully deleted is `''`, not `null` -- the table
  // (a later task) clears an input to an empty string, it does not delete
  // the field. Only `null` (never opened, never typed in) should read as
  // unnamed; a mutant that dropped the `!== ''` half of the guard and kept
  // only `!== null` would still pass every test above (none of them ever
  // gives a student an empty-string name) but would count this student as
  // named.
  it('does not count an emptied name as named', () => {
    expect(rosterCounts([student({ number: 1, name: '' })]).named).toBe(0);
  });
});

describe('serialiseForCompare', () => {
  it('changes when a student is marked absent', () => {
    const a = [student({ number: 1 })];
    const b = [student({ number: 1, absent: true })];
    expect(serialiseForCompare(a)).not.toBe(serialiseForCompare(b));
  });

  it('does NOT change when only a name changes', () => {
    // A rename moves nobody, so it must not mark the groups out of date.
    const a = [student({ number: 1, name: 'Ana' })];
    const b = [student({ number: 1, name: 'Anna' })];
    expect(serialiseForCompare(a)).toBe(serialiseForCompare(b));
  });

  it('changes when a letter changes', () => {
    expect(serialiseForCompare([student({ number: 1 })])).not.toBe(
      serialiseForCompare([student({ number: 1, together: 'A' })]),
    );
  });

  // The brief's own test above only ever exercises `together`. A mutant
  // that dropped `apart` from the template string entirely would still
  // pass it -- this is the one that would catch it.
  it('changes when the apart letter changes, independently of together', () => {
    expect(serialiseForCompare([student({ number: 1 })])).not.toBe(
      serialiseForCompare([student({ number: 1, apart: 'X' })]),
    );
  });

  it('changes when a sex changes', () => {
    expect(serialiseForCompare([student({ number: 1 })])).not.toBe(
      serialiseForCompare([student({ number: 1, sex: 'M' })]),
    );
  });

  // Every field this function reads is joined into ONE string per student
  // with `:` -- a naive template could let two different rosters collide
  // on the same string (e.g. a number of 1 and a sex of "M2" vs a number of
  // 12 and no sex). Not a realistic input (numbers are whole, sex is a
  // fixed domain), but this pins that the two given here, which COULD
  // collide under a careless separator choice, do not.
  it('does not collide two different rosters onto the same string', () => {
    const a = [student({ number: 1, together: 'AB' })];
    const b = [student({ number: 1, together: 'A' }), student({ number: 2 })];
    // Not a claim these two happen to differ for any particular reason --
    // just that distinct rosters produce distinct strings.
    expect(serialiseForCompare(a)).not.toBe(serialiseForCompare(b));
  });

  // Sorted before joining (the implementation's own choice): the roster
  // re-rendering in a new order, or a student removed and an equal one
  // re-added, must not read as a change when nothing about any student
  // did. Without the sort, this would fail because the two arrays join in
  // their given order rather than a canonical one.
  it('does not change when the same students are listed in a different order', () => {
    const a = [
      student({ number: 1, name: 'Ana' }),
      student({ number: 2, absent: true }),
    ];
    const b = [
      student({ number: 2, absent: true }),
      student({ number: 1, name: 'Ana' }),
    ];
    expect(serialiseForCompare(a)).toBe(serialiseForCompare(b));
  });

  it('changes when a student is added', () => {
    const a = [student({ number: 1 })];
    const b = [student({ number: 1 }), student({ number: 2 })];
    expect(serialiseForCompare(a)).not.toBe(serialiseForCompare(b));
  });
});

// Design spec section 4, "Together / apart": "chosen from a dropdown that
// grows as needed (A, then B once A is used, and so on)." Together and
// apart grow INDEPENDENTLY -- a together "A" and an apart "A" are unrelated
// domains, so the field a caller asks about is what the highest-used letter
// is measured against, never both together.
describe('availableLetters', () => {
  it('offers just A when nobody has used a letter yet', () => {
    expect(availableLetters([student({ number: 1 })], 'together')).toEqual([
      'A',
    ]);
  });

  it('is quiet on an empty roster -- still just A, not an empty list', () => {
    // A blank roster has no highest letter to grow from, so this must not
    // throw or return [] -- there is always at least one letter to offer
    // the FIRST student who gets one.
    expect(availableLetters([], 'together')).toEqual(['A']);
  });

  it('grows to B once A is used', () => {
    expect(
      availableLetters([student({ number: 1, together: 'A' })], 'together'),
    ).toEqual(['A', 'B']);
  });

  it('grows to one past the highest letter in use, not just one more than the first', () => {
    // A mutant that always appended exactly one letter past the FIRST
    // student's own letter, rather than the highest across the whole
    // roster, would still pass the test above but fail this one.
    expect(
      availableLetters(
        [
          student({ number: 1, together: 'A' }),
          student({ number: 2, together: 'C' }),
        ],
        'together',
      ),
    ).toEqual(['A', 'B', 'C', 'D']);
  });

  it('together and apart grow independently', () => {
    const roster = [
      student({ number: 1, together: 'A', apart: null }),
      student({ number: 2, together: null, apart: 'A' }),
    ];
    // Both fields have exactly one letter in use, but a mutant that read
    // BOTH fields into one shared count would grow one of them too far.
    expect(availableLetters(roster, 'together')).toEqual(['A', 'B']);
    expect(availableLetters(roster, 'apart')).toEqual(['A', 'B']);
  });

  it('a student with no letter in this field does not affect the count', () => {
    expect(
      availableLetters(
        [student({ number: 1, together: null }), student({ number: 2 })],
        'together',
      ),
    ).toEqual(['A']);
  });

  it('never offers a letter past Z', () => {
    expect(
      availableLetters([student({ number: 1, together: 'Z' })], 'together'),
    ).toEqual(
      Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
    );
  });
});

// Stage 3, Task 5 (design spec section 4, "Numbers" / "Together / apart"):
// caught as it is TYPED, in the table -- never held back until "Make
// groups" is pressed. Mirrors the engine's own duplicateNumber/
// togetherApartClash guards (grouping.ts) on the identical data, one
// keystroke earlier, in a sentence written for the moment of typing rather
// than the moment of shuffling.
describe('rosterProblems', () => {
  it('finds a duplicate number and names who already holds it', () => {
    const problems = rosterProblems(
      [
        student({ sex: 'M', number: 5, name: 'Eko' }),
        student({ sex: 'M', number: 5, name: 'Ana' }),
      ],
      en,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('duplicate');
    expect(problems[0].message).toBe(
      'Number 5 is already used by Eko. Every student needs their own.',
    );
  });

  it('finds a together-and-apart clash', () => {
    const problems = rosterProblems(
      [
        student({
          sex: 'M',
          number: 1,
          name: 'Ana',
          together: 'A',
          apart: 'X',
        }),
        student({
          sex: 'M',
          number: 2,
          name: 'Budi',
          together: 'A',
          apart: 'X',
        }),
      ],
      en,
    );
    expect(problems[0].kind).toBe('clash');
    expect(problems[0].message).toBe(
      'Ana and Budi are kept together, so they cannot also be kept apart.',
    );
  });

  it('is quiet when the same apart letter is on students not kept together', () => {
    const students = [
      student({ sex: 'M', number: 1, together: 'A', apart: 'X' }),
      student({ sex: 'M', number: 2, together: 'A' }),
      student({ sex: 'M', number: 3, apart: 'X' }),
    ];
    expect(
      searched(rosterProblems(students, en), {
        of: students,
        what: 'students handed to rosterProblems',
      }),
    ).toEqual([]);
    expect(
      floorBreach('roster/apart-letter-not-kept-together', students.length),
    ).toBeUndefined();
  });

  it('names an unnamed student as Student N in the message', () => {
    const problems = rosterProblems(
      [student({ sex: 'M', number: 5 }), student({ sex: 'M', number: 5 })],
      en,
    );
    expect(problems[0].message).toContain('Student 5');
  });

  // Not in the brief -- pins that `students` (what a future caller would
  // use to locate the affected row, per Problem's own doc comment) carries
  // the real number involved, for both kinds.
  it('the duplicate problem names the duplicated number in students', () => {
    const problems = rosterProblems(
      [student({ sex: 'M', number: 7 }), student({ sex: 'M', number: 7 })],
      en,
    );
    expect(problems[0].students).toEqual([7]);
  });

  it('the clash problem names every clashing number in students', () => {
    const problems = rosterProblems(
      [
        student({ sex: 'M', number: 1, together: 'A', apart: 'X' }),
        student({ sex: 'M', number: 2, together: 'A', apart: 'X' }),
      ],
      en,
    );
    expect(problems[0].students).toEqual([1, 2]);
  });

  // A third row claiming the same number is still ONE fact to fix, not a
  // second, redundant sentence repeating it. A mutant that reported once
  // PER REPEAT, rather than once per duplicated NUMBER, would fail this by
  // returning length 2.
  it('reports a number used three times only once', () => {
    const problems = rosterProblems(
      [
        student({ sex: 'M', number: 5, name: 'Eko' }),
        student({ sex: 'M', number: 5, name: 'Ana' }),
        student({ sex: 'M', number: 5, name: 'Budi' }),
      ],
      en,
    );
    expect(problems).toHaveLength(1);
  });

  // Two DIFFERENT duplicated numbers are two DIFFERENT facts, and both must
  // be reported -- distinguishing this from "collapse to one" directly
  // above.
  it('reports two different duplicated numbers as two separate problems', () => {
    const problems = rosterProblems(
      [
        student({ sex: 'M', number: 5 }),
        student({ sex: 'M', number: 5 }),
        student({ sex: 'M', number: 9 }),
        student({ sex: 'M', number: 9 }),
      ],
      en,
    );
    expect(problems.filter((p) => p.kind === 'duplicate')).toHaveLength(2);
  });

  // Design spec section 4, "Absence": "Their letters lapse with them...
  // constrains nobody." A clash that exists only because one holder of the
  // shared apart-letter is absent must not block a shuffle that would, in
  // fact, succeed -- mirroring the engine's own togetherApartClash, checked
  // against the present pool, never the raw roster.
  it('an absent student holding one side of a clash does not trigger it', () => {
    const students = [
      student({
        sex: 'M',
        number: 1,
        together: 'A',
        apart: 'X',
        absent: true,
      }),
      student({ sex: 'M', number: 2, together: 'A', apart: 'X' }),
    ];
    const problems = rosterProblems(students, en);
    expect(
      searched(problems, {
        of: students,
        what: 'students handed to rosterProblems',
      }),
    ).toEqual([]);
    expect(
      floorBreach('roster/absent-holder-of-a-clash', students.length),
    ).toBeUndefined();
  });

  // ...but a duplicate number is still caught even when one holder is
  // absent -- a register number is still taken while its holder is out
  // (nextNumber's own doc comment, above, gives the identical reasoning),
  // and the engine's own duplicateNumber check runs BEFORE its absence
  // filter for the same reason.
  it('a duplicate number is still caught when one holder is absent', () => {
    const problems = rosterProblems(
      [
        student({ sex: 'M', number: 5, name: 'Eko', absent: true }),
        student({ sex: 'M', number: 5, name: 'Ana' }),
      ],
      en,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('duplicate');
  });

  it('is quiet on an empty roster', () => {
    const cases = [{ case: 'an empty roster', students: [] as Student[] }];
    expect(
      searched(
        cases.flatMap(({ students }) => rosterProblems(students, en)),
        { of: cases, what: 'rosters handed to rosterProblems' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('roster/empty-roster-problems', cases.length),
    ).toBeUndefined();
  });

  it('renders the clash message in Indonesian too, not a copy of the English sentence', () => {
    const problems = rosterProblems(
      [
        student({
          sex: 'M',
          number: 1,
          name: 'Ana',
          together: 'A',
          apart: 'X',
        }),
        student({
          sex: 'M',
          number: 2,
          name: 'Budi',
          together: 'A',
          apart: 'X',
        }),
      ],
      id,
    );
    expect(problems[0].message).not.toBe(
      'Ana and Budi are kept together, so they cannot also be kept apart.',
    );
    expect(problems[0].message).toContain('Ana');
    expect(problems[0].message).toContain('Budi');
  });
});

describe('rosterWarnings', () => {
  it('warns about a gap, naming the missing numbers', () => {
    expect(
      rosterWarnings(
        [1, 2, 3, 5, 8].map((n) => student({ number: n })),
        en,
      ),
    ).toEqual([
      'Your class list looks incomplete. Numbers 4, 6 and 7 are missing. ' +
        'That is fine if those children have left — open Student details to check.',
    ]);
  });

  it('is quiet when the numbers run without gaps', () => {
    const students = [1, 2, 3].map((n) => student({ number: n }));
    expect(
      searched(rosterWarnings(students, en), {
        of: students,
        what: 'students handed to rosterWarnings',
      }),
    ).toEqual([]);
    expect(
      floorBreach('roster/numbers-without-gaps', students.length),
    ).toBeUndefined();
  });

  it('does not treat a roster starting above 1 as a gap', () => {
    // A class numbered from 101 is a register, not an incomplete list.
    const students = [101, 102].map((n) => student({ number: n }));
    expect(
      searched(rosterWarnings(students, en), {
        of: students,
        what: 'students handed to rosterWarnings',
      }),
    ).toEqual([]);
    expect(
      floorBreach('roster/numbered-from-above-one', students.length),
    ).toBeUndefined();
  });

  // Not in the brief -- English inflects (this file's established
  // convention elsewhere, e.g. rosterCountLine/resultsSummary), so a SINGLE
  // missing number needs its own grammatical branch: "Number 3 is missing",
  // never "Numbers 3 are missing".
  it('uses singular grammar for exactly one missing number', () => {
    expect(
      rosterWarnings(
        [1, 2, 4].map((n) => student({ number: n })),
        en,
      ),
    ).toEqual([
      'Your class list looks incomplete. Number 3 is missing. ' +
        'That is fine if those children have left — open Student details to check.',
    ]);
  });

  it('is quiet on an empty roster', () => {
    const cases = [{ case: 'an empty roster', students: [] as Student[] }];
    expect(
      searched(
        cases.flatMap(({ students }) => rosterWarnings(students, en)),
        { of: cases, what: 'rosters handed to rosterWarnings' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('roster/empty-roster-warnings', cases.length),
    ).toBeUndefined();
  });

  // A single-student roster has no internal range to be missing a number
  // FROM. This is the exact scenario the uncommitted #9 task brief's own e2e snippet got
  // wrong -- see this task's own report -- so it is pinned here at the unit
  // level too: filling the only row's number produces no gap, whatever it
  // is filled with.
  it('is quiet on a single-student roster, however it is numbered', () => {
    const students = [student({ number: 4 })];
    expect(
      searched(rosterWarnings(students, en), {
        of: students,
        what: 'students handed to rosterWarnings',
      }),
    ).toEqual([]);
    expect(
      floorBreach('roster/single-student', students.length),
    ).toBeUndefined();
  });

  it('is quiet when a duplicate, not a gap, is what is wrong', () => {
    // rosterProblems' own job, not this function's -- a repeated number is
    // not a missing one.
    const students = [student({ number: 1 }), student({ number: 1 })];
    expect(
      searched(rosterWarnings(students, en), {
        of: students,
        what: 'students handed to rosterWarnings',
      }),
    ).toEqual([]);
    expect(
      floorBreach('roster/duplicate-not-gap', students.length),
    ).toBeUndefined();
  });

  // Absence does not touch the register -- design spec section 4's "their
  // number is still taken" (nextNumber's own doc comment, above) applies
  // here too: an absent student's number still closes the gap it would
  // otherwise leave.
  it('an absent student still counts as holding their number, closing the gap', () => {
    const students = [1, 2, 3].map((n) =>
      student({ number: n, absent: n === 2 }),
    );
    expect(
      searched(rosterWarnings(students, en), {
        of: students,
        what: 'students handed to rosterWarnings',
      }),
    ).toEqual([]);
    expect(
      floorBreach('roster/absent-closes-the-gap', students.length),
    ).toBeUndefined();
  });

  it('renders in Indonesian too, not a copy of the English sentence', () => {
    const msg = rosterWarnings(
      [1, 2, 3, 5, 8].map((n) => student({ number: n })),
      id,
    )[0];
    expect(msg).toContain('4');
    expect(msg).toContain('6');
    expect(msg).toContain('7');
    expect(msg).not.toContain('looks incomplete');
  });
});

/**
 * Review finding, fixed. The gap warning must not enumerate a range wider
 * than the roster can hold.
 */
describe('rosterWarnings does not enumerate an unbounded range', () => {
  // A school roll number puts `max - min` in the tens of millions. The old
  // loop built an array that large and joined it into one enormous
  // sentence: the tab locked up with no paint and no way out but closing
  // it, taking the roster the teacher had just imported with it.
  //
  // Timed, because "returns []" alone would also pass after ten minutes of
  // building an array it then threw away.
  it('returns nothing, promptly, for a range wider than MAX_ROSTER', () => {
    const started = Date.now();
    const students = [student({ number: 1 }), student({ number: 99999999 })];
    const out = rosterWarnings(students, en);
    expect(
      searched(out, {
        of: students,
        what: 'students handed to rosterWarnings',
      }),
    ).toEqual([]);
    expect(
      floorBreach('roster/range-wider-than-max', students.length),
    ).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(200);
  });

  // The warning it is bounded FOR still fires: this is a limit, not a
  // removal. Without this the fix could be "always return []" and pass.
  it('still names a small gap', () => {
    expect(
      rosterWarnings(
        [
          student({ number: 1 }),
          student({ number: 2 }),
          student({ number: 4 }),
        ],
        en,
      ),
    ).toHaveLength(1);
  });

  // The boundary itself, both sides, so an off-by-one cannot survive.
  it('warns up to the limit and stops beyond it', () => {
    const at = [student({ number: 1 }), student({ number: MAX_ROSTER })];
    const past = [student({ number: 1 }), student({ number: MAX_ROSTER + 1 })];
    expect(rosterWarnings(at, en)).toHaveLength(1);
    expect(
      searched(rosterWarnings(past, en), {
        of: past,
        what: 'students handed to rosterWarnings',
      }),
    ).toEqual([]);
    expect(
      floorBreach('roster/one-past-the-limit', past.length),
    ).toBeUndefined();
  });
});
