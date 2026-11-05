import type { Student } from './grouping';
import type { Strings } from './i18n';

/**
 * Why the two sex switches (#cg-sex-mix, #cg-sex-separate) are disabled --
 * or `null` when they are not.
 *
 * Design spec section 6: "Both are DISABLED unless every student BEING
 * GROUPED has M or F." The qualifier is load-bearing. An absent student
 * with no sex set must not hold the switches shut, because they are not
 * being placed into anything today -- measuring the WHOLE roster instead
 * would produce "the worst kind of block" (the section's own words): every
 * group on screen has a sex, nothing looks wrong, and the one student
 * preventing the switches from ever turning on is not even in the room.
 * `grouped` below is filtered to `!absent` for exactly that reason, before
 * `unset` is ever computed from it.
 *
 * Returns `null` for "enabled" rather than an empty string, deliberately:
 * `if (why)` then reads correctly at every call site, and an empty string
 * that means "fine" is exactly the stringly-typed signal that gets tested
 * as truthy by accident.
 *
 * `roster === null` and `roster.length === 0` collapse to the SAME message
 * (`sexWhyNoList`) rather than two -- an empty list and no list are the
 * same fact here (nobody has a sex either way), matching how design spec
 * section 4's "Students box" already treats emptying the list as returning
 * to the no-list state, not a third state of its own.
 *
 * `grouped.length === 0` -- a roster exists but every student on it is
 * absent -- is NOT special-cased, and falls through to `unset.length ===
 * 0` -> enabled. That is the vacuous case, not a bug: "every student being
 * grouped has M or F" is true of an empty set of students being grouped,
 * the same way `[].every(...)` is `true` in JS. Toggling the switches here
 * is harmless (there is nobody to place), and pressing Make Groups already
 * reports `NO_STUDENTS` regardless of `sexMode` -- see grouping.ts's
 * `ERROR_CODES.noStudents` doc comment on the second of its two triggers.
 *
 * G-07 (the third, name-specific message) is DISCHARGED, in
 * `sexWhyReturning` below rather than as a parameter here -- this function
 * stays a pure read of one snapshot. See that function's own doc comment.
 */
export const sexWhy = (roster: Student[] | null, t: Strings): string | null => {
  if (roster === null || roster.length === 0) return t.sexWhyNoList;
  const grouped = roster.filter((s) => !s.absent);
  // `!s.sex`, not `s.sex === null`: the type says `'M' | 'F' | null`, but
  // stage 3 builds this roster by reading the DOM, and `astro check` checks
  // code, never the values the DOM hands it -- a field the type
  // promises is never missing can still arrive `undefined` in practice (a
  // student row rendered without its sex control wired yet, a form field
  // read before its listener attaches). A strict `=== null` treats that
  // `undefined` as SET, which fails OPEN on exactly the guarantee this
  // module exists to provide -- it would enable the switches for a roster
  // that does not actually have M or F for everyone. `!s.sex` treats
  // anything falsy (`null`, `undefined`, and an empty string, though the
  // type admits none of the last) as unset, the same fail-closed shape
  // grouping.ts's own `.filter((s) => s.sex !== 'M' && s.sex !== 'F')`
  // already uses for the identical question elsewhere in this codebase.
  const unset = grouped.filter((s) => !s.sex);
  if (unset.length === 0) return null;
  return t.sexWhyUnset({ unset: unset.length, grouped: grouped.length });
};

/**
 * The name-specific message for the moment ONE student's return is what
 * closed the switches -- design spec sections 6 and 13's third message,
 * G-07 in the test traceability matrix. `null` when it does not apply, so
 * `sexWhyReturning(prev, next, t) ?? sexWhy(next, t)` reads correctly at
 * the call site and an inapplicable case falls through to the count.
 *
 * `sexWhy`'s own comment predicted this would need the caller to say which
 * control just fired. It does not. The fact the message needs is "who
 * newly entered the grouped pool without a sex", and that is a pure
 * function of the roster BEFORE and the roster AFTER -- so this is a second
 * function taking two snapshots, not a transition parameter threaded
 * through the first. Nothing on the page has to report what a teacher
 * clicked, and both functions stay independently unit-testable against
 * hand-built rosters.
 *
 * Deliberately narrow, and each condition earns its place:
 *
 * - The switches must have been OPEN before (`sexWhy(previous) === null`).
 *   A roster already shut for a different reason gets the count instead:
 *   naming one student when two are unset tells a teacher to fix one row
 *   and leaves them with the switches still shut and no idea why.
 * - EXACTLY ONE student may have made the transition. Two at once has no
 *   honest single name to report, and `sexWhyUnset`'s count is true of
 *   both.
 * - That student must have been `absent` before and present after. A new
 *   row, a rename, or a sex cleared to blank all close the switches too,
 *   but nobody "is back" -- the message would be a lie about what happened.
 *
 * Matched across the two snapshots by `number` -- the field `Student` calls
 * "The identity". A number that appears twice in `previous` (a duplicate a
 * teacher is mid-way through fixing) is not special-cased: `find` takes the
 * first, which at worst produces the count instead of the name.
 *
 * `!s.sex` rather than `s.sex === null`, for the identical fail-closed
 * reason `sexWhy` above gives at length: this roster is built by reading
 * the DOM, whose values no type check sees.
 */
export const sexWhyReturning = (
  previous: Student[],
  next: Student[],
  t: Strings,
): string | null => {
  if (sexWhy(previous, t) !== null) return null;
  const returned = next.filter(
    (s) =>
      !s.absent &&
      previous.find((was) => was.number === s.number)?.absent === true,
  );
  if (returned.length !== 1) return null;
  const [who] = returned;
  if (who.sex) return null;
  return t.sexWhyReturning({
    who: who.name ? who.name : t.studentNumber({ n: who.number }),
  });
};
