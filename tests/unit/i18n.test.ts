import { describe, it, expect } from 'vitest';
import { nonEmpty, searched } from '../source-files';
import { catalogueLeaves, stringLeaves } from '../../src/lib/catalogue-leaves';
import { en as enCatalogue } from '../../src/lib/i18n/en';
import { id as idCatalogue } from '../../src/lib/i18n/id';
import {
  LOCALES,
  DEFAULT_LOCALE,
  getStrings,
  renderError,
  renderWarning,
  renderNumbersProblem,
  localisePath,
  localeFromPath,
  toolPath,
  otherLocales,
  isLocale,
  groupName,
  resultsHeadingText,
} from '../../src/lib/i18n';
import {
  ERROR_CODES,
  WARNING_CODES,
  MAX_STUDENTS,
  type GroupingError,
  type GroupingWarning,
} from '../../src/lib/grouping';
import {
  NUMBER_SETS_PROBLEM_KINDS,
  type NumberSetsProblem,
} from '../../src/lib/numberSets';
import { siteEn, siteId } from '../../src/lib/i18n/site';
import { LOCALE_METADATA } from '../../src/lib/i18n/metadata';
import { isMessageTemplate } from '../../src/lib/i18n/message';

/**
 * The catalogues as written. Since #136 every parameterised message in them
 * is a template string, so the structural checks walk these and reach the
 * messages like any other copy.
 */
const catalogues = [
  ['en', enCatalogue],
  ['id', idCatalogue],
] as const;

/**
 * The tables a page receives from `getStrings`, where every message is a
 * function of its named slots. Everything that renders uses these.
 */
const en = getStrings('en');
const id = getStrings('id');
const locales = [
  ['en', en],
  ['id', id],
] as const;

/**
 * Every string in a catalogue, PROVED non-empty before a guard reads it.
 *
 * Three guards below assert absence over the result of filtering this --
 * nothing blank, nothing left as English. A walker that returned `[]` would
 * satisfy all three at once while reading nothing, which is #84's lesson in
 * a second medium: the file walk already refuses an empty result inside
 * `filesUnder`, and a catalogue walk is the same shape.
 *
 * A plain `throw` via `nonEmpty`, not an `expect`: the refusal belongs to
 * the derivation, where a call site cannot forget it.
 *
 * Strings alone: a table from `getStrings` holds each message as a function,
 * which is not copy, so a check that must see the messages walks
 * `catalogues`, never `locales`.
 */
const deepStrings = (value: unknown): Array<[string, string]> =>
  nonEmpty(stringLeaves(value), 'catalogue strings');

/**
 * Strings that are legitimately the same in both languages. Measured, not
 * assumed — this is the whole list across every key at every depth.
 */
const ALLOWED_IDENTICAL = new Set([
  'speedNormal', // "Normal" is the Indonesian word as well
  // Stage 3, Task 2. Punctuation/symbols, not English -- "#" and "—" carry
  // no language of their own, so there is nothing to translate. See these
  // two keys' own doc comments in en.ts.
  'rosterColNumber',
  'rosterUnset',
]);

describe('locales are complete', () => {
  it('Indonesian defines every key English defines, at every depth', () => {
    // Every leaf, array positions included, so a themes list or a howToSteps
    // that lost an entry is a failure rather than a shorter page. The first
    // version read `Object.entries` at the top level only and skipped anything
    // that was not a string, which left roughly 45 keys -- `errors.*`,
    // `themes.*`, `themeNames.*`, every `howToSteps` entry -- unchecked.
    const paths = (table: unknown): string[] =>
      catalogueLeaves(table)
        .map(([path]) => path)
        .sort();
    expect(paths(idCatalogue)).toEqual(
      nonEmpty(paths(enCatalogue), 'English leaf paths'),
    );
  });

  it.each(catalogues)('%s has no blank string anywhere', (_name, catalogue) => {
    const blank = deepStrings(catalogue)
      .filter(([, v]) => v.trim() === '')
      .map(([k]) => k);
    expect(blank).toEqual([]);
  });

  it('Indonesian is actually translated, not copied English', () => {
    // Walks EVERY string rather than five hand-picked ones. A copy-paste
    // locale passes a same-keys check perfectly, and five samples cannot see
    // the section somebody forgot.
    //
    // Since #136 that includes every parameterised message: each is a
    // template string now, so one left in English is caught here like any
    // other copy. Until then a separate probe had to call both locales'
    // functions with the same arguments, because a function has no text.
    //
    // Exceptions are listed by name, so each one is a decision rather than a
    // loosened rule.
    const enMap = new Map(deepStrings(enCatalogue));
    const idStrings = deepStrings(idCatalogue);
    const identical = idStrings
      .filter(([k, v]) => enMap.get(k) === v)
      .map(([k]) => k);

    expect(
      searched(
        identical.filter((k) => !ALLOWED_IDENTICAL.has(k)),
        { of: idStrings, what: 'Indonesian catalogue strings' },
      ),
    ).toEqual([]);
  });

  it('and the list of exceptions has no dead entries', () => {
    // An allow-list that outlives its reason quietly stops guarding anything.
    // If a translation lands for one of these, this fails and the entry goes.
    const enMap = new Map(deepStrings(enCatalogue));
    const stillIdentical = deepStrings(idCatalogue)
      .filter(([k, v]) => enMap.get(k) === v)
      .map(([k]) => k);
    expect(
      [...ALLOWED_IDENTICAL].filter((k) => !stillIdentical.includes(k)).sort(),
    ).toEqual([]);
  });
});

describe('every engine error can be rendered in every language', () => {
  /**
   * One realistic error per code, with the data that code carries.
   *
   * The old version called renderError({ code }) with no data at all and
   * asserted only that the result was non-empty — so
   * " are not in your class list. Check the spelling." passed, as did
   * " all need to be kept apart from each other, so you would need at least 0
   * groups." GroupingError is a union now, so those calls no longer even
   * describe a possible value.
   */
  const SAMPLES: Record<string, GroupingError> = {
    NO_STUDENTS: { code: ERROR_CODES.noStudents },
    TOO_MANY_STUDENTS: {
      code: ERROR_CODES.tooManyStudents,
      maxStudents: 500,
    },
    DUPLICATE_NUMBER: { code: ERROR_CODES.duplicateNumber, number: 5 },
    INVALID_GROUP_SIZE: { code: ERROR_CODES.invalidGroupSize },
    INVALID_GROUP_COUNT: { code: ERROR_CODES.invalidGroupCount },
    TOO_MANY_GROUPS: { code: ERROR_CODES.tooManyGroups, maxGroups: 4 },
    // Numbers, not names -- same reason as KEEP_APART_IMPOSSIBLE below.
    TOGETHER_APART_CLASH: {
      code: ERROR_CODES.togetherApartClash,
      students: [1, 2],
    },
    TOGETHER_UNIT_TOO_LARGE: {
      code: ERROR_CODES.togetherUnitTooLarge,
      letter: 'A',
      unit: 6,
      groupSize: 4,
    },
    TOGETHER_NO_ARRANGEMENT: {
      code: ERROR_CODES.togetherNoArrangement,
      groupsTried: 2,
    },
    TOGETHER_SEARCH_GAVE_UP: { code: ERROR_CODES.togetherSearchGaveUp },
    // Numbers, not names -- identity is the number (Student.number). See the
    // "resolving a student number to a label" block below for how a name
    // reaches the page from here.
    KEEP_APART_IMPOSSIBLE: {
      code: ERROR_CODES.keepApartImpossible,
      students: [1, 2],
      groupsNeeded: 2,
    },
    KEEP_APART_NO_ARRANGEMENT: {
      code: ERROR_CODES.keepApartNoArrangement,
      groupsTried: 2,
    },
    KEEP_APART_SEARCH_GAVE_UP: { code: ERROR_CODES.keepApartSearchGaveUp },
    BOTH_RULES_NO_ARRANGEMENT: {
      code: ERROR_CODES.bothRulesNoArrangement,
      groupsTried: 2,
    },
    BOTH_RULES_SEARCH_GAVE_UP: { code: ERROR_CODES.bothRulesSearchGaveUp },
    // Task 7. Carries `students: number[]`, never names -- same resolver
    // pattern as TOGETHER_APART_CLASH and KEEP_APART_IMPOSSIBLE above. A
    // single student, deliberately: the guard can legitimately fire for
    // just one (see grouping.test.ts's "refuses when a student being
    // grouped has no sex set"), so English copy has a singular/plural
    // branch to get right, unlike the two codes above whose student lists
    // are always >= 2 by construction.
    SEX_NEEDS_ALL_SET: { code: ERROR_CODES.sexNeedsAllSet, students: [3] },
    // Task 8b. Carries `students: number[]`, never names -- same resolver
    // pattern as TOGETHER_APART_CLASH above. Always >= 2 by construction (a
    // together-unit spanning both sexes needs at least one of each), unlike
    // SEX_NEEDS_ALL_SET above.
    SEX_SEPARATE_SPLITS_UNIT: {
      code: ERROR_CODES.sexSeparateSplitsUnit,
      students: [1, 2],
    },
    // Fix round 1, F-2. Carries `groupsRequested: number`, never names --
    // no resolver involved, unlike every other code in this table that
    // carries `students`.
    SEX_SEPARATE_IMPOSSIBLE: {
      code: ERROR_CODES.sexSeparateImpossible,
      groupsRequested: 4,
    },
    // Fix round 2. Carries no data at all, like the other three
    // SEARCH_GAVE_UP codes above -- nothing was established, so there is
    // nothing to pass through.
    SEX_SEPARATE_SEARCH_GAVE_UP: { code: ERROR_CODES.sexSeparateSearchGaveUp },
    // Task 9. Carries `students: number[]`, never names -- same resolver
    // pattern as TOGETHER_APART_CLASH above. Always >= 2 by construction.
    PINNED_SPLITS_UNIT: {
      code: ERROR_CODES.pinnedSplitsUnit,
      students: [1, 7],
    },
    // Task 9. Carries `students: number[]`, always >= 2 by construction
    // (an apart-letter needs at least two holders, both inside one pinned
    // group to trip this).
    PINNED_APART_CLASH: {
      code: ERROR_CODES.pinnedApartClash,
      students: [1, 2],
    },
    // Task 9. Carries a single `number`, like DUPLICATE_NUMBER -- never a
    // list.
    PINNED_IN_TWO_GROUPS: {
      code: ERROR_CODES.pinnedInTwoGroups,
      number: 5,
    },
    // Fix round 1, F-1/F-2. Carries three numbers, always present -- see
    // ERROR_CODES.pinnedTooManyGroups's doc comment in grouping.ts for why
    // a derived `poolGroupsNeeded` is not its own field. F-1's own reported
    // shape: 10 students, groupCount 4, one pin of 8.
    PINNED_TOO_MANY_GROUPS: {
      code: ERROR_CODES.pinnedTooManyGroups,
      requestedGroups: 4,
      pinnedGroupCount: 1,
      remainingStudents: 2,
    },
  };

  it('every code the engine can return has a sample here', () => {
    // Otherwise a new code arrives with no coverage and this file still
    // reports green — the list would be describing itself, not the engine.
    expect(Object.keys(SAMPLES).sort()).toEqual(
      Object.values(ERROR_CODES).sort(),
    );
  });

  it.each(locales)(
    '%s renders every code as a real sentence',
    (_n, strings) => {
      for (const [code, error] of Object.entries(SAMPLES)) {
        const msg = renderError(error, strings);
        expect(msg).not.toContain(code); // no raw code leaking through
        // A sentence, not a fragment: starts with a capital, ends in a stop,
        // and never opens with the space left by missing data.
        expect(msg).toMatch(/^\S.*[.!?]$/);
        expect(msg[0]).toBe(msg[0].toUpperCase());
      }
    },
  );

  it('the impossible-constraints message names the students, via the resolver, and the group count', () => {
    const names = ['Ana', 'Budi', 'Citra', 'Dewi', 'Eko'];
    const msg = renderError(
      {
        code: ERROR_CODES.keepApartImpossible,
        students: [1, 2, 3, 4, 5],
        groupsNeeded: 5,
      },
      en,
      (n) => names[n - 1],
    );
    for (const name of names) expect(msg).toContain(name);
    expect(msg).toContain('5');
  });

  it('the too-many and duplicate messages print the numbers the engine gave', () => {
    // The sentence check above passes with any number in the slot, so the
    // limit and the repeated number went unobserved (#390, RE9 RE10).
    expect(
      renderError({ code: ERROR_CODES.tooManyStudents, maxStudents: 500 }, en),
    ).toBe('That is more students than this tool will take. The most is 500.');
    expect(
      renderError({ code: ERROR_CODES.duplicateNumber, number: 5 }, en),
    ).toBe(
      'Student number 5 is used twice. Give each student their own number.',
    );
  });

  describe('resolving a student number to a label', () => {
    // KEEP_APART_IMPOSSIBLE carries numbers (Student.number is the identity;
    // see grouping.ts), never names -- the engine has no roster to resolve
    // one from. renderError's third parameter is how a caller with a roster
    // supplies a better label than a bare number; a caller without one --
    // or one that simply forgets -- must still get a readable sentence.
    it.each(locales)(
      'falls back to the numbered label when no resolver is supplied (%s)',
      (_name, strings) => {
        const msg = renderError(
          {
            code: ERROR_CODES.keepApartImpossible,
            students: [1, 2],
            groupsNeeded: 2,
          },
          strings,
        );
        // The exact rendered sentence, not merely "a function was called" --
        // a resolver that fires but formats wrongly would still pass a
        // weaker check.
        expect(msg).toBe(
          strings.errors.KEEP_APART_IMPOSSIBLE({
            names: [
              strings.studentNumber({ n: 1 }),
              strings.studentNumber({ n: 2 }),
            ],
            groupsNeeded: 2,
          }),
        );
        expect(msg).toContain(strings.studentNumber({ n: 1 }));
        expect(msg).toContain(strings.studentNumber({ n: 2 }));
        // Digits alone, with no word around them, is exactly the bug this
        // default exists to prevent -- "1 and 2 all need to be kept apart"
        // reads as nonsense to a teacher.
        expect(msg).not.toMatch(/^\d/);
      },
    );

    it('English default reads "Student 1 and Student 2 …", not bare digits', () => {
      const msg = renderError(
        {
          code: ERROR_CODES.keepApartImpossible,
          students: [1, 2],
          groupsNeeded: 2,
        },
        en,
      );
      expect(msg).toContain('Student 1 and Student 2');
    });

    it('Indonesian default reads "Siswa 1 dan Siswa 2 …", not bare digits', () => {
      const msg = renderError(
        {
          code: ERROR_CODES.keepApartImpossible,
          students: [1, 2],
          groupsNeeded: 2,
        },
        id,
      );
      expect(msg).toContain('Siswa 1 dan Siswa 2');
    });

    it('a supplied resolver is used in place of the default, for every number', () => {
      const byNumber: Record<number, string> = { 1: 'Ana', 2: 'Budi' };
      const msg = renderError(
        {
          code: ERROR_CODES.keepApartImpossible,
          students: [1, 2],
          groupsNeeded: 2,
        },
        en,
        (n) => byNumber[n],
      );
      expect(msg).toBe(
        'Ana and Budi all need to be kept apart from each other, so you would need at least 2 groups. Either make more groups or remove one of the rules.',
      );
      expect(msg).not.toContain('Student');
    });
  });

  describe('together-apart clash resolves student numbers to names', () => {
    // Correction 1: TOGETHER_APART_CLASH carries `students: number[]`,
    // exactly like KEEP_APART_IMPOSSIBLE above, and must go through the same
    // resolver -- a teacher reading "1 and 2 are marked..." instead of
    // "Ana and Budi are marked..." is exactly the regression the resolver
    // parameter exists to prevent.
    it.each(locales)(
      'falls back to the numbered label when no resolver is supplied (%s)',
      (_name, strings) => {
        const msg = renderError(
          { code: ERROR_CODES.togetherApartClash, students: [1, 2] },
          strings,
        );
        expect(msg).toBe(
          strings.errors.TOGETHER_APART_CLASH({
            names: [
              strings.studentNumber({ n: 1 }),
              strings.studentNumber({ n: 2 }),
            ],
          }),
        );
        expect(msg).toContain(strings.studentNumber({ n: 1 }));
        expect(msg).toContain(strings.studentNumber({ n: 2 }));
        // Digits alone, with no word around them, is exactly the bug this
        // default exists to prevent.
        expect(msg).not.toMatch(/^\d/);
      },
    );

    it('English default reads "Student 1 and Student 2 …", not bare digits', () => {
      const msg = renderError(
        { code: ERROR_CODES.togetherApartClash, students: [1, 2] },
        en,
      );
      expect(msg).toContain('Student 1 and Student 2');
    });

    it('Indonesian default reads "Siswa 1 dan Siswa 2 …", not bare digits', () => {
      const msg = renderError(
        { code: ERROR_CODES.togetherApartClash, students: [1, 2] },
        id,
      );
      expect(msg).toContain('Siswa 1 dan Siswa 2');
    });

    it('English: a supplied resolver is used in place of the default, for every number', () => {
      const byNumber: Record<number, string> = { 1: 'Ana', 2: 'Budi' };
      const msg = renderError(
        { code: ERROR_CODES.togetherApartClash, students: [1, 2] },
        en,
        (n) => byNumber[n],
      );
      expect(msg).toBe(
        'Ana and Budi are marked to stay together and to be kept apart from each other at the same time. Remove the together letter or the apart letter from one of them.',
      );
      expect(msg).not.toContain('Student');
    });

    it('Indonesian: a supplied resolver is used in place of the default, for every number', () => {
      const byNumber: Record<number, string> = { 1: 'Ana', 2: 'Budi' };
      const msg = renderError(
        { code: ERROR_CODES.togetherApartClash, students: [1, 2] },
        id,
        (n) => byNumber[n],
      );
      expect(msg).toBe(
        'Ana dan Budi ditandai untuk disatukan sekaligus dipisahkan satu sama lain. Hapus huruf yang menyatukan mereka, atau huruf yang memisahkan mereka.',
      );
      expect(msg).not.toContain('Siswa');
    });
  });

  describe('sex-needs-all-set resolves student numbers to names', () => {
    // Task 7. Carries `students: number[]`, exactly like
    // TOGETHER_APART_CLASH and KEEP_APART_IMPOSSIBLE above, and must go
    // through the same resolver -- a teacher reading "3 does not have..."
    // instead of "Citra does not have..." is the same regression the
    // resolver parameter exists to prevent for the other two codes.
    it.each(locales)(
      'falls back to the numbered label when no resolver is supplied (%s)',
      (_name, strings) => {
        const msg = renderError(
          { code: ERROR_CODES.sexNeedsAllSet, students: [3] },
          strings,
        );
        expect(msg).toBe(
          strings.errors.SEX_NEEDS_ALL_SET({
            names: [strings.studentNumber({ n: 3 })],
          }),
        );
        expect(msg).toContain(strings.studentNumber({ n: 3 }));
        // A bare digit with no word around it is exactly the bug this
        // default exists to prevent.
        expect(msg).not.toMatch(/^\d+ /);
      },
    );

    it('English default reads "Student 3 …", not a bare digit', () => {
      const msg = renderError(
        { code: ERROR_CODES.sexNeedsAllSet, students: [3] },
        en,
      );
      expect(msg).toContain('Student 3');
    });

    it('Indonesian default reads "Siswa 3 …", not a bare digit', () => {
      const msg = renderError(
        { code: ERROR_CODES.sexNeedsAllSet, students: [3] },
        id,
      );
      expect(msg).toContain('Siswa 3');
    });

    it('English: a supplied resolver is used in place of the default', () => {
      const msg = renderError(
        { code: ERROR_CODES.sexNeedsAllSet, students: [3] },
        en,
        (n) => (n === 3 ? 'Citra' : `#${n}`),
      );
      expect(msg).toBe(
        'Citra has no sex set, so this mode cannot run until every student does. Set a sex for them, or turn it off.',
      );
      expect(msg).not.toContain('Student');
    });

    it('Indonesian: a supplied resolver is used in place of the default', () => {
      const msg = renderError(
        { code: ERROR_CODES.sexNeedsAllSet, students: [3] },
        id,
        (n) => (n === 3 ? 'Citra' : `#${n}`),
      );
      expect(msg).toBe(
        'Citra belum memiliki jenis kelamin, jadi mode ini tidak bisa dijalankan sampai jenis kelamin semua siswa terisi. Isi jenis kelamin untuk mereka, atau matikan mode ini.',
      );
      expect(msg).not.toContain('Siswa');
    });

    it('English names everyone when more than one student has no sex set, with plural grammar', () => {
      // English inflects (see resultsSummary's own singular/plural split),
      // so a list of TWO must read differently from the singular case
      // above -- "has" -> "have", "them" -> "each of them" -- not just a
      // longer name list glued onto the same singular verb.
      const msg = renderError(
        { code: ERROR_CODES.sexNeedsAllSet, students: [1, 2] },
        en,
        (n) => (n === 1 ? 'Ana' : 'Budi'),
      );
      expect(msg).toBe(
        'Ana and Budi have no sex set, so this mode cannot run until every student does. Set a sex for each of them, or turn it off.',
      );
    });

    it('Indonesian reads the same with two students, since Indonesian does not inflect for plural', () => {
      const msg = renderError(
        { code: ERROR_CODES.sexNeedsAllSet, students: [1, 2] },
        id,
        (n) => (n === 1 ? 'Ana' : 'Budi'),
      );
      expect(msg).toBe(
        'Ana dan Budi belum memiliki jenis kelamin, jadi mode ini tidak bisa dijalankan sampai jenis kelamin semua siswa terisi. Isi jenis kelamin untuk mereka, atau matikan mode ini.',
      );
    });
  });

  describe('sex-separate-splits-unit resolves student numbers to names', () => {
    // Task 8b. Carries `students: number[]`, exactly like
    // TOGETHER_APART_CLASH above, and must go through the same resolver --
    // a teacher reading "1 and 2 are marked..." instead of "Ana and Budi
    // are marked..." is the same regression the resolver parameter exists
    // to prevent there.
    it.each(locales)(
      'falls back to the numbered label when no resolver is supplied (%s)',
      (_name, strings) => {
        const msg = renderError(
          { code: ERROR_CODES.sexSeparateSplitsUnit, students: [1, 2] },
          strings,
        );
        expect(msg).toBe(
          strings.errors.SEX_SEPARATE_SPLITS_UNIT({
            names: [
              strings.studentNumber({ n: 1 }),
              strings.studentNumber({ n: 2 }),
            ],
          }),
        );
        expect(msg).toContain(strings.studentNumber({ n: 1 }));
        expect(msg).toContain(strings.studentNumber({ n: 2 }));
        expect(msg).not.toMatch(/^\d/);
      },
    );

    it('English default reads "Student 1 and Student 2 …", not bare digits', () => {
      const msg = renderError(
        { code: ERROR_CODES.sexSeparateSplitsUnit, students: [1, 2] },
        en,
      );
      expect(msg).toContain('Student 1 and Student 2');
    });

    it('Indonesian default reads "Siswa 1 dan Siswa 2 …", not bare digits', () => {
      const msg = renderError(
        { code: ERROR_CODES.sexSeparateSplitsUnit, students: [1, 2] },
        id,
      );
      expect(msg).toContain('Siswa 1 dan Siswa 2');
    });

    it('English: a supplied resolver is used in place of the default, names the pair and both remedies', () => {
      const byNumber: Record<number, string> = { 1: 'Ana', 2: 'Budi' };
      const msg = renderError(
        { code: ERROR_CODES.sexSeparateSplitsUnit, students: [1, 2] },
        en,
        (n) => byNumber[n],
      );
      expect(msg).toBe(
        'Ana and Budi are marked to stay together, but are not all the same sex, so they cannot form a single-sex group. Remove the together letter from one of them, or turn this mode off.',
      );
      expect(msg).not.toContain('Student');
    });

    it('Indonesian: a supplied resolver is used in place of the default', () => {
      const byNumber: Record<number, string> = { 1: 'Ana', 2: 'Budi' };
      const msg = renderError(
        { code: ERROR_CODES.sexSeparateSplitsUnit, students: [1, 2] },
        id,
        (n) => byNumber[n],
      );
      expect(msg).toBe(
        'Ana dan Budi ditandai untuk disatukan, tetapi tidak semuanya berjenis kelamin sama, sehingga tidak bisa membentuk kelompok satu jenis kelamin. Hapus huruf yang menyatukan mereka, atau matikan mode ini.',
      );
      expect(msg).not.toContain('Siswa');
    });
  });

  describe('sex-separate-impossible names no rule and no side (Fix round 1, F-2)', () => {
    // Exact full sentences, both languages -- this code's whole reason to
    // exist is that a teacher must never read a number they did not type,
    // so its copy gets the same word-for-word scrutiny
    // sex-separate-splits-unit's did above, not just a substring check.
    it('English reads the exact sentence, naming the requested count and both remedies, no rule', () => {
      const msg = renderError(
        { code: ERROR_CODES.sexSeparateImpossible, groupsRequested: 4 },
        en,
      );
      expect(msg).toBe(
        'Boys and girls cannot be kept in separate groups across 4 groups while also satisfying your other rules. The search cannot tell which rule is the problem, so try either remedy: ask for a different number of groups, or turn this mode off.',
      );
    });

    it('Indonesian reads the exact sentence', () => {
      const msg = renderError(
        { code: ERROR_CODES.sexSeparateImpossible, groupsRequested: 4 },
        id,
      );
      expect(msg).toBe(
        'Laki-laki dan perempuan tidak bisa tetap berada di kelompok terpisah dalam 4 kelompok sekaligus memenuhi aturan Anda yang lain. Pencarian ini tidak bisa memastikan aturan mana yang jadi masalah, jadi coba salah satu perbaikan ini: minta jumlah kelompok yang berbeda, atau matikan mode ini.',
      );
    });

    it.each(locales)(
      'is not a together/apart code in disguise, at a groupsTried value those codes also use (%s)',
      (_name, strings) => {
        // Fix round 1, F-7 precedent (BOTH_RULES_NO_ARRANGEMENT's own test
        // above): the risk is not "renders empty", it is "collapses into a
        // sibling code's exact wording" -- same groupsTried/groupsRequested
        // value (3) as the together/apart/both-rules samples elsewhere in
        // this file, so a copy-paste that reused one of THEIR strings would
        // be caught here, not hidden by picking a number nothing else uses.
        const msg = renderError(
          { code: ERROR_CODES.sexSeparateImpossible, groupsRequested: 3 },
          strings,
        );
        expect(msg).toContain('3');
        expect(msg).not.toBe(
          strings.errors.TOGETHER_NO_ARRANGEMENT({ groupsTried: 3 }),
        );
        expect(msg).not.toBe(
          strings.errors.KEEP_APART_NO_ARRANGEMENT({ groupsTried: 3 }),
        );
        expect(msg).not.toBe(
          strings.errors.BOTH_RULES_NO_ARRANGEMENT({ groupsTried: 3 }),
        );
      },
    );
  });

  describe('sex-separate-search-gave-up claims nothing, and offers the mode switch (Fix round 2)', () => {
    // Exact full sentences, both languages -- same word-for-word scrutiny
    // sex-separate-impossible's own test above gets: a proof-shaped
    // sentence reaching a teacher when nothing was actually proven is
    // exactly the defect this code exists to prevent, so a substring check
    // could not tell a correct fix from one that merely renders SOMETHING.
    it('English reads the exact sentence: no proof claimed, fewer letters or the mode switch', () => {
      const msg = renderError(
        { code: ERROR_CODES.sexSeparateSearchGaveUp },
        en,
      );
      expect(msg).toBe(
        'There are too many together- and apart-letters here to work through while also keeping boys and girls in separate groups. Try using fewer letters, or turn this mode off.',
      );
    });

    it('Indonesian reads the exact sentence', () => {
      const msg = renderError(
        { code: ERROR_CODES.sexSeparateSearchGaveUp },
        id,
      );
      expect(msg).toBe(
        'Huruf yang harus disatukan dan aturan pemisahan di sini terlalu banyak untuk dihitung sekaligus, sambil juga menjaga laki-laki dan perempuan di kelompok terpisah. Coba gunakan lebih sedikit huruf, atau matikan mode ini.',
      );
    });

    // Collapsing into ANY of the other three SEARCH_GAVE_UP codes would be
    // the same defect class as sex-separate-impossible's own "not a
    // together/apart code in disguise" test above -- these four all carry
    // ZERO data, so a copy-paste mistake here could not be caught by any
    // number-based check the way that test uses; only the exact sentence
    // can catch it.
    it.each(locales)(
      'is not one of the other three SEARCH_GAVE_UP codes in disguise (%s)',
      (_name, strings) => {
        const msg = renderError(
          { code: ERROR_CODES.sexSeparateSearchGaveUp },
          strings,
        );
        expect(msg).not.toBe(strings.errors.TOGETHER_SEARCH_GAVE_UP);
        expect(msg).not.toBe(strings.errors.KEEP_APART_SEARCH_GAVE_UP);
        expect(msg).not.toBe(strings.errors.BOTH_RULES_SEARCH_GAVE_UP);
      },
    );

    it.each(locales)(
      'is not sexSeparateImpossible in disguise (%s)',
      (_name, strings) => {
        const msg = renderError(
          { code: ERROR_CODES.sexSeparateSearchGaveUp },
          strings,
        );
        const proof = renderError(
          { code: ERROR_CODES.sexSeparateImpossible, groupsRequested: 4 },
          strings,
        );
        expect(msg).not.toBe(proof);
      },
    );
  });

  describe('both together- and apart-letters are live at once', () => {
    // Correction 2: the two single-rule codes have OPPOSITE remedies, so
    // guessing between them when both rules are live sends the teacher the
    // wrong way as often as the right one. These pin that the combined
    // copy commits to neither.
    it.each(locales)(
      'names how many groups were tried, without picking a side (%s)',
      (_name, strings) => {
        const msg = renderError(
          { code: ERROR_CODES.bothRulesNoArrangement, groupsTried: 3 },
          strings,
        );
        expect(msg).toContain('3');
        // "Without picking a side" (Fix round 1, F-7): the old version
        // asserted only the group count, which both single-rule PROVEN
        // messages also contain at groupsTried=3 -- so it could not have
        // told a collapse-to-one-rule bug from the real thing. This can:
        // the two single-rule messages are distinct copy this must never
        // equal.
        expect(msg).not.toBe(
          strings.errors.TOGETHER_NO_ARRANGEMENT({ groupsTried: 3 }),
        );
        expect(msg).not.toBe(
          strings.errors.KEEP_APART_NO_ARRANGEMENT({ groupsTried: 3 }),
        );
      },
    );

    // Fix round 1, F-6: folds in and replaces the old English-only "offers
    // BOTH remedies -- bigger groups AND more groups -- not one" test, whose
    // two assertions ('bigger', 'more groups') this strictly subsumes as
    // substrings, and mirrors it into Indonesian, which had NO assertion on
    // this content at all before now -- the gap F-6 found: the Indonesian
    // used to offer four actions with no way to tell which addressed which
    // rule ("berikan setiap huruf ke lebih sedikit siswa" for a message
    // about BOTH letter kinds, when only the together-letter remedy is
    // that). Each phrase below only appears in the FIXED copy -- picked so
    // a regression back to the old generic listing reddens this, not just a
    // regression that drops a remedy entirely.
    it.each([
      ['en', en, 'make the groups bigger', 'make more groups'],
      ['id', id, 'untuk huruf yang harus disatukan', 'untuk aturan pemisahan'],
    ] as const)(
      'ties each remedy to the rule it fixes, not a shared generic list (%s)',
      (_name, strings, togetherPhrase, apartPhrase) => {
        const msg = renderError(
          { code: ERROR_CODES.bothRulesNoArrangement, groupsTried: 3 },
          strings,
        );
        expect(msg).toContain(togetherPhrase);
        expect(msg).toContain(apartPhrase);
      },
    );

    it('English gave-up copy does not claim either rule is the cause', () => {
      // Fix round 1, F-2: the old version only re-checked, for this one
      // code, what the `it.each(locales)` sentence-shape loop above already
      // asserts for EVERY code in SAMPLES (no raw code leaking through; a
      // real sentence) -- nothing in it tested this code's own claim.
      const msg = renderError({ code: ERROR_CODES.bothRulesSearchGaveUp }, en);
      // Mentions BOTH kinds of letter...
      expect(msg).toContain('together');
      expect(msg).toContain('apart');
      // ...and is not a single-rule message in disguise: the two
      // single-rule gave-up sentences are distinct copy this must never
      // collapse into.
      expect(msg).not.toBe(en.errors.TOGETHER_SEARCH_GAVE_UP);
      expect(msg).not.toBe(en.errors.KEEP_APART_SEARCH_GAVE_UP);
    });

    it('Indonesian gave-up copy does not claim either rule is the cause', () => {
      const msg = renderError({ code: ERROR_CODES.bothRulesSearchGaveUp }, id);
      // "disatukan" (together) and "pemisahan" (apart) -- the Indonesian
      // words the single-rule copy above uses on their own.
      expect(msg).toContain('disatukan');
      expect(msg).toContain('pemisahan');
      expect(msg).not.toBe(id.errors.TOGETHER_SEARCH_GAVE_UP);
      expect(msg).not.toBe(id.errors.KEEP_APART_SEARCH_GAVE_UP);
    });
  });

  it('states the maximum possible when too many groups were requested', () => {
    const msg = renderError(
      { code: ERROR_CODES.tooManyGroups, maxGroups: 4 },
      en,
    );
    expect(msg).toContain('4');
  });

  it.each(locales)(
    'the together-unit-too-large message names the letter, the unit size and the group size (%s)',
    (_name, strings) => {
      // letter: 'Q' rather than 'A' -- the sample used to pass 'A', so a
      // renderError that quietly hardcoded the letter to 'A' instead of
      // substituting `error.letter` would render "...letter "A"..." and this
      // test could not tell the difference: its own expected value was the
      // same letter the bug would have hardcoded. 'Q' does not collide with
      // a plausible hardcoded default, so a dropped substitution now shows
      // up as a missing 'Q' rather than a coincidental match. Fix round 1, F-6.
      const msg = renderError(
        {
          code: ERROR_CODES.togetherUnitTooLarge,
          letter: 'Q',
          unit: 6,
          groupSize: 4,
        },
        strings,
      );
      expect(msg).toContain('Q');
      expect(msg).toContain('6');
      expect(msg).toContain('4');
    },
  );

  it.each(locales)(
    'the together-no-arrangement message names how many groups were tried (%s)',
    (_name, strings) => {
      // Fix round 1, F-1/F-6: the generic "renders every code as a real
      // sentence" check above only looks at sentence SHAPE, so it would not
      // notice renderError threading the wrong number through. This is the
      // dedicated check that does, matching the precedent set by the
      // together-unit-too-large test above -- and, since Task 11's sweep,
      // by KEEP_APART_NO_ARRANGEMENT's own dedicated check directly below,
      // which did not exist when this comment was first written.
      const msg = renderError(
        { code: ERROR_CODES.togetherNoArrangement, groupsTried: 3 },
        strings,
      );
      expect(msg).toContain('3');
    },
  );

  // Task 11, the final sweep. Named directly by the comment above (before
  // this task): this sibling code had a SAMPLES entry (the generic "renders every code" check above)
  // but, unlike TOGETHER_NO_ARRANGEMENT just above, no test confirming
  // `renderError` actually threads `groupsTried` through rather than, say,
  // hardcoding a number or dropping it. Same idiom as that test, same
  // number, deliberately, so a reader can compare the two side by side.
  it.each(locales)(
    'the keep-apart-no-arrangement message names how many groups were tried (%s)',
    (_name, strings) => {
      const msg = renderError(
        { code: ERROR_CODES.keepApartNoArrangement, groupsTried: 3 },
        strings,
      );
      expect(msg).toContain('3');
    },
  );

  describe('pinned-splits-unit resolves student numbers to names', () => {
    // Task 9, Correction 2. Carries `students: number[]`, exactly like
    // togetherApartClash above, and must go through the same resolver.
    it.each(locales)(
      'falls back to the numbered label when no resolver is supplied (%s)',
      (_name, strings) => {
        const msg = renderError(
          { code: ERROR_CODES.pinnedSplitsUnit, students: [1, 7] },
          strings,
        );
        expect(msg).toBe(
          strings.errors.PINNED_SPLITS_UNIT({
            names: [
              strings.studentNumber({ n: 1 }),
              strings.studentNumber({ n: 7 }),
            ],
          }),
        );
        expect(msg).toContain(strings.studentNumber({ n: 1 }));
        expect(msg).toContain(strings.studentNumber({ n: 7 }));
        expect(msg).not.toMatch(/^\d/);
      },
    );

    it('English: a supplied resolver is used in place of the default, names the pair and both remedies', () => {
      const byNumber: Record<number, string> = { 1: 'Ana', 7: 'Gita' };
      const msg = renderError(
        { code: ERROR_CODES.pinnedSplitsUnit, students: [1, 7] },
        en,
        (n) => byNumber[n],
      );
      expect(msg).toBe(
        'Ana and Gita are marked to stay together, but only some of them are in a pinned group. Unpin the group, or remove the together letter from whoever is outside it.',
      );
      expect(msg).not.toContain('Student');
    });

    it('Indonesian: a supplied resolver is used in place of the default', () => {
      const byNumber: Record<number, string> = { 1: 'Ana', 7: 'Gita' };
      const msg = renderError(
        { code: ERROR_CODES.pinnedSplitsUnit, students: [1, 7] },
        id,
        (n) => byNumber[n],
      );
      expect(msg).toBe(
        'Ana dan Gita ditandai untuk disatukan, tetapi hanya sebagian dari mereka yang berada di kelompok yang dikunci. Batalkan kunci kelompok itu, atau hapus huruf penyatu itu dari yang berada di luar kelompok.',
      );
      expect(msg).not.toContain('Siswa');
    });
  });

  describe('pinned-apart-clash resolves student numbers to names', () => {
    // Task 9, Correction 3 (decision: refuse, not warn). Carries
    // `students: number[]`, same resolver pattern as togetherApartClash.
    it.each(locales)(
      'falls back to the numbered label when no resolver is supplied (%s)',
      (_name, strings) => {
        const msg = renderError(
          { code: ERROR_CODES.pinnedApartClash, students: [1, 2] },
          strings,
        );
        expect(msg).toBe(
          strings.errors.PINNED_APART_CLASH({
            names: [
              strings.studentNumber({ n: 1 }),
              strings.studentNumber({ n: 2 }),
            ],
          }),
        );
        expect(msg).toContain(strings.studentNumber({ n: 1 }));
        expect(msg).toContain(strings.studentNumber({ n: 2 }));
        expect(msg).not.toMatch(/^\d/);
      },
    );

    it('English: a supplied resolver is used in place of the default', () => {
      const byNumber: Record<number, string> = { 1: 'Ana', 2: 'Budi' };
      const msg = renderError(
        { code: ERROR_CODES.pinnedApartClash, students: [1, 2] },
        en,
        (n) => byNumber[n],
      );
      expect(msg).toBe(
        'Ana and Budi are marked to be kept apart from each other, but a pinned group puts them in the same one. Unpin the group, or remove the apart letter from one of them.',
      );
      expect(msg).not.toContain('Student');
    });

    it('Indonesian: a supplied resolver is used in place of the default', () => {
      const byNumber: Record<number, string> = { 1: 'Ana', 2: 'Budi' };
      const msg = renderError(
        { code: ERROR_CODES.pinnedApartClash, students: [1, 2] },
        id,
        (n) => byNumber[n],
      );
      expect(msg).toBe(
        'Ana dan Budi ditandai untuk dipisahkan satu sama lain, tetapi kelompok yang dikunci menempatkan mereka bersama. Batalkan kunci kelompok itu, atau hapus huruf pemisah itu dari salah satu siswa tersebut.',
      );
      expect(msg).not.toContain('Siswa');
    });
  });

  describe('pinned-in-two-groups resolves the student number to a name', () => {
    // Task 9, Correction 3 (an unsafe caller error, built not just
    // reported -- see the report). Carries a single `number`, like
    // duplicateNumber, but resolved through `resolveStudent` here (unlike
    // duplicateNumber): this fires after matching against the current
    // roster, so the number is a real, current student.
    it.each(locales)(
      'falls back to the numbered label when no resolver is supplied (%s)',
      (_name, strings) => {
        const msg = renderError(
          { code: ERROR_CODES.pinnedInTwoGroups, number: 5 },
          strings,
        );
        expect(msg).toBe(
          strings.errors.PINNED_IN_TWO_GROUPS({
            name: strings.studentNumber({ n: 5 }),
          }),
        );
        expect(msg).toContain(strings.studentNumber({ n: 5 }));
        // A bare digit with no word around it is exactly the bug this
        // default exists to prevent.
        expect(msg).not.toMatch(/^\d+ /);
      },
    );

    it('English: a supplied resolver is used in place of the default', () => {
      const msg = renderError(
        { code: ERROR_CODES.pinnedInTwoGroups, number: 5 },
        en,
        () => 'Eko',
      );
      expect(msg).toBe(
        'Eko is pinned into two different groups at once. A student can only be pinned into one group. Remove them from one of the two.',
      );
      expect(msg).not.toContain('Student');
    });

    it('Indonesian: a supplied resolver is used in place of the default', () => {
      const msg = renderError(
        { code: ERROR_CODES.pinnedInTwoGroups, number: 5 },
        id,
        () => 'Eko',
      );
      expect(msg).toBe(
        'Eko dikunci ke dalam dua kelompok berbeda sekaligus. Satu siswa hanya bisa dikunci ke dalam satu kelompok. Keluarkan dari salah satu kelompok tersebut.',
      );
      expect(msg).not.toContain('Siswa');
    });
  });

  describe('pinned-too-many-groups says the true thing in all three directions (Fix round 1, F-1/F-2 + Fix round 2)', () => {
    // F-1's own reachable shape: an empty-group regression, not a caller
    // mistake -- MORE pool groups requested than pool students remain.
    // Exact sentences, both languages: this code's whole reason to exist is
    // that the OLD message here was a tautology (TOO_MANY_GROUPS's `max`
    // always equal to the number the teacher had just typed -- F-2), so a
    // substring check could not tell a real fix from another
    // wrong-but-plausible sentence.
    it('English: not enough pool students left, names the shortfall and suggests fewer groups', () => {
      const msg = renderError(
        {
          code: ERROR_CODES.pinnedTooManyGroups,
          requestedGroups: 4,
          pinnedGroupCount: 1,
          remainingStudents: 2,
        },
        en,
      );
      expect(msg).toBe(
        'Your pins already fill 1 of the 4 groups you asked for, which only leaves 2 students — not enough for the 3 groups still needed. Unpin a group, or ask for fewer groups.',
      );
    });

    it('Indonesian: the same shape', () => {
      const msg = renderError(
        {
          code: ERROR_CODES.pinnedTooManyGroups,
          requestedGroups: 4,
          pinnedGroupCount: 1,
          remainingStudents: 2,
        },
        id,
      );
      expect(msg).toBe(
        'Kunci Anda sudah memakai 1 dari 4 kelompok yang Anda minta, sehingga hanya tersisa 2 siswa — tidak cukup untuk 3 kelompok yang masih dibutuhkan. Batalkan kunci salah satu kelompok, atau minta lebih sedikit kelompok.',
      );
    });

    // The other direction: the pins alone already claim every group asked
    // for (or more) -- the ONLY shape this call site covered before this
    // fix (Task 9's original degenerate-case guard). Still this same code,
    // but now says "more", never a max equal to what was typed.
    it('English: pins already claim every group requested, suggests more groups instead', () => {
      const msg = renderError(
        {
          code: ERROR_CODES.pinnedTooManyGroups,
          requestedGroups: 1,
          pinnedGroupCount: 1,
          remainingStudents: 6,
        },
        en,
      );
      expect(msg).toBe(
        'Your pins already fill 1 of the 1 group you asked for, which only leaves 6 students with no group left for them. Unpin a group, or ask for more groups.',
      );
    });

    it('Indonesian: the same shape', () => {
      const msg = renderError(
        {
          code: ERROR_CODES.pinnedTooManyGroups,
          requestedGroups: 1,
          pinnedGroupCount: 1,
          remainingStudents: 6,
        },
        id,
      );
      expect(msg).toBe(
        'Kunci Anda sudah memakai 1 dari 1 kelompok yang Anda minta, sehingga hanya tersisa 6 siswa tanpa kelompok tersisa untuk mereka. Batalkan kunci salah satu kelompok, atau minta lebih banyak kelompok.',
      );
    });

    it('is never the same sentence as plain TOO_MANY_GROUPS at an overlapping max', () => {
      // Fix round 1, F-2's own bug was TOO_MANY_GROUPS's `max` collapsing
      // to the number just typed -- a future edit that reused one
      // implementation for the other would reintroduce exactly that.
      const pinned = renderError(
        {
          code: ERROR_CODES.pinnedTooManyGroups,
          requestedGroups: 1,
          pinnedGroupCount: 1,
          remainingStudents: 6,
        },
        en,
      );
      expect(pinned).not.toBe(en.errors.TOO_MANY_GROUPS({ max: 1 }));
    });

    it('English: singular "group" when only one was requested, in both places it appears', () => {
      const msg = renderError(
        {
          code: ERROR_CODES.pinnedTooManyGroups,
          requestedGroups: 1,
          pinnedGroupCount: 1,
          remainingStudents: 6,
        },
        en,
      );
      expect(msg).toContain('1 group ');
      expect(msg).not.toContain('1 groups');
    });

    // Fix round 2. The third direction: the pins claim MORE groups than
    // were requested (pinnedGroupCount > requestedGroups) while pool
    // students still remain -- reachable by pinning three groups, then
    // lowering the count field to two. Before this fix, this direction fell
    // into the same `poolGroupsNeeded <= 0` branch as the "claims every
    // group requested" case above and reused its "X of the Y groups"
    // opening, which is only coherent when X <= Y -- producing "Your pins
    // already fill 3 of the 2 groups you asked for". The refuse/succeed
    // decision was always correct here (grouping.test.ts's own "Fix round
    // 2" fixture pins that); only this sentence was wrong.
    it('English: pins claim MORE groups than requested, names the true count instead of "X of the Y"', () => {
      const msg = renderError(
        {
          code: ERROR_CODES.pinnedTooManyGroups,
          requestedGroups: 2,
          pinnedGroupCount: 3,
          remainingStudents: 3,
        },
        en,
      );
      expect(msg).toBe(
        'Your pins already use 3 groups — more than the 2 groups you asked for — which leaves 3 students with no group left for them. Unpin a group, or ask for more groups.',
      );
    });

    it('Indonesian: the same shape', () => {
      const msg = renderError(
        {
          code: ERROR_CODES.pinnedTooManyGroups,
          requestedGroups: 2,
          pinnedGroupCount: 3,
          remainingStudents: 3,
        },
        id,
      );
      expect(msg).toBe(
        'Kunci Anda sudah memakai 3 kelompok — lebih banyak daripada 2 kelompok yang Anda minta — sehingga tersisa 3 siswa tanpa kelompok tersisa untuk mereka. Batalkan kunci salah satu kelompok, atau minta lebih banyak kelompok.',
      );
    });
  });
});

describe('every engine warning can be rendered in every language', () => {
  /**
   * One realistic warning per code, mirroring SAMPLES above.
   *
   * Task 8a. `sexSpillover` is the only code WARNING_CODES defines.
   * When this sample was written, nothing in grouping.ts emitted it yet --
   * Task 8b's separate-mode placement, which landed later, is the first
   * caller (see the doc comment on WARNING_CODES.sexSpillover in
   * grouping.ts). That did not excuse the renderer from having a real
   * sample here even then: the parity check below would not notice a code
   * with no sample any more than the error one would.
   */
  const WARNING_SAMPLES: Record<string, GroupingWarning> = {
    SEX_SPILLOVER: {
      code: WARNING_CODES.sexSpillover,
      students: [7, 8],
      sex: 'F',
    },
    // Task 9. Carries `students: number[]`, never names, and no `sex` field
    // (see WARNING_CODES.pinnedMixedSex's doc comment in grouping.ts).
    PINNED_MIXED_SEX: {
      code: WARNING_CODES.pinnedMixedSex,
      students: [1, 4],
    },
    // Whole-branch review, I-2. Carries `students: number[]`, never names,
    // and no `sex` field (see WARNING_CODES.sexBothTooSmall's doc comment
    // in grouping.ts) -- there is no host side and no spilled side, so no
    // one sex is the "right" one to name.
    SEX_BOTH_TOO_SMALL: {
      code: WARNING_CODES.sexBothTooSmall,
      students: [1, 7],
    },
  };

  it('every code the engine can return has a sample here', () => {
    expect(Object.keys(WARNING_SAMPLES).sort()).toEqual(
      Object.values(WARNING_CODES).sort(),
    );
  });

  it.each(locales)(
    '%s renders every code as a real sentence',
    (_n, strings) => {
      for (const [code, warning] of Object.entries(WARNING_SAMPLES)) {
        const msg = renderWarning(warning, strings);
        expect(msg).not.toContain(code); // no raw code leaking through
        expect(msg).toMatch(/^\S.*[.!?]$/);
        expect(msg[0]).toBe(msg[0].toUpperCase());
      }
    },
  );

  describe('sex-spillover resolves student numbers to names', () => {
    // Task 8a. Carries `students: number[]`, exactly like the error codes
    // above, and must go through the same resolver -- a teacher reading
    // "7 and 8 have joined..." instead of "Gita and Hani have joined..." is
    // the same regression the resolver parameter exists to prevent there.
    it.each(locales)(
      'falls back to the numbered label when no resolver is supplied (%s)',
      (_name, strings) => {
        const msg = renderWarning(
          { code: WARNING_CODES.sexSpillover, students: [7, 8], sex: 'F' },
          strings,
        );
        expect(msg).toBe(
          strings.warnings.SEX_SPILLOVER({
            names: [
              strings.studentNumber({ n: 7 }),
              strings.studentNumber({ n: 8 }),
            ],
            sex: 'F',
          }),
        );
        expect(msg).toContain(strings.studentNumber({ n: 7 }));
        expect(msg).toContain(strings.studentNumber({ n: 8 }));
        // A bare digit with no word around it is exactly the bug this
        // default exists to prevent.
        expect(msg).not.toMatch(/^\d/);
      },
    );

    it('English default reads "Student 7 and Student 8 …", not bare digits', () => {
      const msg = renderWarning(
        { code: WARNING_CODES.sexSpillover, students: [7, 8], sex: 'F' },
        en,
      );
      expect(msg).toContain('Student 7 and Student 8');
    });

    it('Indonesian default reads "Siswa 7 dan Siswa 8 …", not bare digits', () => {
      const msg = renderWarning(
        { code: WARNING_CODES.sexSpillover, students: [7, 8], sex: 'F' },
        id,
      );
      expect(msg).toContain('Siswa 7 dan Siswa 8');
    });

    // Girls short: sex: 'F' names the spilled students, so the message must
    // say they joined a group of BOYS. Also checks the "not a mistake"
    // reassurance the brief requires -- the message must not read as if the
    // teacher did something wrong.
    it('English: a supplied resolver is used in place of the default, names who spilled and where they landed', () => {
      const msg = renderWarning(
        { code: WARNING_CODES.sexSpillover, students: [7, 8], sex: 'F' },
        en,
        (n) => (n === 7 ? 'Gita' : 'Hani'),
      );
      expect(msg).toBe(
        'Gita and Hani have joined a group of boys because there were not enough girls to make a group of their own. That is simply how the numbers divided, not a mistake to fix.',
      );
      expect(msg).not.toContain('Student');
      expect(msg).toContain('not a mistake');
    });

    it('Indonesian: a supplied resolver is used in place of the default', () => {
      const msg = renderWarning(
        { code: WARNING_CODES.sexSpillover, students: [7, 8], sex: 'F' },
        id,
        (n) => (n === 7 ? 'Gita' : 'Hani'),
      );
      expect(msg).toBe(
        'Gita dan Hani bergabung dengan kelompok laki-laki karena jumlah perempuan tidak cukup untuk membentuk kelompok sendiri. Ini murni soal angka, bukan kesalahan yang perlu diperbaiki.',
      );
      expect(msg).not.toContain('Siswa');
      expect(msg).toContain('bukan kesalahan');
    });

    // The other direction: boys short this time (sex: 'M'), and a single
    // spilled student -- English inflects for singular ("has", not "have"),
    // unlike the two-student case above.
    it('English names a single spilled student with singular grammar, boys short this time', () => {
      const msg = renderWarning(
        { code: WARNING_CODES.sexSpillover, students: [9], sex: 'M' },
        en,
        () => 'Ivan',
      );
      expect(msg).toBe(
        'Ivan has joined a group of girls because there were not enough boys to make a group of their own. That is simply how the numbers divided, not a mistake to fix.',
      );
    });

    it('Indonesian reads the same shape with one student, since Indonesian does not inflect for plural', () => {
      const msg = renderWarning(
        { code: WARNING_CODES.sexSpillover, students: [9], sex: 'M' },
        id,
        () => 'Ivan',
      );
      expect(msg).toBe(
        'Ivan bergabung dengan kelompok perempuan karena jumlah laki-laki tidak cukup untuk membentuk kelompok sendiri. Ini murni soal angka, bukan kesalahan yang perlu diperbaiki.',
      );
    });
  });

  describe('pinned-mixed-sex resolves student numbers to names', () => {
    // Task 9, Correction 3 (decision: warn, not refuse). Carries
    // `students: number[]`, same resolver pattern as sexSpillover above.
    it.each(locales)(
      'falls back to the numbered label when no resolver is supplied (%s)',
      (_name, strings) => {
        const msg = renderWarning(
          { code: WARNING_CODES.pinnedMixedSex, students: [1, 4] },
          strings,
        );
        expect(msg).toBe(
          strings.warnings.PINNED_MIXED_SEX({
            names: [
              strings.studentNumber({ n: 1 }),
              strings.studentNumber({ n: 4 }),
            ],
          }),
        );
        expect(msg).toContain(strings.studentNumber({ n: 1 }));
        expect(msg).toContain(strings.studentNumber({ n: 4 }));
        expect(msg).not.toMatch(/^\d/);
      },
    );

    it('English: a supplied resolver is used in place of the default, and reassures rather than blaming', () => {
      const msg = renderWarning(
        { code: WARNING_CODES.pinnedMixedSex, students: [1, 4] },
        en,
        (n) => (n === 1 ? 'Ana' : 'Budi'),
      );
      expect(msg).toBe(
        'Ana and Budi are pinned together as one group, but are not all the same sex, so this group was not split by sex like the others. That is what the pin asked for, not a mistake to fix.',
      );
      expect(msg).not.toContain('Student');
      expect(msg).toContain('not a mistake');
    });

    it('Indonesian: a supplied resolver is used in place of the default', () => {
      const msg = renderWarning(
        { code: WARNING_CODES.pinnedMixedSex, students: [1, 4] },
        id,
        (n) => (n === 1 ? 'Ana' : 'Budi'),
      );
      expect(msg).toBe(
        'Ana dan Budi dikunci bersama dalam satu kelompok, tetapi tidak semuanya berjenis kelamin sama, sehingga kelompok ini tidak dipisahkan berdasarkan jenis kelamin seperti kelompok lainnya. Itu sesuai permintaan kunci kelompoknya, bukan kesalahan yang perlu diperbaiki.',
      );
      expect(msg).not.toContain('Siswa');
      expect(msg).toContain('bukan kesalahan');
    });
  });

  describe('sex-both-too-small does not contradict itself the way two sexSpillover warnings did (Fix, I-2)', () => {
    // Whole-branch review, I-2. Carries `students: number[]`, same resolver
    // pattern as sexSpillover/pinnedMixedSex above. Always >= 2 by
    // construction (both sexes must have at least one member for this to
    // fire -- see the call site in grouping.ts), so no singular/plural
    // branch, like sexSeparateSplitsUnit.
    it.each(locales)(
      'falls back to the numbered label when no resolver is supplied (%s)',
      (_name, strings) => {
        const msg = renderWarning(
          { code: WARNING_CODES.sexBothTooSmall, students: [1, 7] },
          strings,
        );
        expect(msg).toBe(
          strings.warnings.SEX_BOTH_TOO_SMALL({
            names: [
              strings.studentNumber({ n: 1 }),
              strings.studentNumber({ n: 7 }),
            ],
          }),
        );
        expect(msg).toContain(strings.studentNumber({ n: 1 }));
        expect(msg).toContain(strings.studentNumber({ n: 7 }));
        expect(msg).not.toMatch(/^\d/);
      },
    );

    // Exact full sentences, both languages -- this code's whole reason to
    // exist is that TWO sexSpillover warnings about the same merged group
    // contradicted each other ("joined a group of girls" / "joined a group
    // of boys", about one group), so a substring check could not tell a
    // real fix (one honest sentence) from a sentence that merely renders.
    it('English: a supplied resolver is used in place of the default, names both and blames neither sex', () => {
      const msg = renderWarning(
        { code: WARNING_CODES.sexBothTooSmall, students: [1, 7] },
        en,
        (n) => (n === 1 ? 'Ana' : 'Gita'),
      );
      expect(msg).toBe(
        'Ana and Gita were placed in one combined group because there were not enough of either sex to make a group of their own. That is simply how the numbers divided, not a mistake to fix.',
      );
      expect(msg).not.toContain('Student');
      expect(msg).toContain('not a mistake');
      // Never claims either side "joined" a pre-existing group of the
      // other -- that framing is exactly what made the two old
      // sexSpillover warnings contradict each other.
      expect(msg).not.toContain('joined');
    });

    it('Indonesian: a supplied resolver is used in place of the default', () => {
      const msg = renderWarning(
        { code: WARNING_CODES.sexBothTooSmall, students: [1, 7] },
        id,
        (n) => (n === 1 ? 'Ana' : 'Gita'),
      );
      expect(msg).toBe(
        'Ana dan Gita digabungkan menjadi satu kelompok karena jumlah laki-laki maupun perempuan tidak cukup untuk membentuk kelompok sendiri-sendiri. Ini murni soal angka, bukan kesalahan yang perlu diperbaiki.',
      );
      expect(msg).not.toContain('Siswa');
      expect(msg).toContain('bukan kesalahan');
    });

    it.each(locales)(
      'is not sexSpillover in disguise (%s)',
      (_name, strings) => {
        const msg = renderWarning(
          { code: WARNING_CODES.sexBothTooSmall, students: [1, 7] },
          strings,
        );
        const spilloverAsM = renderWarning(
          { code: WARNING_CODES.sexSpillover, students: [1, 7], sex: 'M' },
          strings,
        );
        const spilloverAsF = renderWarning(
          { code: WARNING_CODES.sexSpillover, students: [1, 7], sex: 'F' },
          strings,
        );
        expect(msg).not.toBe(spilloverAsM);
        expect(msg).not.toBe(spilloverAsF);
      },
    );
  });
});

// #188. The three number fields refuse in the page's own language, and the
// refusal names the text a teacher actually typed. This is the ONE place a
// problem kind becomes a sentence -- the same reason `renderError` and
// `resultsHeadingText` live in this module rather than at their call sites.
describe('a refused number field says what is wrong in every language', () => {
  const en = getStrings('en');
  const problem = (
    kind: NumberSetsProblem['kind'],
    text = '',
  ): NumberSetsProblem => ({ kind, text });

  // A literal pin against the design, deliberately NOT derived from the
  // array it checks: an assertion that compares a list to itself passes at
  // any size, so it would never notice a kind being dropped.
  it('has exactly seven kinds to render', () => {
    expect(NUMBER_SETS_PROBLEM_KINDS).toHaveLength(7);
  });

  it('names the offending text and the class size for something that is not a number', () => {
    const sentence = renderNumbersProblem(
      problem('notAWholeNumber', 'abc'),
      25,
      en,
    );
    expect(sentence).toContain('abc');
    expect(sentence).toContain('25');
  });

  it('names the class size when a number is above it', () => {
    const sentence = renderNumbersProblem(problem('aboveCount', '26'), 25, en);
    expect(sentence).toContain('26');
    expect(sentence).toContain('25');
  });

  // A different remedy from the one above, which is why it is a different
  // sentence: this one cannot be solved by changing the Students box.
  it("names the page's own ceiling rather than the class size", () => {
    const sentence = renderNumbersProblem(
      problem('aboveMaximum', String(MAX_STUDENTS + 1)),
      MAX_STUDENTS + 50,
      en,
    );
    expect(sentence).toContain(String(MAX_STUDENTS + 1));
    expect(sentence).toContain(String(MAX_STUDENTS));
  });

  it('names the repeated number', () => {
    expect(renderNumbersProblem(problem('duplicate', '7'), 25, en)).toContain(
      '7',
    );
  });

  it('names the set that holds only one number', () => {
    expect(renderNumbersProblem(problem('lonelySet', '3'), 25, en)).toContain(
      '3',
    );
  });

  it('names the set that has no letter left', () => {
    expect(
      renderNumbersProblem(problem('tooManySets', '53,54'), 60, en),
    ).toContain('53,54');
  });

  // The count box is at fault here, not anything in these fields, so the
  // sentence must point at the box -- and must never leak the `NaN` an
  // empty number input actually produces.
  it('points at the count box when the count cannot be read', () => {
    const sentence = renderNumbersProblem(problem('noCount'), Number.NaN, en);
    expect(sentence).toContain('number of students');
    expect(sentence).not.toContain('NaN');
  });

  // Derived from the kinds themselves, so a kind added later and left
  // unhandled turns this red -- rather than passing because nobody
  // remembered to extend a hand-written list. Mirrors `renderError`'s own
  // promise never to show a teacher a raw code.
  for (const locale of LOCALES) {
    it(`renders every kind as a sentence in ${locale}`, () => {
      const strings = getStrings(locale);
      for (const kind of NUMBER_SETS_PROBLEM_KINDS) {
        const sentence = renderNumbersProblem(problem(kind, '7'), 25, strings);
        expect(sentence.trim()).not.toBe('');
        expect(sentence).not.toContain(kind);
      }
    });
  }
});

describe('site-wide copy is fully translated', () => {
  it('every English site key exists in Indonesian', () => {
    const keys = (table: unknown): string[] =>
      stringLeaves(table)
        .map(([key]) => key)
        .sort();
    expect(keys(siteId)).toEqual(nonEmpty(keys(siteEn), 'English site keys'));
  });

  it('no site string is blank in either language', () => {
    const strings = [...deepStrings(siteEn), ...deepStrings(siteId)];
    const blank = strings
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);
    expect(searched(blank, { of: strings, what: 'site strings' })).toEqual([]);
  });

  it('the visible prose is genuinely translated, not copied English', () => {
    // Walks EVERY string rather than a hand-picked sample, so a section that
    // was forgotten during translation cannot hide behind the ones that were
    // done. Proper nouns and the language switcher label are legitimately
    // identical across locales, so they are excluded by name.
    const allowedIdentical = new Set([
      'language.label',
      // "Glory points" is YeeTalk's in-app currency — a product name, not
      // English prose, so it is correctly identical in both locales. Listed
      // explicitly rather than loosening the check: the guard's value is that
      // every exception is a decision someone made on purpose.
      'glory.inputLabel',
      // "ShyTalk" is the product's name. A nav item that translated it would
      // be naming a different product. Identical in all five by design.
      'nav.shytalk',
      // "Yawelo Idle" likewise, the game's name, never translated (#403).
      'nav.yaweloIdle',
    ]);
    const enMap = new Map(stringLeaves(siteEn));
    const idLeaves = stringLeaves(siteId);
    const identical = idLeaves
      .filter(([k, v]) => enMap.get(k) === v)
      .map(([k]) => k)
      .filter((k) => !allowedIdentical.has(k));
    expect(
      searched(identical, { of: idLeaves, what: 'Indonesian site strings' }),
    ).toEqual([]);
  });
});

describe('locale lookup', () => {
  // #21 Stage 4. This used to be `expect(LOCALES).toEqual(['en', 'id'])` — a
  // tripwire wearing an assertion's clothes. It stated the CONFIGURATION, so
  // adding a locale failed it, and the only way past was to edit the literal
  // — which is not review, it is bookkeeping. What actually has to hold is
  // below, and it keeps holding at five locales without an edit.
  it('lists the default locale first, once each', () => {
    expect(LOCALES[0]).toBe(DEFAULT_LOCALE);
    expect(new Set(LOCALES).size, 'a locale is listed twice').toBe(
      LOCALES.length,
    );
  });

  it('gives every locale a strings table and its own metadata', () => {
    // The half that a list of names cannot state: a locale in LOCALES with no
    // catalogue behind it routes to a page rendered in English, and one with
    // no metadata gets `og:locale` and its number formatting from whatever
    // the lookup falls back to.
    for (const locale of LOCALES) {
      expect(getStrings(locale), `${locale} has no strings table`).toBeTruthy();
      expect(
        LOCALE_METADATA[locale]?.nativeName,
        `${locale} has no native name — the switcher would label it blank`,
      ).toBeTruthy();
    }
  });

  it.each(catalogues)(
    'getStrings("%s") returns that locale',
    (name, catalogue) => {
      // A page's table is compiled from its catalogue: plain copy carried over
      // as written, and only the messages turned into functions (#136). A
      // lookup that went to the wrong locale would carry the wrong copy.
      const plain = deepStrings(catalogue).filter(
        ([, text]) => !isMessageTemplate(text),
      );
      expect(Object.fromEntries(deepStrings(getStrings(name)))).toEqual(
        Object.fromEntries(plain),
      );
    },
  );

  it('falls back to English for anything unrecognised', () => {
    expect(getStrings('fr')).toBe(en);
    expect(getStrings(undefined)).toBe(en);
  });

  it('renders anonymous students using the locale word for "Student"', () => {
    expect(en.studentNumber({ n: 7 })).toContain('7');
    expect(id.studentNumber({ n: 7 })).toContain('7');
    expect(en.studentNumber({ n: 7 })).not.toBe(id.studentNumber({ n: 7 }));
  });
});

describe('the locale-aware paths', () => {
  // localisePath's own doc comment names "the classic i18n bug" — a switcher
  // that dumps the visitor on the homepage. Every function in this block had
  // zero references anywhere in tests/ before this.

  it.each([
    ['/', 'en', '/'],
    ['/', 'id', '/id/'],
    ['/id/', 'en', '/'],
    ['/id/', 'id', '/id/'],
    // A prefix with no slash after it is that language's homepage too.
    ['/id', 'en', '/'],
    ['/id', 'id', '/id/'],
    ['/zh', 'vi', '/vi/'],
    ['/classroom-groups', 'id', '/id/classroom-groups'],
    ['/classroom-groups/', 'id', '/id/classroom-groups/'],
    ['/id/classroom-groups', 'en', '/classroom-groups'],
    ['/id/classroom-groups/', 'en', '/classroom-groups/'],
    ['/glory-points', 'en', '/glory-points'],
    // The anchoring that matters: /identity is not the Indonesian homepage.
    ['/identity', 'id', '/id/identity'],
    ['/identity', 'en', '/identity'],
    ['/ideas', 'en', '/ideas'],
    ['/id-card', 'en', '/id-card'],
  ] as const)('localisePath(%s, %s) -> %s', (path, target, expected) => {
    expect(localisePath(path, target)).toBe(expected);
  });

  it.each([
    ['/', 'en'],
    ['/glory-points', 'en'],
    ['/identity', 'en'], // must NOT be read as the /id prefix
    ['/ideas', 'en'],
    ['/id', 'id'],
    ['/id/', 'id'],
    ['/id/glory-points', 'id'],
  ] as const)('localeFromPath(%s) -> %s', (path, locale) => {
    expect(localeFromPath(path)).toBe(locale);
  });

  it('a round trip through the other language returns to the same page', () => {
    for (const path of [
      '/',
      '/glory-points',
      '/classroom-groups',
      '/identity',
    ]) {
      const there = localisePath(path, 'id');
      expect(localisePath(there, 'en')).toBe(path);
    }
  });

  it.each([
    ['en', '/classroom-groups'],
    ['id', '/id/classroom-groups'],
  ] as const)('toolPath(%s)', (locale, expected) => {
    expect(toolPath(locale)).toBe(expected);
  });

  it('otherLocales lists every locale except the one given', () => {
    expect(otherLocales('en')).toEqual(['id', 'zh', 'vi', 'th']);
    expect(otherLocales('id')).toEqual(['en', 'zh', 'vi', 'th']);
    expect(otherLocales('th')).toEqual(['en', 'id', 'zh', 'vi']);
    // Derived as well as spelled out, so this keeps holding as LOCALES grows
    // rather than becoming another two-locale assumption to find later.
    for (const locale of LOCALES) {
      expect(otherLocales(locale)).not.toContain(locale);
      expect(otherLocales(locale)).toHaveLength(LOCALES.length - 1);
    }
  });

  it.each([
    ['en', true],
    ['id', true],
    ['fr', false],
    ['EN', false],
    ['', false],
  ] as const)('isLocale(%s) -> %s', (value, expected) => {
    expect(isLocale(value)).toBe(expected);
  });

  it.each([[undefined], [null], [7], [{}]])(
    'isLocale rejects the non-string %s',
    (value) => {
      expect(isLocale(value)).toBe(false);
    },
  );
});

// Stage 3, Task 8 (design spec section 5): the themed branch this function
// used to have -- Animals / Colours / Planets, chosen by a `naming`/`theme`
// pair of arguments -- is gone along with the theme `<select>` that fed it
// and the locale tables (`themeNames`, `themes`) it read from. Groups are
// always numbered; these three tests are what is left of a block that used
// to also cover "uses the theme in the page language" and two theme
// fallback cases, both retired in the same commit that removes the feature
// (design spec section 13's own "tests for a removed feature are deleted
// in the same stage that removes it").
describe('group names', () => {
  it('numbers groups from 1, not from 0', () => {
    expect(groupName(0, en)).toBe('Group 1');
    expect(groupName(0, id)).toBe('Kelompok 1');
  });

  it('keeps numbering past what any theme table used to hold', () => {
    // The old theme tables topped out at 8 names and fell back to
    // numbering past that point -- groupName has no such ceiling any more,
    // proven here at an index well past where the old fallback used to
    // kick in.
    expect(groupName(8, en)).toBe('Group 9');
    expect(groupName(8, id)).toBe('Kelompok 9');
  });

  it('matches groupLabel directly -- groupName is a thin, one-based wrapper around it', () => {
    for (const strings of [en, id]) {
      for (const index of [0, 1, 24]) {
        expect(groupName(index, strings)).toBe(
          strings.groupLabel({ n: index + 1 }),
        );
      }
    }
  });
});

// Stage 2, Task 5. Design spec section 8: "Class name is optional. Blank is
// fine and nothing is blocked... It heads the results: `7B — your groups`...
// It is not repeated on every group card." The "not repeated on cards" half
// is an e2e concern (classroom-groups.spec.ts); this is the pure half,
// composed in ONE function so the named and unnamed forms cannot drift
// apart -- the same reason groupName/renderError above live here rather
// than at their call site.
describe('the results heading names the class once, or leaves it out entirely', () => {
  it.each(locales)(
    'a blank class name gets the plain heading (%s)',
    (_name, strings) => {
      expect(resultsHeadingText('', strings)).toBe(strings.resultsHeading);
    },
  );

  // Design spec section 8 says a blank name "blocks nothing" -- a teacher
  // who fat-fingers the space bar has not typed a name any more than a
  // teacher who typed nothing at all. Distinct from the empty-string case
  // above: a `className === ''` check with no `.trim()` would treat this
  // input as non-blank and render " — your groups", a dash with nothing in
  // front of it.
  it.each(locales)(
    'a whitespace-only class name counts as blank too (%s)',
    (_name, strings) => {
      expect(resultsHeadingText('   ', strings)).toBe(strings.resultsHeading);
      expect(resultsHeadingText('\t\n ', strings)).toBe(strings.resultsHeading);
    },
  );

  it('a named class heads the results, English', () => {
    expect(resultsHeadingText('7B', en)).toBe('7B — your groups');
  });

  it('a named class heads the results, Indonesian', () => {
    expect(resultsHeadingText('7B', id)).toBe('7B — kelompok Anda');
  });

  // Design spec section 9: "The class name is made safe for a filename, and
  // only there... The class name itself is never altered -- not on the
  // page, not in the `# Class:` line, not in the results heading." That
  // line is written for stage 4's filename work, but its own words reach
  // this heading too, so a NON-blank name keeps its own incidental
  // leading/trailing whitespace -- `.trim()` only decides blankness above,
  // it never edits what is actually shown. Deliberately corrects
  // the uncommitted #9 task brief's own snippet, which threaded `className.trim()`
  // through to the named branch as well.
  it.each(locales)(
    'a non-blank name keeps its own whitespace, untrimmed (%s)',
    (_name, strings) => {
      const msg = resultsHeadingText(' 7B ', strings);
      expect(msg).toBe(strings.resultsHeadingNamed({ className: ' 7B ' }));
      expect(msg.startsWith(' 7B ')).toBe(true);
    },
  );

  // "A teacher's typed text is theirs" -- resultsHeadingText itself does no
  // escaping or sanitising of any kind; the DOM-level safety
  // (classroom-groups.ts writing this through `.textContent`, never
  // `.innerHTML`) is proven separately, in the e2e suite, where there is an
  // actual DOM to prove it against. This pins the half that belongs here:
  // the STRING is threaded through byte-for-byte, so nothing upstream of
  // the DOM write has already stripped or escaped anything.
  it.each(locales)(
    'passes special characters through untouched (%s)',
    (_name, strings) => {
      const weird = '<b>7"B</b> & Co / Ltd';
      expect(resultsHeadingText(weird, strings)).toBe(
        strings.resultsHeadingNamed({ className: weird }),
      );
      expect(resultsHeadingText(weird, strings)).toContain(weird);
    },
  );
});

describe('the sentences a teacher reads at the end', () => {
  // These are asserted as WHOLE SENTENCES. The e2e suite checked
  // `toContainText('22')` — a bare number, which would pass just as happily
  // if the two arguments were swapped, and did pass while the page said
  // "1 groups from 7 students."
  it.each([
    [5, 22, '5 groups from 22 students.'],
    // The tool's own documented headline case: 7 students in groups of 4 is
    // ONE group of 7. The page has printed "1 groups" since it shipped.
    [1, 7, '1 group from 7 students.'],
    [1, 1, '1 group from 1 student.'],
    [2, 2, '2 groups from 2 students.'],
  ])('English %i/%i', (groups, students, sentence) => {
    expect(en.resultsSummary({ groups, students })).toBe(sentence);
  });

  it.each([
    [5, 22, '5 kelompok dari 22 siswa.'],
    [1, 7, '1 kelompok dari 7 siswa.'],
  ])('Indonesian %i/%i — no inflection, correct as written', (g, s, out) => {
    expect(id.resultsSummary({ groups: g, students: s })).toBe(out);
  });

  it('cannot pass with its arguments swapped', () => {
    // The property the old assertion lacked.
    expect(en.resultsSummary({ groups: 5, students: 22 })).not.toBe(
      en.resultsSummary({ groups: 22, students: 5 }),
    );
  });
});
