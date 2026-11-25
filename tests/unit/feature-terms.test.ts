import { describe, it, expect } from 'vitest';
import { nonEmpty, searched } from '../source-files';
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
 * The pin warning (removed with the pinned path, #390 F20) explained a
 * warning a teacher had just been shown: "that is what the pin asked for, not
 * a mistake to fix". zh said
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
 * `dipisahkan`, `memisahkan` and `pemisahan`. Changing an entry needs a fresh
 * operator read, like
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

/**
 * The features each unit's English names: what `checkFeatureTerms` weighs the
 * rendering against, so what a clean verdict on those units was reached over.
 */
const featuresNamedIn = (
  units: readonly BackTranslationUnit[],
): FeatureTerm[] => units.flatMap(({ english }) => featuresNamed(english));

/** A glossary approving one word per feature, for the fixtures below. */
const ONE_WORD: Glossary = {
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

describe('featuresNamed: the features a piece of English copy names', () => {
  it.each<[string, FeatureTerm[]]>([
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
    // Words that merely hold a feature's letters name no feature.
    'Keep everyone apartment-free while keeping score.',
    'Spin the wheel at the pinnacle.',
    'He left absently.',
    // "mixture" holds m-i-x, and a dough left overnight is not a leftover.
    'A mixture of flour and water, left overnight.',
  ])('%j names no feature', (english) => {
    // `featuresNamed` tests the copy against every feature; those are the
    // units it walks, the same for every case.
    expect(
      searched(featuresNamed(english), { of: FEATURES, what: 'features' }),
    ).toEqual([]);
  });
});

describe('checkFeatureTerms: copy against the words its locale approved', () => {
  it('copy carrying an approved word for every feature it names passes', () => {
    const copy = unit(
      'rosterClashMessage',
      '{names} are to be kept apart, but they are in one group.',
      '{names} cần được tách biệt, nhưng các em đang ở cùng một nhóm.',
    );
    const named = featuresNamedIn([copy]);
    expect(
      searched(checkFeatureTerms([copy], 'vi', ONE_WORD), {
        of: named,
        what: 'features the copy names',
      }),
    ).toEqual([]);
  });

  it('copy naming a feature with none of its approved words is returned, naming the feature', () => {
    const copy = unit(
      'rosterAbsentConsequence',
      'A student marked absent is left out of the groups.',
      'Học sinh được đánh dấu nghỉ học sẽ không được xếp vào nhóm.',
    );
    expect(checkFeatureTerms([copy], 'vi', ONE_WORD)).toEqual([
      { ...copy, missing: ['absent'] },
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
    const named = featuresNamedIn([control, column]);
    expect(
      searched(checkFeatureTerms([control, column], 'vi', glossary), {
        of: named,
        what: 'features the copy names',
      }),
    ).toEqual([]);
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
      'groupedNote',
      '{names} are absent, so they are kept together in one group.',
      '{names} nghỉ học, nên được xếp lại thành một bài đăng.',
    );
    expect(
      checkFeatureTerms([copy], 'vi', ONE_WORD).map(({ missing }) => missing),
    ).toEqual([['together', 'absent', 'group']]);
  });

  it('copy whose English names no feature is never returned, whatever its rendering', () => {
    const copy = unit('title', 'Classroom tools', 'bài đăng');
    // The copy names nothing, so the population is the features it was tested
    // against: every one of them, and none was found.
    expect(
      searched(checkFeatureTerms([copy], 'vi', ONE_WORD), {
        of: FEATURES,
        what: 'features',
      }),
    ).toEqual([]);
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

  it('letter case does not decide it, whatever the composition', () => {
    const copy = unit('x', 'Kept apart', 'Được TÁCH BIỆT'.normalize('NFD'));
    const named = featuresNamedIn([copy]);
    expect(
      searched(checkFeatureTerms([copy], 'vi', ONE_WORD), {
        of: named,
        what: 'features the copy names',
      }),
    ).toEqual([]);
  });

  it('Unicode composition does not decide it, whatever the glossary spells', () => {
    const decomposed: Glossary = {
      ...ONE_WORD,
      apart: ['tách biệt'.normalize('NFD')],
    };
    const copy = unit('y', 'Kept apart', 'Được tách biệt');
    const named = featuresNamedIn([copy]);
    expect(
      searched(checkFeatureTerms([copy], 'vi', decomposed), {
        of: named,
        what: 'features the copy names',
      }),
    ).toEqual([]);
  });

  it('a slot in the rendering carries no word, even one spelled like an approved word', () => {
    const copy = unit('x', 'Mark {name} absent', 'Đánh dấu {vắng mặt}');
    expect(
      checkFeatureTerms([copy], 'vi', ONE_WORD).map(({ missing }) => missing),
    ).toEqual([['absent']]);
  });

  it('an approved word left with no letters approves nothing', () => {
    const copy = unit('x', 'Mark it absent', '… anything at all');
    const hollow: Glossary = { ...ONE_WORD, absent: ['…'] };
    expect(
      checkFeatureTerms([copy], 'vi', hollow).map(({ missing }) => missing),
    ).toEqual([['absent']]);
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

  it('Chinese is searched without word breaks: 一起 inside 待在一起 counts', () => {
    const copy = unit('zh', 'Keep them together', '让他们待在一起吧');
    const named = featuresNamedIn([copy]);
    expect(
      searched(checkFeatureTerms([copy], 'zh', GLOSSARY.zh), {
        of: named,
        what: 'features the copy names',
      }),
    ).toEqual([]);
  });

  it('Thai is searched without word breaks: ขาด inside ขาดเรียน counts', () => {
    const copy = unit('th', 'Mark them absent', 'ทำเครื่องหมายว่าขาดเรียน');
    const named = featuresNamedIn([copy]);
    expect(
      searched(checkFeatureTerms([copy], 'th', GLOSSARY.th), {
        of: named,
        what: 'features the copy names',
      }),
    ).toEqual([]);
  });
});

describe('on the live catalogues', () => {
  const naming = (units: readonly BackTranslationUnit[]) =>
    units.filter(({ english }) => featuresNamed(english).length > 0);

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
    },
  );

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
      'site.calculators.glory.howToSteps[0]',
      'Hãy nhập số điểm vinh quang mà bạn muốn đạt được vào ô bên dưới.',
      'gloryPoints',
    ],
    [
      'th',
      'site.calculators.glory.assumptions',
      'สมมติว่า 1 คะแนนเท่ากับ 1 เหรียญ, 0.9 เหรียญต่อถั่ว และของขวัญจะถูกแปลงเป็นถั่วในอัตรา 40%',
      'bean',
    ],
    [
      'zh',
      'site.calculators.glory.howToSteps[2]',
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
});
