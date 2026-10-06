import { describe, it, expect } from 'vitest';
import { nonEmpty, searched } from '../source-files';
import { floorBreach } from '../floors';
import {
  backTranslationUnits,
  TRANSLATED_LOCALES,
  type BackTranslationUnit,
} from '../../src/lib/i18n/back-translate';
import {
  checkFeatureTerms,
  featuresNamed,
  FEATURE_TERMS,
  type FeatureTerm,
  type Glossary,
} from '../../src/lib/i18n/feature-terms';
import { partsOf, wordsOf } from '../../src/lib/i18n/label-check';
import type { Locale } from '../../src/lib/i18n/locales';

/**
 * Copy that names a feature of the classroom-groups tool, held to the words
 * its locale approved for that feature (#319).
 *
 * `warnings.PINNED_MIXED_SEX` explains a warning a teacher has just been
 * shown: "that is what the pin asked for, not a mistake to fix". zh said
 * "what the tag asked for", vi "the request in the post", th "what the pin's
 * description says", with a transliteration that also means a PIN code. Each
 * was translated, non-blank and slot-perfect, so every structural guard
 * passed it. A label is judged against the sentences around it (#161);
 * nothing judged a sentence against its siblings.
 */

/**
 * The words each locale may use for each feature (operator decision on #319,
 * 2026-09-23: "any word its labels use"). Together, apart and absent take the
 * words of the labels approved on #161 and pinned in `verified-labels.test.ts`
 * -- the roster column, the Keep together and Keep apart controls, the state
 * counts, the CSV headers -- in the forms the language inflects them into:
 * Indonesian changes a root under a prefix, so `pisah` is `terpisah`,
 * `dipisahkan`, `memisahkan` and `pemisahan`. The pin has no control yet, so
 * its one word per locale was approved on #319 itself, and any future pin
 * control is held to it. Changing an entry needs a fresh operator read, like
 * every pinned value.
 *
 * `mix` and `leftovers` (#390) take their words from those features' own
 * controls, `sexMixLabel` and `leftoversLabel`. Each control was correct in
 * every locale while the copy describing it was not. zh 平均 and th เท่ากัน
 * ("evenly") and vi cân bằng ("balanced") are how each locale's
 * "Mix boys and girls evenly" control says it. Leftovers are the students
 * left over, never the bare word for "left", which also names leftover food:
 * zh 剩余, vi còn lại and th นักเรียน…เหลือ, where the student is in the word.
 * `sound` takes the Sound on control's word, and `classList` the words of
 * the Class list print option, pinned on #161 in th. `gloryPoints`, `bean`
 * and `coin` are the operator's 2026-09-30 decision, which id already kept:
 * YeeTalk's names in English, the coin in the page's language.
 */
const GLOSSARY: Record<Exclude<Locale, 'en'>, Glossary> = {
  id: {
    pin: ['kunci'],
    together: ['bersama', 'disatukan', 'menyatukan'],
    apart: [
      'terpisah',
      'dipisahkan',
      'memisahkan',
      'pemisahan',
      'jangan bersama',
    ],
    absent: ['tidak hadir', 'ketidakhadiran'],
    group: ['kelompok', 'pengelompokan'],
    mix: ['campur'],
    leftovers: ['tersisa', 'sisa dalam'],
    sound: ['suara'],
    classList: ['daftar kelas'],
    gloryPoints: ['glory point'],
    bean: ['bean'],
    coin: ['koin'],
  },
  zh: {
    pin: ['固定'],
    together: ['一起', '同组'],
    apart: ['分开'],
    absent: ['缺席'],
    group: ['组'],
    mix: ['平均'],
    leftovers: ['剩余'],
    sound: ['声音'],
    classList: ['班级名单'],
    gloryPoints: ['glory point'],
    bean: ['bean'],
    coin: ['金币'],
  },
  vi: {
    pin: ['ghim'],
    together: ['cùng nhau', 'cùng nhóm'],
    apart: ['tách biệt', 'khác nhóm'],
    absent: ['vắng mặt'],
    group: ['nhóm'],
    mix: ['cân bằng'],
    leftovers: ['còn học sinh', 'học sinh còn lại'],
    sound: ['âm thanh'],
    classList: ['danh sách lớp'],
    gloryPoints: ['glory point'],
    bean: ['bean'],
    coin: ['xu'],
  },
  th: {
    pin: ['ปักหมุด'],
    together: ['ด้วยกัน', 'กลุ่มเดียวกัน'],
    apart: ['แยก', 'คนละกลุ่ม'],
    absent: ['ไม่มา', 'ขาด'],
    group: ['กลุ่ม'],
    mix: ['เท่ากัน'],
    leftovers: ['นักเรียนเหลือ', 'นักเรียนที่เหลือ'],
    sound: ['เสียง'],
    classList: ['รายชื่อชั้น', 'รายชื่อนักเรียน'],
    gloryPoints: ['glory point'],
    bean: ['bean'],
    coin: ['เหรียญ'],
  },
};

const glossaryOf = (locale: Locale): Glossary => {
  if (locale === 'en')
    throw new Error('English is the source, so it has no glossary to hold');
  return GLOSSARY[locale];
};

const FEATURES = Object.keys(FEATURE_TERMS) as FeatureTerm[];

const unit = (
  key: string,
  english: string,
  translation: string,
): BackTranslationUnit => ({ key, english, translation });

/** A glossary approving one word per feature, for the fixtures below. */
const ONE_WORD: Glossary = {
  pin: ['ghim'],
  together: ['cùng nhau'],
  apart: ['tách biệt'],
  absent: ['vắng mặt'],
  group: ['nhóm'],
  mix: ['cân bằng'],
  leftovers: ['học sinh còn lại'],
  sound: ['âm thanh'],
  classList: ['danh sách lớp'],
  gloryPoints: ['glory point'],
  bean: ['bean'],
  coin: ['xu'],
};

/** What zh `warnings.PINNED_MIXED_SEX` said until #319. */
const PINNED_MIXED_SEX_ZH_BEFORE =
  '{names} 被归为一组，但组内成员并非全为同一性别，因此该组并未像其他组那样按性别划分。这正是该标签的要求，并非需要更正的错误。';

describe('featuresNamed: the features a piece of English copy names', () => {
  it.each<[string, FeatureTerm[]]>([
    ['Unpin a group, or ask for more groups.', ['pin', 'group']],
    ['Your pins already fill the groups you asked for.', ['pin', 'group']],
    ['{names} are pinned together as one group.', ['pin', 'together', 'group']],
    ['Pinning a group keeps it as it is.', ['pin', 'group']],
    ['There are too many together-letters here.', ['together']],
    ['{names} all need to be kept apart.', ['apart']],
    ['Mark absences and pairings in Student details.', ['absent']],
    ['Show students who are absent', ['absent']],
    ['Grouping options', ['group']],
    [
      '{grouped} of {typed} grouped — numbers {absent} are absent.',
      ['absent', 'group'],
    ],
    ['Mix boys and girls evenly', ['mix']],
    ['mixed by sex', ['mix']],
    ['If students are left over', ['leftovers']],
    ['leftovers in one group', ['group', 'leftovers']],
    ['Sound off', ['sound']],
    ['Your class list is still here.', ['classList']],
  ])('%j names %j', (english, named) => {
    expect(featuresNamed(english)).toEqual(named);
  });

  it.each([
    // A slot is a placeholder the page fills, not a word the copy uses.
    '{absent} of {typed}',
    // "keeping" holds the letters p-i-n, and is not a pin.
    'Keep everyone apartment-free while keeping score.',
    'Spin the wheel at the pinnacle.',
    'He left absently.',
    // "mixture" holds m-i-x, and a dough left overnight is not a leftover.
    'A mixture of flour and water, left overnight.',
  ])('%j names no feature', (english) => {
    expect(featuresNamed(english)).toEqual([]);
  });
});

describe('checkFeatureTerms: copy against the words its locale approved', () => {
  it('copy carrying an approved word for every feature it names passes', () => {
    const copy = unit(
      'errors.PINNED_APART_CLASH',
      '{names} are to be kept apart, but a pinned group puts them in one group.',
      '{names} cần được tách biệt, nhưng một nhóm được ghim lại xếp các em vào cùng một nhóm.',
    );
    expect(checkFeatureTerms([copy], 'vi', ONE_WORD)).toEqual([]);
  });

  it('copy naming a feature with none of its approved words is returned, naming the feature', () => {
    const copy = unit(
      'warnings.PINNED_MIXED_SEX',
      'That is what the pin asked for, not a mistake to fix.',
      'Đó chính là yêu cầu trong bài đăng, không phải lỗi cần sửa.',
    );
    expect(checkFeatureTerms([copy], 'vi', ONE_WORD)).toEqual([
      { ...copy, missing: ['pin'] },
    ]);
  });

  it("any one of a feature's approved words is enough", () => {
    const glossary: Glossary = {
      ...ONE_WORD,
      apart: ['tách biệt', 'khác nhóm'],
    };
    const control = unit(
      'a',
      'Keep these two apart',
      'Xếp hai em này khác nhóm',
    );
    const column = unit(
      'b',
      'Mark who is kept apart',
      'Đánh dấu ai được tách biệt',
    );
    expect(checkFeatureTerms([control, column], 'vi', glossary)).toEqual([]);
  });

  it('each feature is judged on its own: carrying one does not excuse another', () => {
    const copy = unit(
      'errors.BOTH_RULES_SEARCH_GAVE_UP',
      'There are too many together- and apart-letters here.',
      'Có quá nhiều chữ cái cùng nhau và chữ cái tách chữ ở đây.',
    );
    expect(
      checkFeatureTerms([copy], 'vi', ONE_WORD).map(({ missing }) => missing),
    ).toEqual([['apart']]);
  });

  it('names every missing feature, in the order the features are declared', () => {
    const copy = unit(
      'warnings.PINNED_MIXED_SEX',
      '{names} are pinned together as one group.',
      '{names} được xếp lại thành một bài đăng.',
    );
    expect(
      checkFeatureTerms([copy], 'vi', ONE_WORD).map(({ missing }) => missing),
    ).toEqual([['pin', 'together', 'group']]);
  });

  it('copy whose English names no feature is never returned, whatever its rendering', () => {
    const copy = unit('title', 'Classroom tools', 'bài đăng');
    expect(checkFeatureTerms([copy], 'vi', ONE_WORD)).toEqual([]);
  });

  it('an approved word must appear whole: cùng is not cùng nhau', () => {
    const copy = unit('x', 'Keep them together', 'Xếp các em cùng một chỗ');
    expect(
      checkFeatureTerms([copy], 'vi', ONE_WORD).map(({ missing }) => missing),
    ).toEqual([['together']]);
  });

  it('an approved word that punctuation splits needs every one of its parts', () => {
    // As in `checkLabels`: `按……划分` is two parts, and a witness carries both.
    const split: Glossary = { ...ONE_WORD, together: ['cùng…nhau'] };
    const both = unit(
      'a',
      'Keep them together',
      'Xếp các em cùng nhóm với nhau',
    );
    const one = unit('b', 'Keep them together', 'Xếp các em cùng nhóm');
    expect(
      checkFeatureTerms([both, one], 'vi', split).map(({ key }) => key),
    ).toEqual(['b']);
  });

  it('neither letter case nor Unicode composition decides it', () => {
    const copy = unit('x', 'Kept apart', 'Được TÁCH BIỆT'.normalize('NFD'));
    expect(checkFeatureTerms([copy], 'vi', ONE_WORD)).toEqual([]);
    const decomposed: Glossary = {
      ...ONE_WORD,
      apart: ['tách biệt'.normalize('NFD')],
    };
    expect(
      checkFeatureTerms(
        [unit('y', 'Kept apart', 'Được tách biệt')],
        'vi',
        decomposed,
      ),
    ).toEqual([]);
  });

  it('a slot in the rendering carries no word, even one spelled like an approved word', () => {
    const copy = unit('x', 'Unpin {name}', 'Bỏ {ghim}');
    expect(
      checkFeatureTerms([copy], 'vi', ONE_WORD).map(({ missing }) => missing),
    ).toEqual([['pin']]);
  });

  it('an approved word left with no letters approves nothing', () => {
    const copy = unit('x', 'Unpin it', '… anything at all');
    const hollow: Glossary = { ...ONE_WORD, pin: ['…'] };
    expect(
      checkFeatureTerms([copy], 'vi', hollow).map(({ missing }) => missing),
    ).toEqual([['pin']]);
  });

  it('a label is held to the same words as a sentence', () => {
    const label = unit('printWhatGroups', 'Group results', '集团业绩');
    expect(
      checkFeatureTerms([label], 'zh', GLOSSARY.zh).map(({ key, missing }) => [
        key,
        missing,
      ]),
    ).toEqual([['printWhatGroups', ['group']]]);
  });

  it('Chinese and Thai are searched without word breaks: 固定 inside 取消固定 counts', () => {
    expect(
      checkFeatureTerms(
        [unit('zh', 'Unpin that group', '请取消固定那个组')],
        'zh',
        GLOSSARY.zh,
      ),
    ).toEqual([]);
    expect(
      checkFeatureTerms(
        [unit('th', 'Unpin that group', 'เลิกปักหมุดกลุ่มนั้น')],
        'th',
        GLOSSARY.th,
      ),
    ).toEqual([]);
  });
});

describe('on the live catalogues', () => {
  const naming = (units: readonly BackTranslationUnit[]) =>
    units.filter(({ english }) => featuresNamed(english).length > 0);
  // One id per locale: each case runs the same line over its own catalogue.
  const NAMING_FLOOR: Readonly<Record<string, string>> = {
    id: 'feature-terms/naming-units-id',
    zh: 'feature-terms/naming-units-zh',
    vi: 'feature-terms/naming-units-vi',
    th: 'feature-terms/naming-units-th',
  };
  const APPROVED_FLOOR: Readonly<Record<string, string>> = {
    id: 'feature-terms/approved-words-id',
    zh: 'feature-terms/approved-words-zh',
    vi: 'feature-terms/approved-words-vi',
    th: 'feature-terms/approved-words-th',
  };

  it.each(TRANSLATED_LOCALES)(
    '%s: every piece of copy that names a feature carries an approved word for it',
    (locale) => {
      const units = backTranslationUnits(locale);
      const misses = checkFeatureTerms(units, locale, glossaryOf(locale));
      const named = naming(units);
      expect(
        searched(
          misses.map(({ key, missing }) => `${key}: ${missing.join(', ')}`),
          { of: named, what: `${locale} copy naming a feature` },
        ),
      ).toEqual([]);
      expect(floorBreach(NAMING_FLOOR[locale], named.length)).toBeUndefined();
    },
  );

  it.each(TRANSLATED_LOCALES)(
    '%s: every feature is named somewhere, so every entry of its glossary is exercised',
    (locale) => {
      const units = backTranslationUnits(locale);
      for (const feature of FEATURES)
        nonEmpty(
          units.filter(({ english }) =>
            featuresNamed(english).includes(feature),
          ),
          `${locale} copy naming "${feature}"`,
        );
    },
  );

  it.each(TRANSLATED_LOCALES)(
    '%s: every approved word is in use, so none is a typo or a stale approval',
    (locale) => {
      const renderings = backTranslationUnits(locale).map(({ translation }) =>
        wordsOf(translation, locale),
      );
      const unused = FEATURES.flatMap((feature) =>
        glossaryOf(locale)[feature].filter((word) => {
          const parts = partsOf(word, locale);
          return !renderings.some((text) =>
            parts.every((part) => text.includes(part)),
          );
        }),
      );
      const approved = FEATURES.flatMap(
        (feature) => glossaryOf(locale)[feature],
      );
      expect(
        searched(unused, {
          of: approved,
          what: `${locale} approved words`,
        }),
      ).toEqual([]);
      expect(
        floorBreach(APPROVED_FLOOR[locale], approved.length),
      ).toBeUndefined();
    },
  );

  it.each(TRANSLATED_LOCALES)(
    '%s: the pin has exactly one approved word (AC2)',
    (locale) => {
      expect(glossaryOf(locale).pin).toHaveLength(1);
    },
  );

  it('zh PINNED_MIXED_SEX seeded back to "the tag" is flagged for the pin', () => {
    const units = backTranslationUnits('zh');
    const seeded = units.map((one) =>
      one.key === 'warnings.PINNED_MIXED_SEX'
        ? { ...one, translation: PINNED_MIXED_SEX_ZH_BEFORE }
        : one,
    );
    // Watch the seed apply: exactly one unit differs, and it is this one.
    expect(
      seeded.filter((one, index) => one !== units[index]).map(({ key }) => key),
    ).toEqual(['warnings.PINNED_MIXED_SEX']);

    const verdict = checkFeatureTerms(seeded, 'zh', GLOSSARY.zh).find(
      ({ key }) => key === 'warnings.PINNED_MIXED_SEX',
    );
    expect(verdict?.missing).toContain('pin');
  });

  it.each<[string, string, string, FeatureTerm]>([
    ['zh', 'soundOff', '畅所欲言', 'sound'],
    ['vi', 'soundOff', 'Hãy lên tiếng', 'sound'],
    ['th', 'soundOff', 'แสดงความคิดเห็น', 'sound'],
    [
      'zh',
      'privacy',
      '所有操作都在您的浏览器中完成。课程列表绝不会离开此页面。',
      'classList',
    ],
    ['zh', 'stateBunched', '一组剩菜', 'leftovers'],
    ['th', 'stateMixed', 'แบ่งตามเพศ', 'mix'],
    [
      'vi',
      'site.glory.howToSteps[0]',
      'Hãy nhập số điểm vinh quang mà bạn muốn đạt được vào ô bên dưới.',
      'gloryPoints',
    ],
    [
      'th',
      'site.glory.assumptions',
      'สมมติว่า 1 คะแนนเท่ากับ 1 เหรียญ, 0.9 เหรียญต่อถั่ว และของขวัญจะถูกแปลงเป็นถั่วในอัตรา 40%',
      'bean',
    ],
    [
      'zh',
      'site.glory.howToSteps[2]',
      '请准确读出达到该目标所需的硬币、豆子以及礼物总价值。',
      'coin',
    ],
  ])(
    '%s %s seeded back to what #390 corrected is flagged for %s',
    (locale, key, before, feature) => {
      const units = backTranslationUnits(locale as Locale);
      const seeded = units.map((one) =>
        one.key === key ? { ...one, translation: before } : one,
      );
      // Watch the seed apply: exactly one unit differs, and it is this one.
      expect(
        seeded
          .filter((one, index) => one !== units[index])
          .map((one) => one.key),
      ).toEqual([key]);
      const verdict = checkFeatureTerms(
        seeded,
        locale as Locale,
        glossaryOf(locale as Locale),
      ).find((one) => one.key === key);
      expect(verdict?.missing).toContain(feature);
    },
  );

  it('the corrected zh PINNED_MIXED_SEX is not flagged, and says 固定', () => {
    const units = backTranslationUnits('zh');
    const corrected = nonEmpty(
      units.filter(({ key }) => key === 'warnings.PINNED_MIXED_SEX'),
      'zh warnings.PINNED_MIXED_SEX',
    );
    expect(corrected.map(({ translation }) => translation)).not.toContain(
      PINNED_MIXED_SEX_ZH_BEFORE,
    );
    expect(
      corrected.every(({ translation }) => translation.includes('固定')),
    ).toBe(true);
    expect(
      checkFeatureTerms(corrected, 'zh', GLOSSARY.zh).map(({ key }) => key),
    ).toEqual([]);
  });
});
