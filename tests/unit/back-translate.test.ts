import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Catalogue } from '../../src/lib/i18n/en';
import { en } from '../../src/lib/i18n/en';
import { id } from '../../src/lib/i18n/id';
import { th } from '../../src/lib/i18n/th';
import { vi } from '../../src/lib/i18n/vi';
import { zh } from '../../src/lib/i18n/zh';
import { getSiteStrings, type Locale } from '../../src/lib/i18n';
import { siteEn } from '../../src/lib/i18n/site';
import { CSV_LOCALES } from '../../src/lib/csv-locale';
import { stringLeaves } from '../../src/lib/catalogue-leaves';
import { searched } from '../source-files';
import {
  backTranslationUnits,
  chrF,
  engineConfig,
  engineLanguages,
  engineName,
  engineSource,
  isLabel,
  libreTranslateBody,
  livenessProblems,
  reviewMarkdown,
  sendable,
  translatedTexts,
  unitsBetween,
  worstFirst,
  type Comparison,
  type EngineLanguage,
} from '../../src/lib/i18n/back-translate';
import { floorBreach } from '../floors';

/**
 * #95. The back-translation gate, minus the engine.
 *
 * Every non-English locale is read back into English by an engine that did
 * not write it, and the round trip is scored against the English it came
 * from. The copy was drafted by DeepL, so DeepL cannot be the reader: a
 * round trip through the same engine agrees with itself and proves nothing.
 *
 * Advisory by operator decision (2026-09-10): the review is surfaced and
 * nothing fails on a score. What does fail is a run that compared nothing,
 * because an advisory check that silently reads nothing looks exactly like
 * one that found nothing wrong.
 */

describe('chrF: how far a back-translation drifted from its English', () => {
  // Hand-derived, not computed: 'ab' against 'abc' has unigram precision 2/3
  // and bigram precision 1/2 (mean 7/12) with recall 1, so F2 is
  // 5 * 7/12 / (4 * 7/12 + 1) = 35/40. The reverse swaps precision and
  // recall, and recall weighs four times as much: 5 * 7/12 / (4 + 7/12).
  it.each([
    ['identical text', 'Add a student', 'Add a student', 100],
    ['nothing in common', 'ab', 'cd', 0],
    ['an added character', 'ab', 'abc', 87.5],
    ['a dropped character, which costs more', 'abc', 'ab', 700 / 11],
    ['a one-letter reference', 'a', 'ab', 250 / 3],
    ['case, spacing and punctuation', 'Add a student.', 'add  a student', 100],
    ['full-width letters', 'AB', 'ＡＢ', 100],
    ['a message slot', '{names} have joined', 'have joined', 100],
    ['an empty back-translation', 'Add a student', '', 0],
    ['symbols, which carry no language', 'A + B', 'AB', 100],
    // Orders one to six: 7/8, 6/7, 5/6, 4/5, 3/4 and 2/3 on both sides, whose
    // mean is 4017/5040. Five orders would give 3457/4200 instead.
    [
      'a text long enough for all six orders',
      'abcdefgh',
      'abcdefgx',
      133900 / 1680,
    ],
    ['two texts with nothing to compare', '', '', 100],
    ['two texts of punctuation alone', '.', '!', 100],
    // U+20000 and U+20001 share their high surrogate, so a count over UTF-16
    // code units would find half of each in common and score 25.
    ['astral letters that share a surrogate', '𠀀', '𠀁', 0],
  ])('%s', (_, reference, hypothesis, want) => {
    expect(chrF(reference, hypothesis)).toBeCloseTo(want, 10);
  });
});

describe('unitsBetween: what the reader is asked to read', () => {
  it('pairs copy by key', () => {
    expect(
      unitsBetween(
        { add: 'Add a student', nested: { hint: 'Type a name' } },
        { add: 'Tambah siswa', nested: { hint: 'Ketik nama' } },
      ),
    ).toEqual([
      { key: 'add', english: 'Add a student', translation: 'Tambah siswa' },
      { key: 'nested.hint', english: 'Type a name', translation: 'Ketik nama' },
    ]);
  });

  it('addresses a list item by its position', () => {
    expect(
      unitsBetween(
        { steps: ['Open the page', 'Pick a size'] },
        { steps: ['Buka halaman', 'Pilih ukuran'] },
      ),
    ).toEqual([
      {
        key: 'steps[0]',
        english: 'Open the page',
        translation: 'Buka halaman',
      },
      { key: 'steps[1]', english: 'Pick a size', translation: 'Pilih ukuran' },
    ]);
  });

  it('puts a prefix on every key when given one', () => {
    expect(
      unitsBetween(
        { menuLabel: 'Toggle navigation menu' },
        { menuLabel: 'Chuyển đổi menu điều hướng' },
        'site',
      ),
    ).toEqual([
      {
        key: 'site.menuLabel',
        english: 'Toggle navigation menu',
        translation: 'Chuyển đổi menu điều hướng',
      },
    ]);
  });

  it('sends nothing a translator never took: symbols, copy left as English, non-strings', () => {
    expect(
      unitsBetween(
        { number: '#', brand: 'ShyTalk', max: 40, add: 'Add' },
        { number: '#', brand: 'ShyTalk', max: 40, add: 'Tambah' },
      ),
    ).toEqual([{ key: 'add', english: 'Add', translation: 'Tambah' }]);
  });

  it('sends no symbol even when its translation differs', () => {
    expect(unitsBetween({ n: '#', dash: '—' }, { n: '＃', dash: '–' })).toEqual(
      [],
    );
  });

  it('sends nothing for copy the locale has no string for', () => {
    expect(
      unitsBetween(
        { a: 'Add a student', b: 'Type a name', c: 'Close' },
        { b: 'Ketik nama', c: 7 },
      ),
    ).toEqual([
      { key: 'b', english: 'Type a name', translation: 'Ketik nama' },
    ]);
  });

  it('sends a plural as its "other" sentence', () => {
    expect(
      unitsBetween(
        { n: '{n, plural, one {# group} other {# groups}}' },
        { n: '{n, plural, other {# กลุ่ม}}' },
      ),
    ).toEqual([{ key: 'n', english: '{n} groups', translation: '{n} กลุ่ม' }]);
  });

  it('pairs the branches of a choice by name, not by position', () => {
    expect(
      unitsBetween(
        {
          pick: '{sex, select, M {{names} is a boy} other {{names} is a girl}}',
        },
        { pick: '{sex, select, other {{names} gadis} M {{names} laki-laki}}' },
      ),
    ).toEqual([
      {
        key: 'pick [sex=M]',
        english: '{names} is a boy',
        translation: '{names} laki-laki',
      },
      {
        key: 'pick [sex=other]',
        english: '{names} is a girl',
        translation: '{names} gadis',
      },
    ]);
  });

  it('refuses a translation that dropped a choice the English makes', () => {
    expect(() =>
      unitsBetween(
        { pick: '{sex, select, M {boy} other {girl}}' },
        { pick: 'anak' },
      ),
    ).toThrow(
      'pick: the English chooses by {sex} from M, other; the translation makes no choice',
    );
    expect(() =>
      unitsBetween(
        { pick: '{sex, select, M {boy} other {girl}}' },
        { pick: '{sex, select, other {anak}}' },
      ),
    ).toThrow(
      'pick: the English chooses by {sex} from M, other; the translation chooses by {sex} from other',
    );
  });

  it.each([
    [
      'chooses by another value',
      '{kind, select, M {anak laki} other {anak}}',
      'chooses by {kind} from M, other',
    ],
    [
      'adds a branch',
      '{sex, select, M {laki} F {perempuan} other {anak}}',
      'chooses by {sex} from M, F, other',
    ],
    [
      'has as many branches under other names',
      '{sex, select, F {perempuan} other {anak}}',
      'chooses by {sex} from F, other',
    ],
  ])('refuses a translation that %s', (_, translation, theirs) => {
    expect(() =>
      unitsBetween(
        { pick: '{sex, select, M {boy} other {girl}}' },
        { pick: translation },
      ),
    ).toThrow(
      `pick: the English chooses by {sex} from M, other; the translation ${theirs}`,
    );
  });
});

/** The raw catalogues, one per translated locale; the compiler keeps it whole. */
const CATALOGUES = { id, zh, vi, th } satisfies Record<
  Exclude<Locale, 'en'>,
  Catalogue
>;
const TRANSLATED = Object.keys(CATALOGUES) as Array<keyof typeof CATALOGUES>;

/**
 * Each locale's count of translated entries, ratcheted (#468). Keyed by the
 * catalogue, so a locale added without a floor fails to compile.
 */
const TRANSLATED_FLOOR: Readonly<Record<keyof typeof CATALOGUES, string>> = {
  id: 'back-translate/translated-id',
  zh: 'back-translate/translated-zh',
  vi: 'back-translate/translated-vi',
  th: 'back-translate/translated-th',
};

/** The CSV vocabulary without its `sex` letters, which the roster rows read back. */
const csvCopy = (locale: Locale) =>
  Object.fromEntries(
    Object.entries(CSV_LOCALES[locale]).filter(([key]) => key !== 'sex'),
  );

/**
 * The keys a locale translated, derived independently of the module: every
 * English leaf with a letter in it whose locale value differs.
 */
function translatedKeys(
  english: unknown,
  translated: unknown,
  prefix: string,
): string[] {
  const theirs = new Map(stringLeaves(translated));
  return stringLeaves(english)
    .filter(
      ([path, value]) => /\p{L}/u.test(value) && theirs.get(path) !== value,
    )
    .map(([path]) => `${prefix}${path}`);
}

describe('backTranslationUnits: every catalogue the site ships', () => {
  it('reads the main catalogue', () => {
    expect(backTranslationUnits('vi')).toContainEqual({
      key: 'rosterColSex',
      english: 'Sex',
      translation: 'Giới tính',
    });
  });

  it('reads the site chrome', () => {
    expect(backTranslationUnits('vi')).toContainEqual({
      key: 'site.menuLabel',
      english: 'Toggle navigation menu',
      translation: 'Chuyển đổi menu điều hướng',
    });
  });

  it('reads the CSV vocabulary', () => {
    expect(backTranslationUnits('vi')).toContainEqual({
      key: 'csv.columns.name',
      english: 'name',
      translation: 'tên',
    });
  });

  it('reads every entry a locale translated, and nothing else', () => {
    for (const locale of TRANSLATED) {
      const expected = new Set([
        ...translatedKeys(en, CATALOGUES[locale], ''),
        ...translatedKeys(siteEn, getSiteStrings(locale), 'site.'),
        ...translatedKeys(csvCopy('en'), csvCopy(locale), 'csv.'),
      ]);
      const read = new Set(
        backTranslationUnits(locale).map(({ key }) =>
          key.replace(/ \[[^\]]*\]$/, ''),
        ),
      );
      expect([...read].sort(), locale).toEqual([...expected].sort());
      // After the verdict, so a population that grew never hides a finding.
      expect(
        floorBreach(TRANSLATED_FLOOR[locale], expected.size),
        `${locale}: not the recorded count of translated entries`,
      ).toBeUndefined();
    }
  });

  it('gives every unit a key of its own', () => {
    for (const locale of TRANSLATED) {
      const keys = backTranslationUnits(locale).map(({ key }) => key);
      expect(new Set(keys).size, locale).toBe(keys.length);
    }
  });

  it('reads nothing for English, which has nothing to read back', () => {
    expect(backTranslationUnits('en')).toEqual([]);
  });
});

/** One comparison, with only what a test is about spelled out. */
const compared = (
  locale: Locale,
  key: string,
  score: number,
  backTranslation = 'Add a student',
  translation = 'Tambah siswa',
): Comparison => ({
  locale,
  key,
  english: 'Add a student',
  translation,
  backTranslation,
  score,
});

describe('worstFirst', () => {
  it('puts the lowest score first and breaks a tie by locale, then key', () => {
    const rows = [
      compared('vi', 'b', 70),
      compared('id', 'z', 20),
      compared('th', 'a', 70),
      compared('id', 'a', 70),
      compared('zh', 'm', 45),
    ];
    expect(worstFirst(rows).map((row) => `${row.locale}:${row.key}`)).toEqual([
      'id:z',
      'zh:m',
      'id:a',
      'th:a',
      'vi:b',
    ]);
    expect(rows[0].key, 'worstFirst sorted its input in place').toBe('b');
  });

  it('breaks a tie on score and locale by key', () => {
    // Given b before a, so a stable sort that ignored the key keeps them wrong.
    const rows = [compared('id', 'b', 70), compared('id', 'a', 70)];
    expect(worstFirst(rows).map((row) => row.key)).toEqual(['a', 'b']);
  });
});

describe('livenessProblems: a run that read nothing is a failure', () => {
  it('finds none when every locale read something back', () => {
    expect(
      livenessProblems(
        ['id', 'zh'],
        [compared('id', 'a', 90), compared('zh', 'a', 40)],
      ),
    ).toEqual([]);
  });

  it('names a locale that compared nothing', () => {
    expect(livenessProblems(['id', 'zh'], [compared('id', 'a', 90)])).toEqual([
      'zh: nothing was compared -- no translated copy was read back',
    ]);
  });

  it('counts back-translations by their text, not by how many came back', () => {
    expect(
      livenessProblems(
        ['th'],
        [compared('th', 'a', 0, ''), compared('th', 'b', 0, '  ')],
      ),
    ).toEqual(['th: none of 2 back-translations came back with any text']);
  });

  it('leaves one empty back-translation to the review, as its worst row', () => {
    expect(
      livenessProblems(
        ['th'],
        [compared('th', 'a', 0, ''), compared('th', 'b', 80)],
      ),
    ).toEqual([]);
  });

  it('fails a run that compared nothing at all, once per locale', () => {
    expect(livenessProblems(['id', 'zh', 'vi', 'th'], [])).toHaveLength(4);
  });
});

describe('engineSource: which of the engine’s languages a locale is', () => {
  const offered = (...codes: string[]): EngineLanguage[] =>
    codes.map((code) => ({ code, targets: ['en'] }));

  it('takes the locale’s own code', () => {
    expect(engineSource('vi', offered('en', 'vi'))).toBe('vi');
  });

  it('takes the script the locale is written in when the engine splits one', () => {
    expect(engineSource('zh', offered('en', 'zh-Hant', 'zh-Hans'))).toBe(
      'zh-Hans',
    );
  });

  it('refuses a locale the engine cannot read into English', () => {
    expect(() => engineSource('th', [{ code: 'th', targets: ['fr'] }])).toThrow(
      'th: the engine cannot read th into English; it reads nothing',
    );
    expect(() => engineSource('th', offered('en', 'vi'))).toThrow(
      'th: the engine cannot read th into English; it reads en, vi',
    );
  });

  it('prefers the locale’s own code to a scripted one', () => {
    expect(engineSource('zh', offered('en', 'zh', 'zh-Hans'))).toBe('zh');
  });

  it('refuses to guess between two codes in the locale’s script', () => {
    expect(() =>
      engineSource('zh', offered('en', 'zh-Hans', 'zh-Hans-CN')),
    ).toThrow(
      'zh: the engine offers zh-Hans, zh-Hans-CN for zh in the Hans script, and the gate will not guess which',
    );
  });

  it('never takes a code Intl cannot read as the locale’s script', () => {
    expect(() => engineSource('vi', offered('en', 'vi-!!'))).toThrow(
      'vi: the engine cannot read vi into English; it reads en, vi-!!',
    );
  });
});

describe('engineLanguages: what the engine says it can read', () => {
  it('reads the list LibreTranslate answers, keeping what the gate uses', () => {
    expect(
      engineLanguages([{ code: 'th', name: 'Thai', targets: ['en', 'fr'] }]),
    ).toEqual([{ code: 'th', targets: ['en', 'fr'] }]);
  });

  it('refuses an answer that is not that list', () => {
    expect(() => engineLanguages({ error: 'Not Found' })).toThrow(/languages/);
    expect(() => engineLanguages([{ code: 'th' }])).toThrow(/languages/);
    expect(() => engineLanguages([{ code: 'th', targets: 'en' }])).toThrow(
      /languages/,
    );
  });

  it.each([
    ['an entry with no code', [{ targets: ['en'] }]],
    ['a target that is not a string', [{ code: 'th', targets: ['en', 3] }]],
  ])('refuses %s', (_, answer) => {
    expect(() => engineLanguages(answer)).toThrow(
      'expected GET /languages to answer a list of { code, targets }',
    );
  });
});

describe('the LibreTranslate request and its answer', () => {
  it('asks for English from the locale, as plain text', () => {
    expect(libreTranslateBody(['Tambah siswa', 'Ketik nama'], 'id')).toEqual({
      q: ['Tambah siswa', 'Ketik nama'],
      source: 'id',
      target: 'en',
      format: 'text',
    });
  });

  it('carries a key only when there is one', () => {
    expect(libreTranslateBody(['x'], 'th', 'k-123')).toEqual({
      q: ['x'],
      source: 'th',
      target: 'en',
      format: 'text',
      api_key: 'k-123',
    });
  });

  it('reads one back-translation per text sent', () => {
    expect(
      translatedTexts({ translatedText: ['Add a student', 'Type a name'] }, 2),
    ).toEqual(['Add a student', 'Type a name']);
  });

  it('refuses an answer with a different count', () => {
    expect(() => translatedTexts({ translatedText: ['only one'] }, 2)).toThrow(
      'expected 2 translatedText entries, got 1',
    );
  });

  it('refuses an answer that is not a list of strings', () => {
    // Matched on the field it names: a bare `toThrow()` also passes for a
    // function that throws for any reason at all, and did, against a stub.
    expect(() =>
      translatedTexts({ translatedText: 'Add a student' }, 1),
    ).toThrow(/translatedText/);
    expect(() => translatedTexts({ translatedText: [3] }, 1)).toThrow(
      /translatedText/,
    );
    expect(() => translatedTexts(null, 1)).toThrow(/translatedText/);
  });

  it('passes on the engine’s own error', () => {
    expect(() => translatedTexts({ error: 'Invalid API key' }, 1)).toThrow(
      /Invalid API key/,
    );
  });
});

describe('sendable: what the engine is sent', () => {
  // The score leaves slots out on both sides, and the engine mangles them --
  // `{on}` came back as `MHon}` and `{n}` as `(3nd)` in 13 of 24 historical
  // pairs measured on 2026-09-23 -- so a slot sent is only noise.
  it.each([
    ['a slot at the start', '{n} đã được thêm vào', 'đã được thêm vào'],
    ['a slot glued to a word', 'Nhóm{n}', 'Nhóm'],
    ['slots between words', '{names} ถูก {x} เก็บ', 'ถูก เก็บ'],
    ['plain copy', 'Tambah siswa', 'Tambah siswa'],
    ['nothing but a slot', '{n}', ''],
  ])('%s', (_, text, want) => {
    expect(sendable(text)).toBe(want);
  });
});

describe('engineName: the engine the Dockerfile builds, unless a run names one', () => {
  const pinned =
    'FROM libretranslate/libretranslate:v1.9.6@sha256:' + 'a'.repeat(64);

  it('names the tag the Dockerfile builds, without its digest', () => {
    expect(engineName({}, `${pinned}\nENV LT_LOAD_ONLY=en\n`)).toBe(
      'LibreTranslate v1.9.6',
    );
  });

  it('reads a tag that carries no digest', () => {
    expect(
      engineName({}, 'FROM libretranslate/libretranslate:v2.0.0 AS engine\n'),
    ).toBe('LibreTranslate v2.0.0');
  });

  it('never reads a FROM line that is commented out', () => {
    expect(
      engineName(
        {},
        `# FROM libretranslate/libretranslate:v0.0.1\n  ${pinned}\n`,
      ),
    ).toBe('LibreTranslate v1.9.6');
  });

  it('lets a run name its own engine, and treats an empty name as none', () => {
    expect(engineName({ BACK_TRANSLATE_ENGINE: 'my-engine' }, pinned)).toBe(
      'my-engine',
    );
    expect(engineName({ BACK_TRANSLATE_ENGINE: '' }, pinned)).toBe(
      'LibreTranslate v1.9.6',
    );
  });

  it('refuses a Dockerfile that names no libretranslate image', () => {
    expect(() => engineName({}, 'FROM node:24\n')).toThrow(
      /names no libretranslate\/libretranslate image/,
    );
  });

  it("names the repository's own Dockerfile's tag", () => {
    // Read here by a different route from the one under test: the tag is
    // what sits between the image's ':' and its '@' on the FROM line.
    const dockerfile = readFileSync('docker/libretranslate/Dockerfile', 'utf8');
    const from = dockerfile
      .split('\n')
      .find((line) => line.startsWith('FROM libretranslate/libretranslate:'));
    expect(from, 'the Dockerfile has a FROM line').toBeDefined();
    const tag = from!.split(':')[1]!.split('@')[0]!;
    expect(tag).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(engineName({}, dockerfile)).toBe(`LibreTranslate ${tag}`);
  });
});

describe('engineConfig: a missing engine fails loudly', () => {
  it('refuses to run without an engine address', () => {
    expect(() => engineConfig({})).toThrow(/BACK_TRANSLATE_URL/);
    expect(() => engineConfig({ BACK_TRANSLATE_URL: '' })).toThrow(
      /BACK_TRANSLATE_URL/,
    );
  });

  it('refuses an address that is not http or https', () => {
    // `new URL('localhost:5000')` parses, as the scheme "localhost:".
    expect(() =>
      engineConfig({ BACK_TRANSLATE_URL: 'localhost:5000' }),
    ).toThrow(/BACK_TRANSLATE_URL/);
  });

  it('reads the address, without a trailing slash, and the key', () => {
    expect(
      engineConfig({
        BACK_TRANSLATE_URL: 'http://127.0.0.1:5000/',
        BACK_TRANSLATE_API_KEY: 'k-123',
      }),
    ).toEqual({ url: 'http://127.0.0.1:5000', apiKey: 'k-123' });
  });

  it('treats an empty key as no key', () => {
    expect(
      engineConfig({
        BACK_TRANSLATE_URL: 'http://127.0.0.1:5000',
        BACK_TRANSLATE_API_KEY: '',
      }),
    ).toEqual({ url: 'http://127.0.0.1:5000' });
  });
});

describe('reviewMarkdown: the page a reviewer reads', () => {
  const rows = [
    compared('id', 'good', 90, 'Add a student'),
    compared('id', 'bad', 30, 'Add sexual intercourse'),
    compared('th', 'only', 55, 'Add a pupil', 'เพิ่มนักเรียน'),
  ];
  const page = () =>
    reviewMarkdown(rows, ['id', 'th'], 'LibreTranslate v1.9.6');

  it('names the engine that read the copy back', () => {
    expect(page()).toContain('LibreTranslate v1.9.6');
  });

  it('gives each locale a section, in the order given', () => {
    const id = page().indexOf('<summary>id');
    const th = page().indexOf('<summary>th');
    expect(id, 'no id section').toBeGreaterThan(-1);
    expect(th, 'th section missing or before id').toBeGreaterThan(id);
  });

  it('counts each locale and gives its lowest and median score', () => {
    expect(page()).toMatch(
      /<summary>id — 2 compared, lowest 30, median 60<\/summary>/,
    );
    expect(page()).toMatch(
      /<summary>th — 1 compared, lowest 55, median 55<\/summary>/,
    );
  });

  it('lists a locale’s rows worst first', () => {
    const bad = page().indexOf('| `bad` |');
    const good = page().indexOf('| `good` |');
    expect(bad, 'the bad row is missing').toBeGreaterThan(-1);
    expect(
      good,
      'the good row is missing or before the bad one',
    ).toBeGreaterThan(bad);
  });

  it('shows the English, the translation and the back-translation side by side', () => {
    expect(page()).toContain(
      '| 55 | `only` | Add a student | เพิ่มนักเรียน | Add a pupil |',
    );
  });

  it('reviews sentences apart from labels of three words or fewer', () => {
    const split = reviewMarkdown(
      [
        {
          ...compared('vi', 'sentence', 40),
          english: 'Keep these students together in one group',
        },
        {
          ...compared('vi', 'label', 9, 'Gender', 'Giới tính'),
          english: 'Sex',
        },
      ],
      ['vi'],
      'engine',
    );
    const at = (needle: string) => split.indexOf(needle);
    expect([
      at('#### Sentences') > -1,
      at('| `sentence` |') > at('#### Sentences'),
      at('#### Labels of three words or fewer') > at('| `sentence` |'),
      at('| `label` |') > at('#### Labels of three words or fewer'),
    ]).toEqual([true, true, true, true]);
  });

  it('counts a label by its words, never its slots', () => {
    const slotted = reviewMarkdown(
      // Two words and two slots: a label by its words, a sentence by its tokens.
      [{ ...compared('th', 'slotted', 50), english: '{n} of {total} chosen' }],
      ['th'],
      'engine',
    );
    // The heading is found first: `indexOf` answers -1 for a missing one, and
    // every row sits "after" -1, which is how this passed before the split
    // existed.
    const labels = slotted.indexOf('#### Labels of three words or fewer');
    expect(labels, 'no labels section').toBeGreaterThan(-1);
    expect(slotted.indexOf('| `slotted` |')).toBeGreaterThan(labels);
    expect(slotted).not.toContain('#### Sentences');
  });

  it('counts a label by its words, never its symbols', () => {
    expect(isLabel('Boys & girls only')).toBe(true);
    expect(isLabel('Keep these four together')).toBe(false);
  });

  it('opens the labels section with the caveat the score needs', () => {
    const labelled = reviewMarkdown(
      [
        {
          ...compared('vi', 'label', 9, 'Gender', 'Giới tính'),
          english: 'Sex',
        },
      ],
      ['vi'],
      'engine',
    );
    const heading = labelled.indexOf('#### Labels of three words or fewer');
    const caveat = labelled.indexOf(
      'Judge these by eye; the order is only a place to start (#95, #161).',
    );
    expect(heading, 'no labels section').toBeGreaterThan(-1);
    expect(caveat, 'no caveat after the heading').toBeGreaterThan(heading);
    expect(labelled.indexOf('| `label` |')).toBeGreaterThan(caveat);
  });

  it('has no labels section when every row is a sentence', () => {
    const sentences = reviewMarkdown(
      [
        {
          ...compared('vi', 'sentence', 40),
          english: 'Keep these students together in one group',
        },
      ],
      ['vi'],
      'engine',
    );
    expect(sentences, 'no sentences section').toContain('#### Sentences');
    expect(sentences).not.toContain('#### Labels');
  });

  it('says a locale read nothing back, rather than scoring an empty list', () => {
    expect(reviewMarkdown([], ['zh'], 'engine')).toContain(
      '<details><summary>zh — 0 compared</summary>\n\nNothing was read back.\n\n</details>',
    );
  });

  it('keeps an entity-like text literal, escaping its ampersand', () => {
    expect(
      reviewMarkdown(
        [compared('vi', 'k', 10, 'Use &lt; for <')],
        ['vi'],
        'engine',
      ),
    ).toContain('| Use &amp;lt; for &lt; |');
  });

  it('keeps every value inside its own table cell', () => {
    const awkward = reviewMarkdown(
      [compared('vi', 'k', 10, 'a | b\nc <b>d</b>', 'x|y')],
      ['vi'],
      'engine',
    );
    expect(awkward).toContain(
      '| 10 | `k` | Add a student | x\\|y | a \\| b c &lt;b&gt;d&lt;/b&gt; |',
    );
  });
});

/**
 * The script, run the way the workflow runs it, against a stand-in engine.
 *
 * The real engine is exercised by the workflow itself, on the runner; here a
 * local server speaks LibreTranslate's two endpoints so every failure path
 * can be reached on demand. Its log opens with `listening`, so a run that
 * made no request is told apart from a server that recorded nothing.
 */
describe('scripts/i18n-back-translate.mjs', () => {
  const script = resolve('scripts', 'i18n-back-translate.mjs');
  const LANGUAGES: Array<EngineLanguage & { name: string }> = [
    { code: 'en', name: 'English', targets: ['id', 'th', 'vi', 'zh-Hans'] },
    { code: 'id', name: 'Indonesian', targets: ['en'] },
    { code: 'th', name: 'Thai', targets: ['en'] },
    { code: 'vi', name: 'Vietnamese', targets: ['en'] },
    { code: 'zh-Hans', name: 'Chinese (Simplified)', targets: ['en'] },
    { code: 'zh-Hant', name: 'Chinese (Traditional)', targets: ['en'] },
  ];
  let dir = '';
  let server: Server | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'back-translate-'));
  });
  afterEach(async () => {
    // `close` alone waits out any keep-alive socket the script's fetch left.
    server?.closeAllConnections();
    await new Promise<void>((done) =>
      server ? server.close(() => done()) : done(),
    );
    server = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  interface StandIn {
    url: string;
    log: string[];
    /** Every text the engine was asked to read, in order. */
    sent: string[];
    /** The same, each as `<source> <text>`: which language it was sent as. */
    sentFrom: string[];
  }

  async function standIn(options: {
    languages?: EngineLanguage[];
    answer?: (text: string, source: string) => string;
    refuse?: { status: number; error: string };
  }): Promise<StandIn> {
    const log: string[] = [];
    const sent: string[] = [];
    const sentFrom: string[] = [];
    server = createServer((request, response) => {
      // Decoded as a stream, so a Thai character split across two chunks
      // arrives whole rather than as two replacement characters.
      request.setEncoding('utf8');
      let body = '';
      request.on('data', (chunk: string) => (body += chunk));
      request.on('end', () => {
        const reply = (status: number, value: unknown) => {
          response.writeHead(status, { 'content-type': 'application/json' });
          response.end(JSON.stringify(value));
        };
        if (request.method === 'GET' && request.url === '/languages') {
          log.push('GET /languages');
          reply(200, options.languages ?? LANGUAGES);
          return;
        }
        if (request.method === 'POST' && request.url === '/translate') {
          const { q, source } = JSON.parse(body) as {
            q: string[];
            source: string;
          };
          log.push(`POST /translate ${source} ${q.length}`);
          sent.push(...q);
          sentFrom.push(...q.map((text) => `${source} ${text}`));
          if (options.refuse) {
            reply(options.refuse.status, { error: options.refuse.error });
            return;
          }
          const answer = options.answer ?? ((text: string) => `back:${text}`);
          reply(200, { translatedText: q.map((text) => answer(text, source)) });
          return;
        }
        log.push(`unexpected ${request.method} ${request.url}`);
        reply(404, { error: 'Not Found' });
      });
    });
    const listening = server;
    await new Promise<void>((done) => listening.listen(0, '127.0.0.1', done));
    log.push('listening');
    const { port } = listening.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}`, log, sent, sentFrom };
  }

  /** One run of the real script, with only the environment a test gives it. */
  function run(
    env: Record<string, string>,
    args: readonly string[] = [],
  ): Promise<{ status: number | null; output: string }> {
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    for (const name of Object.keys(childEnv))
      if (name.startsWith('BACK_TRANSLATE_')) delete childEnv[name];
    // Never the real job summary: a test run inside CI would write into it.
    childEnv.GITHUB_STEP_SUMMARY = join(dir, 'summary.md');
    Object.assign(childEnv, env);
    return new Promise((done, fail) => {
      const child = spawn(
        process.execPath,
        ['--no-warnings', script, ...args],
        {
          env: childEnv,
        },
      );
      let output = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => (output += chunk));
      child.stderr.on('data', (chunk: string) => (output += chunk));
      child.on('error', fail);
      child.on('close', (status) => done({ status, output }));
    });
  }

  const summary = () => readFileSync(join(dir, 'summary.md'), 'utf8');
  const report = () =>
    JSON.parse(readFileSync(join(dir, 'back-translation.json'), 'utf8')) as {
      comparisons: Comparison[];
    };
  const translateRequests = (engine: StandIn) =>
    engine.log.filter((line) => line.startsWith('POST /translate'));

  it('reads every locale back into English and writes the review', async () => {
    const engine = await standIn({});
    const result = await run({
      BACK_TRANSLATE_URL: engine.url,
      BACK_TRANSLATE_REPORT: join(dir, 'back-translation.json'),
    });
    expect(result.status, result.output).toBe(0);
    for (const locale of TRANSLATED) {
      const units = backTranslationUnits(locale);
      const mine = report().comparisons.filter((row) => row.locale === locale);
      expect(mine, locale).toHaveLength(units.length);
      // Written out here, not taken from the module: the slots the engine is
      // spared, then the stand-in's answer.
      for (const row of mine)
        expect(row.backTranslation, `${locale} ${row.key}`).toBe(
          `back:${row.translation
            .replace(/\{[^{}]*\}/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()}`,
        );
    }
    // Not one slot reached the engine, and the copy around them did: the
    // Vietnamese group label is `Nhóm {n}`.
    expect(
      searched(
        engine.sent.filter((text) => /[{}]/.test(text)),
        { of: engine.sent, what: 'texts sent to the engine' },
      ),
      'a slot sent is noise the engine mangles',
    ).toEqual([]);
    expect(
      floorBreach('back-translate/texts-sent', engine.sent.length),
    ).toBeUndefined();
    expect(engine.sent).toContain('Nhóm');
    // Every section, parsed off its line rather than found as a substring.
    expect(
      [
        ...summary().matchAll(/^<details><summary>(\w+) — (\d+) compared/gm),
      ].map(([, locale, count]) => `${locale} ${count}`),
    ).toEqual(
      TRANSLATED.map(
        (locale) => `${locale} ${backTranslationUnits(locale).length}`,
      ),
    );
    // zh is asked for in the script it is written in, not just by its code.
    expect(
      translateRequests(engine).some((line) =>
        line.startsWith('POST /translate zh-Hans '),
      ),
    ).toBe(true);
  });

  it('says how many it compared per locale, and as what', async () => {
    const engine = await standIn({});
    const result = await run({ BACK_TRANSLATE_URL: engine.url });
    expect(result.status, result.output).toBe(0);
    for (const locale of TRANSLATED)
      expect(result.output, locale).toMatch(
        new RegExp(
          `^${locale}: ${backTranslationUnits(locale).length} compared, \\d+ distinct, read as ${locale === 'zh' ? 'zh-Hans' : locale}$`,
          'm',
        ),
      );
  });

  it('scores each back-translation against its English', async () => {
    const engine = await standIn({});
    const result = await run({
      BACK_TRANSLATE_URL: engine.url,
      BACK_TRANSLATE_REPORT: join(dir, 'back-translation.json'),
    });
    expect(result.status, result.output).toBe(0);
    const rows = report().comparisons;
    expect(rows.filter(({ score }) => score > 0).length).toBeGreaterThan(0);
    for (const row of rows)
      expect(row.score, `${row.locale} ${row.key}`).toBe(
        chrF(row.english, row.backTranslation),
      );
  });

  it('sends a text once per locale, however many keys share it', async () => {
    // Liveness: the catalogues do repeat a translation under several keys,
    // so sending one per key would show here.
    expect(
      TRANSLATED.some((locale) => {
        const units = backTranslationUnits(locale);
        return (
          new Set(units.map(({ translation }) => sendable(translation))).size <
          units.length
        );
      }),
    ).toBe(true);
    const engine = await standIn({});
    await run({ BACK_TRANSLATE_URL: engine.url });
    expect(engine.sentFrom.length).toBeGreaterThan(0);
    expect(new Set(engine.sentFrom).size).toBe(engine.sentFrom.length);
  });

  it('names the engine it was given, in the review and the report', async () => {
    const engine = await standIn({});
    const result = await run({
      BACK_TRANSLATE_URL: engine.url,
      BACK_TRANSLATE_ENGINE: 'libretranslate/libretranslate:v1.6.2',
      BACK_TRANSLATE_REPORT: join(dir, 'back-translation.json'),
    });
    expect(result.status, result.output).toBe(0);
    expect(summary()).toMatch(
      /^Every translated locale, read back into English by \*\*libretranslate\/libretranslate:v1\.6\.2\*\*, /m,
    );
    expect(
      (
        JSON.parse(
          readFileSync(join(dir, 'back-translation.json'), 'utf8'),
        ) as {
          engine: string;
        }
      ).engine,
    ).toBe('libretranslate/libretranslate:v1.6.2');
  });

  // #390 F75. The workflow no longer types the version, so a run that names
  // no engine must take it from the Dockerfile Dependabot bumps.
  it('names the engine the Dockerfile builds when a run names none', async () => {
    const engine = await standIn({});
    const result = await run({ BACK_TRANSLATE_URL: engine.url });
    expect(result.status, result.output).toBe(0);
    const built = engineName(
      {},
      readFileSync('docker/libretranslate/Dockerfile', 'utf8'),
    );
    expect(built).toMatch(/^LibreTranslate v\d/);
    // The name the review's anchored opening line carries, compared EXACTLY
    // with the Dockerfile's: a missing line reads as undefined and fails.
    const opening =
      /^Every translated locale, read back into English by \*\*(LibreTranslate v[^*]+)\*\*, /m;
    expect(opening.exec(summary())?.[1]).toBe(built);
  });

  it('prints the review when there is no job summary to write it to', async () => {
    const engine = await standIn({});
    const result = await run({
      BACK_TRANSLATE_URL: engine.url,
      GITHUB_STEP_SUMMARY: '',
    });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toMatch(
      /^Every translated locale, read back into English by \*\*LibreTranslate v\d+\.\d+\.\d+\*\*, /m,
    );
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, 'summary.md'))).toBe(false);
  });

  it('never fails on a score, however bad', async () => {
    const engine = await standIn({ answer: () => 'zzz' });
    const result = await run({ BACK_TRANSLATE_URL: engine.url });
    expect(result.status, result.output).toBe(0);
    expect(summary()).toMatch(/^\| 0 \| /m);
  });

  it('fails loudly without an engine, before writing or sending anything', async () => {
    const engine = await standIn({});
    const result = await run({});
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/BACK_TRANSLATE_URL/);
    expect(
      existsSync(join(dir, 'summary.md')),
      'a refused run wrote a summary',
    ).toBe(false);
    expect(
      searched(translateRequests(engine), {
        of: engine.log,
        what: 'stand-in engine log lines',
      }),
      'a run with no engine sent something',
    ).toEqual([]);
    // `listening` and nothing else: not even the languages read (#522).
    expect(
      floorBreach('back-translate/no-engine-log', engine.log.length),
    ).toBeUndefined();
  });

  it('fails a locale that came back empty, and says so in the summary', async () => {
    const engine = await standIn({
      answer: (text, source) => (source === 'th' ? '' : `back:${text}`),
    });
    const result = await run({ BACK_TRANSLATE_URL: engine.url });
    expect(result.status, result.output).toBe(1);
    expect(result.output).toMatch(/^th: /m);
    expect(summary()).toMatch(/^\*\*This run cannot be believed:\*\*$/m);
    expect(summary()).toMatch(/^th: /m);
  });

  it('passes on the engine’s refusal', async () => {
    const engine = await standIn({
      refuse: { status: 403, error: 'Invalid API key' },
    });
    const result = await run({ BACK_TRANSLATE_URL: engine.url });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/^✗ .*Invalid API key/m);
  });

  it('refuses an engine that cannot read a locale, before sending anything', async () => {
    const engine = await standIn({
      languages: LANGUAGES.filter(({ code }) => code !== 'th'),
    });
    const result = await run({ BACK_TRANSLATE_URL: engine.url });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/\bth\b/);
    expect(
      searched(translateRequests(engine), {
        of: engine.log,
        what: 'stand-in engine log lines',
      }),
      'it sent copy before finding a locale it could not read',
    ).toEqual([]);
    expect(
      floorBreach('back-translate/refused-locale-log', engine.log.length),
    ).toBeUndefined();
  });

  it('refuses an argument, since everything it reads is an environment variable', async () => {
    const engine = await standIn({});
    const result = await run({ BACK_TRANSLATE_URL: engine.url }, ['--report']);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/takes no arguments/);
    expect(engine.log, 'it reached the engine before refusing').toEqual([
      'listening',
    ]);
  });

  it('is watched by a stand-in that records a real request', async () => {
    // The control for every "sent nothing" above: the same recorder, a run
    // that sends. Without it, a recorder that stopped recording would pass
    // every one of them.
    const engine = await standIn({});
    await run({ BACK_TRANSLATE_URL: engine.url });
    expect(translateRequests(engine).length).toBeGreaterThan(0);
  });
});
