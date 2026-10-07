import { describe, it, expect } from 'vitest';
import { CSV_LOCALES, type CsvColumn } from '../../src/lib/csv-locale';
import { floorBreach } from '../floors';
import { nonEmpty, searched } from '../source-files';
import { LOCALES, getStrings, type Locale } from '../../src/lib/i18n';
import {
  serialiseRoster,
  serialiseGroups,
  todayISO,
  safeFilePart,
  fileName,
  parseRoster,
  emptyTemplate,
  detectLocale,
  importFile,
} from '../../src/lib/csv';
import { student } from './factories';

// The catalogues as a page receives them: every message compiled into a
// function of its named slots (#136). A raw catalogue holds templates.
const en = getStrings('en');
const id = getStrings('id');

/**
 * Stage 4, Task 1. The two column tables, and the invariants that make
 * every later task in this stage possible.
 *
 * Every literal here is checked against design spec section 9's own table
 * ("Language"), not against the plan's snippet -- stage 3's ledger records
 * eleven separate occasions where a plan snippet gave a label, selector or
 * whole sentence that did not exist in the product.
 */

/** Every unordered pair of locales, derived -- `en/id`, `en/zh`, ... */
const localePairs = (): [Locale, Locale][] =>
  LOCALES.flatMap((a, i) =>
    LOCALES.slice(i + 1).map((b): [Locale, Locale] => [a, b]),
  );

/** A table's header words as `detectLocale` compares them: trimmed, lowered. */
const headerWords = (locale: Locale): string[] =>
  Object.values(CSV_LOCALES[locale].columns).map((w) => w.trim().toLowerCase());

/** Words a locale USED to write, still accepted on import (#252). */
const supersededWords = (locale: Locale): string[] =>
  Object.values(CSV_LOCALES[locale].supersededColumns ?? {})
    .flat()
    .map((w) => w.trim().toLowerCase());

/**
 * Every word the PARSER will match for a locale. The no-shared-word rule has
 * to hold over THIS set, not over the current headers alone: a superseded
 * word is matched exactly like a current one, so one that collided with
 * another language's header would make that language's files unreadable --
 * and it would be invisible to a check that only looked at what is written
 * today.
 */
const parsableWords = (locale: Locale): string[] => [
  ...headerWords(locale),
  ...supersededWords(locale),
];

/** The four tokens the PARSER reads, named by what each one MEANS. */
const VALUE_MEANINGS = ['sex.M', 'sex.F', 'absentYes', 'absentNo'] as const;
type ValueMeaning = (typeof VALUE_MEANINGS)[number];

/** One locale's parser tokens, keyed by meaning and normalised as the parser reads them. */
const valueTokens = (locale: Locale): Record<ValueMeaning, string> => {
  const t = CSV_LOCALES[locale];
  const lower = (s: string) => s.trim().toLowerCase();
  return {
    'sex.M': lower(t.sex.M),
    'sex.F': lower(t.sex.F),
    absentYes: lower(t.absentYes),
    absentNo: lower(t.absentNo),
  };
};

describe('CSV_LOCALES', () => {
  it('has English headers', () => {
    expect(Object.values(CSV_LOCALES.en.columns)).toEqual([
      'number',
      'name',
      'sex',
      'absent',
      'together',
      'apart',
    ]);
  });

  it('has Indonesian headers', () => {
    expect(Object.values(CSV_LOCALES.id.columns)).toEqual([
      'nomor',
      'nama',
      'jenis kelamin',
      'tidak hadir',
      'bersama',
      'terpisah',
    ]);
  });

  // ORDER, not just membership. `Object.values` above already depends on
  // insertion order, but that is incidental; the serialiser writes columns
  // in this order and the parser reads headers positionally-by-name, so two
  // tables that agreed on the SET and disagreed on the ORDER would produce
  // a file one page writes and the other reads with the columns swapped.
  //
  // Derived from LOCALES rather than written out: the two-locale version
  // compared `id` against `en` by name and said nothing about the other
  // three once #22 shipped five. Exact-order equality subsumes the separate
  // sorted-set comparison that version carried alongside it -- same array,
  // same order, therefore same keys -- so this is the whole contract rather
  // than half of it. A missing column in one language is a file the other
  // pages cannot read. `astro check` catches a missing key, since `columns`
  // is a `Record<CsvColumn, string>`, but no type can see their order.
  it('lists the same column keys, in the same order, in every locale', () => {
    const expected = Object.keys(CSV_LOCALES.en.columns);
    expect(expected).toHaveLength(6);
    for (const locale of LOCALES)
      expect(Object.keys(CSV_LOCALES[locale].columns), locale).toEqual(
        expected,
      );
  });

  it('translates the values, not only the headers', () => {
    expect(CSV_LOCALES.en.sex).toEqual({ M: 'M', F: 'F' });
    expect(CSV_LOCALES.id.sex).toEqual({ M: 'L', F: 'P' });
    expect(CSV_LOCALES.en.absentYes).toBe('yes');
    expect(CSV_LOCALES.en.absentNo).toBe('no');
    expect(CSV_LOCALES.id.absentYes).toBe('ya');
    expect(CSV_LOCALES.id.absentNo).toBe('tidak');
  });

  it('translates the class comment and the group column', () => {
    expect(CSV_LOCALES.en.classComment).toBe('# Class:');
    expect(CSV_LOCALES.id.classComment).toBe('# Kelas:');
    expect(CSV_LOCALES.en.groupColumn).toBe('group');
    expect(CSV_LOCALES.id.groupColumn).toBe('kelompok');
  });

  it('shares no header word between any two locales', () => {
    // detectLocale distinguishes files by their headers, so a word appearing
    // in two tables would make a real file genuinely ambiguous. Over every
    // unordered PAIR: the two-locale version read `CSV_LOCALES.en` and
    // `.id` by name and left nine of the ten pairs unguarded.
    //
    // Compared the way detection compares -- trimmed and lower-cased.
    // The version this replaces compared raw strings, so two tables
    // differing only in case would have passed a guard protecting a
    // detector that cannot tell them apart.
    const collisions: string[] = [];
    let pairs = 0;
    const unordered = localePairs();
    for (const [a, b] of unordered) {
      pairs += 1;
      const first = new Set(parsableWords(a));
      for (const word of parsableWords(b))
        if (first.has(word)) collisions.push(`${a}/${b} both use "${word}"`);
    }
    expect(
      searched(collisions, { of: unordered, what: 'locale pairs' }),
    ).toEqual([]);
    expect(
      floorBreach('csv/header-word-pairs', unordered.length),
    ).toBeUndefined();
    // Anti-vacuity, the same reason the populated-tables test below exists:
    // an empty table makes every comparison above pass having compared
    // nothing. Count the pairs actually walked, and the words in each table.
    expect(pairs).toBe((LOCALES.length * (LOCALES.length - 1)) / 2);
    expect(pairs).toBeGreaterThan(0);
    for (const locale of LOCALES) {
      const words = headerWords(locale);
      expect(words, locale).toHaveLength(6);
      // CONTENT, not entry count. Six empty strings are still six entries,
      // and an emptied table collides with nothing -- so the first form of
      // this control passed a mutation that blanked every Thai header.
      expect(
        words.filter((w) => w !== ''),
        locale,
      ).toHaveLength(6);
      // Superseded words are compared too, so they need the same content
      // control: a list of empty strings collides with nothing either.
      expect(
        supersededWords(locale).filter((w) => w !== ''),
        `${locale} superseded`,
      ).toHaveLength(supersededWords(locale).length);
    }
  });

  // The same ambiguity, one level down and NOT covered by the header test
  // above: `detectLocale` reads headers, but the PARSER reads values, and a
  // token meaning two different things in two languages would silently
  // mis-import a file that passed detection.
  //
  // Stated as MEANING, not as sharing. The two-locale version forbade any
  // shared token at all -- true of en/id by accident of translation, and
  // false the moment #22 shipped five: `M`/`F` is the correct sex token in
  // English, Chinese, Vietnamese and Thai, and only Indonesian differs
  // (`L`/`P`). Widening that version to every pair would redden CI on
  // correct data. What actually mis-imports a file is a token that means
  // one thing in one table and another thing in another -- a `P` reading
  // as female here and as male there. Case-insensitive, because the parser
  // accepts either case.
  it('gives no token two different meanings across locales', () => {
    const meanings = new Map<string, Set<ValueMeaning>>();
    for (const locale of LOCALES)
      for (const meaning of VALUE_MEANINGS) {
        const token = valueTokens(locale)[meaning];
        const seen = meanings.get(token) ?? new Set<ValueMeaning>();
        seen.add(meaning);
        meanings.set(token, seen);
      }
    const tokens = [...meanings];
    const conflicts = tokens
      .filter(([, seen]) => seen.size > 1)
      .map(
        ([token, seen]) => `"${token}" means ${[...seen].sort().join(' and ')}`,
      );
    expect(
      searched(conflicts, { of: tokens, what: 'distinct CSV tokens' }),
    ).toEqual([]);
    expect(floorBreach('csv/distinct-tokens', tokens.length)).toBeUndefined();
    // Anti-vacuity: a table of empty strings collides with nothing, so
    // assert every locale actually contributed a token for every meaning.
    for (const locale of LOCALES) {
      const tokens = Object.values(valueTokens(locale));
      expect(
        tokens.filter((t) => t !== ''),
        locale,
      ).toHaveLength(VALUE_MEANINGS.length);
    }
  });

  it('allows two locales to share a token that means the same thing', () => {
    // The liveness control for the guard above, and the record of a
    // deliberate allowance. The tables really do overlap, so that guard is
    // exercised against real sharing rather than passing over disjoint
    // sets -- which is what a "shares nothing" guard would have demanded,
    // and would have been wrong to.
    const sharing = localePairs().filter(([a, b]) => {
      const first = new Set(Object.values(valueTokens(a)));
      return Object.values(valueTokens(b)).some((t) => first.has(t));
    });
    expect(sharing.length).toBeGreaterThan(0);
  });

  // Guards the two invariants above against a mutant that empties a table:
  // `[].filter(...)` is `[]`, so "shares nothing" passes vacuously against
  // a locale with no columns at all.
  it('every table is actually populated', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(CSV_LOCALES[locale].columns), locale).toHaveLength(6);
      for (const header of Object.values(CSV_LOCALES[locale].columns))
        expect(header, locale).not.toBe('');
    }
  });

  // Compared against the SITE's own locale list, not a hand-written pair:
  // a third locale added to `LOCALES` must redden here, rather than
  // shipping a page whose export button has no column table to read.
  it('carries a table for every locale this site ships', () => {
    expect(Object.keys(CSV_LOCALES).sort()).toEqual([...LOCALES].sort());
  });
});

/**
 * Stage 4, Task 2. Serialising -- a roster, a set of groups, and the
 * filenames both arrive under. C-03…C-07, C-25, C-27.
 *
 * Every shape is asserted in BOTH locales, not only English. The plan's own
 * snippet gave `serialiseGroups` an English test only, which would have let
 * an untranslated `# Groups made` comment ship on the Indonesian export --
 * in direct breach of this stage's own governing constraint ("the file must
 * match the language of the page -- headers AND values").
 */
const sample = [
  student({ number: 1, name: 'Ana', sex: 'F', together: 'A' }),
  student({ number: 4, name: 'Dewi', sex: 'F', absent: true }),
  student({ number: 6 }),
];

describe('serialiseRoster', () => {
  it('writes the English shape', () => {
    expect(serialiseRoster(sample, '7B', 'en')).toBe(
      '# Class: 7B\n' +
        'number,name,sex,absent,together,apart\n' +
        '1,Ana,F,,A,\n' +
        '4,Dewi,F,yes,,\n' +
        '6,,,,,\n',
    );
  });

  it('writes the Indonesian shape', () => {
    expect(serialiseRoster(sample, '7B', 'id')).toBe(
      '# Kelas: 7B\n' +
        'nomor,nama,jenis kelamin,tidak hadir,bersama,terpisah\n' +
        '1,Ana,P,,A,\n' +
        '4,Dewi,P,ya,,\n' +
        '6,,,,,\n',
    );
  });

  // The absent column stays QUIET until somebody is out -- `absentNo` is a
  // token the PARSER accepts, never one the serialiser writes. A row of
  // "no,no,no" down a column is noise in a spreadsheet.
  it('leaves the absent column blank for everyone who is in', () => {
    const lines = serialiseRoster([student({ number: 1 })], '', 'en').split(
      '\n',
    );
    expect(lines[0]).toBe('number,name,sex,absent,together,apart');
    expect(lines[1]).toBe('1,,,,,');
    // Asserted on the CELL, by position, not as `not.toContain('no')` over
    // the whole file -- a substring check is not an existence check, and
    // that one would have been satisfied or broken by unrelated words.
    expect(lines[1].split(',')[3]).toBe('');
  });

  it('omits the class comment when there is no class name', () => {
    expect(
      serialiseRoster([student({ number: 1 })], '', 'en').startsWith('#'),
    ).toBe(false);
  });

  // A class name of only spaces is not a class name. Without this it would
  // produce a bare "# Class:   " line that round-trips into a whitespace
  // class name on import.
  it('omits the class comment for a name of only whitespace', () => {
    expect(
      serialiseRoster([student({ number: 1 })], '   ', 'en').startsWith('#'),
    ).toBe(false);
  });

  it('quotes a name containing a comma', () => {
    expect(
      serialiseRoster([student({ number: 1, name: 'Wong, Mei' })], '', 'en'),
    ).toContain('1,"Wong, Mei",,,,');
  });

  it('quotes a name containing a quote, doubling it', () => {
    expect(
      serialiseRoster(
        [student({ number: 1, name: 'Jo "Jojo" Tan' })],
        '',
        'en',
      ),
    ).toContain('1,"Jo ""Jojo"" Tan",,,,');
  });

  // The third RFC-4180 trigger, which the plan's snippet does not cover: a
  // newline inside a cell. A teacher pasting from a spreadsheet can carry
  // one in, and unquoted it would split one student into two rows.
  it('quotes a name containing a newline', () => {
    expect(
      serialiseRoster([student({ number: 1, name: 'Ana\nMaria' })], '', 'en'),
    ).toContain('1,"Ana\nMaria",,,,');
  });

  // The class name is a teacher's typed text on the same line as metadata,
  // so it needs the same treatment -- the plan's snippet only ever quotes
  // NAMES.
  it('quotes a class name containing a comma', () => {
    expect(
      serialiseRoster([student({ number: 1 })], 'Year 7, Set B', 'en'),
    ).toContain('# Class: "Year 7, Set B"');
  });

  it('writes the together and apart letters', () => {
    expect(
      serialiseRoster(
        [student({ number: 2, together: 'B', apart: 'C' })],
        '',
        'en',
      ),
    ).toContain('2,,,,B,C');
  });

  it('writes an empty roster as its header alone', () => {
    expect(serialiseRoster([], '', 'en')).toBe(
      'number,name,sex,absent,together,apart\n',
    );
  });
});

describe('todayISO and the filename helpers', () => {
  // This test PINNED THE BUG. It read
  // `todayISO(new Date('2026-08-06T23:30:00Z'))` and expected `2026-08-06`
  // -- the UTC answer. That instant is 06:30 on the 7th at UTC+7, which is
  // this site's own audience at exactly the hour they print a register, so
  // the assertion was stating the defect as the contract. Restated with a
  // LOCAL date, which is what the function now returns and what a person at
  // the machine actually sees; the timezone-boundary cases are covered in
  // their own block below.
  it('formats a date as YYYY-MM-DD', () => {
    expect(todayISO(new Date(2026, 7, 6, 23, 30))).toBe('2026-08-06');
  });

  it('builds the four filenames', () => {
    expect(fileName('class-list', '7B', '2026-08-06', 'en')).toBe(
      '7B-class-list-2026-08-06.csv',
    );
    expect(fileName('class-list', '7B', '2026-08-06', 'id')).toBe(
      '7B-daftar-kelas-2026-08-06.csv',
    );
    expect(fileName('groups', '7B', '2026-08-06', 'en')).toBe(
      '7B-groups-2026-08-06.csv',
    );
    expect(fileName('groups', '7B', '2026-08-06', 'id')).toBe(
      '7B-kelompok-2026-08-06.csv',
    );
  });

  it('drops the class part when there is no class name', () => {
    expect(fileName('class-list', '', '2026-08-06', 'en')).toBe(
      'class-list-2026-08-06.csv',
    );
  });

  it('makes a class name safe for a filename', () => {
    expect(safeFilePart('Year 7 / Set B')).toBe('Year-7-Set-B');
    expect(safeFilePart('7B: top set')).toBe('7B-top-set');
    expect(safeFilePart('  7B  ')).toBe('7B');
  });

  it('never returns a leading or trailing dash, or a run of them', () => {
    expect(safeFilePart('///7B///')).toBe('7B');
    expect(safeFilePart('a // b')).toBe('a-b');
  });

  it('returns an empty string for a name made entirely of unusable characters', () => {
    // …so fileName falls back to the unnamed form rather than producing "-.csv".
    expect(safeFilePart('///')).toBe('');
    expect(fileName('class-list', '///', '2026-08-06', 'en')).toBe(
      'class-list-2026-08-06.csv',
    );
  });

  // Design spec section 9: "the class name itself is never altered" -- the
  // sanitising is for the FILENAME only. Pinned directly, because
  // `safeFilePart` returning a new string is not by itself proof that
  // nothing mutated the source.
  it('does not alter the class name it was given', () => {
    const className = 'Year 7 / Set B';
    safeFilePart(className);
    expect(className).toBe('Year 7 / Set B');
    expect(
      serialiseRoster([student({ number: 1 })], className, 'en'),
    ).toContain('# Class: Year 7 / Set B');
  });

  // A path separator or traversal sequence in a class name must not survive
  // into a filename. `/` is already covered above; this is the rest of the
  // set a browser download would act on.
  it('strips characters a filesystem would act on', () => {
    expect(safeFilePart('../../etc/passwd')).toBe('etc-passwd');
    expect(safeFilePart('a\\b')).toBe('a-b');
    expect(safeFilePart('7B*?"<>|')).toBe('7B');
    // C-29 names a colon and a CONTROL CHARACTER specifically. A colon is
    // a drive separator on Windows and a path separator on classic Mac; a
    // newline or a NUL in a filename is refused outright by some
    // filesystems and silently truncates on others.
    expect(safeFilePart('7B: top set')).toBe('7B-top-set');
    expect(safeFilePart('7B\u0000\u0007x')).toBe('7B-x');
    expect(safeFilePart('7B\nSet\tB')).toBe('7B-Set-B');
  });

  // C-30, the half a filename test cannot reach: the name a teacher typed
  // survives into the FILE unaltered, slash and all, even though the
  // filename beside it was sanitised from the same value.
  it('writes the unsanitised class name into the file it names', () => {
    const text = serialiseRoster(
      [student({ number: 1 })],
      'Year 7 / Set B',
      'en',
    );
    expect(text).toContain('# Class: Year 7 / Set B');
    expect(text).not.toContain('Year-7-Set-B');
    expect(fileName('class-list', 'Year 7 / Set B', '2026-08-06', 'en')).toBe(
      'Year-7-Set-B-class-list-2026-08-06.csv',
    );
  });
});

describe('serialiseGroups', () => {
  it('writes one row per student with a group column', () => {
    expect(
      serialiseGroups([[sample[0]], [sample[2]]], '7B', '2026-08-06', 'en'),
    ).toBe(
      '# Class: 7B\n' +
        '# Groups made 2026-08-06\n' +
        'group,number,name\n' +
        '1,1,Ana\n' +
        '2,6,\n',
    );
  });

  // The half the plan's snippet omits. Without this an English "# Groups
  // made" line ships on the Indonesian export.
  it('writes the Indonesian shape, comment line included', () => {
    expect(
      serialiseGroups([[sample[0]], [sample[2]]], '7B', '2026-08-06', 'id'),
    ).toBe(
      '# Kelas: 7B\n' +
        '# Kelompok dibuat 2026-08-06\n' +
        'kelompok,nomor,nama\n' +
        '1,1,Ana\n' +
        '2,6,\n',
    );
  });

  it('numbers the groups from 1, in the order given', () => {
    const out = serialiseGroups(
      [[student({ number: 9 })], [student({ number: 8 })]],
      '',
      '2026-08-06',
      'en',
    );
    expect(out.split('\n').filter((l) => l && !l.startsWith('#'))).toEqual([
      'group,number,name',
      '1,9,',
      '2,8,',
    ]);
  });

  it('quotes a name in a groups file too', () => {
    expect(
      serialiseGroups(
        [[student({ number: 1, name: 'Wong, Mei' })]],
        '',
        '2026-08-06',
        'en',
      ),
    ).toContain('1,1,"Wong, Mei"');
  });

  it('still writes the date comment when there is no class name', () => {
    expect(
      serialiseGroups([[student({ number: 1 })]], '', '2026-08-06', 'en'),
    ).toBe('# Groups made 2026-08-06\ngroup,number,name\n1,1,\n');
  });
});

/**
 * Stage 4, Task 3. Parsing -- the largest task in this stage and the one a
 * teacher will feel. C-01, C-02, C-08…C-10, C-14…C-16, C-21…C-24, X-07.
 *
 * The governing rule (design spec section 9): a bad file is rejected WHOLE
 * and reports EVERY problem, never just the first, because a teacher who
 * has to make three round trips to a spreadsheet stops using the tool.
 */
describe('parseRoster', () => {
  it('accepts a file with nothing but a number column', () => {
    const out = parseRoster('number\n1\n2\n3\n', 'en', en);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.roster.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(
      out.roster.every((s) => s.name === null && s.sex === null && !s.absent),
    ).toBe(true);
  });

  it('accepts partial rows', () => {
    const out = parseRoster('number,name,sex\n1,Ana,\n2,,M\n', 'en', en);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.roster[0]).toMatchObject({ number: 1, name: 'Ana', sex: null });
    expect(out.roster[1]).toMatchObject({ number: 2, name: null, sex: 'M' });
  });

  it('round-trips the class name', () => {
    const out = parseRoster('# Class: 7B\nnumber\n1\n', 'en', en);
    expect(out.ok && out.className).toBe('7B');
  });

  it('round-trips a quoted class name containing a comma', () => {
    const out = parseRoster('# Class: "Year 7, Set B"\nnumber\n1\n', 'en', en);
    expect(out.ok && out.className).toBe('Year 7, Set B');
  });

  it('reads the Indonesian class comment on the Indonesian page', () => {
    const out = parseRoster('# Kelas: 7B\nnomor\n1\n', 'id', id);
    expect(out.ok && out.className).toBe('7B');
  });

  it('accepts blank, no and NO as present', () => {
    for (const v of ['', 'no', 'NO', 'No']) {
      const out = parseRoster(`number,absent\n1,${v}\n`, 'en', en);
      expect(out.ok && out.roster[0].absent, v).toBe(false);
    }
  });

  it('accepts yes in any case as absent', () => {
    for (const v of ['yes', 'YES', 'Yes']) {
      const out = parseRoster(`number,absent\n1,${v}\n`, 'en', en);
      expect(out.ok && out.roster[0].absent, v).toBe(true);
    }
  });

  it('accepts tidak as present on the Indonesian page', () => {
    const out = parseRoster('nomor,tidak hadir\n1,tidak\n', 'id', id);
    expect(out.ok && out.roster[0].absent).toBe(false);
  });

  it('accepts ya as absent on the Indonesian page', () => {
    const out = parseRoster('nomor,tidak hadir\n1,ya\n', 'id', id);
    expect(out.ok && out.roster[0].absent).toBe(true);
  });

  it('reads L and P as the sexes on the Indonesian page', () => {
    const out = parseRoster('nomor,jenis kelamin\n1,L\n2,P\n', 'id', id);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.roster.map((s) => s.sex)).toEqual(['M', 'F']);
  });

  it('refuses anything else in the absent column, by name', () => {
    const out = parseRoster('number,absent\n1,maybe\n', 'en', en);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems[0].message).toBe(
      "Row 1 — absent 'maybe' not understood. Use yes, no, or leave blank.",
    );
  });

  it('refuses an unrecognised sex, by name', () => {
    const out = parseRoster('number,sex\n1,Male\n', 'en', en);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems[0].message).toBe(
      "Row 1 — sex 'Male' not understood. Use M, F, or leave blank.",
    );
  });

  // The refusal is written in the language of the PAGE, and names the
  // tokens THAT page accepts -- an Indonesian teacher told to "use M, F"
  // has been given advice that would fail again.
  it('refuses in Indonesian, naming the Indonesian tokens', () => {
    const out = parseRoster('nomor,jenis kelamin\n1,Male\n', 'id', id);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems[0].message).toContain('L');
    expect(out.problems[0].message).not.toContain('Use M, F');
    expect(out.problems[0].message).not.toBe(
      "Row 1 — sex 'Male' not understood. Use M, F, or leave blank.",
    );
  });

  it('lists EVERY problem, not just the first', () => {
    const out = parseRoster(
      'number,name,sex\n' +
        '1,Ana,F\n' +
        '2,Budi,Male\n' + // row 2 — bad sex
        '1,Citra,F\n' + // row 3 — duplicate number
        ',Dewi,F\n', // row 4 — no number
      'en',
      en,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems).toHaveLength(3);
    expect(out.problems.map((p) => p.row)).toEqual([2, 3, 4]);
    expect(out.problems[1].message).toBe(
      'Row 3 — number 1 is already used by row 1.',
    );
    expect(out.problems[2].message).toBe(
      'Row 4 — number is blank. Every student needs one.',
    );
  });

  it('refuses a number that is not a whole number, by name', () => {
    const out = parseRoster('number\n1\nabc\n', 'en', en);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems[0].message).toBe(
      "Row 2 — number 'abc' is not a whole number.",
    );
  });

  it('refuses a file with no number column at all', () => {
    const out = parseRoster('name,sex\nAna,F\n', 'en', en);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems[0].row).toBeNull();
    expect(out.problems[0].message).toBe(
      'This file has no number column. Every student needs one.',
    );
  });

  it('refuses an empty file', () => {
    const out = parseRoster('', 'en', en);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems[0].row).toBeNull();
    expect(out.problems[0].message).toBe('This file is empty.');
  });

  // A file whose headers are all present but which carries no data rows is
  // NOT an error -- it is an empty class list, and importing it empties the
  // roster, which is a thing a teacher may mean.
  it('accepts a header-only file as an empty roster', () => {
    const text = 'number,name\n';
    const lines = text.split('\n').filter((line) => line !== '');
    const out = parseRoster(text, 'en', en);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(
      searched(out.roster, {
        of: lines,
        what: 'lines of the header-only file',
      }),
    ).toEqual([]);
    expect(floorBreach('csv/header-only-lines', lines.length)).toBeUndefined();
  });

  it('ignores every # line except the class comment', () => {
    const out = parseRoster(
      '# Class: 7B\nnumber,name\n# 1,Ana\n# my notes\n2,Budi\n',
      'en',
      en,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.roster).toHaveLength(1);
    expect(out.roster[0].name).toBe('Budi');
  });

  // Row numbers count DATA rows, not file lines, so a comment sitting
  // between two students does not shift the number a teacher is told to
  // look at. Without this the message sends them to the wrong row.
  it('numbers rows by data row, so a # line does not shift them', () => {
    const out = parseRoster('number\n1\n# a note\n# another\n1\n', 'en', en);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems[0].message).toBe(
      'Row 2 — number 1 is already used by row 1.',
    );
  });

  it('imports nothing from an untouched template', () => {
    // `emptyTemplate` is the same exported function the download button calls,
    // so this proves the artefact a teacher actually receives -- not a copy of
    // it written in the test, which would pass while the real one drifted.
    const template = emptyTemplate('en');
    const lines = template.split('\n').filter((line) => line !== '');
    const out = parseRoster(template, 'en', en);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(
      searched(out.roster, {
        of: lines,
        what: 'lines of the English template',
      }),
    ).toEqual([]);
    expect(
      floorBreach('csv/english-template-lines', lines.length),
    ).toBeUndefined();
  });

  it('imports nothing from an untouched Indonesian template either', () => {
    const template = emptyTemplate('id');
    const lines = template.split('\n').filter((line) => line !== '');
    const out = parseRoster(template, 'id', id);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(
      searched(out.roster, {
        of: lines,
        what: 'lines of the Indonesian template',
      }),
    ).toEqual([]);
    expect(
      floorBreach('csv/indonesian-template-lines', lines.length),
    ).toBeUndefined();
  });

  it('does not import a real child called Example One', () => {
    // The reason examples are comment lines rather than recognised by content.
    const out = parseRoster('number,name\n1,Example One\n', 'en', en);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.roster[0].name).toBe('Example One');
  });

  it('rejects a file of more than MAX_ROSTER rows, naming both numbers', () => {
    const rows = Array.from({ length: 101 }, (_, i) => `${i + 1}`).join('\n');
    const out = parseRoster(`number\n${rows}\n`, 'en', en);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems[0].message).toBe(
      'This file has 101 students. Student details holds up to 100.',
    );
  });

  it('accepts a file of exactly MAX_ROSTER rows', () => {
    const rows = Array.from({ length: 100 }, (_, i) => `${i + 1}`).join('\n');
    const out = parseRoster(`number\n${rows}\n`, 'en', en);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.roster).toHaveLength(100);
  });

  it('handles CRLF line endings, which is what Excel writes', () => {
    const out = parseRoster('number,name\r\n1,Ana\r\n', 'en', en);
    expect(out.ok && out.roster[0].name).toBe('Ana');
  });

  it('handles a UTF-8 BOM, which is also what Excel writes', () => {
    const out = parseRoster('﻿number,name\n1,Ana\n', 'en', en);
    expect(out.ok).toBe(true);
  });

  it('reads quoted cells containing commas', () => {
    const out = parseRoster('number,name\n1,"Wong, Mei"\n', 'en', en);
    expect(out.ok && out.roster[0].name).toBe('Wong, Mei');
  });

  it('reads a doubled quote inside a quoted cell', () => {
    const out = parseRoster('number,name\n1,"Jo ""Jojo"" Tan"\n', 'en', en);
    expect(out.ok && out.roster[0].name).toBe('Jo "Jojo" Tan');
  });

  it('reads a newline inside a quoted cell without splitting the row', () => {
    const out = parseRoster('number,name\n1,"Ana\nMaria"\n2,Budi\n', 'en', en);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.roster).toHaveLength(2);
    expect(out.roster[0].name).toBe('Ana\nMaria');
  });

  it('tolerates headers in any order', () => {
    const out = parseRoster('name,number\nAna,1\n', 'en', en);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.roster[0]).toMatchObject({ number: 1, name: 'Ana' });
  });

  it('tolerates headers in a different case and with padding', () => {
    const out = parseRoster(' Number , Name \n1,Ana\n', 'en', en);
    expect(out.ok && out.roster[0].name).toBe('Ana');
  });

  it('reads the together and apart letters, upper-cased', () => {
    const out = parseRoster('number,together,apart\n1,a,b\n', 'en', en);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.roster[0]).toMatchObject({ together: 'A', apart: 'B' });
  });

  it('refuses a together value that is not a single letter', () => {
    const out = parseRoster('number,together\n1,AB\n', 'en', en);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems[0].message).toBe(
      "Row 1 — together 'AB' is not a single letter.",
    );
  });

  // A round trip is the claim the whole stage rests on. Asserted as an
  // object comparison over the WHOLE roster, in EVERY language, rather
  // than field by field -- a field the serialiser drops and the parser
  // defaults would survive any narrower check. Derived from LOCALES: the
  // hard-coded `['en', 'id']` this replaces stopped covering three of the
  // five the moment #22 shipped them, and every token in this file's
  // tables -- headers, sex, absent, class comment -- differs per locale.
  for (const locale of LOCALES) {
    it(`round-trips a full roster through serialise and parse (${locale})`, () => {
      const original = [
        student({ number: 1, name: 'Ana', sex: 'F', together: 'A' }),
        student({ number: 4, name: 'Wong, Mei', sex: 'F', absent: true }),
        student({ number: 6, sex: 'M', apart: 'B' }),
        student({ number: 9 }),
      ];
      const text = serialiseRoster(original, '7B', locale);
      const out = parseRoster(text, locale, getStrings(locale));
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.roster).toEqual(original);
      expect(out.className).toBe('7B');
    });
  }
});

/**
 * Stage 4, Task 4. C-11, C-12, C-13.
 *
 * Detection rests entirely on the invariant asserted at the top of this
 * file -- no two locales share a header word, over every pair. That is why
 * this can be decided from headers alone rather than by guessing from
 * content.
 */
describe('detectLocale', () => {
  it('recognises an English file', () =>
    expect(detectLocale('number,name,sex\n1,Ana,F\n')).toBe('en'));

  it('recognises an Indonesian file', () =>
    expect(detectLocale('nomor,nama,jenis kelamin\n1,Ana,P\n')).toBe('id'));

  it('recognises one by its class comment alone', () =>
    expect(detectLocale('# Kelas: 7B\nnomor\n1\n')).toBe('id'));

  it('returns null for something that is neither', () =>
    expect(detectLocale('foo,bar\n1,2\n')).toBe(null));

  // The header row is the FIRST non-comment record. A student called
  // "nomor" sits in a data row and must not vote.
  it('is not confused by a name that looks like a header', () =>
    expect(detectLocale('number,name\n1,nomor\n')).toBe('en'));

  it('recognises a file this codebase itself wrote, both ways', () => {
    // Not a hand-typed sample: the real serialiser's output, so detection
    // cannot pass here while drifting from what we actually emit.
    const roster = [student({ number: 1, name: 'Ana', sex: 'F' })];
    expect(detectLocale(serialiseRoster(roster, '7B', 'en'))).toBe('en');
    expect(detectLocale(serialiseRoster(roster, '7B', 'id'))).toBe('id');
    expect(detectLocale(emptyTemplate('en'))).toBe('en');
    expect(detectLocale(emptyTemplate('id'))).toBe('id');
  });

  // Every locale, derived: the two-locale detector scored `en` and `id` by
  // name, so a zh, vi or th file came back null and was parsed as the
  // page's language -- while the no-shared-word guard above had already
  // been widened to all ten pairs (#390, F9).
  it.each(LOCALES)('recognises a %s file this codebase wrote', (locale) => {
    const roster = [student({ number: 1, name: 'Ana', sex: 'F' })];
    expect(detectLocale(serialiseRoster(roster, '7B', locale))).toBe(locale);
    expect(detectLocale(emptyTemplate(locale))).toBe(locale);
  });

  it('recognises a file by a header its locale has since superseded', () => {
    // The superseded word alone, beside a word no table uses: a current
    // header in the same file would win the score on its own and hide
    // whether the superseded word counted.
    const [word] = CSV_LOCALES.vi.supersededColumns?.sex ?? [];
    expect(word).toBe('tình dục');
    expect(detectLocale(`${word},x\nF,1\n`)).toBe('vi');
  });

  it('returns null for an empty file rather than guessing', () =>
    expect(detectLocale('')).toBe(null));

  it('reads a BOM and CRLF file the same as a plain one', () =>
    expect(detectLocale('﻿nomor,nama\r\n1,Ana\r\n')).toBe('id'));

  // Case and padding, the same tolerance `parseRoster` gives headers.
  it('tolerates case and padding in the headers', () =>
    expect(detectLocale(' Nomor , Nama \n1,Ana\n')).toBe('id'));
});

describe('importFile — the wrong language, refused with a way forward', () => {
  it('is refused with a link, in the language of the PAGE', () => {
    const out = importFile('nomor,nama\n1,Ana\n', 'en', en);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems[0].message).toBe(
      'This looks like a Bahasa Indonesia class list. Open the Indonesian ' +
        'version of this page to import it.',
    );
  });

  it('is refused the other way round, in Indonesian', () => {
    const out = importFile('number,name\n1,Ana\n', 'id', id);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems[0].message).toContain('bahasa Inggris');
    expect(out.problems[0].message).not.toContain('Bahasa Indonesia class');
  });

  // The refusal REPLACES the parse, it does not accompany it. Parsing an
  // Indonesian file as English produces a pile of "not understood"
  // problems that are all noise once the real cause is known.
  it('reports the language and nothing else', () => {
    const out = importFile('nomor,nama,jenis kelamin\n1,Ana,P\n', 'en', en);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0].row).toBeNull();
  });

  it('refuses a Vietnamese file on the English page, naming Vietnamese', () => {
    const roster = [student({ number: 1, name: 'Ana', sex: 'F' })];
    const out = importFile(serialiseRoster(roster, '7B', 'vi'), 'en', en);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0].message).toContain(en.csvLanguageName.vi);
  });

  it('passes a right-language file straight through to parseRoster', () => {
    const text = 'number,name\n1,Ana\n';
    expect(importFile(text, 'en', en)).toEqual(parseRoster(text, 'en', en));
  });

  // An unrecognisable file is NOT a wrong-language file. It falls through
  // to the parser, whose own messages ("no number column") are the useful
  // ones -- claiming it is in another language would be a guess.
  it('falls through to the parser when the language cannot be told', () => {
    const out = importFile('foo,bar\n1,2\n', 'en', en);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems[0].message).toBe(
      'This file has no number column. Every student needs one.',
    );
  });
});

/**
 * Review findings, fixed. Each of these reddens against the code as it was
 * before the fix beside it — none is a restatement of something already
 * covered.
 */
describe('todayISO is the LOCAL date, not UTC', () => {
  // At UTC+7 a local time before 07:00 is the previous day in UTC. An
  // Indonesian school day starts at about 06:30, which is exactly when a
  // register is printed and a class list exported -- so `toISOString()`
  // dated both artefacts yesterday for this site's own audience.
  //
  // The dates are built from LOCAL parts so this test states what a person
  // at the machine would see, whatever zone the suite runs in.
  it('takes the date from the local calendar day', () => {
    const early = new Date(2026, 7, 13, 6, 30); // 13 Aug, 06:30 local
    expect(todayISO(early)).toBe('2026-08-13');
    const late = new Date(2026, 7, 13, 23, 30); // 13 Aug, 23:30 local
    expect(todayISO(late)).toBe('2026-08-13');
    // …and both ends of the day agree, which a UTC formatter cannot do:
    // one of them always falls into a neighbouring date.
    expect(todayISO(early)).toBe(todayISO(late));
  });

  it('pads the month and the day', () => {
    expect(todayISO(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });
});

describe('a class name survives the round trip whatever is in it', () => {
  // The class comment is decoded ONCE. It used to be decoded twice -- the
  // record parser removes the quoting, and the class-comment branch then
  // ran the result through the parser again -- so a quote was eaten. A
  // comma survived by luck, which is why only the comma was ever tested.
  for (const className of [
    '7B "Blue"',
    '"Blue" Group',
    '7B, "Blue"',
    'Year 7 / Set B',
    "Ana's class",
  ]) {
    it(`round-trips ${JSON.stringify(className)}`, () => {
      const text = serialiseRoster([student({ number: 1 })], className, 'en');
      const out = parseRoster(text, 'en', en);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.className).toBe(className);
    });
  }
});

/**
 * Header words corrected after files carrying the old word could exist, with
 * the word each one replaced.
 *
 * It is never only a copy change. `parseRoster`'s `indexOf` finds a column BY
 * ITS LOCALISED HEADER WORD, and `at()` returns '' for a column it cannot find
 * -- silently, with no problem reported. So correcting the export alone would
 * make every class list a teacher had already downloaded import with that
 * column blank and no error shown, which is the failure mode this repo treats
 * as worse than a loud one. The superseded word stays readable.
 *
 * #252 corrected the sex header: `vi` wrote `tình dục` (sexual intercourse)
 * and `zh` the bare `性`, after the roster catalogue had been corrected on
 * #53. #161's sheet (2026-09-23) corrected two more: zh `name` wrote `名称`
 * (the name of a thing) where the roster says `姓名`, and vi `apart` wrote
 * `riêng biệt` where the roster says `tách biệt`.
 */
const HEADER_CORRECTIONS: readonly {
  locale: Locale;
  column: CsvColumn;
  corrected: string;
  superseded: string;
}[] = [
  {
    locale: 'vi',
    column: 'sex',
    corrected: 'giới tính',
    superseded: 'tình dục',
  },
  { locale: 'zh', column: 'sex', corrected: '性别', superseded: '性' },
  { locale: 'zh', column: 'name', corrected: '姓名', superseded: '名称' },
  {
    locale: 'vi',
    column: 'apart',
    corrected: 'tách biệt',
    superseded: 'riêng biệt',
  },
  // #319: "number" as in a numeral, not a student's number.
  { locale: 'zh', column: 'number', corrected: '编号', superseded: '数字' },
  {
    locale: 'th',
    column: 'number',
    corrected: 'หมายเลข',
    superseded: 'ตัวเลข',
  },
];

describe('a corrected header word keeps old files readable', () => {
  for (const { locale, column, corrected, superseded } of HEADER_CORRECTIONS) {
    it(`${locale} exports the corrected ${column} word`, () => {
      expect(CSV_LOCALES[locale].columns[column]).toBe(corrected);
      const file = serialiseRoster(
        [student({ number: 1, name: 'Ana', sex: 'F' })],
        '6A',
        locale,
      );
      // The header CELLS, compared exactly -- never a substring test on the
      // whole file. `性` is a substring of `性别`, so `not.toContain` over the
      // text could never pass however correct the header was: the same shape
      // as #21's prod-smoke list, where `/glory-points` is a substring of
      // `/id/glory-points`.
      const headerCells = (file.split('\n')[1] ?? '').split(',');
      expect(headerCells).toContain(corrected);
      expect(headerCells).not.toContain(superseded);
    });

    it(`${locale} still reads its ${column} column under the old header word`, () => {
      const table = CSV_LOCALES[locale];
      // Without this the test is a tautology: while the superseded word IS
      // still the current one, the lookup below succeeds for the wrong
      // reason and proves nothing about reading an old file.
      expect(superseded).not.toBe(table.columns[column]);
      // Built from the SUPERSEDED word deliberately, the way a file already
      // on a teacher's laptop is -- not by re-exporting with mutated code,
      // which would only prove the serialiser agrees with itself. The header
      // and the row both follow the table's own write order.
      const columns = Object.keys(table.columns) as CsvColumn[];
      const cell: Record<CsvColumn, string> = {
        number: '1',
        name: 'Ana',
        sex: table.sex.F,
        absent: '',
        together: 'A',
        apart: 'B',
      };
      const legacy =
        `${table.classComment} 6A\n` +
        `${columns.map((c) => (c === column ? superseded : table.columns[c])).join(',')}\n` +
        `${columns.map((c) => cell[c]).join(',')}\n`;

      const result = parseRoster(legacy, locale, getStrings(locale));
      // `ok` first: a ParseResult carries `problems` only when it failed, so
      // asserting those first would throw on the success path and the
      // assertion below -- the one this test exists for -- would never run.
      expect(result.ok, result.ok ? '' : JSON.stringify(result.problems)).toBe(
        true,
      );
      if (!result.ok) return;
      expect(result.roster).toHaveLength(1);
      // The whole point: every column was FOUND, the corrected one included,
      // rather than read as silently blank.
      expect(result.roster[0]).toMatchObject({
        name: 'Ana',
        sex: 'F',
        together: 'A',
        apart: 'B',
      });
    });
  }

  it('every superseded word the parser accepts is tested above', () => {
    // Derived from the tables, so a word added to `supersededColumns` without
    // a round trip above goes red, and so does a row above whose word the
    // parser would not accept.
    const accepted = LOCALES.flatMap((locale) =>
      Object.entries(CSV_LOCALES[locale].supersededColumns ?? {}).flatMap(
        ([column, words]) =>
          (words ?? []).map((word) => `${locale} ${column} ${word}`),
      ),
    );
    const tested = HEADER_CORRECTIONS.map(
      ({ locale, column, superseded }) => `${locale} ${column} ${superseded}`,
    );
    expect(nonEmpty(accepted, 'superseded header words').sort()).toEqual(
      [...tested].sort(),
    );
  });
});

describe('the sex column header, corrected without breaking old files', () => {
  it('every locale survives an export/import round trip with sex intact', () => {
    const sample = [
      student({ number: 1, name: 'Ana', sex: 'F', together: 'A' }),
      student({ number: 2, name: 'Budi', sex: 'M', apart: 'B' }),
    ];
    const lost: string[] = [];
    const locales = [...LOCALES];
    for (const locale of locales) {
      const result = parseRoster(
        serialiseRoster(sample, '6A', locale),
        locale,
        getStrings(locale),
      );
      if (!result.ok) {
        lost.push(`${locale}: did not parse`);
        continue;
      }
      const sexes = result.roster.map((s) => s.sex);
      if (sexes.join(',') !== 'F,M')
        lost.push(`${locale}: sex ${sexes.join(',')}`);
    }
    expect(
      searched(lost, { of: locales, what: 'locales round-tripped' }),
    ).toEqual([]);
    expect(
      floorBreach('csv/round-tripped-locales', locales.length),
    ).toBeUndefined();
  });

  it('the sex header agrees with the roster column the teacher sees', () => {
    // The CSV header word and the roster catalogue label are two separate
    // tables seeded from the SAME DeepL cache entry, which is how one wrong
    // sense reached both: #53 corrected the catalogue, #252 the file. Fixing
    // one and not the other is invisible -- the page would read one word
    // while the file the teacher opens in Excel carried another, and until
    // now nothing compared them. `locale-fallbacks.test.ts` says in a COMMENT
    // that these must agree; a comment is not an implementation.
    //
    // Scoped to `sex` deliberately, and MEASURED before it was written: of
    // the thirty column/locale pairs, ten legitimately differ. `number` is
    // `#` in every catalogue -- a glyph that heads a column on screen but
    // cannot head a CSV column, which needs a word -- and five more are
    // genuine vocabulary choices. A blanket per-column guard would be red on
    // correct data, which is how #55 reddened CI on a correct config.
    const drift: string[] = [];
    const locales = [...LOCALES];
    for (const locale of locales) {
      const inFile = CSV_LOCALES[locale].columns.sex;
      const onPage = getStrings(locale).rosterColSex;
      // Compared the way a reader compares them: a CSV header is lower case
      // by format and a UI label is sentence case, so `sex`/`Sex` and
      // `giới tính`/`Giới tính` are the same word, not a drift.
      if (inFile.trim().toLowerCase() !== onPage.trim().toLowerCase())
        drift.push(`${locale}: file "${inFile}" vs page "${onPage}"`);
    }
    expect(searched(drift, { of: locales, what: 'locales compared' })).toEqual(
      [],
    );
    expect(
      floorBreach('csv/sex-header-locales', locales.length),
    ).toBeUndefined();
  });

  it('the sex tokens are the letters the roster offers the teacher', () => {
    // #390, F10. The test above holds the sex column's HEADER to the page.
    // The two tokens under it were held to nothing, although translate.ts
    // and csv-locale.ts both say they must agree with the roster's own
    // choices: a file of M/F rows beside a roster offering other letters is
    // a file the teacher cannot check against the table it came from. Until
    // this, changing one side reddened only literal pins, whose natural fix
    // leaves the other side behind.
    const drift: string[] = [];
    const locales = [...LOCALES];
    for (const locale of locales) {
      const { M, F } = CSV_LOCALES[locale].sex;
      const t = getStrings(locale);
      if (M !== t.rosterSexMale)
        drift.push(`${locale}: file M "${M}" vs page "${t.rosterSexMale}"`);
      if (F !== t.rosterSexFemale)
        drift.push(`${locale}: file F "${F}" vs page "${t.rosterSexFemale}"`);
    }
    expect(searched(drift, { of: locales, what: 'locales compared' })).toEqual(
      [],
    );
    expect(
      floorBreach('csv/sex-token-locales', locales.length),
    ).toBeUndefined();
  });

  it("the class comment names the class the way the page's own field does", () => {
    // #390, F12. zh wrote `# 类：` ("Category:") above a class list whose
    // page labels the very same value 班级, as zh does 21 times elsewhere,
    // and th wrote ชั้นเรียน where its field said คลาส. A teacher types the
    // class name into that field and meets it again on this line, so both
    // must use one word. The `(optional)` the field adds is not part of it.
    const word = (text: string) => text.normalize('NFC').trim().toLowerCase();
    const drift: string[] = [];
    const locales = [...LOCALES];
    for (const locale of locales) {
      const inFile = CSV_LOCALES[locale].classComment
        .replace(/^#\s*/, '')
        .replace(/[:：]\s*$/, '');
      const onPage = getStrings(locale).classLabel.replace(
        /\s*[(（][^)）]*[)）]\s*$/,
        '',
      );
      if (word(inFile) !== word(onPage))
        drift.push(`${locale}: file "${inFile}" vs page "${onPage}"`);
    }
    expect(searched(drift, { of: locales, what: 'locales compared' })).toEqual(
      [],
    );
    expect(
      floorBreach('csv/class-comment-locales', locales.length),
    ).toBeUndefined();
  });

  it('correcting the sex header moved nothing else, in any locale', () => {
    // AC7 asks for the untouched tokens asserted rather than assumed. The
    // pins that existed covered `en` and `id` only -- the same two-locale
    // shape this file's own header comment records as having left nine of
    // the ten pairs unguarded once #22 shipped five languages.
    //
    // #390 moved three of them, by operator decision (2026-09-30, "Change
    // all three"): zh `no` 不 → 否, vi `yes` đúng vậy ("that's right") →
    // có, and th `no` ไม่ → ไม่ใช่, the yes/no pairs a form in each language
    // uses. Free before the release, since production had no zh, vi or th.
    const UNTOUCHED = {
      en: {
        absentYes: 'yes',
        absentNo: 'no',
        groupColumn: 'group',
        M: 'M',
        F: 'F',
      },
      id: {
        absentYes: 'ya',
        absentNo: 'tidak',
        groupColumn: 'kelompok',
        M: 'L',
        F: 'P',
      },
      zh: {
        absentYes: '是',
        absentNo: '否',
        groupColumn: '组',
        M: 'M',
        F: 'F',
      },
      vi: {
        absentYes: 'có',
        absentNo: 'không',
        groupColumn: 'nhóm',
        M: 'M',
        F: 'F',
      },
      th: {
        absentYes: 'ใช่',
        absentNo: 'ไม่ใช่',
        groupColumn: 'กลุ่ม',
        M: 'M',
        F: 'F',
      },
    } as const;
    // Derived, so a sixth language fails here rather than shipping unpinned.
    const locales = [...LOCALES];
    expect(
      searched(
        locales.filter((l) => !(l in UNTOUCHED)),
        { of: locales, what: 'locales pinned' },
      ),
    ).toEqual([]);
    const moved: string[] = [];
    for (const locale of locales) {
      const table = CSV_LOCALES[locale];
      const pin = UNTOUCHED[locale];
      const actual = {
        absentYes: table.absentYes,
        absentNo: table.absentNo,
        groupColumn: table.groupColumn,
        M: table.sex.M,
        F: table.sex.F,
      };
      for (const [field, want] of Object.entries(pin))
        if (actual[field as keyof typeof actual] !== want)
          moved.push(
            `${locale}.${field}: "${actual[field as keyof typeof actual]}" (pinned "${want}")`,
          );
    }
    expect(searched(moved, { of: locales, what: 'locales pinned' })).toEqual(
      [],
    );
    expect(
      floorBreach('csv/untouched-locales', locales.length),
    ).toBeUndefined();
  });
});

describe('an unset dropdown exports as nothing, not as its own column name', () => {
  it('writes an empty cell for sex, together and apart in every locale', () => {
    // #249 put the COLUMN NAME into each unset dropdown's empty option, so an
    // unset cell now READS "Sex" on screen. The file must still carry nothing.
    // "Sex" sitting in a pupil's sex column is data, not a placeholder: a
    // teacher would see it in Excel, and re-importing that file would try to
    // read it as a sex token.
    //
    // Asserted per locale because the two words come from DIFFERENT tables --
    // the placeholder from the i18n catalogue, the file from CSV_LOCALES --
    // and only one of them belongs in a CSV. The screen label is named in the
    // failure text so a regression says what leaked, not just that something
    // did.
    const leaked: string[] = [];
    const locales = [...LOCALES];
    for (const locale of locales) {
      const t = getStrings(locale);
      const file = serialiseRoster(
        [student({ number: 1, name: 'Ana', sex: null })],
        '6A',
        locale,
      );
      const cells = (file.split('\n')[2] ?? '').split(',');
      const columns = [
        [2, 'sex', t.rosterColSex],
        [4, 'together', t.rosterColTogether],
        [5, 'apart', t.rosterColApart],
      ] as const;
      for (const [at, name, shown] of columns)
        if (cells[at] !== '')
          leaked.push(
            `${locale}: ${name} exported "${cells[at]}" (the screen shows "${shown}")`,
          );
    }
    expect(searched(leaked, { of: locales, what: 'locales exported' })).toEqual(
      [],
    );
    expect(floorBreach('csv/exported-locales', locales.length)).toBeUndefined();
  });
});
