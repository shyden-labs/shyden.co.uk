import { cell, type BackTranslationUnit } from './back-translate.ts';
import {
  GOOGLE_ENGINE,
  READ_ORDER,
  WRITERS,
  fromGoogleHtml,
  usableWriters,
  writerOf,
  type ReadBackStore,
  type ReadLocale,
  type Writer,
} from './read-back.ts';
import { deeplLanguage, escapeXml } from './translate.ts';

/**
 * Who read a line, beside who wrote it, for every engine's reading the repo
 * keeps. #754 AC10.
 *
 * Nobody marks their own homework (operator 2026-10-16: "if one engine wrote
 * it, another needs to verify it. nobody is allowed to mark their own
 * homework"). Google's readings and verdicts live in `.read-back.json`; every
 * other engine's reading lives in `.second-readings.json` (operator
 * 2026-10-16: "Save every engine's reading"). Both record, for each text, the
 * writers of every line that says it, and `read-back-coverage` refuses a
 * reading whose reader is one of them.
 *
 * DeepL is a writer of every line it drafted, word for word or edited after
 * (operator 2026-10-17): an edit is usually small, so DeepL reading it back is
 * largely reading its own draft.
 *
 * `scripts/i18n-second-read.mjs` is the wiring: read, fetch, write.
 */

/** The engines that read but are not Google, whose store is its own. */
export const SECOND_READERS = [
  'DeepL',
  'LibreTranslate',
  'Azure Translator',
] as const;
export type SecondReader = (typeof SECOND_READERS)[number];

type Drafts = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** The engines that wrote a line, from what the DeepL cache says of it. */
export const writerEngines = (writer: Writer): readonly string[] =>
  writer === 'no DeepL draft' ? [] : ['DeepL'];

/** Whether `reader` wrote any line saying the text it read. */
export const readerWroteIt = (
  reader: string,
  writers: readonly Writer[],
): boolean => writers.some((writer) => writerEngines(writer).includes(reader));

/**
 * Every writer of every line saying `text`, once each, in `WRITERS` order:
 * two English strings can share one translation, and a store keyed by text
 * cannot tell them apart.
 */
export function writersOf(
  locale: ReadLocale,
  text: string,
  units: readonly BackTranslationUnit[],
  drafts: Drafts,
): Writer[] {
  const found = new Set(
    units
      .filter((unit) => unit.translation === text)
      .map((unit) => writerOf(locale, unit.english, unit.translation, drafts)),
  );
  return WRITERS.filter((writer) => found.has(writer));
}

/** Every engine's reading of one text but Google's, beside its writers. */
export interface SecondReading {
  readonly writers: readonly Writer[];
  readonly by: Readonly<Partial<Record<SecondReader, string>>>;
}

/** The saved second readings, keyed by locale and the exact text read. */
export interface SecondStore {
  readonly readings: Readonly<
    Record<ReadLocale, Readonly<Record<string, SecondReading>>>
  >;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {};

const isObject = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function usableSecond(value: unknown): SecondReading | undefined {
  if (!isObject(value)) return undefined;
  const { writers, by } = record(value);
  if (!usableWriters(writers) || !isObject(by)) return undefined;
  const entries = Object.entries(record(by));
  if (entries.length === 0) return undefined;
  if (
    !entries.every(
      ([reader, english]) =>
        SECOND_READERS.includes(reader as SecondReader) &&
        typeof english === 'string',
    )
  )
    return undefined;
  return { writers: [...writers], by: Object.fromEntries(entries) };
}

/** The saved second readings, checked rather than trusted. */
export function parseSecondStore(json: unknown): SecondStore {
  const readings = record(record(json).readings);
  for (const locale of READ_ORDER) {
    if (!(locale in readings))
      throw new Error(
        `the second-readings store has no readings for ${locale}`,
      );
    for (const [text, reading] of Object.entries(record(readings[locale])))
      if (usableSecond(reading) === undefined)
        throw new Error(
          `the second-readings store has a ${locale} reading it cannot use: ${JSON.stringify(text)}`,
        );
  }
  return {
    readings: Object.fromEntries(
      READ_ORDER.map((locale) => [
        locale,
        Object.fromEntries(
          Object.entries(record(readings[locale])).map(([text, reading]) => [
            text,
            usableSecond(reading) as SecondReading,
          ]),
        ),
      ]),
    ) as SecondStore['readings'],
  };
}

/** One saved text, its recorded writers, and every engine that read it. */
export interface ReaderEntry {
  readonly text: string;
  readonly writers: readonly Writer[];
  readonly readers: readonly string[];
}

/** Google's saved readings of a locale, as reader entries. */
export const googleEntries = (
  store: ReadBackStore,
  locale: ReadLocale,
): ReaderEntry[] =>
  Object.entries(store.readings[locale]).map(([text, reading]) => ({
    text,
    writers: reading.writers,
    readers: [GOOGLE_ENGINE],
  }));

/**
 * Google's store with every reading naming the writers of its lines as the
 * cache says now. A text no line says keeps what it recorded: the caller
 * drops it as stale, and a store never holds a reading with no writer.
 */
export const withGoogleWriters = (
  store: ReadBackStore,
  units: Readonly<Record<ReadLocale, readonly BackTranslationUnit[]>>,
  drafts: Drafts,
): ReadBackStore => ({
  ...store,
  readings: Object.fromEntries(
    READ_ORDER.map((locale) => [
      locale,
      Object.fromEntries(
        Object.entries(store.readings[locale]).map(([text, reading]) => {
          const now = writersOf(locale, text, units[locale], drafts);
          return [
            text,
            { ...reading, writers: now.length > 0 ? now : reading.writers },
          ];
        }),
      ),
    ]),
  ) as ReadBackStore['readings'],
});

/** The second readings of a locale, as reader entries. */
export const secondEntries = (
  store: SecondStore,
  locale: ReadLocale,
): ReaderEntry[] =>
  Object.entries(store.readings[locale]).map(([text, reading]) => ({
    text,
    writers: reading.writers,
    readers: Object.keys(reading.by),
  }));

const sameWriters = (a: readonly Writer[], b: readonly Writer[]): boolean =>
  a.length === b.length && a.every((writer, at) => writer === b[at]);

/** What a store holds that it must not, in one locale. */
export interface ReaderProblems {
  /** `reader: text`, where the reader wrote a line saying the text. */
  readonly selfRead: string[];
  /** Texts whose recorded writers are not who wrote their lines now. */
  readonly writersChanged: string[];
  /** Texts no line says any more. */
  readonly stale: string[];
}

/**
 * The readings a store must not hold. A self-reading is judged by the
 * writers now as well as the writers recorded, so a cache that changed under
 * a saved reading cannot launder it.
 */
export function readerProblems(
  locale: ReadLocale,
  units: readonly BackTranslationUnit[],
  drafts: Drafts,
  entries: readonly ReaderEntry[],
): ReaderProblems {
  const texts = new Set(units.map((unit) => unit.translation));
  const problems: ReaderProblems = {
    selfRead: [],
    writersChanged: [],
    stale: [],
  };
  for (const { text, writers, readers } of entries) {
    if (!texts.has(text)) {
      problems.stale.push(text);
      continue;
    }
    const now = writersOf(locale, text, units, drafts);
    if (!sameWriters(writers, now)) problems.writersChanged.push(text);
    for (const reader of readers)
      if (readerWroteIt(reader, [...writers, ...now]))
        problems.selfRead.push(`${reader}: ${text}`);
  }
  return problems;
}

/** One text a run read, and the engine's English for it. */
export interface NewReading {
  readonly text: string;
  readonly english: string;
}

const withLocale = (
  store: SecondStore,
  locale: ReadLocale,
  readings: Readonly<Record<string, SecondReading>>,
): SecondStore => ({ readings: { ...store.readings, [locale]: readings } });

/**
 * The store with a run's readings saved beside the writers of their lines.
 * A reading by an engine that wrote the line is refused and not saved; a
 * text no line says is an error, since nothing could have sent it.
 */
export function addReadings(
  store: SecondStore,
  locale: ReadLocale,
  reader: SecondReader,
  readings: readonly NewReading[],
  units: readonly BackTranslationUnit[],
  drafts: Drafts,
): { store: SecondStore; refused: string[] } {
  const saved = { ...store.readings[locale] };
  const refused: string[] = [];
  for (const { text, english } of readings) {
    const writers = writersOf(locale, text, units, drafts);
    if (writers.length === 0)
      throw new Error(`${locale}: no line says ${JSON.stringify(text)}`);
    if (readerWroteIt(reader, writers)) {
      refused.push(text);
      continue;
    }
    saved[text] = { writers, by: { ...saved[text]?.by, [reader]: english } };
  }
  return { store: withLocale(store, locale, saved), refused };
}

/** The texts to send `reader`: unread by it, not written by it, once each. */
export function toRead(
  locale: ReadLocale,
  reader: SecondReader,
  units: readonly BackTranslationUnit[],
  drafts: Drafts,
  store: SecondStore,
): string[] {
  const texts = [...new Set(units.map((unit) => unit.translation))];
  return texts.filter(
    (text) =>
      store.readings[locale][text]?.by[reader] === undefined &&
      !readerWroteIt(reader, writersOf(locale, text, units, drafts)),
  );
}

/**
 * The store with every text's writers as the cache says now, every reading
 * that has become a self-reading dropped, and every text no line says.
 */
export function refreshWriters(
  store: SecondStore,
  locale: ReadLocale,
  units: readonly BackTranslationUnit[],
  drafts: Drafts,
): { store: SecondStore; dropped: string[] } {
  const kept: Record<string, SecondReading> = {};
  const dropped: string[] = [];
  for (const [text, reading] of Object.entries(store.readings[locale])) {
    const writers = writersOf(locale, text, units, drafts);
    if (writers.length === 0) {
      dropped.push(`no line says: ${text}`);
      continue;
    }
    const by = Object.fromEntries(
      Object.entries(reading.by).filter(([reader]) => {
        const self = readerWroteIt(reader, writers);
        if (self) dropped.push(`${reader}: ${text}`);
        return !self;
      }),
    );
    if (Object.keys(by).length > 0) kept[text] = { writers, by };
  }
  return { store: withLocale(store, locale, kept), dropped };
}

/** A text's readings by engines that wrote none of its lines. */
export const independentReadings = (
  reading: SecondReading,
): [SecondReader, string][] =>
  (Object.entries(reading.by) as [SecondReader, string][]).filter(
    ([reader]) => !readerWroteIt(reader, reading.writers),
  );

/**
 * Each line with an independent second reading, beside its writers: what a
 * person judges by. A self-reading is never shown, so no sheet can count one.
 */
export function secondReadingsReview(
  locale: ReadLocale,
  units: readonly BackTranslationUnit[],
  store: SecondStore,
): string {
  const rows = units.flatMap((unit) => {
    const reading = store.readings[locale][unit.translation];
    const shown = reading ? independentReadings(reading) : [];
    return shown.length === 0
      ? []
      : [
          `| \`${unit.key}\` | ${cell(unit.english)} | ${cell(unit.translation)} | ${(reading as SecondReading).writers.join(', ')} | ${shown
            .map(([reader, english]) => `${reader}: ${cell(english)}`)
            .join('; ')} |`,
        ];
  });
  return [
    `## ${locale}: ${rows.length} line${rows.length === 1 ? '' : 's'} read by an engine that did not write it`,
    '',
    '| key | English | translation | written by | read by |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/** A message slot (`{names}`), which is not copy in any language. */
const SLOT = /\{[^{}]*\}/g;

/**
 * The body of a DeepL request reading lines back into British English. Each
 * slot sits in the tag DeepL ignores, as the drafting requests do; the
 * answer is read by `deeplDrafts`, which takes the tags off.
 */
export const deeplReadBody = (
  texts: readonly string[],
  locale: ReadLocale,
): {
  text: string[];
  source_lang: string;
  target_lang: string;
  tag_handling: string;
  ignore_tags: string[];
} => ({
  text: texts.map((text) =>
    escapeXml(text).replace(SLOT, (slot) => `<x>${slot}</x>`),
  ),
  // A source language takes no variant: DeepL reads ZH, not ZH-HANS.
  source_lang: deeplLanguage(locale).split('-')[0] as string,
  target_lang: 'EN-GB',
  tag_handling: 'xml',
  ignore_tags: ['x'],
});

/** Azure's code for a locale: the site ships Simplified Chinese. */
const azureSource = (locale: ReadLocale): string =>
  locale === 'zh' ? 'zh-Hans' : locale;

/** One Azure Translator request, reading a locale into British English. */
export const azureUrl = (locale: ReadLocale): string =>
  `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=${azureSource(locale)}&to=en-GB&textType=html`;

/**
 * The lines as Azure is sent them: escaped as HTML, each slot in the class
 * Azure leaves untranslated.
 */
export const azureBody = (texts: readonly string[]): { Text: string }[] =>
  texts.map((text) => ({
    Text: text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(SLOT, (slot) => `<span class="notranslate">${slot}</span>`),
  }));

/** Azure's readings, checked rather than trusted: one per line sent. */
export function azureTexts(response: unknown, expected: number): string[] {
  if (!Array.isArray(response))
    throw new Error(
      `Azure answered without a list: ${String(JSON.stringify(response)).slice(0, 200)}`,
    );
  if (response.length !== expected)
    throw new Error(
      `Azure returned ${response.length} readings for ${expected} lines`,
    );
  return response.map((entry, at) => {
    const first = record(entry).translations;
    const text = Array.isArray(first) ? record(first[0]).text : undefined;
    if (typeof text !== 'string')
      throw new Error(`Azure reading ${at} has no text`);
    return fromGoogleHtml(text);
  });
}

const fromFile = (fileText: string, name: string): string | undefined => {
  const line = fileText
    .split('\n')
    .find((entry) => entry.trimStart().startsWith(`${name}=`));
  return line?.slice(line.indexOf('=') + 1).trim() || undefined;
};

/**
 * Azure's key and region: the environment's, else the shared key file's.
 * The error names where it looked and never a key.
 */
export function azureCredentials(
  env: Readonly<Record<string, string | undefined>>,
  fileText: string | undefined,
  filePath: string,
): { key: string; region: string } {
  const value = (name: string): string => {
    const found = env[name]?.trim() || fromFile(fileText ?? '', name);
    if (!found)
      throw new Error(`no ${name} in the environment or in ${filePath}`);
    return found;
  };
  return {
    key: value('AZURE_TRANSLATOR_KEY'),
    region: value('AZURE_TRANSLATOR_REGION'),
  };
}
