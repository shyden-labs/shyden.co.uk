import { describe, expect, it } from 'vitest';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import {
  GOOGLE_ENGINE,
  approvedFirst,
  batches,
  charactersLeft,
  DAILY_CHARACTERS,
  parseLedger,
  quotaDay,
  spend,
  coverage,
  fromGoogleHtml,
  googleBody,
  googleHtml,
  googleKey,
  googleRefusal,
  googleSource,
  googleTexts,
  parseStore,
  readBackReview,
  readingPlan,
  applyVerdicts,
  verdictProblems,
  verdictReview,
  verdictRows,
  writerOf,
  type ReadBackStore,
} from '../../src/lib/i18n/read-back';

/**
 * #754. Google Cloud Translation reads every translated line back into
 * English, and the readings are saved in the repository (operator decision
 * 2026-10-15: only the laptop calls Google; a unit test with no key checks
 * that every line has a reading of its exact current text).
 *
 * Google wrote none of the copy: zh, vi and th were drafted by DeepL and then
 * corrected by hand, so a reading by Google is independent evidence where a
 * DeepL round trip would agree with itself.
 */

const KEY_FILE = '/home/someone/.config/shyden/google-translate.env';

describe('googleKey: where the key comes from', () => {
  it('takes the environment first', () => {
    expect(
      googleKey(
        { GOOGLE_TRANSLATE_API_KEY: 'from-env' },
        'GOOGLE_TRANSLATE_API_KEY=from-file\n',
        KEY_FILE,
      ),
    ).toBe('from-env');
  });

  it('falls back to the shared key file, trimmed', () => {
    expect(
      googleKey(
        {},
        '# shared by every project\nGOOGLE_TRANSLATE_API_KEY= from-file \n',
        KEY_FILE,
      ),
    ).toBe('from-file');
  });

  it('refuses a missing key, naming the file and never a key', () => {
    expect(() => googleKey({}, undefined, KEY_FILE)).toThrow(
      `no GOOGLE_TRANSLATE_API_KEY in the environment or in ${KEY_FILE}`,
    );
  });

  it('refuses a file whose key line is empty', () => {
    expect(() =>
      googleKey({}, 'GOOGLE_TRANSLATE_API_KEY=\n', KEY_FILE),
    ).toThrow(
      `no GOOGLE_TRANSLATE_API_KEY in the environment or in ${KEY_FILE}`,
    );
  });

  it('does not take a commented-out key', () => {
    expect(() =>
      googleKey({}, '# GOOGLE_TRANSLATE_API_KEY=old\n', KEY_FILE),
    ).toThrow(
      `no GOOGLE_TRANSLATE_API_KEY in the environment or in ${KEY_FILE}`,
    );
  });
});

describe('googleSource: the language Google is asked to read', () => {
  // The site ships Simplified Chinese; Google's plain `zh` is the same, but
  // `zh-CN` says so rather than leaving it to a default that could move.
  it.each([
    ['zh', 'zh-CN'],
    ['th', 'th'],
    ['vi', 'vi'],
    ['id', 'id'],
  ] as const)('%s is read as %s', (locale, source) => {
    expect(googleSource(locale)).toBe(source);
  });
});

describe('googleBody: one request', () => {
  it('reads the texts into English as HTML, where a slot can be kept', () => {
    expect(googleBody(['ด้วยกัน', 'ปักหมุด'], 'th')).toEqual({
      q: ['ด้วยกัน', 'ปักหมุด'],
      source: 'th',
      target: 'en',
      format: 'html',
    });
  });
});

describe('googleHtml and fromGoogleHtml: slots kept, not stripped', () => {
  // Stripped, a slot left a hole Google filled with an invented number:
  // zh resultsSummary came back "There are 1 group, consisting of 10
  // students" (2026-10-15). Marked translate="no", it stays where it was.
  it('marks each slot not to translate', () => {
    expect(googleHtml('置顶 {n} 个')).toBe(
      '置顶 <span translate="no">{n}</span> 个',
    );
  });

  it('escapes what HTML would read as markup', () => {
    expect(googleHtml('A & B <c> {x}')).toBe(
      'A &amp; B &lt;c&gt; <span translate="no">{x}</span>',
    );
  });

  it('takes the marks off a reading', () => {
    expect(fromGoogleHtml('Pin <span translate="no">{n}</span> items')).toBe(
      'Pin {n} items',
    );
  });

  it('decodes the entities an HTML answer carries', () => {
    expect(
      fromGoogleHtml('Don&#39;t &quot;x&quot; &amp; &lt;y&gt; &#x27;z&#8217;'),
    ).toBe(`Don't "x" & <y> 'z’`);
  });

  it('decodes once: an escaped entity stays an entity', () => {
    expect(fromGoogleHtml('&amp;lt;')).toBe('&lt;');
  });
});

describe('googleTexts: an answer, checked rather than trusted', () => {
  // The shape measured on 2026-10-15 against the live API.
  const answer = (texts: readonly string[]) => ({
    data: {
      translations: texts.map((translatedText) => ({
        translatedText,
        detectedSourceLanguage: 'th',
      })),
    },
  });

  it('returns one reading per text, in order', () => {
    expect(googleTexts(answer(['together', 'Pin']), 2)).toEqual([
      'together',
      'Pin',
    ]);
  });

  it('refuses a short answer', () => {
    expect(() => googleTexts(answer(['together']), 2)).toThrow(
      'expected 2 translations from Google, got 1',
    );
  });

  it('refuses an answer with no translations list', () => {
    expect(() => googleTexts({ data: {} }, 1)).toThrow(
      'expected data.translations to be a list of 1 { translatedText }, got undefined',
    );
  });

  it('refuses an entry that is not text', () => {
    expect(() =>
      googleTexts({ data: { translations: [{ translatedText: 7 }] } }, 1),
    ).toThrow(
      'expected data.translations to be a list of 1 { translatedText }, got [{"translatedText":7}]',
    );
  });
});

describe('googleRefusal: why Google said no', () => {
  // Measured 2026-10-15: a bad key answers 400 INVALID_ARGUMENT.
  const badKey = {
    error: {
      code: 400,
      message: 'API key not valid. Please pass a valid API key.',
      errors: [{ reason: 'badRequest' }],
      status: 'INVALID_ARGUMENT',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'API_KEY_INVALID',
        },
      ],
    },
  };
  // From Google's documentation, not measured: the quota has not been hit.
  const overQuota = {
    error: {
      code: 429,
      message:
        "Quota exceeded for quota metric 'v2 and v3 general model characters' and limit 'v2 and v3 general model characters per day'",
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'RATE_LIMIT_EXCEEDED',
        },
      ],
    },
  };

  it('names a bad key as a refusal, not the quota', () => {
    expect(googleRefusal(400, badKey)).toEqual({
      quota: false,
      message:
        'Google refused (400 INVALID_ARGUMENT): API key not valid. Please pass a valid API key.',
    });
  });

  it('names the daily quota', () => {
    expect(googleRefusal(429, overQuota)).toEqual({
      quota: true,
      message:
        "Google's daily quota is spent (429 RESOURCE_EXHAUSTED): Quota exceeded for quota metric 'v2 and v3 general model characters' and limit 'v2 and v3 general model characters per day'",
    });
  });

  it.each([
    ['status 429 alone', 429, { error: { message: 'slow down' } }],
    [
      'RESOURCE_EXHAUSTED on a 403',
      403,
      { error: { status: 'RESOURCE_EXHAUSTED', message: 'x' } },
    ],
    [
      'the v2 dailyLimitExceeded reason',
      403,
      { error: { errors: [{ reason: 'dailyLimitExceeded' }], message: 'x' } },
    ],
    [
      'the v2 userRateLimitExceeded reason',
      403,
      {
        error: { errors: [{ reason: 'userRateLimitExceeded' }], message: 'x' },
      },
    ],
  ])('counts %s as the quota', (_name, status, body) => {
    expect(googleRefusal(status, body).quota).toBe(true);
  });

  it('names an answer that is not Google JSON by its text', () => {
    expect(googleRefusal(502, '<html>Bad Gateway</html>')).toEqual({
      quota: false,
      message: 'Google refused (502): <html>Bad Gateway</html>',
    });
  });
});

describe('writerOf: who wrote a line', () => {
  const drafts = {
    th: { 'Add a student': 'เพิ่มนักเรียน', 'Pin it': 'ปักหมุดไว้' },
  };

  it('DeepL, when the line is its draft unchanged', () => {
    expect(writerOf('th', 'Add a student', 'เพิ่มนักเรียน', drafts)).toBe(
      'DeepL',
    );
  });

  it('edited after DeepL, when the line differs from its draft', () => {
    expect(writerOf('th', 'Pin it', 'ปักหมุด', drafts)).toBe(
      'edited after DeepL',
    );
  });

  it('no DeepL draft, when DeepL never saw the English', () => {
    expect(writerOf('th', 'New copy', 'ใหม่', drafts)).toBe('no DeepL draft');
  });

  it('no DeepL draft, for a locale DeepL never drafted', () => {
    expect(writerOf('vi', 'Add a student', 'Thêm học sinh', drafts)).toBe(
      'no DeepL draft',
    );
  });
});

const store = (over: Partial<ReadBackStore> = {}): ReadBackStore => ({
  engine: GOOGLE_ENGINE,
  readings: { id: {}, zh: {}, vi: {}, th: {} },
  pending: { id: [], zh: [], vi: [], th: [] },
  ...over,
});

/** A saved reading, judged `agrees`. */
const r = (english: string) => ({ english, verdict: 'agrees' as const });

describe('parseStore: the saved readings, fail-closed', () => {
  it('reads a well-formed store', () => {
    const json = {
      engine: GOOGLE_ENGINE,
      readings: {
        id: {},
        zh: { 你好: { english: 'Hello', verdict: 'agrees' } },
        vi: {},
        th: {},
      },
      pending: { id: ['a'], zh: [], vi: [], th: [] },
    };
    expect(parseStore(json)).toEqual(json);
  });

  it('refuses a store naming another engine', () => {
    expect(() => parseStore(store({ engine: 'DeepL' }))).toThrow(
      `the read-back store names engine "DeepL", expected "${GOOGLE_ENGINE}"`,
    );
  });

  it('refuses a store missing a locale', () => {
    const { th: _th, ...three } = store().readings;
    expect(() => parseStore({ ...store(), readings: three })).toThrow(
      'the read-back store has no readings for th',
    );
  });

  it.each([
    ['a reading that is not an object', 'Hello'],
    ['a reading with no English', { verdict: 'agrees' }],
    ['a verdict nobody defined', { english: 'Hello', verdict: 'fine' }],
    [
      'an ambiguous verdict with no note',
      { english: 'Hello', verdict: 'ambiguous' },
    ],
    [
      'a wrong verdict with no note',
      { english: 'Hello', verdict: 'wrong', note: ' ' },
    ],
  ])('refuses %s', (_name, reading) => {
    expect(() =>
      parseStore({
        ...store(),
        readings: { ...store().readings, zh: { 你好: reading } },
      }),
    ).toThrow('the read-back store has a zh reading it cannot use: "你好"');
  });

  it('refuses a reading that is not text', () => {
    expect(() =>
      parseStore({
        ...store(),
        readings: { ...store().readings, zh: { a: { english: 1 } } },
      }),
    ).toThrow('the read-back store has a zh reading it cannot use: "a"');
  });

  it('refuses a pending list that is not a list of keys', () => {
    expect(() =>
      parseStore({ ...store(), pending: { ...store().pending, vi: 'all' } }),
    ).toThrow('the read-back store has a vi pending list that is not keys');
  });
});

describe('coverage: every line has a reading of its exact current text', () => {
  const units = [
    { key: 'title', english: 'Title', translation: '标题' },
    { key: 'pin', english: 'Pin it', translation: '置顶 {n}' },
  ];

  it('is clean when every line is read', () => {
    const found = coverage(
      'zh',
      units,
      store({
        readings: {
          ...store().readings,
          zh: { 标题: r('Title'), '置顶 {n}': r('Pin to top') },
        },
      }),
    );
    expect(
      searched(
        [
          ...found.unreadOutsidePending,
          ...found.pendingAlreadyRead,
          ...found.stale,
        ],
        { of: units, what: 'fixture lines, every one read' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('read-back/fixture-read-lines', units.length),
    ).toBeUndefined();
  });

  it('names a line changed since its reading', () => {
    expect(
      coverage(
        'zh',
        units,
        store({ readings: { ...store().readings, zh: { 标题: r('Title') } } }),
      ).unreadOutsidePending,
    ).toEqual(['pin']);
  });

  it('accepts an unread line that is pending', () => {
    expect(
      searched(
        coverage(
          'zh',
          units,
          store({
            readings: { ...store().readings, zh: { 标题: r('Title') } },
            pending: { ...store().pending, zh: ['pin'] },
          }),
        ).unreadOutsidePending,
        { of: units, what: 'fixture lines, one pending' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('read-back/fixture-pending-lines', units.length),
    ).toBeUndefined();
  });

  it('names a pending key whose line is now read, so the list only shrinks', () => {
    expect(
      coverage(
        'zh',
        units,
        store({
          readings: {
            ...store().readings,
            zh: { 标题: r('Title'), '置顶 {n}': r('Pin to top') },
          },
          pending: { ...store().pending, zh: ['pin'] },
        }),
      ).pendingAlreadyRead,
    ).toEqual(['pin']);
  });

  it('names a pending key no line has any more', () => {
    expect(
      coverage(
        'zh',
        units,
        store({
          readings: {
            ...store().readings,
            zh: { 标题: r('Title'), '置顶 {n}': r('Pin to top') },
          },
          pending: { ...store().pending, zh: ['gone'] },
        }),
      ).pendingAlreadyRead,
    ).toEqual(['gone']);
  });

  it('names a reading no line says any more', () => {
    expect(
      coverage(
        'zh',
        units,
        store({
          readings: {
            ...store().readings,
            zh: {
              标题: r('Title'),
              '置顶 {n}': r('Pin to top'),
              旧的: r('Old'),
            },
          },
        }),
      ).stale,
    ).toEqual(['旧的']);
  });
});

describe('readingPlan: what is read, in what order', () => {
  const units = {
    id: [{ key: 'a', english: 'A thing', translation: 'Sesuatu' }],
    zh: [
      { key: 'a', english: 'A thing', translation: '东西' },
      { key: 'b', english: 'Same', translation: '东西' },
      { key: 'c', english: 'Done', translation: '完成' },
    ],
    vi: [{ key: 'a', english: 'A thing', translation: 'Một thứ' }],
    th: [{ key: 'a', english: 'A thing', translation: 'สิ่งของ' }],
  };

  it('reads approved lines first, then zh, th, id, vi, each text once', () => {
    expect(
      readingPlan(units, store(), new Set(['vi:a'])).map(
        ({ locale, text }) => `${locale}:${text}`,
      ),
    ).toEqual(['vi:Một thứ', 'zh:东西', 'zh:完成', 'th:สิ่งของ', 'id:Sesuatu']);
  });

  it('skips a text already read', () => {
    expect(
      readingPlan(
        units,
        store({ readings: { ...store().readings, zh: { 东西: r('Thing') } } }),
        new Set(),
      ).map(({ locale, text }) => `${locale}:${text}`),
    ).toEqual(['zh:完成', 'th:สิ่งของ', 'id:Sesuatu', 'vi:Một thứ']);
  });

  it('keeps a line whole, counting the characters of what is sent', () => {
    expect(
      readingPlan(
        {
          id: [],
          zh: [{ key: 'p', english: 'Pin {n}', translation: '置顶 {n} 个' }],
          vi: [],
          th: [],
        },
        store(),
        new Set(),
      ),
    ).toEqual([{ locale: 'zh', text: '置顶 {n} 个', chars: 36 }]);
  });

  it('never sends a line that is nothing but slots', () => {
    expect(
      readingPlan(
        {
          id: [],
          zh: [
            { key: 'n', english: '{names}', translation: '{names}' },
            { key: 'c', english: 'Done', translation: '完成' },
          ],
          vi: [],
          th: [],
        },
        store(),
        new Set(),
      ).map(({ text }) => text),
    ).toEqual(['完成']);
  });

  it('counts characters by code point, as Google bills them', () => {
    expect(
      readingPlan(
        {
          id: [],
          zh: [{ key: 'e', english: 'Smile', translation: '😀笑' }],
          vi: [],
          th: [],
        },
        store(),
        new Set(),
      ).map(({ chars }) => chars),
    ).toEqual([2]);
  });
});

describe('batches: requests of a bounded size, one locale each', () => {
  const item = (locale: 'zh' | 'th', text: string) => ({
    locale,
    text,
    chars: [...text].length,
  });

  it('starts a new batch when the locale changes', () => {
    expect(
      batches(
        [item('zh', 'a'), item('th', 'b'), item('zh', 'c')],
        25,
        5000,
      ).map((batch) => batch.map(({ text }) => text)),
    ).toEqual([['a'], ['b'], ['c']]);
  });

  it('starts a new batch at the text limit', () => {
    expect(
      batches([item('zh', 'a'), item('zh', 'b'), item('zh', 'c')], 2, 5000).map(
        (batch) => batch.length,
      ),
    ).toEqual([2, 1]);
  });

  it('starts a new batch at the character limit', () => {
    expect(
      batches(
        [item('zh', 'aaa'), item('zh', 'bbb'), item('zh', 'c')],
        25,
        6,
      ).map((batch) => batch.map(({ text }) => text)),
    ).toEqual([['aaa', 'bbb'], ['c']]);
  });

  it('sends a text longer than the character limit on its own', () => {
    expect(
      batches([item('zh', 'a'), item('zh', 'long text')], 25, 4).map((batch) =>
        batch.map(({ text }) => text),
      ),
    ).toEqual([['a'], ['long text']]);
  });
});

describe('approvedFirst: the lines the operator approved, read before the rest', () => {
  const units = {
    id: [],
    zh: [
      { key: 'rosterColSex', english: 'Sex', translation: '性别' },
      { key: 'title', english: 'Title', translation: '标题' },
      { key: 'warnings.SPILL [sex=M]', english: 'Boys', translation: '男生' },
      { key: 'warnings.SPILL [sex=F]', english: 'Girls', translation: '女生' },
      { key: 'warnings.SPILLOVER', english: 'Over', translation: '超过' },
    ],
    vi: [],
    th: [],
  };

  it('names a pinned key and every branch of a pinned message, nothing else', () => {
    expect(
      [
        ...approvedFirst(
          {
            en: { rosterColSex: 'Sex' },
            zh: { rosterColSex: '性别', 'warnings.SPILL': '…' },
          },
          units,
        ),
      ].sort(),
    ).toEqual([
      'zh:rosterColSex',
      'zh:warnings.SPILL [sex=F]',
      'zh:warnings.SPILL [sex=M]',
    ]);
  });
});

describe('readBackReview: what a run read, for a person to judge', () => {
  const row = (over: Record<string, unknown>) => ({
    locale: 'th' as const,
    key: 'rosterColTogether',
    writer: 'edited after DeepL' as const,
    english: 'Together',
    translation: 'ด้วยกัน',
    reading: 'together',
    score: 100,
    ...over,
  });

  it('names the reader, and each line its writer, worst first', () => {
    expect(
      readBackReview([
        row({}),
        row({
          key: 'pin',
          english: 'Pin',
          translation: 'ปัก|หมุด',
          reading: 'stake',
          score: 12.4,
          writer: 'DeepL',
        }),
      ]),
    ).toBe(
      [
        '## th: 2 lines read back by Google Cloud Translation v2',
        '',
        'Google wrote none of these lines. Labels of three words or fewer are judged by eye: a score reads them word for word.',
        '',
        '| chrF | written by | key | English | translation | Google |',
        '| ---: | --- | --- | --- | --- | --- |',
        '| 12 | DeepL | `pin` | Pin | ปัก\\|หมุด | stake |',
        '| 100 | edited after DeepL | `rosterColTogether` | Together | ด้วยกัน | together |',
      ].join('\n'),
    );
  });

  it('says so when a run read nothing', () => {
    expect(readBackReview([])).toBe('Nothing was read in this run.');
  });
});

describe('the daily ledger: the client never sends past 16,000 characters', () => {
  // Measured 2026-10-15: Google accepted 16,991 characters before refusing a
  // request, so its quota stops the request AFTER the one that crosses it.
  // The client keeps its own count and stops before.
  it('is 16,000 characters, 31 of which fit the free 500,000 a month', () => {
    expect(DAILY_CHARACTERS).toBe(16_000);
    expect(DAILY_CHARACTERS * 31).toBeLessThanOrEqual(500_000);
  });

  it.each([
    ['before midnight in California', '2026-10-15T06:59:59Z', '2026-10-14'],
    ['at midnight in California', '2026-10-15T07:00:00Z', '2026-10-15'],
    ['in winter, eight hours behind', '2026-12-01T07:59:59Z', '2026-11-30'],
  ])('counts a day as Google does, by Pacific time: %s', (_name, at, day) => {
    expect(quotaDay(new Date(at))).toBe(day);
  });

  it('leaves the whole day when nothing was spent', () => {
    expect(charactersLeft({}, '2026-10-15')).toBe(16_000);
  });

  it('leaves what was not spent', () => {
    expect(charactersLeft({ '2026-10-15': 12_500 }, '2026-10-15')).toBe(3_500);
  });

  it('leaves nothing, never less, once a day is overspent', () => {
    expect(charactersLeft({ '2026-10-15': 16_991 }, '2026-10-15')).toBe(0);
  });

  it('adds what a request spent', () => {
    expect(spend({ '2026-10-14': 9 }, '2026-10-15', 40)).toEqual({
      '2026-10-14': 9,
      '2026-10-15': 40,
    });
    expect(spend({ '2026-10-15': 40 }, '2026-10-15', 2)).toEqual({
      '2026-10-15': 42,
    });
  });

  it('reads a ledger, fail-closed', () => {
    expect(parseLedger({ '2026-10-15': 3 })).toEqual({ '2026-10-15': 3 });
    expect(() => parseLedger({ '2026-10-15': '3' })).toThrow(
      'the character ledger has a day that is not a count: 2026-10-15',
    );
    expect(() => parseLedger([])).toThrow(
      'the character ledger is not a table of days',
    );
  });
});

describe('batches under an allowance', () => {
  const item = (text: string) => ({
    locale: 'zh' as const,
    text,
    chars: [...text].length,
  });

  it('sends nothing past the allowance, and never a text that would cross it', () => {
    expect(
      batches([item('aaa'), item('bb'), item('c')], 25, 5000, 4).map((batch) =>
        batch.map(({ text }) => text),
      ),
    ).toEqual([['aaa']]);
  });

  it('sends nothing when the day is spent', () => {
    const plan = [item('a')];
    expect(
      searched(batches(plan, 25, 5000, 0), {
        of: plan,
        what: 'texts planned on a spent day',
      }),
    ).toEqual([]);
    expect(
      floorBreach('read-back/spent-day-plan', plan.length),
    ).toBeUndefined();
  });
});

describe('verdicts: a wrong reading blocks the change', () => {
  // Operator 2026-10-15: "i do want wrong readings to block a change". A
  // score cannot tell (of 495 lines read, 155 scored under 50 and 111 of
  // those were approved copy), so each reading is judged beside its English.
  const units = [
    { key: 'title', english: 'Title', translation: '标题' },
    { key: 'again', english: 'Shuffle again', translation: '重新洗牌' },
    { key: 'pin', english: 'Pin it', translation: '置顶' },
    { key: 'new', english: 'New', translation: '新' },
  ];
  const judged = store({
    readings: {
      ...store().readings,
      zh: {
        标题: r('Title'),
        重新洗牌: {
          english: 'Chop again',
          verdict: 'ambiguous',
          note: 'cut / shuffle',
        },
        置顶: {
          english: 'Stake it',
          verdict: 'wrong',
          note: 'reads as a stake, not a pin',
        },
        新: { english: 'New' },
      },
    },
  });

  it('names every read line with no verdict, and every wrong one', () => {
    expect(verdictProblems('zh', units, judged)).toEqual({
      unjudged: ['new'],
      wrong: ['pin'],
    });
  });

  it('leaves a line Google has not read to the pending list', () => {
    expect(
      verdictProblems(
        'zh',
        [...units, { key: 'later', english: 'Later', translation: '以后' }],
        judged,
      ),
    ).toEqual({ unjudged: ['new'], wrong: ['pin'] });
  });

  it('applies verdicts by key to the reading of the current line', () => {
    const next = applyVerdicts(judged, 'zh', units, [
      { key: 'new', verdict: 'agrees' },
      { key: 'pin', verdict: 'agrees', note: 'pinned to the top' },
    ]);
    expect(next.readings.zh['新']).toEqual({
      english: 'New',
      verdict: 'agrees',
    });
    expect(next.readings.zh['置顶']).toEqual({
      english: 'Stake it',
      verdict: 'agrees',
      note: 'pinned to the top',
    });
    expect(judged.readings.zh['新']).toEqual({ english: 'New' });
  });

  it.each([
    [
      'a key no line has',
      { key: 'gone', verdict: 'agrees' },
      'zh gone: no such line',
    ],
    [
      'a line Google has not read',
      { key: 'later', verdict: 'agrees' },
      'zh later: Google has not read this line',
    ],
    [
      'a verdict nobody defined',
      { key: 'new', verdict: 'fine' },
      'zh new: "fine" is not agrees, ambiguous or wrong',
    ],
    [
      'a wrong verdict with no note',
      { key: 'new', verdict: 'wrong' },
      'zh new: a wrong or ambiguous verdict says why in a note',
    ],
  ])('refuses %s', (_name, row, message) => {
    expect(() =>
      applyVerdicts(
        judged,
        'zh',
        [...units, { key: 'later', english: 'Later', translation: '以后' }],
        [row],
      ),
    ).toThrow(message);
  });

  it('lists every verdict for the operator: wrong, then ambiguous, then unjudged, then agrees', () => {
    expect(verdictReview('zh', units, judged)).toBe(
      [
        "## zh: 4 lines judged against Google's reading (1 wrong, 1 ambiguous, 1 unjudged, 1 agree)",
        '',
        '| verdict | key | English | translation | Google | note |',
        '| --- | --- | --- | --- | --- | --- |',
        '| **wrong** | `pin` | Pin it | 置顶 | Stake it | reads as a stake, not a pin |',
        '| ambiguous | `again` | Shuffle again | 重新洗牌 | Chop again | cut / shuffle |',
        '| unjudged | `new` | New | 新 | New |  |',
        '| agrees | `title` | Title | 标题 | Title |  |',
      ].join('\n'),
    );
  });
});

describe('verdictRows: the judged sheet, read back', () => {
  it('reads locale, key, verdict and note, ignoring the columns shown for reading', () => {
    expect(
      verdictRows(
        [
          'locale\tkey\tverdict\tnote\tEnglish\ttranslation\tGoogle\tchrF',
          'zh\ttitle\tagrees\t\tTitle\t标题\tTitle\t100',
          'th\tagain\tambiguous\tสับ: shuffle / chop\tShuffle again\tสับใหม่\tChop again\t27',
          '',
        ].join('\n'),
      ),
    ).toEqual([
      { locale: 'zh', key: 'title', verdict: 'agrees', note: '' },
      {
        locale: 'th',
        key: 'again',
        verdict: 'ambiguous',
        note: 'สับ: shuffle / chop',
      },
    ]);
  });

  it('refuses a sheet without its header', () => {
    expect(() => verdictRows('zh\ttitle\tagrees\t')).toThrow(
      'a verdict sheet starts with the header locale, key, verdict, note',
    );
  });

  it('refuses a row for a locale nobody reads', () => {
    expect(() =>
      verdictRows('locale\tkey\tverdict\tnote\nen\ttitle\tagrees\t'),
    ).toThrow('row 2: "en" is not a locale Google reads');
  });
});
