import { MAX_STUDENTS, anonymousStudent } from './grouping';
import type { Student } from './grouping';
import { LETTERS } from './roster';

/**
 * One of the three number fields beside "Number of students" (#188), turned
 * into sets of register numbers.
 *
 * `absent` is a flat list of numbers; `pairing` is what "keep these two
 * together" and "keep these two apart" both are, where a SET is the unit.
 * The two share one parser because the typing is identical -- only the
 * "a set of one is meaningless" rule differs (AC5).
 */
export type NumberSetsKind = 'absent' | 'pairing';

export interface NumberSetsOptions {
  /** What `#cg-count` currently holds: the highest number a teacher may name. */
  count: number;
  kind: NumberSetsKind;
}

/**
 * Why a field was refused, and the text that caused it -- spelled exactly as
 * the teacher typed it, so the page can drop it into the sentence without
 * re-deriving it. The same contract `Problem.students` keeps in roster.ts:
 * the caller resolves copy, the pure module resolves facts.
 *
 * `aboveCount` and `aboveMaximum` are deliberately NOT one code. They name
 * the same shape of mistake and need different remedies -- "you typed 25
 * students" versus "this page cannot go above MAX_STUDENTS at all" -- and
 * en.ts already keeps three separate sentences for the size limits for
 * exactly this reason.
 */
export const NUMBER_SETS_PROBLEM_KINDS = [
  'notAWholeNumber',
  'aboveCount',
  'aboveMaximum',
  'duplicate',
  'lonelySet',
  'tooManySets',
  'noCount',
] as const;

/**
 * Derived from the array above, not written twice.
 *
 * A bare union is erased at build time, so nothing could DERIVE the set of
 * kinds at runtime and a test would have to hand-list them -- which is how a
 * guard comes to pass because somebody forgot to extend a list. `ERROR_CODES`
 * in grouping.ts is a runtime object for the same reason.
 */
export type NumberSetsProblemKind = (typeof NUMBER_SETS_PROBLEM_KINDS)[number];

export interface NumberSetsProblem {
  kind: NumberSetsProblemKind;
  text: string;
}

export interface NumberSetsResult {
  /**
   * Comma joins a set, semicolon starts a new one (operator, 2026-09-16):
   * `3,9; 14,15` is two independent units, not one of four.
   *
   * EMPTY whenever `problem` is set. A field that is half-read is the worst
   * of both: it would group on some of what was typed while the page says
   * it refused the rest.
   */
  sets: number[][];
  problem: NumberSetsProblem | null;
}

/**
 * Split on a separator, trim every piece, and drop the empty ones a trailing
 * or doubled separator leaves behind (AC2) -- shared by both levels so the
 * two cannot drift apart on what "empty" means.
 */
const pieces = (text: string, separator: string): string[] =>
  text
    .split(separator)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '');

/**
 * Digits only. `Number` is far too generous for a register number: it reads
 * `''` as 0, `' 7 '` as 7 and `0x10` as 16, so testing the TEXT is what
 * keeps `-3` and `2.5` refusals rather than silent conversions.
 */
const WHOLE_NUMBER = /^[0-9]+$/;

/**
 * One field's text, read left to right, stopping at the FIRST thing wrong.
 * A teacher fixes that, re-reads, and is told about the next -- never handed
 * a list to triage.
 */
export const parseNumberSets = (
  text: string,
  { count, kind }: NumberSetsOptions,
): NumberSetsResult => {
  const refuse = (
    problemKind: NumberSetsProblemKind,
    offending: string,
  ): NumberSetsResult => ({
    sets: [],
    problem: { kind: problemKind, text: offending },
  });

  const setTexts = pieces(text, ';');
  // An empty field asks nothing of the count, so a missing count is not this
  // field's problem and must not be announced as one -- a teacher who has
  // not typed here yet gets no sentence about a box they have not reached.
  if (setTexts.length === 0) return { sets: [], problem: null };

  // `readCount()` (classroom-groups.ts) is `Number(input.value)`, so an
  // EMPTY count box arrives as `NaN` -- and `7 > NaN` is false, so every
  // range check below would pass in silence and a teacher would be told
  // nothing was wrong with a field that could not be checked at all. The
  // count is what is at fault, so it is named rather than their input.
  if (!Number.isInteger(count) || count < 1) return refuse('noCount', '');

  const sets: number[][] = [];
  // Across the WHOLE field, not per set: `3,9; 9,14` asks for 9 to be in two
  // different units at once, which is the same mistake as typing it twice in
  // one -- and the roster refuses a repeated number rather than quietly
  // de-duplicating it (`rosterProblems`, roster.ts).
  const seen = new Set<number>();

  for (const setText of setTexts) {
    const numbers: number[] = [];
    for (const member of pieces(setText, ',')) {
      if (!WHOLE_NUMBER.test(member)) return refuse('notAWholeNumber', member);
      const number = Number(member);
      if (number < 1) return refuse('notAWholeNumber', member);
      if (number > MAX_STUDENTS) return refuse('aboveMaximum', member);
      if (number > count) return refuse('aboveCount', member);
      if (seen.has(number)) return refuse('duplicate', member);
      seen.add(number);
      numbers.push(number);
    }
    // AC5. Checked after the members, so `3` in a pairing field is reported
    // as the lonely set it is rather than passing validation and vanishing.
    if (kind === 'pairing' && numbers.length < 2) {
      return refuse('lonelySet', setText);
    }
    // A unit is carried by a LETTER, and there are 26 of them. Reusing `A`
    // for a 27th set would MERGE two units a teacher meant to keep separate:
    // the engine would obey, the page would look right, and the groups would
    // be quietly wrong. Refused instead, naming the set with nowhere to go.
    if (kind === 'pairing' && sets.length === LETTERS.length) {
      return refuse('tooManySets', setText);
    }
    sets.push(numbers);
  }

  return { sets, problem: null };
};

/** The three fields, already parsed, as `studentsForInput` reads them. */
export interface NumberFields {
  absent: number[][];
  together: number[][];
  apart: number[][];
}

/**
 * Exactly what `GroupingInput.students` should be for what a teacher typed.
 *
 * With all three fields empty this is the bare `count` the page has always
 * passed (AC7) -- the default path does not change shape because a new
 * feature exists. Otherwise it is the whole class as anonymous students,
 * numbered 1..count with NOBODY renumbered to close the gap an absentee
 * leaves: absence marks a pupil out of THIS shuffle, not out of the register
 * (`nextNumber`'s own reasoning, roster.ts).
 *
 * No grouping rule is written here. `buildGroups` already drops absentees,
 * places a together-block as one unit and separates an apart-set, so every
 * error and warning the engine owns -- `togetherApartClash` included --
 * applies to typed numbers for free.
 */
export const studentsForInput = (
  count: number,
  fields: NumberFields,
): number | Student[] => {
  const typedNothing =
    fields.absent.length === 0 &&
    fields.together.length === 0 &&
    fields.apart.length === 0;
  if (typedNothing) return count;

  const absent = new Set(fields.absent.flat());
  // One letter per set, in the order typed. `together` and `apart` are
  // unrelated domains (roster.ts: "a 'together A' and an 'apart A' are
  // unrelated"), so each field letters from A independently -- a shared
  // counter would be a bug no assertion about one field alone could see.
  const lettered = (sets: number[][]): Map<number, string> => {
    const letters = new Map<number, string>();
    sets.forEach((set, index) => {
      for (const number of set) letters.set(number, LETTERS[index]);
    });
    return letters;
  };
  const together = lettered(fields.together);
  const apart = lettered(fields.apart);

  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    // Built ON the blank record rather than beside it (#277): the three
    // fields a number set decides are the three named here, and the rest —
    // `name`, `sex`, and whatever a later field turns out to be — default
    // wherever `Student` itself is defined, not here as well.
    return {
      ...anonymousStudent(number),
      absent: absent.has(number),
      together: together.get(number) ?? null,
      apart: apart.get(number) ?? null,
    };
  });
};
