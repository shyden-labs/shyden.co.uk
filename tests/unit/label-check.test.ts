import { describe, it, expect } from 'vitest';
import { nonEmpty, searched } from '../source-files';
import { floorBreach } from '../floors';
import {
  backTranslationUnits,
  type BackTranslationUnit,
  TRANSLATED_LOCALES,
} from '../../src/lib/i18n/back-translate';
import {
  checkLabels,
  checkNamedLabels,
  renderedOn,
} from '../../src/lib/i18n/label-check';

/**
 * A short label, cross-checked against how its own locale renders the same
 * English elsewhere (#161).
 *
 * `vi.rosterColSex` held `Tình dục` -- sexual intercourse -- as a column
 * heading for a month while four Vietnamese sentences said `giới tính` for
 * the same word. A bare label carries no context, so the engine picked the
 * wrong sense; the sentences around it had context and got it right. Reading
 * the label back into English cannot see this, because the wrong sense reads
 * back as the same ambiguous word (#95 measured it: 100 before the fix, 9
 * after). The locale's own sentences can.
 */

const unit = (
  key: string,
  english: string,
  translation: string,
): BackTranslationUnit => ({ key, english, translation });

const SEX_SENTENCE = unit(
  'modeHintSex',
  'Mix the groups by sex so each one is balanced',
  'Trộn các nhóm theo giới tính để mỗi nhóm cân bằng',
);

describe('checkLabels: a label against the rest of its locale', () => {
  it('a label its own sentences use agrees', () => {
    const label = unit('rosterColSex', 'Sex', 'Giới tính');

    expect(checkLabels([label, SEX_SENTENCE], 'vi')).toEqual([
      { ...label, status: 'agrees', witnesses: [SEX_SENTENCE], variants: [] },
    ]);
  });

  it('a label its own sentences never use is flagged, with those sentences', () => {
    const label = unit('rosterColSex', 'Sex', 'Tình dục');

    expect(checkLabels([label, SEX_SENTENCE], 'vi')).toEqual([
      {
        ...label,
        status: 'disagrees',
        witnesses: [SEX_SENTENCE],
        variants: [],
      },
    ]);
  });

  it('a label no other copy uses is unchecked, never agreed', () => {
    const label = unit('rosterColAbsent', 'Absent', 'Vắng mặt');

    expect(checkLabels([label, SEX_SENTENCE], 'vi')).toEqual([
      { ...label, status: 'unchecked', witnesses: [], variants: [] },
    ]);
  });

  it("finds the label's English as a whole word, so Sex is not in Essex", () => {
    const label = unit('rosterColSex', 'Sex', 'Tình dục');
    const essex = unit(
      'schoolHint',
      'Schools in Essex use this every week',
      'Các trường ở Essex dùng cái này mỗi tuần',
    );

    expect(checkLabels([label, essex], 'vi')).toEqual([
      { ...label, status: 'unchecked', witnesses: [], variants: [] },
    ]);
  });

  it.each([
    [
      'groups',
      unit('groupColumn', 'Group', 'Nhóm'),
      unit(
        'howTo',
        'Make four groups from the class list',
        'Tạo bốn nhóm từ danh sách lớp',
      ),
    ],
    [
      'sexes',
      unit('rosterColSex', 'Sex', 'Giới tính'),
      unit(
        'mixHint',
        'Keep both sexes in every group',
        'Giữ cả hai giới tính trong mỗi nhóm',
      ),
    ],
  ])(
    'a plural in the sentence (%s) still uses the label word',
    (_plural, label, sentence) => {
      expect(checkLabels([label, sentence], 'vi')).toEqual([
        { ...label, status: 'agrees', witnesses: [sentence], variants: [] },
      ]);
    },
  );

  it('neither letter case nor Unicode composition decides agreement', () => {
    const label = unit('rosterColSex', 'SEX', 'Giới tính');
    const decomposed = 'trộn các nhóm theo giới tính'.normalize('NFD');
    const sentence = unit(
      'modeHintSex',
      'Mix the groups by sex so each one is balanced',
      decomposed,
    );
    // The control: without normalising, the sentence does not contain the
    // label, so an agreement below can only come from the normalisation.
    expect(decomposed.includes('giới tính')).toBe(false);

    expect(checkLabels([label, sentence], 'vi')).toEqual([
      { ...label, status: 'agrees', witnesses: [sentence], variants: [] },
    ]);
  });

  it('slots and punctuation separate the words compared, on both sides', () => {
    const splitBy = unit('modeLabel', 'Split by', '按……划分');
    const apart = unit('stateApart', '{n} apart', '{n} 分开');
    const sentence = unit(
      'warnings.APART',
      '{names} are kept apart, so the group is not split by sex',
      '{names} 被分开，因此该组没有按性别划分',
    );

    expect(checkLabels([splitBy, apart, sentence], 'zh')).toEqual([
      { ...splitBy, status: 'agrees', witnesses: [sentence], variants: [] },
      { ...apart, status: 'agrees', witnesses: [sentence], variants: [] },
    ]);
  });

  it('every part of the label must appear in one piece of copy', () => {
    const label = unit('modeLabel', 'Split by', '按……划分');
    const first = unit(
      'a',
      'Groups are split by size first',
      '小组首先按大小排列',
    );
    const second = unit(
      'b',
      'Nothing here is split by sex',
      '这里没有任何划分',
    );

    expect(checkLabels([label, first, second], 'zh')).toEqual([
      {
        ...label,
        status: 'disagrees',
        witnesses: [first, second],
        variants: [],
      },
    ]);
  });

  it('a label whose rendering lost its words agrees with nothing', () => {
    // `[].every(...)` is true: without a guard, a translation that kept only
    // its slot would agree with every witness it has.
    const label = unit('stateNamed', '{n} named', '{n}');
    const sentence = unit(
      'namedHint',
      'Pupils are named in the order you typed them',
      'Học sinh được đặt tên theo thứ tự bạn đã nhập',
    );

    expect(checkLabels([label, sentence], 'vi')).toEqual([
      { ...label, status: 'disagrees', witnesses: [sentence], variants: [] },
    ]);
  });

  it('copy with no English words has nothing to look for, so no witnesses', () => {
    // An empty pattern would match the lone `s` a possessive leaves once its
    // apostrophe is gone ("pupil's" is "pupil s"), so it has to be refused.
    const count = unit('count', '{n}', '{n} học sinh');
    const sentence = unit(
      'nameHint',
      "Each pupil's name goes on its own line",
      'Tên của mỗi học sinh nằm trên một dòng riêng',
    );

    expect(checkLabels([count, sentence], 'vi')).toEqual([
      { ...count, status: 'unchecked', witnesses: [], variants: [] },
    ]);
  });

  it('a longer label is a witness: "Exit full screen" judges "Full screen"', () => {
    const open = unit('boardOpen', 'Full screen', 'หน้าจอเต็ม');
    const exit = unit('boardExit', 'Exit full screen', 'ปิดโหมดเต็มหน้าจอ');

    expect(checkLabels([open, exit], 'th')).toEqual([
      { ...open, status: 'disagrees', witnesses: [exit], variants: [] },
      { ...exit, status: 'unchecked', witnesses: [], variants: [] },
    ]);
  });

  it('copy with the same English is no witness, so two copies of one wrong rendering cannot vouch for each other', () => {
    // One engine call rendered both from the same bare source, so they agree
    // by construction. Before #252, the CSV header repeated `Tình dục`.
    const button = unit('again', 'Shuffle again', '再次洗牌');
    const board = unit('boardShuffle', 'Shuffle again', '再次洗牌');
    const sentence = unit(
      'staleRefuseExport',
      'These groups are out of date. Shuffle again before you save them.',
      '这些组已过时。保存前请重新打乱顺序。',
    );

    expect(checkLabels([button, board, sentence], 'zh')).toEqual([
      { ...button, status: 'disagrees', witnesses: [sentence], variants: [] },
      { ...board, status: 'disagrees', witnesses: [sentence], variants: [] },
    ]);
  });

  it('copy with the same English rendered in other words is a variant: a roster and a CSV naming one column two ways', () => {
    const roster = unit('rosterColName', 'Name', '姓名');
    const csv = unit('csv.columns.name', 'name', '名称');

    expect(checkLabels([roster, csv], 'zh')).toEqual([
      { ...roster, status: 'unchecked', witnesses: [], variants: [csv] },
      { ...csv, status: 'unchecked', witnesses: [], variants: [roster] },
    ]);
  });

  it('copy with the same English is no variant when one rendering holds the other', () => {
    // One way only: `第 {n} 组` holds `组`, and `组` does not hold `第`.
    const column = unit('csv.groupColumn', 'Group', '组');
    const heading = unit('groupLabel', 'Group {n}', '第 {n} 组');

    expect(checkLabels([column, heading], 'zh')).toEqual([
      { ...column, status: 'unchecked', witnesses: [], variants: [] },
      { ...heading, status: 'unchecked', witnesses: [], variants: [] },
    ]);
  });

  it('judges copy of three lettered words or fewer, slots not counted, and nothing longer', () => {
    const three = unit('modeGroupCount', 'Number of groups', '组数');
    const slotted = unit(
      'groupLabel',
      'Group {n} of {total}',
      '第 {n} 组，共 {total} 组',
    );
    const four = unit('modeHint', 'Number of groups wanted', '想要的组数');

    expect(
      checkLabels([three, slotted, four], 'zh').map(({ key }) => key),
    ).toEqual(['modeGroupCount', 'groupLabel']);
  });
});

describe('checkNamedLabels: a sentence that names a label, held to it', () => {
  const heading = unit('sectionStudentsHeading', 'Student details', '学生信息');
  const naming = (translation: string) =>
    unit(
      'studentsLockedReason',
      'Set by your list. Add or remove students in Student details to change it.',
      translation,
    );

  it("a sentence naming a heading in the heading's own words carries it", () => {
    const sentence = naming('如需修改，请在“学生信息”中添加或移除学生。');
    expect(checkNamedLabels([heading, sentence], 'zh')).toEqual([
      { sentence, labels: [heading], carried: true },
    ]);
  });

  it('a sentence naming it in other words does not, whatever else agrees', () => {
    // #390: zh told teachers to open 学生详情 six times beside a heading
    // reading 学生信息. One sentence using the heading's word was enough for
    // `checkLabels` to call the label agreed.
    const other = naming('如需修改，请在“学生详情”中添加或移除学生。');
    const agreeing = unit(
      'rosterAtLimitMessage',
      'Student details holds up to {max} students. Remove a student to add another.',
      '“学生信息”最多可容纳 {max} 名学生。',
    );
    expect(
      checkNamedLabels([heading, other, agreeing], 'zh').map(
        ({ sentence, carried }) => [sentence.key, carried],
      ),
    ).toEqual([
      ['studentsLockedReason', false],
      ['rosterAtLimitMessage', true],
    ]);
  });

  it('a capital marks a name: the common words of a label name nothing', () => {
    const list = unit('printWhatClassList', 'Class list', '班级名单');
    const common = unit(
      'ioHandoverNotOffered',
      'No class list arrived. Go back to the other tab and try again.',
      '没有收到名单。',
    );
    // What the check walks: the label unit and the sentence that holds its
    // common words.
    const units = [list, common];
    expect(
      searched(checkNamedLabels(units, 'zh'), { of: units, what: 'units' }),
    ).toEqual([]);
    expect(
      floorBreach('label-check/common-words-units', units.length),
    ).toBeUndefined();
  });

  // #403. English capitalises a language's name wherever it stands, so the
  // capital that marks a label marks nothing there: "the Indonesian
  // archipelago" names a place, not the CSV option reading "Indonesian". A
  // control is held beside it, so a reader blind to every one-word label
  // cannot pass this.
  it("a language's name is grammar, not a label, while a control is still named", () => {
    const indonesian = unit('csvLanguageVersion.id', 'Indonesian', '印尼语');
    const calculate = unit('site.glory.calculate', 'Calculate', '计算');
    const journey = unit(
      'site.home.yaweloIdleBody',
      'Journey across the Indonesian archipelago, then select Calculate.',
      '穿越印度尼西亚群岛，然后选择“计算”。',
    );
    expect(
      checkNamedLabels([indonesian, calculate, journey], 'zh').map(
        ({ labels }) => labels.map(({ key }) => key),
      ),
    ).toEqual([['site.glory.calculate']]);
  });

  it('a one-word label is named mid-sentence, never by the capital that starts one', () => {
    const calculate = unit('site.glory.calculate', 'Calculate', '计算');
    const named = unit(
      'site.glory.howToSteps[1]',
      'Select Calculate — or press Enter.',
      '选择“计算”——或按 Enter 键。',
    );
    const opening = unit(
      'site.glory.lead',
      'Calculate the coins you need.',
      '算出所需金币。',
    );
    expect(
      checkNamedLabels([calculate, named, opening], 'zh').map(
        ({ sentence }) => sentence.key,
      ),
    ).toEqual(['site.glory.howToSteps[1]']);
  });

  it('a label inside a longer label the sentence names belongs to the longer one', () => {
    const make = unit('makeGroups', 'Make Groups', 'Tạo nhóm');
    const groups = unit('printGroupsHeading', 'Groups', 'Các nhóm');
    const press = unit(
      'howToSteps[2]',
      'Press Make Groups.',
      'Nhấn vào “Tạo nhóm”.',
    );
    expect(checkNamedLabels([make, groups, press], 'vi')).toEqual([
      { sentence: press, labels: [make], carried: true },
    ]);
  });

  it('labels sharing an English are one name: carrying any rendering of it is enough', () => {
    // The sentence carries the SECOND label's rendering only, so a check that
    // read the first alone would call it a miss.
    const again = unit('again', 'Shuffle again', '重新洗牌');
    const board = unit('boardShuffle', 'Shuffle again', '再洗一次');
    const refusal = unit(
      'staleRefusePrint',
      'These groups are out of date. Shuffle again before printing them.',
      '这些分组已经过时了。打印前请再洗一次。',
    );
    expect(checkNamedLabels([again, board, refusal], 'zh')).toEqual([
      { sentence: refusal, labels: [again, board], carried: true },
    ]);
  });
});

describe('renderedOn: where a label is read', () => {
  it.each([
    ['rosterColSex', '/classroom-groups'],
    ['warnings.SEX_SPILLOVER [sex=M]', '/classroom-groups'],
    ['site.home.workGloryTitle', '/'],
    ['site.glory.heading', '/glory-points'],
    ['site.notFound.heading', 'the 404 page'],
    ['site.nav.home', 'the header or footer of every page'],
    ['csv.columns.sex', 'the CSV file a teacher downloads'],
  ])('%s is read on %s', (key, where) => {
    expect(renderedOn(key)).toBe(where);
  });

  it('refuses a site section it has no page for, naming it', () => {
    expect(() => renderedOn('site.nowhere.heading')).toThrow(/nowhere/);
  });
});

describe('on the live catalogues', () => {
  const live = () => backTranslationUnits('vi');
  const verdictOn = (units: readonly BackTranslationUnit[], key: string) =>
    nonEmpty(checkLabels(units, 'vi'), 'vi labels').find(
      (label) => label.key === key,
    );

  it('vi rosterColSex seeded back to Tình dục is flagged against the prose saying giới tính', () => {
    const units = live();
    const seeded = units.map((one) =>
      one.key === 'rosterColSex' ? { ...one, translation: 'Tình dục' } : one,
    );
    // Watch the seed apply: exactly one unit differs, and it is this one.
    expect(
      seeded.filter((one, index) => one !== units[index]).map(({ key }) => key),
    ).toEqual(['rosterColSex']);

    const verdict = verdictOn(seeded, 'rosterColSex');

    expect(verdict?.status).toBe('disagrees');
    expect(
      verdict?.witnesses.filter(({ translation }) =>
        translation.toLocaleLowerCase('vi').includes('giới tính'),
      ).length,
    ).toBeGreaterThan(0);
  });

  it('the value the operator approved, Giới tính, is not flagged', () => {
    expect(verdictOn(live(), 'rosterColSex')).toMatchObject({
      translation: 'Giới tính',
      status: 'agrees',
      variants: [],
    });
  });

  // #390. A teacher told to open a section, or press a button, looks for the
  // words the sentence gives; the page shows the label's. Eighteen sentences
  // named Student details one way beside a heading saying another, and four
  // named Shuffle again in other words, in zh, vi and th.
  //
  // One floor per locale (#525), spelled as literals so the recorder can read
  // each id. A locale with no entry reads an id nobody recorded, and its case
  // goes red under its own name.
  const NAMED_LABEL_FLOOR: Readonly<Record<string, string>> = {
    id: 'label-check/named-labels-id',
    zh: 'label-check/named-labels-zh',
    vi: 'label-check/named-labels-vi',
    th: 'label-check/named-labels-th',
  };
  it.each(TRANSLATED_LOCALES)(
    '%s: every sentence that names a label carries that label',
    (locale) => {
      const verdicts = checkNamedLabels(backTranslationUnits(locale), locale);
      expect(
        searched(
          verdicts
            .filter(({ carried }) => !carried)
            .map(
              ({ sentence, labels }) =>
                `${sentence.key} names ${labels.map(({ key }) => key).join('/')}`,
            ),
          { of: verdicts, what: `${locale} sentences naming a label` },
        ),
      ).toEqual([]);
      expect(
        floorBreach(NAMED_LABEL_FLOOR[locale], verdicts.length),
      ).toBeUndefined();
    },
  );
});
