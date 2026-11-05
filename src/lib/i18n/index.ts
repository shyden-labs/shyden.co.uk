import { en, type Catalogue, type Strings } from './en';
import { id } from './id';
import { zh } from './zh';
import { vi } from './vi';
import { th } from './th';
import {
  siteEn,
  siteId,
  siteZh,
  siteVi,
  siteTh,
  type SiteStrings,
} from './site';
import {
  ERROR_CODES,
  MAX_STUDENTS,
  type GroupingError,
  WARNING_CODES,
  type GroupingWarning,
} from '../grouping';
// TYPE-ONLY, deliberately: this module is imported by roster.ts (for
// `Strings`), and numberSets.ts imports roster.ts for `LETTERS`, so a VALUE
// import here would close a runtime cycle. A type import is erased at build
// time and closes nothing.
import type { NumberSetsProblem } from '../numberSets';
import { DEFAULT_LOCALE, LOCALES, type Locale } from './locales';
import { LOCALE_METADATA } from './metadata';
import { compileCatalogue } from './message';

export { DEFAULT_LOCALE, LOCALES, type Locale };

/** Locales that carry a URL prefix -- everything except the default. */
export const PREFIXED_LOCALES: readonly Locale[] = LOCALES.filter(
  (l) => l !== DEFAULT_LOCALE,
);

/**
 * The badge shown beside every BETA locale, in every locale.
 *
 * Deliberately ONE untranslated token (operator decision, 2026-09-10). The
 * badge labels a LANGUAGE, and it is rendered beside languages the reader may
 * not speak -- on an English page it marks Bahasa Indonesia and the rest, so
 * "BETA" in the page's current language would describe the wrong thing to the
 * one visitor who most needs it. The NOTICE and the accessible label are
 * translated; see `language.betaNotice` / `language.betaLabel` in `site.ts`.
 */
export const BETA_BADGE = 'BETA';

/**
 * Whether a locale's copy is unverified -- true for everything but the default.
 *
 * Derived, never enumerated. Shyden has no native speakers for any locale
 * but English, so "unverified" is a property of the whole non-English set and
 * not of four particular codes. A hand-written set would miss the next locale
 * added on the day it is added, which is the exact failure behind #24, #49 and
 * #60 -- and Indonesian, which is LIVE on production and unverified, is the
 * proof the distinction is not academic.
 */
export const isBetaLocale = (locale: Locale): boolean =>
  locale !== DEFAULT_LOCALE;

/**
 * Matches a leading `/<locale>` segment for any PREFIXED locale.
 *
 * Built from LOCALES rather than written out, because the literal it replaces
 * (`/^\/id(?=\/|$)/`) failed silently rather than loudly: with `zh` in
 * LOCALES but not in the pattern, `localisePath('/', 'zh')` returned `/id/` --
 * the INDONESIAN homepage, served as Chinese, with every existing test green.
 *
 * The `(?=\/|$)` boundary is load-bearing: without it `/identity-check` parses
 * as Indonesian and gets rewritten.
 */
const PREFIX_PATTERN = new RegExp(`^/(${PREFIXED_LOCALES.join('|')})(?=/|$)`);

const CATALOGUES: Record<Locale, Catalogue> = { en, id, zh, vi, th };

/** Each locale's strings, compiled on first use and kept. */
const compiled = new Map<Locale, Strings>();

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);

/**
 * A locale's strings, with every message compiled into a function of its
 * named slots that formats with the locale's own plural rules and list
 * punctuation (#136). Unknown or absent locale falls back to English rather
 * than throwing.
 */
export const getStrings = (locale: unknown): Strings => {
  const key = isLocale(locale) ? locale : DEFAULT_LOCALE;
  let strings = compiled.get(key);
  if (!strings) {
    strings = compileCatalogue(
      en,
      CATALOGUES[key],
      LOCALE_METADATA[key].numberLocale,
    );
    compiled.set(key, strings);
  }
  return strings;
};

/**
 * A locale's tool catalogue as written, every message still a template.
 * `getStrings` compiles each message into a function (#136), so a walk over
 * its result never sees one and finds fewer entries than the catalogue
 * holds. The translation-report table (#97) walks this instead.
 */
export const rawCatalogue = (locale: Locale): Catalogue => CATALOGUES[locale];

/**
 * Site copy by locale — header, footer, homepage, 404, Glory Points.
 *
 * Here rather than in `site.ts` since #22: the lookup needs `isLocale` and
 * `DEFAULT_LOCALE` as values, and importing them into `site.ts` made that
 * file unreadable to `scripts/i18n-translate.mjs`, which runs under plain
 * Node. Every site string was therefore invisible to the translator. Beside
 * `getStrings` is also simply where its twin belongs: one file decides what a
 * locale is and what copy it gets.
 */
const SITE_TABLE: Record<Locale, SiteStrings> = {
  en: siteEn,
  id: siteId,
  zh: siteZh,
  vi: siteVi,
  th: siteTh,
};

/** Unknown or absent locale falls back to the default, never throws. */
export const getSiteStrings = (locale: unknown): SiteStrings =>
  isLocale(locale) ? SITE_TABLE[locale] : SITE_TABLE[DEFAULT_LOCALE];

export type { SiteStrings };

/** The path to this tool in a given locale. The default locale is unprefixed. */
export const toolPath = (locale: Locale): string =>
  localisePath('/classroom-groups', locale);

/**
 * Every locale except the one being viewed, in LOCALES order.
 *
 * Replaces `otherLocale`, which returned a single Locale and was therefore
 * binary by construction: with five languages there is no "the other one",
 * only a list. The language switcher is a dropdown for exactly that reason.
 */
export const otherLocales = (locale: Locale): Locale[] =>
  LOCALES.filter((l) => l !== locale);

/**
 * The same page in another locale.
 *
 * Every page needs this for its hreflang links and its language switcher, and
 * getting it wrong is the classic i18n bug: a switcher that always dumps the
 * visitor on the homepage instead of the page they were reading. English is
 * unprefixed, so switching is purely adding or removing a locale segment
 * such as `/id`.
 */
export function localisePath(pathname: string, target: Locale): string {
  const stripped = pathname.replace(PREFIX_PATTERN, '') || '/';
  return target === DEFAULT_LOCALE ? stripped : `/${target}${stripped}`;
}

/** The locale a path belongs to, inferred from its prefix. */
export const localeFromPath = (pathname: string): Locale => {
  const prefix = PREFIX_PATTERN.exec(pathname);
  return prefix ? (prefix[1] as Locale) : DEFAULT_LOCALE;
};

/**
 * A student number, resolved to a label a teacher can read.
 *
 * The engine's errors carry numbers, never names (see `Student.number`'s
 * comment: identity is the number, and `GroupingError`'s `keepApartImpossible`
 * variant carries `students: number[]` for exactly that reason) — grouping.ts
 * has no roster to resolve one from. `renderError` has no roster either by
 * default, so a resolver is how one gets supplied.
 */
export type ResolveStudentLabel = (studentNumber: number) => string;

/**
 * Whether a message names exactly two students, which three of its sentences
 * word differently ("both", "are not the same sex") from three or more (#505).
 */
const howMany = (students: readonly number[]): 'two' | 'more' =>
  students.length === 2 ? 'two' : 'more';

/**
 * Turn an engine error into a sentence in the page's language.
 *
 * The engine deliberately returns a code plus data instead of prose, so this
 * is the single place a message is composed. The switch is exhaustive over
 * ErrorCode; adding a code without handling it here fails the type check
 * rather than silently rendering the raw code to a teacher.
 *
 * `resolveStudent` turns a `KEEP_APART_IMPOSSIBLE` number into display text.
 * It defaults to the same numbered label an anonymous student already gets
 * elsewhere on the page (`strings.studentNumber`) rather than a second,
 * independent spelling of "Student N" — so a caller that forgets to pass a
 * resolver still gets "Student 1 and Student 2 all need to be kept apart…",
 * never bare digits. Stage 2's page passes its own resolver, one that reads
 * the roster and prefers `name ?? studentNumber(n)`, so a teacher who typed
 * names sees them. This keeps the engine pure — `GroupingError` still carries
 * only numbers, and nothing in this module imports grouping.ts's `Student`
 * type — while guaranteeing the default is still a full sentence, not a
 * partial one.
 */
export function renderError(
  error: GroupingError,
  strings: Strings,
  resolveStudent: ResolveStudentLabel = (n) => strings.studentNumber({ n }),
): string {
  const e = strings.errors;
  switch (error.code) {
    case ERROR_CODES.noStudents:
      return e.NO_STUDENTS;
    case ERROR_CODES.invalidGroupSize:
      return e.INVALID_GROUP_SIZE;
    case ERROR_CODES.invalidGroupCount:
      return e.INVALID_GROUP_COUNT;
    case ERROR_CODES.tooManyGroups:
      return e.TOO_MANY_GROUPS({ max: error.maxGroups });
    // Carries `students: number[]`, exactly like keepApartImpossible below --
    // same reason (identity is the number) and the same fix (resolve each
    // one through `resolveStudent` before the copy ever sees it).
    case ERROR_CODES.togetherApartClash:
      return e.TOGETHER_APART_CLASH({
        names: error.students.map(resolveStudent),
      });
    case ERROR_CODES.togetherUnitTooLarge:
      return e.TOGETHER_UNIT_TOO_LARGE({
        letter: error.letter,
        unit: error.unit,
        groupSize: error.groupSize,
      });
    case ERROR_CODES.togetherNoArrangement:
      return e.TOGETHER_NO_ARRANGEMENT({ groupsTried: error.groupsTried });
    case ERROR_CODES.togetherSearchGaveUp:
      return e.TOGETHER_SEARCH_GAVE_UP;
    case ERROR_CODES.tooManyStudents:
      return e.TOO_MANY_STUDENTS({ max: error.maxStudents });
    case ERROR_CODES.duplicateNumber:
      return e.DUPLICATE_NUMBER({ number: error.number });
    case ERROR_CODES.keepApartImpossible:
      return e.KEEP_APART_IMPOSSIBLE({
        names: error.students.map(resolveStudent),
        howMany: howMany(error.students),
        groupsNeeded: error.groupsNeeded,
      });
    case ERROR_CODES.keepApartNoArrangement:
      return e.KEEP_APART_NO_ARRANGEMENT({ groupsTried: error.groupsTried });
    case ERROR_CODES.keepApartSearchGaveUp:
      return e.KEEP_APART_SEARCH_GAVE_UP;
    case ERROR_CODES.bothRulesNoArrangement:
      return e.BOTH_RULES_NO_ARRANGEMENT({ groupsTried: error.groupsTried });
    case ERROR_CODES.bothRulesSearchGaveUp:
      return e.BOTH_RULES_SEARCH_GAVE_UP;
    // Carries `students: number[]`, exactly like togetherApartClash and
    // keepApartImpossible above -- same reason (identity is the number) and
    // the same fix (resolve each one through `resolveStudent` first).
    case ERROR_CODES.sexNeedsAllSet:
      return e.SEX_NEEDS_ALL_SET({ names: error.students.map(resolveStudent) });
    // Task 8b. Carries `students: number[]`, exactly like the codes above --
    // same reason (identity is the number) and the same fix.
    case ERROR_CODES.sexSeparateSplitsUnit:
      return e.SEX_SEPARATE_SPLITS_UNIT({
        names: error.students.map(resolveStudent),
        howMany: howMany(error.students),
      });
    // Fix round 1, F-2. Carries `groupsRequested: number`, never a student
    // list -- no resolver needed, unlike every other `separate`-mode code
    // above.
    case ERROR_CODES.sexSeparateImpossible:
      return e.SEX_SEPARATE_IMPOSSIBLE({
        groupsRequested: error.groupsRequested,
      });
    // Fix round 2. Carries no data at all, like togetherSearchGaveUp /
    // keepApartSearchGaveUp / bothRulesSearchGaveUp above -- nothing to pass
    // through.
    case ERROR_CODES.sexSeparateSearchGaveUp:
      return e.SEX_SEPARATE_SEARCH_GAVE_UP;
    // Task 9. Carries `students: number[]`, exactly like togetherApartClash
    // above -- same reason (identity is the number) and the same fix.
    case ERROR_CODES.pinnedSplitsUnit:
      return e.PINNED_SPLITS_UNIT({
        names: error.students.map(resolveStudent),
      });
    case ERROR_CODES.pinnedApartClash:
      return e.PINNED_APART_CLASH({
        names: error.students.map(resolveStudent),
      });
    // Carries a single `number`, exactly like duplicateNumber, but --
    // unlike duplicateNumber -- resolved through `resolveStudent` before the
    // copy sees it: this fires after matching against the current roster,
    // so the number is a real, current student, not an ambiguous raw
    // digit (see ERROR_CODES.pinnedInTwoGroups's doc comment).
    case ERROR_CODES.pinnedInTwoGroups:
      return e.PINNED_IN_TWO_GROUPS({ name: resolveStudent(error.number) });
    // Fix round 1, F-1/F-2. Carries three numbers, never a student list --
    // no resolver needed, unlike most codes above (same shape as
    // sexSeparateImpossible's single `groupsRequested`, just three fields
    // instead of one). Replaces the two situations that used to share
    // `tooManyGroups` on the pinned path -- see
    // ERROR_CODES.pinnedTooManyGroups's doc comment in grouping.ts.
    case ERROR_CODES.pinnedTooManyGroups: {
      // Which of three sentences applies used to be decided inside the
      // English function, by subtraction. Arithmetic is not copy, so it is
      // decided here and every locale's template selects on the outcome.
      const poolGroupsNeeded = error.requestedGroups - error.pinnedGroupCount;
      return e.PINNED_TOO_MANY_GROUPS({
        requestedGroups: error.requestedGroups,
        pinnedGroupCount: error.pinnedGroupCount,
        remainingStudents: error.remainingStudents,
        poolGroupsNeeded,
        situation:
          poolGroupsNeeded < 0
            ? 'over'
            : poolGroupsNeeded === 0
              ? 'full'
              : 'short',
      });
    }
  }
}

/**
 * Turn an engine warning into a sentence in the page's language.
 *
 * Mirrors `renderError` exactly, for the same reason: the engine returns a
 * code plus data, never prose, and `students` carries numbers (identity is
 * the number, see `Student.number` in grouping.ts) that this function
 * resolves through the same `resolveStudent` parameter renderError uses,
 * defaulting the same way -- a caller that forgets a resolver still gets
 * "Student 7, Student 8 …", never bare digits.
 *
 * Task 8a. `sexSpillover` was the first code WARNING_CODES defined. Task 8a
 * built this renderer ahead of a real caller -- see the doc comment on
 * WARNING_CODES.sexSpillover there -- so Task 8b's separate-mode placement
 * work landed against a channel that was already tested and translated
 * rather than inventing one under time pressure alongside the harder
 * placement logic.
 */
export function renderWarning(
  warning: GroupingWarning,
  strings: Strings,
  resolveStudent: ResolveStudentLabel = (n) => strings.studentNumber({ n }),
): string {
  const w = strings.warnings;
  switch (warning.code) {
    case WARNING_CODES.sexSpillover:
      return w.SEX_SPILLOVER({
        names: warning.students.map(resolveStudent),
        sex: warning.sex,
      });
    // Task 9. Carries `students: number[]`, same resolver pattern as
    // sexSpillover above -- no `sex` field to pass through, see
    // WARNING_CODES.pinnedMixedSex's doc comment in grouping.ts.
    case WARNING_CODES.pinnedMixedSex:
      return w.PINNED_MIXED_SEX({
        names: warning.students.map(resolveStudent),
        howMany: howMany(warning.students),
      });
    // Whole-branch review, I-2. Carries `students: number[]`, same resolver
    // pattern as sexSpillover/pinnedMixedSex above -- no `sex` field to pass
    // through, see WARNING_CODES.sexBothTooSmall's doc comment in
    // grouping.ts.
    case WARNING_CODES.sexBothTooSmall:
      return w.SEX_BOTH_TOO_SMALL({
        names: warning.students.map(resolveStudent),
      });
  }
}

/**
 * The display name for a group.
 *
 * Stage 3, Task 8 (design spec section 5): the themed branch this function
 * used to have -- Animals / Colours / Planets, chosen by a now-removed
 * `<select>` -- is gone along with the theme tables it read from. Groups
 * are always numbered; kept as a real function (not inlined at its one call
 * site, `classroom-groups.ts`'s own `render()`) because it still composes
 * one thing this file already owns -- turning a zero-based index into the
 * page's own `groupLabel` sentence -- in one place, the same reason
 * `resultsHeadingText` below stays a function rather than two copies of
 * "which form do I show" at each of ITS own call sites.
 */
export function groupName(index: number, strings: Strings): string {
  return strings.groupLabel({ n: index + 1 });
}

/**
 * The results heading: unnamed groups read "Your groups"; a named class
 * heads them "<name> — your groups" (design spec section 8). Composed here,
 * in ONE place, so the named and unnamed forms cannot drift apart -- the
 * same reason `groupName` and `renderError` above live here rather than at
 * their call site.
 *
 * A blank -- or WHITESPACE-ONLY -- class name counts as none: design spec
 * section 8 says plainly "Blank is fine and nothing is blocked", and a
 * teacher who fat-fingers the space bar should not get a heading reading
 * " — your groups", a dash with nothing in front of it. `.trim()` is used
 * only to DECIDE that, never to alter what is shown: design spec section 9
 * is explicit that "the class name itself is never altered -- not on the
 * page, not in the `# Class:` line, not in the results heading" -- that
 * section's own filename-safety substitution is deliberately scoped to the
 * exported filename and nowhere else, so a name a teacher actually typed
 * (leading/trailing whitespace included) reaches this heading exactly as
 * typed. So `className.trim()` decides the blank check and never reaches
 * the named branch.
 */
export function resultsHeadingText(
  className: string,
  strings: Strings,
): string {
  return className.trim() === ''
    ? strings.resultsHeading
    : strings.resultsHeadingNamed({ className });
}

/**
 * A refused number field (#188), as a sentence in the page's language.
 *
 * The ONE place a `NumberSetsProblem` kind becomes copy, for the reason
 * `renderError` and `resultsHeadingText` above both give: two call
 * sites deciding "which sentence do I show" is how two sentences for one
 * fact drift apart.
 *
 * `count` is what `#cg-count` currently holds, which the parser was given
 * and which two of the sentences name. It is NOT read from the problem:
 * `numberSets.ts` stays pure of the page, and a problem carries only the
 * offending text.
 *
 * `max` comes from `MAX_STUDENTS` here rather than from the caller, so the
 * ceiling a teacher is told about is necessarily the one the parser
 * enforced -- a caller passing its own number could tell them a limit that
 * is not the real one.
 *
 * No `default` branch on purpose. The switch is exhaustive over
 * `NumberSetsProblemKind`, so adding a kind without a sentence for it fails
 * the build -- which a `default` that threw at runtime would hide until a
 * teacher hit it.
 */
export function renderNumbersProblem(
  problem: NumberSetsProblem,
  count: number,
  strings: Strings,
): string {
  switch (problem.kind) {
    case 'notAWholeNumber':
      return strings.numbersNotWholeMessage({ text: problem.text, count });
    case 'aboveCount':
      return strings.numbersAboveCountMessage({ text: problem.text, count });
    case 'aboveMaximum':
      return strings.numbersAboveMaximumMessage({
        text: problem.text,
        max: MAX_STUDENTS,
      });
    case 'duplicate':
      return strings.numbersDuplicateMessage({ text: problem.text });
    case 'lonelySet':
      return strings.numbersLonelySetMessage({ text: problem.text });
    case 'tooManySets':
      return strings.numbersTooManySetsMessage({ text: problem.text });
    case 'noCount':
      return strings.numbersNoCountMessage;
  }
}

export type { Strings };
