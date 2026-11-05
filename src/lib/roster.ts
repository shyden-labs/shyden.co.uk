/**
 * The roster: pure arithmetic and comparison over `Student[]`.
 *
 * The roster ARRAY itself never lives here — it is one array in
 * `classroom-groups.ts`'s own module scope, never persisted, reached from
 * outside that file only through `getRoster`/`setRoster` (that file's own
 * doc comment explains why an accessor pair exists rather than an exported
 * `let`). This file is everything about a roster that is a fact of its
 * data, not a fact of the page: next-number assignment, the counts the
 * Student details header (`sectionState`, src/lib/sections.ts) reads, and
 * the one string that says whether two rosters would group differently.
 * Kept pure and here, per this repo's working agreement (CLAUDE.md: logic
 * is pure in src/lib and unit-tested; page scripts only wire the DOM), so
 * each rule is proven against its own inputs rather than sampled through
 * the DOM.
 */
import type { Student } from './grouping';
import type { Strings } from './i18n';

/**
 * Student details holds up to this many named rows — design spec section 4,
 * "Two size limits, not one". `MAX_STUDENTS` (grouping.ts, also 100) is the
 * other limit: a bare count of anonymous students costs the page one
 * number, while a named row costs six form controls (number, name, sex,
 * absent, together, apart), so the two get different ceilings. 100 is
 * roughly twice the largest real class, so no teacher meets it by
 * accident.
 *
 * Three separate outcomes for exceeding it (design spec section 4), each
 * with its own function below: opening Student details above the limit
 * with no list yet (`rosterOpenProblem`), the two add controls disabling
 * once a roster reaches it (`rosterAtLimit`), and `+ Add several…`
 * refusing a batch that would cross it even from under it
 * (`rosterRoomProblem`). Importing this one constant, rather than each call
 * site hard-coding `100` by hand, is what keeps all three (and every
 * message they drive) certain to agree.
 */
export const MAX_ROSTER = 100;

/**
 * One past the highest number in use — never the first free gap.
 *
 * A gap is usually the register number of a child who has left; filling it
 * would quietly hand their number to somebody else (design spec section 4,
 * "Numbers"). An absent student's number is still taken: absence marks
 * them out of THIS shuffle, not out of the register, so this reads every
 * student's number regardless of `absent`.
 */
export const nextNumber = (roster: Student[]): number =>
  roster.reduce((max, s) => Math.max(max, s.number), 0) + 1;

/**
 * The four counts the Student details header reads once a roster exists:
 * how many have a name, how many are marked absent, and how many carry
 * each kind of letter. `together` and `apart` are independent counts, not
 * a partition of the roster — a student can carry both letters at once
 * (see `Student`'s own doc comment in grouping.ts), so they can and do
 * overlap.
 *
 * An emptied name (`''`, typed and then deleted) reads as unnamed, the
 * same as one that was never set (`null`) — only a name with real
 * characters in it counts.
 */
export const rosterCounts = (roster: readonly Student[]) => ({
  named: roster.filter((s) => s.name !== null && s.name !== '').length,
  absent: roster.filter((s) => s.absent).length,
  together: roster.filter((s) => s.together !== null).length,
  apart: roster.filter((s) => s.apart !== null).length,
});

/**
 * Everything about the roster that could change who ends up with whom,
 * folded into one string two calls can compare with `!==` — the same
 * "primitive, compared by value" contract every `Snapshot` field keeps
 * (see that interface's own doc comment in staleness.ts).
 *
 * The NAME IS DELIBERATELY ABSENT. Correcting a spelling moves nobody, so
 * it must not mark the groups out of date — and leaving the name out of
 * the comparison is what makes that true by construction, rather than by a
 * special case somebody has to remember.
 *
 * Sorted before joining, so the same roster listed in a different array
 * order — the table re-rendering, or a student removed and an equal one
 * re-added — still compares equal: nothing about any actual student
 * changed, so nothing here may read as though it did.
 */
export const serialiseForCompare = (roster: Student[]): string =>
  roster
    .map(
      (s) =>
        `${s.number}:${s.sex ?? ''}:${s.absent ? 1 : 0}:${s.together ?? ''}:${s.apart ?? ''}`,
    )
    .sort()
    .join('|');

/**
 * A to Z -- every letter a together-block or an apart-set may be called, and
 * the ONE home for that alphabet.
 *
 * `availableLetters` below hands a teacher a growing PREFIX of it. #188's
 * number fields letter their sets from the same list, which is what lets a
 * 27th set be refused rather than silently reusing `A` and merging two units
 * a teacher meant to keep separate. Generated rather than typed out, so the
 * two facts a caller needs -- what the letters are, and that there are 26 --
 * cannot drift apart.
 */
export const LETTERS: readonly string[] = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i),
);

/**
 * Which letters a together/apart `<select>` should offer — design spec
 * section 4: "chosen from a dropdown that grows as needed (A, then B once A
 * is used, and so on)." Always starts at `['A']`, even on an empty roster,
 * so there is a letter for the first student who gets one; grows to one
 * PAST whichever letter is currently the highest in use for `field`,
 * never past `Z` (26 is far more letters than any real class needs, and it
 * keeps the return value finite regardless of what a future import feeds
 * this).
 *
 * `together` and `apart` grow independently — a "together A" and an "apart
 * A" are unrelated domains (one is a unit, the other a mutual-separation
 * set), so `field` selects which of the two a given call is measuring.
 * `readonly` because this only ever reads the roster, the same contract
 * `getRoster()` (classroom-groups.ts) already returns.
 */
export const availableLetters = (
  roster: readonly Student[],
  field: 'together' | 'apart',
): string[] => {
  let highest = 0; // 0 = none in use yet; A=1, B=2, … Z=26
  for (const s of roster) {
    const letter = s[field];
    if (!letter) continue;
    const code = letter.toUpperCase().charCodeAt(0) - 64;
    if (code > highest) highest = code;
  }
  return LETTERS.slice(0, Math.min(LETTERS.length, highest + 1));
};

/**
 * A validation problem the roster refuses to let stand -- caught as it is
 * TYPED, in the table, never held back until "Make groups" is pressed
 * (design spec section 4: "Not held back until the button is pressed --
 * one rule for both clashes means one behaviour to learn."). Both kinds
 * mirror a refusal the ENGINE already makes on the identical data
 * (`ERROR_CODES.duplicateNumber` / `.togetherApartClash`, grouping.ts's
 * `buildGroups`) -- this is the same fact, caught one keystroke earlier, in
 * a sentence written for the moment of typing rather than the moment of
 * shuffling ("already used by Eko", not "used twice").
 *
 * `students` carries every student NUMBER the problem concerns -- identity
 * is the number (this stage's own global constraint) -- so a future caller
 * can act on the affected row(s) without re-deriving them from `message`.
 */
export interface Problem {
  kind: 'duplicate' | 'clash' | 'no-sex';
  students: number[];
  message: string;
}

/**
 * A student's own label for a validation message: their name if they have
 * one, "Student N" otherwise -- the same fallback `resolveStudent`
 * (classroom-groups.ts) already uses for the engine's own errors, kept
 * LOCAL here rather than imported: that function reads a page-level
 * `rosterNames` map this pure module has no business knowing about, and the
 * roster array handed to `rosterProblems` already carries everything this
 * needs. Truthy, not `!== null` -- matching `rosterCounts`'s own "an
 * emptied name reads as unnamed" contract, above: `''` and `null` both fall
 * through to the numbered label.
 */
const label = (student: Student, t: Strings): string =>
  student.name ? student.name : t.studentNumber({ n: student.number });

/**
 * Every duplicate number and together/apart clash currently in the roster
 * -- see `Problem`'s own doc comment for why this exists alongside the
 * engine's identical guards.
 *
 * DUPLICATE runs over the WHOLE roster, absent students included: a
 * register number is still taken while its holder is out of today's
 * shuffle (`nextNumber`'s own doc comment, above, gives the identical
 * reasoning), and the engine's own `duplicateNumber` check runs before ITS
 * OWN absence filter for the same reason -- see the call site in
 * `buildGroups`. Reports at most ONE problem per duplicated number,
 * regardless of how many rows share it: a third or fourth row claiming the
 * same number is still the same fact a teacher needs to fix once, not a
 * second, redundant sentence saying so again.
 *
 * CLASH runs over PRESENT students only: design spec section 4, "Their
 * letters lapse with them" -- an absent student's together/apart letters
 * constrain nobody, so a clash that exists only because an absent student
 * shares a letter must not block a shuffle that would, in fact, succeed.
 * Mirrors the engine's own `togetherApartClash`, checked against the POOL
 * (present, unpinned students) rather than the raw roster -- see the call
 * site in `buildGroups`.
 */
export function rosterProblems(roster: Student[], t: Strings): Problem[] {
  const problems: Problem[] = [];

  const holders = new Map<number, Student>();
  const reportedDuplicates = new Set<number>();
  for (const s of roster) {
    const holder = holders.get(s.number);
    if (!holder) {
      holders.set(s.number, s);
      continue;
    }
    if (reportedDuplicates.has(s.number)) continue;
    reportedDuplicates.add(s.number);
    problems.push({
      kind: 'duplicate',
      students: [s.number],
      message: t.rosterDuplicateMessage({
        number: s.number,
        name: label(holder, t),
      }),
    });
  }

  const present = roster.filter((s) => !s.absent);
  const togetherBlocks = new Map<string, Student[]>();
  for (const s of present) {
    if (s.together === null) continue;
    const block = togetherBlocks.get(s.together) ?? [];
    block.push(s);
    togetherBlocks.set(s.together, block);
  }
  for (const block of togetherBlocks.values()) {
    const byApartLetter = new Map<string, Student[]>();
    for (const s of block) {
      if (s.apart === null) continue;
      const clashers = byApartLetter.get(s.apart) ?? [];
      clashers.push(s);
      byApartLetter.set(s.apart, clashers);
    }
    for (const clashers of byApartLetter.values()) {
      if (clashers.length < 2) continue;
      problems.push({
        kind: 'clash',
        students: clashers.map((s) => s.number),
        message: t.rosterClashMessage({
          names: clashers.map((s) => label(s, t)),
        }),
      });
    }
  }

  // Pushed LAST, deliberately. Only the FIRST problem is surfaced
  // (`#cg-roster-problem`), and a missing sex is the least specific thing
  // wrong with a roster — a duplicate number or a together/apart clash names
  // one student and one contradiction, while "nobody has a sex yet" is the
  // ordinary state of a roster someone is still filling in. Pushing it first
  // buried every sharper message behind it.

  // Sex is required for every student (operator, 2026-08-13). Reported as ONE
  // problem naming everyone still missing it, rather than one per student: a
  // fresh roster of thirty would otherwise post thirty identical refusals,
  // and the teacher's next action is the same either way.
  //
  // Absent students are included. They are still students on the list, and a
  // roster half-filled because someone happened to be away is exactly the
  // state this rule exists to stop reaching the shuffle.
  const noSex = roster.filter((s) => s.sex === null);
  if (noSex.length > 0) {
    problems.push({
      kind: 'no-sex',
      students: noSex.map((s) => s.number),
      message: t.rosterNoSexMessage({ names: noSex.map((s) => label(s, t)) }),
    });
  }

  return problems;
}

/**
 * A gap in the roster's own numbering -- NON-blocking (design spec section
 * 4: "A gap raises a non-blocking warning"), which is why this is a
 * separate function returning plain strings rather than a third `Problem`
 * kind: nothing that reads this list may disable "Make groups" the way a
 * `Problem` does -- see classroom-groups.ts's own wiring, which checks
 * `rosterProblems(...).length` for that and never this.
 *
 * Measured between the roster's OWN min and max, never against 1: a class
 * register genuinely starting above 1 (a school-wide roll number, say) is
 * not an incomplete list, and there is nothing below its own first entry to
 * compare it to -- see the "does not treat a roster starting above 1 as a
 * gap" test. A roster of one has no internal range to be missing a number
 * FROM, so it is always quiet, however it is numbered. Absence is not
 * consulted: a gap is about the REGISTER, and an absent student's number
 * still holds their place in it (the same reasoning `nextNumber`'s own doc
 * comment gives, above).
 */
export function rosterWarnings(roster: Student[], t: Strings): string[] {
  if (roster.length === 0) return [];
  const numbers = roster.map((s) => s.number);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  // A range WIDER than the roster can hold is not a gap a teacher can act
  // on, and enumerating it is not merely useless -- it is fatal. A school
  // roll number (Indonesian NISN is ten digits) puts `max - min` in the
  // tens of millions: the loop below builds an array that large,
  // `rosterGapWarning` maps it to strings and joins it into a single
  // ~10^9-character sentence, and the tab locks up with no paint and no way
  // out but closing it -- taking the roster the teacher just imported with
  // it. Measured, not theorised: 1 and 99999999 builds 60 million entries
  // in two seconds.
  //
  // This warning exists for "you typed 1, 2, 3, 5". Bounded by MAX_ROSTER,
  // because a gap that cannot fit in the roster is not that.
  if (max - min >= MAX_ROSTER) return [];
  const present = new Set(numbers);
  const missing: number[] = [];
  for (let n = min; n <= max; n++) {
    if (!present.has(n)) missing.push(n);
  }
  return missing.length === 0 ? [] : [t.rosterGapWarning({ missing })];
}

/**
 * Student details' own hard ceiling reached -- design spec section 4,
 * "Adding a row at 100": "both `+ Add student` and `+ Add several…` are
 * disabled and state the limit." A plain boolean gate, unlike
 * `rosterRoomProblem` below (which also has to say how many rows remain
 * when a BATCH is requested) -- there is nothing left to count once the
 * roster already holds the maximum, so the message this drives
 * (`rosterAtLimitMessage`, en.ts/id.ts) needs no argument of its own.
 * `>=`, not `===`: nothing in this file lets a roster exceed `MAX_ROSTER`
 * through its own two add paths, but a caller this module does not control
 * (a later stage's CSV import, say) must still read an over-full roster as
 * "at the limit", not merely "not yet at it".
 */
export const rosterAtLimit = (roster: readonly Student[]): boolean =>
  roster.length >= MAX_ROSTER;

/**
 * Whether Student details has room for `count` MORE students, and if not,
 * the message naming how many rows actually ARE free -- design spec
 * section 4: "`+ Add several…` also refuses a number that would cross it,
 * saying how many rows are free." `null` means the whole batch fits;
 * a message means it does not -- and the WHOLE batch is refused, never
 * partially added up to whatever room remains (design spec section 4 says
 * "refuses a number that would cross it", never "adds as many as will
 * fit"), so the caller must add all `count` rows or none, on this
 * function's say-so alone.
 *
 * `room` is floored at 0 rather than allowed to go negative: nothing in
 * this module lets `roster.length` exceed `MAX_ROSTER` in the first place
 * (`rosterAtLimit`, above, is what the two add controls are `disabled` on),
 * but a message reading "-3 more" would be nonsense if some future caller
 * ever handed this an already over-full roster.
 */
export function rosterRoomProblem(
  roster: readonly Student[],
  count: number,
  t: Strings,
): string | null {
  const room = Math.max(0, MAX_ROSTER - roster.length);
  return count <= room ? null : t.rosterRoomMessage({ room });
}

/**
 * Whether Student details should refuse to open right now, and if so, the
 * message explaining why -- design spec section 4: "Opening Student
 * details with the count above 100 — the section refuses to open and says
 * why... The count itself is left alone." Takes `rosterLength` rather than
 * a roster, deliberately: the one call site (classroom-groups.ts's own
 * `#cg-students-toggle` handler) already has `getRoster().length` to hand,
 * and every other function in this file that only ever needs a count, not
 * a roster to inspect field-by-field, is typed the same lean way.
 *
 * Reachable only with NO list yet (`rosterLength === 0`) -- once even one
 * named row exists, growing the roster past `MAX_ROSTER` is already
 * impossible (`rosterAtLimit`, above, is what the two add controls are
 * disabled on), so this asks a DIFFERENT question: not "is the roster
 * full" but "is the plain COUNT, with no roster built from it yet, already
 * too big to build one from at all".
 */
export function rosterOpenProblem(
  rosterLength: number,
  count: number,
  t: Strings,
): string | null {
  return rosterLength === 0 && count > MAX_ROSTER
    ? t.rosterOpenRefusedMessage({ max: MAX_ROSTER })
    : null;
}

/**
 * Whether `#cg-count` ("Number of students") must stop being typeable and
 * become a read-out instead -- design spec section 4, "The Students box —
 * an input, then a read-out": "Two things could claim to know how big the
 * class is: the box and the list... they are never both in charge... The
 * moment a list exists, the box becomes a read-out." True the instant the
 * roster holds even one student -- deliberately blind to MAX_ROSTER,
 * absence, names or anything else about the roster's CONTENTS, unlike
 * every other predicate in this file. That is what finally closes X-08
 * ("there is no way to type the box past MAX_ROSTER with a list present"):
 * Task 6 already made sure neither add path could ever push a roster past
 * the ceiling; this is the other half, and it closes it more strongly than
 * the letter of X-08 asks for -- a box that cannot be typed into AT ALL
 * can never disagree with a list that exists, at any size, so there is
 * nothing left to check "past MAX_ROSTER" specifically.
 *
 * FOUR controls now, not one (#188). `#cg-count` and the three number fields
 * beside it -- absent numbers, keep together, keep apart -- all lock on this
 * same single fact, because all four are ways of saying who is in the class
 * and the list is authoritative over every one of them. Documented here
 * rather than beside each control: a rule written for one control and
 * applied to four is how three of them end up agreeing while the fourth
 * quietly drifts.
 */
export const studentsBoxLocked = (roster: readonly Student[]): boolean =>
  roster.length > 0;
