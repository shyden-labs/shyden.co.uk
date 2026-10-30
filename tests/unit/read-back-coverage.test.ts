import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { searched } from '../source-files';
import {
  READ_ORDER,
  coverage,
  parseStore,
  unitsByLocale,
  verdictProblems,
  type ReadLocale,
} from '../../src/lib/i18n/read-back';
import {
  googleEntries,
  parseSecondStore,
  readerProblems,
  secondEntries,
  type ReaderEntry,
} from '../../src/lib/i18n/readers';

/**
 * #754. Every translated line has Google's reading of its exact current text,
 * or is on the store's pending list, which only shrinks.
 *
 * Only the laptop calls Google (operator decision 2026-10-15), so this reads
 * the saved store and needs no key and no network. A line changed or added
 * without a fresh reading turns this red; `npm run i18n:google-read-back`
 * reads it. Every reading is then judged beside its English, and a line with
 * no verdict, or one judged wrong, fails here too (operator 2026-10-15: "i
 * do want wrong readings to block a change").
 */

const STORE = parseStore(
  JSON.parse(
    readFileSync(
      new URL('../../src/lib/i18n/.read-back.json', import.meta.url),
      'utf8',
    ),
  ),
);
const SECOND = parseSecondStore(
  JSON.parse(
    readFileSync(
      new URL('../../src/lib/i18n/.second-readings.json', import.meta.url),
      'utf8',
    ),
  ),
);
const DRAFTS = JSON.parse(
  readFileSync(
    new URL('../../src/lib/i18n/.translations.json', import.meta.url),
    'utf8',
  ),
) as Record<string, Record<string, string>>;
const UNITS = unitsByLocale();
const LINES_FLOOR: Readonly<Record<ReadLocale, string>> = {
  zh: 'read-back/lines-zh',
  th: 'read-back/lines-th',
  id: 'read-back/lines-id',
  vi: 'read-back/lines-vi',
};
const FIX = 'run npm run i18n:google-read-back';

describe('every translated line is read back by Google, or pending', () => {
  it.each(READ_ORDER)('%s', (locale) => {
    const lines = UNITS[locale].map(({ translation }) => translation);
    const found = coverage(locale, UNITS[locale], STORE);
    expect(
      searched(found.unreadOutsidePending, {
        of: lines,
        what: `${locale} translated lines`,
      }),
      `${locale}: lines with no reading of their current text; ${FIX}`,
    ).toEqual([]);
    // Pending keys and readings are judged against the same lines: a
    // locale read in full has no pending keys, so the lines are what counts.
    expect(
      searched(found.pendingAlreadyRead, {
        of: lines,
        what: `${locale} translated lines`,
      }),
      `${locale}: pending keys that are read or gone; ${FIX}`,
    ).toEqual([]);
    expect(
      searched(found.stale, { of: lines, what: `${locale} translated lines` }),
      `${locale}: readings of text no line says; ${FIX}`,
    ).toEqual([]);
    const verdicts = verdictProblems(locale, UNITS[locale], STORE);
    expect(
      searched(verdicts.unjudged, {
        of: lines,
        what: `${locale} translated lines`,
      }),
      `${locale}: read lines with no verdict; judge them with npm run i18n:read-back-verdicts`,
    ).toEqual([]);
    expect(
      searched(verdicts.wrong, {
        of: lines,
        what: `${locale} translated lines`,
      }),
      `${locale}: lines whose reading shows them wrong; correct the line, then read it again`,
    ).toEqual([]);
    expect(floorBreach(LINES_FLOOR[locale], lines.length)).toBeUndefined();
  });
});

/**
 * #754 AC10. Nobody marks their own homework (operator 2026-10-16): every
 * reading the repo keeps, Google's and every other engine's, names the
 * writers of its line, and none was read by one of them. DeepL wrote every
 * line it drafted, word for word or edited after (operator 2026-10-17). The
 * writers are judged as the DeepL cache says now, so a re-drafted line
 * cannot keep a reading its new writer took.
 */
const GOOGLE_READINGS_FLOOR: Readonly<Record<ReadLocale, string>> = {
  zh: 'read-back/google-readings-zh',
  th: 'read-back/google-readings-th',
  id: 'read-back/google-readings-id',
  vi: 'read-back/google-readings-vi',
};
const SECOND_READINGS_FLOOR: Readonly<Record<ReadLocale, string>> = {
  zh: 'read-back/second-readings-zh',
  th: 'read-back/second-readings-th',
  id: 'read-back/second-readings-id',
  vi: 'read-back/second-readings-vi',
};
const REFRESH = 'run npm run i18n:second-read -- --refresh-writers';

const noSelfReading = (
  locale: ReadLocale,
  entries: readonly ReaderEntry[],
  what: string,
  floor: string,
) => {
  const found = readerProblems(locale, UNITS[locale], DRAFTS, entries);
  expect(
    searched(found.selfRead, { of: entries, what }),
    `${locale}: readings by an engine that wrote the line; ${REFRESH}`,
  ).toEqual([]);
  expect(
    searched(found.writersChanged, { of: entries, what }),
    `${locale}: readings whose recorded writers are not the writers now; ${REFRESH}`,
  ).toEqual([]);
  expect(
    searched(found.stale, { of: entries, what }),
    `${locale}: readings of text no line says; ${REFRESH}`,
  ).toEqual([]);
};

describe('no Google reading is filed under the wrong writer', () => {
  it.each(READ_ORDER)('%s', (locale) => {
    noSelfReading(
      locale,
      googleEntries(STORE, locale),
      `${locale} Google readings`,
      GOOGLE_READINGS_FLOOR[locale],
    );
  });
});

describe('no second reading was taken by the engine that wrote the line', () => {
  it.each(READ_ORDER)('%s', (locale) => {
    noSelfReading(
      locale,
      secondEntries(SECOND, locale),
      `${locale} second readings`,
      SECOND_READINGS_FLOOR[locale],
    );
  });
});
