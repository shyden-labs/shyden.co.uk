import { describe, expect, it } from 'vitest';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import {
  GOOGLE_ENGINE,
  type ReadBackStore,
} from '../../src/lib/i18n/read-back';
import {
  addReadings,
  azureBody,
  azureCredentials,
  azureTexts,
  azureUrl,
  deeplReadBody,
  googleEntries,
  independentReadings,
  parseSecondStore,
  readerProblems,
  readerWroteIt,
  refreshWriters,
  secondEntries,
  secondReadingsReview,
  toRead,
  writerEngines,
  writersOf,
  withGoogleWriters,
  type SecondStore,
} from '../../src/lib/i18n/readers';

/**
 * #754 AC10. Nobody marks their own homework (operator 2026-10-16: "if one
 * engine wrote it, another needs to verify it"). Every engine's reading of a
 * line is kept beside the line's writer, and a reading whose reader wrote
 * the line is refused. DeepL is a writer of every line it drafted, word for
 * word or edited after (operator 2026-10-17).
 */

const drafts = {
  th: { 'Add a student': 'เพิ่มนักเรียน', 'Pin it': 'ปักหมุดไว้' },
};
/** One line DeepL wrote, one edited after it, one it never drafted. */
const units = [
  { key: 'add', english: 'Add a student', translation: 'เพิ่มนักเรียน' },
  { key: 'pin', english: 'Pin it', translation: 'ปักหมุด' },
  { key: 'new', english: 'New copy', translation: 'ใหม่' },
];

const empty = (): SecondStore => ({
  readings: { zh: {}, th: {}, id: {}, vi: {} },
});

describe('writerEngines: the engines that wrote a line', () => {
  it.each([
    ['DeepL', ['DeepL']],
    ['edited after DeepL', ['DeepL']],
    ['no DeepL draft', []],
  ] as const)('%s', (writer, engines) => {
    expect(writerEngines(writer)).toEqual(engines);
  });
});

describe('readerWroteIt', () => {
  it('DeepL wrote a line it drafted word for word', () => {
    expect(readerWroteIt('DeepL', ['DeepL'])).toBe(true);
  });

  it('DeepL wrote a line edited after its draft (operator 2026-10-17)', () => {
    expect(readerWroteIt('DeepL', ['edited after DeepL'])).toBe(true);
  });

  it('DeepL did not write a line it never drafted', () => {
    expect(readerWroteIt('DeepL', ['no DeepL draft'])).toBe(false);
  });

  it.each(['Azure Translator', 'LibreTranslate', GOOGLE_ENGINE])(
    '%s wrote none of the copy',
    (reader) => {
      expect(readerWroteIt(reader, ['DeepL', 'edited after DeepL'])).toBe(
        false,
      );
    },
  );
});

describe('writersOf: every writer of every line saying a text', () => {
  it('one line, one writer', () => {
    expect(writersOf('th', 'เพิ่มนักเรียน', units, drafts)).toEqual(['DeepL']);
  });

  it('two lines sharing one text give both writers, in WRITERS order', () => {
    const shared = [
      { key: 'b', english: 'New copy', translation: 'เพิ่มนักเรียน' },
      ...units,
    ];
    expect(writersOf('th', 'เพิ่มนักเรียน', shared, drafts)).toEqual([
      'DeepL',
      'no DeepL draft',
    ]);
  });

  it('a text no line says has no writer', () => {
    expect(
      searched(writersOf('th', 'ไม่มี', units, drafts), {
        of: units,
        what: 'th fixture lines',
      }),
    ).toEqual([]);
    expect(floorBreach('readers/fixture-lines', units.length)).toBeUndefined();
  });
});

describe('parseSecondStore: fail-closed', () => {
  it('reads a well-formed store', () => {
    const json = {
      readings: {
        zh: {},
        th: {
          ใหม่: { writers: ['no DeepL draft'], by: { DeepL: 'New' } },
        },
        id: {},
        vi: {},
      },
    };
    expect(parseSecondStore(json)).toEqual(json);
  });

  it('refuses a store missing a locale', () => {
    expect(() =>
      parseSecondStore({ readings: { zh: {}, th: {}, id: {} } }),
    ).toThrow('the second-readings store has no readings for vi');
  });

  it.each([
    ['not an object', 'New'],
    ['no writers', { by: { DeepL: 'New' } }],
    ['no reader', { writers: ['DeepL'], by: {} }],
    ['a writer nobody defined', { writers: ['Claude'], by: { DeepL: 'x' } }],
    [
      'writers out of order',
      { writers: ['no DeepL draft', 'DeepL'], by: { DeepL: 'x' } },
    ],
    ['a writer twice', { writers: ['DeepL', 'DeepL'], by: { DeepL: 'x' } }],
    [
      'Google, whose readings have their own store',
      { writers: ['DeepL'], by: { [GOOGLE_ENGINE]: 'x' } },
    ],
    ['a reader nobody defined', { writers: ['DeepL'], by: { Bing: 'x' } }],
    ['a reading that is not text', { writers: ['DeepL'], by: { DeepL: 1 } }],
  ])('refuses a reading with %s', (_name, reading) => {
    expect(() =>
      parseSecondStore({
        readings: { ...empty().readings, th: { ใหม่: reading } },
      }),
    ).toThrow(
      'the second-readings store has a th reading it cannot use: "ใหม่"',
    );
  });
});

const google = (writers: string[]): ReadBackStore =>
  ({
    engine: GOOGLE_ENGINE,
    readings: {
      zh: {},
      id: {},
      vi: {},
      th: {
        เพิ่มนักเรียน: { english: 'Add a student', verdict: 'agrees', writers },
      },
    },
    pending: { zh: [], th: [], id: [], vi: [] },
  }) as ReadBackStore;

describe('readerProblems: what a store holds that it must not', () => {
  it('is clean for independent readings of current lines', () => {
    const store = {
      readings: {
        ...empty().readings,
        th: {
          เพิ่มนักเรียน: {
            writers: ['DeepL'],
            by: { 'Azure Translator': 'Add a student' },
          },
          ใหม่: { writers: ['no DeepL draft'], by: { DeepL: 'New' } },
        },
      },
    } as SecondStore;
    expect(
      readerProblems('th', units, drafts, secondEntries(store, 'th')),
    ).toEqual({
      selfRead: [],
      writersChanged: [],
      stale: [],
    });
  });

  it('names DeepL reading a line DeepL wrote', () => {
    const store = {
      readings: {
        ...empty().readings,
        th: {
          เพิ่มนักเรียน: { writers: ['DeepL'], by: { DeepL: 'Add student' } },
        },
      },
    } as SecondStore;
    expect(
      readerProblems('th', units, drafts, secondEntries(store, 'th')).selfRead,
    ).toEqual(['DeepL: เพิ่มนักเรียน']);
  });

  it('names DeepL reading a line edited after its draft', () => {
    const store = {
      readings: {
        ...empty().readings,
        th: {
          ปักหมุด: { writers: ['edited after DeepL'], by: { DeepL: 'Pin' } },
        },
      },
    } as SecondStore;
    expect(
      readerProblems('th', units, drafts, secondEntries(store, 'th')).selfRead,
    ).toEqual(['DeepL: ปักหมุด']);
  });

  it('judges by the writer now, even when the store recorded another', () => {
    const store = {
      readings: {
        ...empty().readings,
        th: {
          เพิ่มนักเรียน: { writers: ['no DeepL draft'], by: { DeepL: 'Add' } },
        },
      },
    } as SecondStore;
    expect(
      readerProblems('th', units, drafts, secondEntries(store, 'th')),
    ).toEqual({
      selfRead: ['DeepL: เพิ่มนักเรียน'],
      writersChanged: ['เพิ่มนักเรียน'],
      stale: [],
    });
  });

  it('names a reading of a text no line says, and no writer change for it', () => {
    const store = {
      readings: {
        ...empty().readings,
        th: {
          ไม่มี: { writers: ['DeepL'], by: { 'Azure Translator': 'None' } },
        },
      },
    } as SecondStore;
    expect(
      readerProblems('th', units, drafts, secondEntries(store, 'th')),
    ).toEqual({
      selfRead: [],
      writersChanged: [],
      stale: ['ไม่มี'],
    });
  });

  it("checks Google's store the same way: its writers are recorded and current", () => {
    expect(
      readerProblems(
        'th',
        units,
        drafts,
        googleEntries(google(['DeepL']), 'th'),
      ),
    ).toEqual({ selfRead: [], writersChanged: [], stale: [] });
    expect(
      readerProblems(
        'th',
        units,
        drafts,
        googleEntries(google(['no DeepL draft']), 'th'),
      ).writersChanged,
    ).toEqual(['เพิ่มนักเรียน']);
  });
});

describe('addReadings: a run saves only independent readings', () => {
  it('saves a reading with the writers of its line', () => {
    expect(
      addReadings(
        empty(),
        'th',
        'Azure Translator',
        [{ text: 'เพิ่มนักเรียน', english: 'Add a student' }],
        units,
        drafts,
      ),
    ).toEqual({
      store: {
        readings: {
          ...empty().readings,
          th: {
            เพิ่มนักเรียน: {
              writers: ['DeepL'],
              by: { 'Azure Translator': 'Add a student' },
            },
          },
        },
      },
      refused: [],
    });
  });

  it('keeps the readings other engines already saved', () => {
    const first = addReadings(
      empty(),
      'th',
      'Azure Translator',
      [{ text: 'ใหม่', english: 'New' }],
      units,
      drafts,
    ).store;
    const { store } = addReadings(
      first,
      'th',
      'DeepL',
      [{ text: 'ใหม่', english: 'Fresh' }],
      units,
      drafts,
    );
    expect(store.readings.th['ใหม่']?.by).toEqual({
      'Azure Translator': 'New',
      DeepL: 'Fresh',
    });
  });

  it('refuses, and does not save, a reading by its own writer', () => {
    const { store, refused } = addReadings(
      empty(),
      'th',
      'DeepL',
      [
        { text: 'เพิ่มนักเรียน', english: 'Add a student' },
        { text: 'ปักหมุด', english: 'Pin' },
      ],
      units,
      drafts,
    );
    expect(refused).toEqual(['เพิ่มนักเรียน', 'ปักหมุด']);
    expect(store.readings.th).toEqual({});
  });

  it('refuses a text no line says', () => {
    expect(() =>
      addReadings(
        empty(),
        'th',
        'DeepL',
        [{ text: 'ไม่มี', english: 'x' }],
        units,
        drafts,
      ),
    ).toThrow('th: no line says "ไม่มี"');
  });
});

describe('toRead: what a reader is sent', () => {
  it('every current text the reader did not write and has not read, once', () => {
    const twice = [
      ...units,
      { key: 'again', english: 'New copy', translation: 'ใหม่' },
    ];
    expect(toRead('th', 'Azure Translator', twice, drafts, empty())).toEqual([
      'เพิ่มนักเรียน',
      'ปักหมุด',
      'ใหม่',
    ]);
    expect(toRead('th', 'DeepL', twice, drafts, empty())).toEqual(['ใหม่']);
  });

  it('skips a text it has already read', () => {
    const read = addReadings(
      empty(),
      'th',
      'Azure Translator',
      [{ text: 'ใหม่', english: 'New' }],
      units,
      drafts,
    ).store;
    expect(toRead('th', 'Azure Translator', units, drafts, read)).toEqual([
      'เพิ่มนักเรียน',
      'ปักหมุด',
    ]);
  });
});

describe('refreshWriters: the writers as the cache says now', () => {
  it('rewrites writers, drops self-readings and texts no line says', () => {
    const store = {
      readings: {
        ...empty().readings,
        th: {
          เพิ่มนักเรียน: {
            writers: ['no DeepL draft'],
            by: { DeepL: 'Add', 'Azure Translator': 'Add a student' },
          },
          ปักหมุด: { writers: ['no DeepL draft'], by: { DeepL: 'Pin' } },
          ไม่มี: { writers: ['DeepL'], by: { 'Azure Translator': 'None' } },
        },
      },
    } as SecondStore;
    const refreshed = refreshWriters(store, 'th', units, drafts);
    expect(refreshed.dropped).toEqual([
      'DeepL: เพิ่มนักเรียน',
      'DeepL: ปักหมุด',
      'no line says: ไม่มี',
    ]);
    expect(refreshed.store.readings.th).toEqual({
      เพิ่มนักเรียน: {
        writers: ['DeepL'],
        by: { 'Azure Translator': 'Add a student' },
      },
    });
  });
});

describe('independentReadings: no tally counts a self-reading', () => {
  it('leaves out a reader that wrote the line', () => {
    expect(
      independentReadings({
        writers: ['edited after DeepL'],
        by: { DeepL: 'Pin', 'Azure Translator': 'Pin it' },
      }),
    ).toEqual([['Azure Translator', 'Pin it']]);
  });
});

describe('secondReadingsReview: what a person judges by', () => {
  it('lists each line with its writers and only independent readings', () => {
    const store = {
      readings: {
        ...empty().readings,
        th: {
          ปักหมุด: {
            writers: ['edited after DeepL'],
            by: { DeepL: 'SELF', 'Azure Translator': 'Pin it' },
          },
        },
      },
    } as SecondStore;
    const page = secondReadingsReview('th', units, store);
    expect(page).toContain(
      '| `pin` | Pin it | ปักหมุด | edited after DeepL | Azure Translator: Pin it |',
    );
    expect(page).not.toContain('SELF');
    expect(page).toContain(
      '## th: 1 line read by an engine that did not write it',
    );
  });
});

describe('DeepL as a reader', () => {
  it('reads into British English with every slot kept as a tag', () => {
    expect(deeplReadBody(['{n} ชื่อ & <b>'], 'th')).toEqual({
      text: ['<x>{n}</x> ชื่อ &amp; &lt;b&gt;'],
      source_lang: 'TH',
      target_lang: 'EN-GB',
      tag_handling: 'xml',
      ignore_tags: ['x'],
    });
  });

  it('names Chinese as DeepL takes a source language, without the variant', () => {
    expect(deeplReadBody(['你好'], 'zh').source_lang).toBe('ZH');
  });
});

describe('Azure Translator as a reader', () => {
  it('asks for British English from the line as HTML', () => {
    expect(azureUrl('zh')).toBe(
      'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=zh-Hans&to=en-GB&textType=html',
    );
    expect(azureUrl('th')).toContain('&from=th&');
  });

  it('marks each slot not to translate', () => {
    expect(azureBody(['{n} ชื่อ & x'])).toEqual([
      { Text: '<span class="notranslate">{n}</span> ชื่อ &amp; x' },
    ]);
  });

  it('reads one text per line sent, slot marks off and entities decoded', () => {
    expect(
      azureTexts(
        [
          {
            translations: [
              {
                text: '<span class="notranslate">{n}</span> names &amp; x',
                to: 'en-GB',
              },
            ],
          },
        ],
        1,
      ),
    ).toEqual(['{n} names & x']);
  });

  it.each([
    ['not a list', { error: { code: 401000, message: 'denied' } }, 1],
    ['the wrong count', [], 1],
    ['an entry with no text', [{ translations: [{}] }], 1],
  ])('refuses an answer that is %s', (_name, answer, expected) => {
    expect(() => azureTexts(answer, expected)).toThrow(/Azure/);
  });

  it('takes the key and region from the environment, else the shared file', () => {
    expect(
      azureCredentials(
        { AZURE_TRANSLATOR_KEY: 'k1', AZURE_TRANSLATOR_REGION: 'r1' },
        'AZURE_TRANSLATOR_KEY=k2\nAZURE_TRANSLATOR_REGION=r2\n',
        '/f',
      ),
    ).toEqual({ key: 'k1', region: 'r1' });
    expect(
      azureCredentials(
        {},
        'AZURE_TRANSLATOR_KEY= k2 \nAZURE_TRANSLATOR_REGION=r2\n',
        '/f',
      ),
    ).toEqual({ key: 'k2', region: 'r2' });
  });

  it('names where it looked, and never a key', () => {
    expect(() =>
      azureCredentials({}, 'AZURE_TRANSLATOR_REGION=r2\n', '/f'),
    ).toThrow('no AZURE_TRANSLATOR_KEY in the environment or in /f');
  });
});

describe("withGoogleWriters: Google's readings name their writers as the cache says now", () => {
  it('rewrites each current text, and keeps a stale text as recorded for the caller to drop', () => {
    const store = google(['no DeepL draft']);
    const stale = {
      ...store,
      readings: {
        ...store.readings,
        th: {
          ...store.readings.th,
          ไม่มี: { english: 'None', verdict: 'agrees', writers: ['DeepL'] },
        },
      },
    } as ReadBackStore;
    const next = withGoogleWriters(
      stale,
      { zh: [], id: [], vi: [], th: units },
      drafts,
    );
    expect(next.readings.th['เพิ่มนักเรียน']).toEqual({
      english: 'Add a student',
      verdict: 'agrees',
      writers: ['DeepL'],
    });
    expect(next.readings.th['ไม่มี']?.writers).toEqual(['DeepL']);
    expect(stale.readings.th['เพิ่มนักเรียน']?.writers).toEqual([
      'no DeepL draft',
    ]);
  });
});
