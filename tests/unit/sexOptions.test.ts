import { describe, it, expect } from 'vitest';
import { sexWhy, sexWhyReturning } from '../../src/lib/sexOptions';
import { student } from './factories';
import type { Student } from '../../src/lib/grouping';
import { getStrings } from '../../src/lib/i18n';

// The catalogues as a page receives them: every message compiled into a
// function of its named slots (#136). A raw catalogue holds templates.
const en = getStrings('en');
const id = getStrings('id');

describe('sexWhy — why the two sex switches are disabled', () => {
  it('says so with its own wording when there is no list at all', () => {
    expect(sexWhy(null, en)).toBe(
      'Add your students in Student details and set M or F for each to use these.',
    );
  });

  // Design spec section 4: emptying the list returns to the no-list state,
  // not a third state of its own -- `roster: []` must read exactly like
  // `roster: null`, not fall through to the count branch below (which
  // would report "0 of the 0 students...", true but useless).
  it('treats an empty list the same as no list at all', () => {
    expect(sexWhy([], en)).toBe(sexWhy(null, en));
  });

  it('is enabled once every student being grouped has a sex', () => {
    const roster = [
      student({ number: 1, sex: 'M' }),
      student({ number: 2, sex: 'F' }),
    ];
    expect(sexWhy(roster, en)).toBeNull();
  });

  it('names the count when some students being grouped have no sex set', () => {
    const roster = [
      student({ number: 1, sex: 'M' }),
      student({ number: 2, sex: null }),
      student({ number: 3, sex: null }),
    ];
    // 2 unset of 3 grouped -- the same shape design spec section 6's own
    // approved copy demonstrates with different numbers (3 of 22).
    expect(sexWhy(roster, en)).toBe(
      '2 of the 3 students being grouped have no sex set. Open Student ' +
        'details and set M or F for them to use these.',
    );
  });

  // G-04 (test traceability matrix). The rule this whole function exists to
  // prove: an absent student with no sex set must not hold the switches
  // shut, because they are not being placed into anything. If `absent`
  // were not filtered out of `grouped` before `unset` is computed from it,
  // this would report "1 of the 2 ... have no sex set" instead of enabling
  // the switches.
  it('does not count an absent student with no sex set against the total (G-04)', () => {
    const roster = [
      student({ number: 1, sex: 'M' }),
      student({ number: 2, sex: null, absent: true }),
    ];
    expect(sexWhy(roster, en)).toBeNull();
  });

  // The mirror of the test above, proving the filter is by `absent`, not by
  // `sex` -- a mutant that filtered on `sex === null` instead of `absent`
  // could still pass the test above by coincidence, but not this one.
  it('excludes an absent student from the grouped count even when they do have a sex', () => {
    const withAbsentSexed = sexWhy(
      [
        student({ number: 1, sex: null }),
        student({ number: 2, sex: 'F', absent: true }),
      ],
      en,
    );
    const withoutThem = sexWhy([student({ number: 1, sex: null })], en);
    expect(withAbsentSexed).toBe(withoutThem);
    expect(withAbsentSexed).toBe(
      '1 of the 1 student being grouped has no sex set. Open Student ' +
        'details and set M or F for them to use these.',
    );
  });

  // Singular grammar: "1 ... student ... has", not "1 ... students ...
  // have". Design spec section 6's own example only ever shows the plural
  // (3 of 22), so the singular branch is otherwise unproven.
  it('branches singular/plural in English at exactly one unset of one grouped', () => {
    expect(sexWhy([student({ number: 1, sex: null })], en)).toBe(
      '1 of the 1 student being grouped has no sex set. Open Student ' +
        'details and set M or F for them to use these.',
    );
  });

  // The two branches (unset-count "has"/"have", grouped-count
  // "student"/"students") are independent -- this pins them at DIFFERENT
  // values (unset=1, grouped=3) so a mutant that tied both to the same
  // number cannot pass both this test and the one above by accident.
  it('combines presence and sex correctly across a mixed roster', () => {
    const roster = [
      student({ number: 1, sex: 'M' }), // present, set
      student({ number: 2, sex: 'F' }), // present, set
      student({ number: 3, sex: null }), // present, unset
      student({ number: 4, sex: null, absent: true }), // absent, unset -- excluded
      student({ number: 5, sex: 'M', absent: true }), // absent, set -- excluded
    ];
    expect(sexWhy(roster, en)).toBe(
      '1 of the 3 students being grouped has no sex set. Open Student ' +
        'details and set M or F for them to use these.',
    );
  });

  // Vacuous truth, not a bug: "every student being grouped has M or F" is
  // true of an empty set of students being grouped, the same way
  // `[].every(...)` is `true`. A roster that exists but is 100% absent
  // enables the switches -- there is nobody for them to misapply to, and
  // Make Groups already refuses separately (NO_STUDENTS) regardless of
  // sexMode.
  it('is enabled, not disabled, when a roster exists but everyone on it is absent', () => {
    const roster = [
      student({ number: 1, sex: null, absent: true }),
      student({ number: 2, sex: null, absent: true }),
    ];
    expect(sexWhy(roster, en)).toBeNull();
  });

  it('produces the Indonesian no-list wording from the Indonesian table', () => {
    expect(sexWhy(null, id)).toBe(
      'Tambahkan siswa Anda di bagian Detail siswa dan atur L atau P ' +
        'untuk masing-masing agar bisa memakai opsi ini.',
    );
  });

  // Bahasa Indonesia does not inflect for plural (same reasoning as every
  // sibling comment on this in en.ts/id.ts's own `errors` table), so this
  // has no singular/plural counterpart to pin the way the English tests
  // above do.
  it('produces the Indonesian unset-count wording', () => {
    const roster = [
      student({ number: 1, sex: 'M' }),
      student({ number: 2, sex: null }),
      student({ number: 3, sex: null }),
    ];
    expect(sexWhy(roster, id)).toBe(
      '2 dari 3 siswa yang dikelompokkan belum memiliki jenis kelamin. ' +
        'Buka Detail siswa dan atur L atau P untuk mereka agar bisa ' +
        'memakai opsi ini.',
    );
  });

  it('does not count an absent student against the total, in Indonesian too (G-04)', () => {
    const roster = [
      student({ number: 1, sex: 'M' }),
      student({ number: 2, sex: null, absent: true }),
    ];
    expect(sexWhy(roster, id)).toBeNull();
  });

  // F-3 (review). The type says `sex: 'M' | 'F' | null` -- never
  // `undefined` -- but `astro check` holds only the code to that, and stage
  // 3 builds this roster by reading the DOM, where a field the type promises
  // is never missing can still arrive `undefined` in practice. The
  // `student()` factory above
  // cannot produce this shape (`Partial<Student>` still means "if given,
  // `sex` is `'M' | 'F' | null`"), so this is a hand-built object with a
  // cast, reaching past the type the same way a real DOM read could. A
  // strict `sex === null` check treats this student as SET and enables the
  // switches -- fail OPEN on the one guarantee this module exists to
  // provide. `!s.sex` must fail CLOSED instead: this roster keeps them
  // disabled, the same as an explicit `null` does.
  it('treats an undefined sex as unset, not as set (fails closed, not open)', () => {
    const withUndefinedSex = {
      number: 1,
      name: null,
      sex: undefined,
      absent: false,
      together: null,
      apart: null,
    } as unknown as Student;
    expect(sexWhy([withUndefinedSex], en)).toBe(
      sexWhy([student({ number: 1, sex: null })], en),
    );
    // Guards against a vacuous pass -- a mutant that made sexWhy always
    // return null would satisfy the equality above by both sides agreeing
    // on the wrong answer.
    expect(sexWhy([withUndefinedSex], en)).not.toBeNull();
  });
});

/**
 * G-07, the third message design spec sections 6 and 13 both call for, and
 * which `sexWhy`'s own doc comment recorded as OWED because a snapshot
 * cannot express it: "Dewi is back and has no sex set." fires on the moment
 * un-ticking one student's absence is specifically what CLOSES the switches
 * -- a TRANSITION, not a state.
 *
 * `sexWhy`'s comment predicted the caller "would have to know which control
 * just fired and pass that in". It does not. The fact the message needs is
 * "who newly entered the grouped pool without a sex", which is a pure
 * function of the roster BEFORE and the roster AFTER -- so this stays a
 * second pure function beside `sexWhy` rather than a parameter threaded
 * through it, and no call site has to report what the teacher just clicked.
 * Students are matched across the two snapshots by `number`, the field the
 * type calls "The identity".
 *
 * Returns `null` -- never a string -- whenever the name-specific message
 * does not apply, so the caller's `sexWhyReturning(...) ?? sexWhy(...)`
 * reads correctly and cannot accidentally prefer an empty string. Same
 * reasoning as `sexWhy`'s own null-not-empty-string contract above.
 */
describe('sexWhyReturning — the message for the student who just came back', () => {
  const M = student({ number: 1, sex: 'M' });
  const F = student({ number: 2, sex: 'F' });
  /** Dewi, out today, sex never set -- so she holds nothing shut while absent. */
  const dewiAbsent = student({
    number: 3,
    name: 'Dewi',
    sex: null,
    absent: true,
  });
  const dewiBack = { ...dewiAbsent, absent: false };

  it('names the student whose return is what closed the switches', () => {
    expect(sexWhyReturning([M, F, dewiAbsent], [M, F, dewiBack], en)).toBe(
      'Dewi is back and has no sex set. These options need one for every ' +
        'student being grouped.',
    );
  });

  // The precondition is not "somebody came back" -- it is "the switches were
  // OPEN and this closed them". A roster already shut for a different reason
  // gets `sexWhy`'s count message, which is the true one: naming Dewi would
  // tell a teacher to fix one row when two are unset.
  it('stays out of the way when the switches were already shut', () => {
    const alsoUnset = student({ number: 4, sex: null });
    expect(
      sexWhyReturning(
        [M, F, alsoUnset, dewiAbsent],
        [M, F, alsoUnset, dewiBack],
        en,
      ),
    ).toBeNull();
  });

  it('stays out of the way when the returning student HAS a sex', () => {
    const budiAbsent = student({
      number: 3,
      name: 'Budi',
      sex: 'M',
      absent: true,
    });
    expect(
      sexWhyReturning(
        [M, F, budiAbsent],
        [M, F, { ...budiAbsent, absent: false }],
        en,
      ),
    ).toBeNull();
  });

  // Nobody's absence changed at all -- a rename, a letter, a new row. The
  // switches may well have closed, but not because anyone came back.
  it('stays out of the way when no absence was lifted', () => {
    const newRow = student({ number: 3, sex: null });
    expect(sexWhyReturning([M, F], [M, F, newRow], en)).toBeNull();
  });

  // Two at once -- "+ Add several" cannot do this, but un-ticking a row
  // while another is mid-edit can, and a message that names one of two is
  // worse than the count, which names neither and is true of both.
  it('defers to the count when two students come back together', () => {
    const other = student({ number: 4, name: 'Eka', sex: null, absent: true });
    expect(
      sexWhyReturning(
        [M, F, dewiAbsent, other],
        [M, F, dewiBack, { ...other, absent: false }],
        en,
      ),
    ).toBeNull();
  });

  // The same numbered fallback `rosterProblems` already uses -- a teacher
  // who has not typed a name still gets told WHICH row, not a blank space
  // where a name should be.
  it('falls back to the numbered label for a student with no name', () => {
    const unnamed = student({ number: 7, sex: null, absent: true });
    expect(
      sexWhyReturning(
        [M, F, unnamed],
        [M, F, { ...unnamed, absent: false }],
        en,
      ),
    ).toBe(
      'Student 7 is back and has no sex set. These options need one for ' +
        'every student being grouped.',
    );
  });

  it('answers in Indonesian too', () => {
    const message = sexWhyReturning([M, F, dewiAbsent], [M, F, dewiBack], id);
    expect(message).not.toBeNull();
    expect(message).not.toBe(
      sexWhyReturning([M, F, dewiAbsent], [M, F, dewiBack], en),
    );
    expect(message).toContain('Dewi');
  });

  // Fails closed on the same `undefined` the sibling `sexWhy` test above
  // reaches past the type for: a DOM-built roster can carry it, and treating
  // it as SET would leave the switches open on a student who has no sex.
  it('treats an undefined sex as unset, not as set', () => {
    const undef = {
      number: 3,
      name: 'Dewi',
      sex: undefined,
      absent: true,
      together: null,
      apart: null,
    } as unknown as Student;
    expect(
      sexWhyReturning([M, F, undef], [M, F, { ...undef, absent: false }], en),
    ).toContain('Dewi');
  });
});
