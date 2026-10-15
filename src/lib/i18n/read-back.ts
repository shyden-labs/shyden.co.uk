import {
  backTranslationUnits,
  cell,
  sendable,
  type BackTranslationUnit,
} from './back-translate.ts';

/**
 * The decisions behind Google's reading of every translated line, with no I/O
 * in sight. #754.
 *
 * Every line in id, zh, vi and th is read back into English by Google Cloud
 * Translation, which wrote none of it: zh, vi and th were drafted by DeepL
 * (`.translations.json`) and corrected by hand, and LibreTranslate, the
 * reader before this, could not read Thai (#751: ด้วยกัน "together" came back
 * as "Integer", ปักหมุด "pin" as "stake"; Google read both correctly on
 * 2026-10-15). LibreTranslate stays as an extra reading, never the only one.
 *
 * Only the laptop calls Google (operator decision 2026-10-15). Its readings
 * are saved in `.read-back.json` beside the DeepL cache, and a unit test with
 * no key and no network fails when a line has no reading of its exact current
 * text. A full read is about 52,600 characters and the free daily quota is
 * 16,000, so the store also carries the keys not yet read, a list that only
 * shrinks.
 *
 * `scripts/i18n-google-read-back.mjs` is the wiring: read, fetch, write. Like
 * `back-translate.ts`, this module is for the CLI and stays out of the
 * browser bundle.
 */

/** The reader, as the store and the review name it. */
export const GOOGLE_ENGINE = 'Google Cloud Translation v2';

/** The locales read, in the order a run reads them: smallest first (#754). */
export const READ_ORDER = ['zh', 'th', 'id', 'vi'] as const;
export type ReadLocale = (typeof READ_ORDER)[number];

/**
 * The characters the client lets itself send in one of Google's days. The
 * project's own quota is the same 16,000, but measured on 2026-10-15 it let
 * 16,991 through: Google refuses the request AFTER the one that crosses it.
 * So the client keeps its own count and never sends a request that would
 * cross, and 31 days of it fit inside the free 500,000 a month.
 */
export const DAILY_CHARACTERS = 16_000;

/** Characters spent per Google day, `YYYY-MM-DD`. */
export type Ledger = Record<string, number>;

/** Google's quota day: it resets at midnight Pacific time. */
export const quotaDay = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);

/** What is left of a day's characters: never less than nothing. */
export const charactersLeft = (ledger: Readonly<Ledger>, day: string): number =>
  Math.max(0, DAILY_CHARACTERS - (ledger[day] ?? 0));

/** The ledger after a request spent `chars` on `day`. */
export const spend = (
  ledger: Readonly<Ledger>,
  day: string,
  chars: number,
): Ledger => ({ ...ledger, [day]: (ledger[day] ?? 0) + chars });

/** The saved ledger, checked rather than trusted. */
export function parseLedger(json: unknown): Ledger {
  if (!json || typeof json !== 'object' || Array.isArray(json))
    throw new Error('the character ledger is not a table of days');
  for (const [day, chars] of Object.entries(json))
    if (!Number.isInteger(chars) || (chars as number) < 0)
      throw new Error(
        `the character ledger has a day that is not a count: ${day}`,
      );
  return { ...(json as Ledger) };
}

/** A value for every locale read, keyed by locale. */
const each = <T>(value: (locale: ReadLocale) => T): Record<ReadLocale, T> =>
  Object.fromEntries(
    READ_ORDER.map((locale) => [locale, value(locale)]),
  ) as Record<ReadLocale, T>;

/** Every line of every locale read, from all three catalogues. */
export const unitsByLocale = (): Record<ReadLocale, BackTranslationUnit[]> =>
  each(backTranslationUnits);

/** Who wrote a line, as far as the DeepL cache can say. */
export type Writer = 'DeepL' | 'edited after DeepL' | 'no DeepL draft';

/**
 * A judgement of Google's reading beside the English (operator 2026-10-15:
 * "i do want wrong readings to block a change"; the agent judges, the
 * operator sees every verdict). `agrees`: the reading carries the English
 * meaning. `ambiguous`: Google took another sense of the same word, and the
 * line stands. `wrong`: the line says something else, and blocks until it is
 * corrected and read again. A score cannot make this call: of 495 lines read
 * on 2026-10-15, 155 scored under 50, and 111 of those were approved copy.
 */
export const VERDICTS = ['agrees', 'ambiguous', 'wrong'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Google's English for one line, and its verdict once judged. */
export interface Reading {
  readonly english: string;
  readonly verdict?: Verdict;
  /** Why: required for `ambiguous` and `wrong`. */
  readonly note?: string;
}

/**
 * The saved readings. `readings` maps each locale's exact line, slots and
 * all, to Google's reading of it; `pending` lists the keys whose current
 * text has not been read yet.
 */
export interface ReadBackStore {
  readonly engine: string;
  readonly readings: Record<ReadLocale, Record<string, Reading>>;
  readonly pending: Record<ReadLocale, string[]>;
}

/** A reading as the store may hold it, or undefined. */
function usableReading(value: unknown): Reading | undefined {
  const { english, verdict, note } = record(value);
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;
  if (typeof english !== 'string') return undefined;
  if (verdict !== undefined && !VERDICTS.includes(verdict as Verdict))
    return undefined;
  if (note !== undefined && typeof note !== 'string') return undefined;
  if (
    (verdict === 'ambiguous' || verdict === 'wrong') &&
    (typeof note !== 'string' || note.trim() === '')
  )
    return undefined;
  return {
    english,
    ...(verdict === undefined ? {} : { verdict: verdict as Verdict }),
    ...(note === undefined ? {} : { note }),
  };
}

/** One text to read, with the characters Google counts against the quota. */
export interface PlanItem {
  readonly locale: ReadLocale;
  readonly text: string;
  readonly chars: number;
}

/** One line a run read, as its review shows it. */
export interface ReadRow {
  readonly locale: ReadLocale;
  readonly key: string;
  readonly writer: Writer;
  readonly english: string;
  readonly translation: string;
  readonly reading: string;
  /** `chrF` of Google's reading against the English, 0 to 100. */
  readonly score: number;
}

/** What a coverage check found wrong in one locale. */
export interface Coverage {
  /** Keys whose current text has no reading and are not pending. */
  readonly unreadOutsidePending: string[];
  /** Pending keys that are read, or that no line has any more. */
  readonly pendingAlreadyRead: string[];
  /** Saved readings of a text no line says any more. */
  readonly stale: string[];
}

const KEY_NAME = 'GOOGLE_TRANSLATE_API_KEY';

/**
 * The API key: the environment's, else the one shared key file's (operator
 * 2026-10-14: "all projects need to use the same key"). The error names
 * where it looked and never a key.
 */
export function googleKey(
  env: Readonly<Record<string, string | undefined>>,
  fileText: string | undefined,
  filePath: string,
): string {
  const fromEnv = env[KEY_NAME]?.trim();
  if (fromEnv) return fromEnv;
  const line = (fileText ?? '')
    .split('\n')
    .find((entry) => entry.trimStart().startsWith(`${KEY_NAME}=`));
  const fromFile = line?.slice(line.indexOf('=') + 1).trim();
  if (fromFile) return fromFile;
  throw new Error(`no ${KEY_NAME} in the environment or in ${filePath}`);
}

/** Google's code for a locale: the site ships Simplified Chinese. */
export const googleSource = (locale: ReadLocale): string =>
  locale === 'zh' ? 'zh-CN' : locale;

/**
 * The JSON body of one `POST /language/translate/v2`. HTML, not text: only
 * in HTML can a slot be marked `translate="no"` and come back where it was.
 */
export const googleBody = (
  texts: readonly string[],
  source: string,
): Record<string, unknown> => ({
  q: [...texts],
  source,
  target: 'en',
  format: 'html',
});

/** A message slot (`{names}`), which is not copy in any language. */
const SLOT = /\{[^{}]*\}/g;

/**
 * A line as Google is sent it: escaped as HTML, each slot marked not to
 * translate. Stripped, as LibreTranslate is sent them, a slot left a hole
 * Google filled with an invented number (zh resultsSummary read back as
 * "There are 1 group, consisting of 10 students", 2026-10-15).
 */
export const googleHtml = (line: string): string =>
  line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(SLOT, (slot) => `<span translate="no">${slot}</span>`);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

/**
 * Google's HTML answer as text: the slot marks taken off and every entity
 * decoded, once, so an escaped `&amp;lt;` stays `&lt;`.
 */
export const fromGoogleHtml = (reading: string): string =>
  reading
    .replace(/<\/?span\b[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name: string) => {
      if (name[0] === '#')
        return String.fromCodePoint(
          name[1] === 'x' || name[1] === 'X'
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10),
        );
      return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
    });

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {};

/**
 * The readings in an answer, checked rather than trusted: one string per text
 * sent, or an error naming what came back instead.
 */
export function googleTexts(response: unknown, expected: number): string[] {
  const translations = record(record(response).data).translations;
  const texts = Array.isArray(translations)
    ? translations.map((entry) => record(entry).translatedText)
    : undefined;
  if (!texts || !texts.every((text) => typeof text === 'string'))
    throw new Error(
      `expected data.translations to be a list of ${expected} { translatedText }, got ${String(
        JSON.stringify(translations),
      ).slice(0, 200)}`,
    );
  if (texts.length !== expected)
    throw new Error(
      `expected ${expected} translations from Google, got ${texts.length}`,
    );
  return texts;
}

/** The v2 reasons Google gives a spent quota (`dailyLimitExceeded` and kin). */
const QUOTA_REASON = /limitexceeded/i;

/**
 * Why Google said no, and whether it was the daily quota. Either way the run
 * stops there and nothing is retried: a quota is waited out, and any other
 * refusal needs a person.
 */
export function googleRefusal(
  status: number,
  body: unknown,
): { quota: boolean; message: string } {
  const error = record(record(body).error);
  if (typeof error.message !== 'string')
    return {
      quota: status === 429,
      message: `Google refused (${status}): ${String(
        typeof body === 'string' ? body : JSON.stringify(body),
      ).slice(0, 200)}`,
    };
  const reasons = [
    ...(Array.isArray(error.errors) ? error.errors : []),
    ...(Array.isArray(error.details) ? error.details : []),
  ].map((entry) => String(record(entry).reason ?? ''));
  const quota =
    status === 429 ||
    error.status === 'RESOURCE_EXHAUSTED' ||
    reasons.some((reason) => QUOTA_REASON.test(reason));
  const label = typeof error.status === 'string' ? ` ${error.status}` : '';
  return {
    quota,
    message: `${quota ? "Google's daily quota is spent" : 'Google refused'} (${status}${label}): ${error.message}`,
  };
}

/**
 * Who wrote a line: DeepL, when the line is its cached draft unchanged;
 * edited after DeepL, when it differs; no DeepL draft, when the cache never
 * held its English. The cache is keyed by the English sentence, slots and
 * all, as `messageUnits` splits it, which is how a unit carries it.
 */
export function writerOf(
  locale: string,
  english: string,
  translation: string,
  drafts: Readonly<Record<string, Readonly<Record<string, string>>>>,
): Writer {
  const draft = drafts[locale]?.[english];
  if (draft === undefined) return 'no DeepL draft';
  return draft === translation ? 'DeepL' : 'edited after DeepL';
}

/** The saved store, checked rather than trusted. */
export function parseStore(json: unknown): ReadBackStore {
  const store = record(json);
  if (store.engine !== GOOGLE_ENGINE)
    throw new Error(
      `the read-back store names engine ${JSON.stringify(store.engine)}, expected "${GOOGLE_ENGINE}"`,
    );
  const readings = record(store.readings);
  const pending = record(store.pending);
  for (const locale of READ_ORDER) {
    if (!(locale in readings))
      throw new Error(`the read-back store has no readings for ${locale}`);
    for (const [text, reading] of Object.entries(record(readings[locale])))
      if (usableReading(reading) === undefined)
        throw new Error(
          `the read-back store has a ${locale} reading it cannot use: ${JSON.stringify(text)}`,
        );
    const keys = pending[locale];
    if (!Array.isArray(keys) || !keys.every((key) => typeof key === 'string'))
      throw new Error(
        `the read-back store has a ${locale} pending list that is not keys`,
      );
  }
  return {
    engine: GOOGLE_ENGINE,
    readings: each((locale) =>
      Object.fromEntries(
        Object.entries(record(readings[locale])).map(([text, reading]) => [
          text,
          usableReading(reading) as Reading,
        ]),
      ),
    ),
    pending: each((locale) => [...(pending[locale] as string[])]),
  };
}

/**
 * Whether every line of a locale has a reading of its exact current text.
 * Equality both ways: an unread line must be pending, a pending key must
 * still be unread, and a reading must belong to a line, so the list only
 * shrinks and the store holds nothing nobody says.
 */
export function coverage(
  locale: ReadLocale,
  units: readonly BackTranslationUnit[],
  store: ReadBackStore,
): Coverage {
  const readings = store.readings[locale];
  const pending = new Set(store.pending[locale]);
  const texts = new Set(units.map((unit) => unit.translation));
  const unread = new Set(
    units
      .filter((unit) => !(unit.translation in readings))
      .map((unit) => unit.key),
  );
  return {
    unreadOutsidePending: [...unread].filter((key) => !pending.has(key)),
    pendingAlreadyRead: [...pending].filter((key) => !unread.has(key)),
    stale: Object.keys(readings).filter((text) => !texts.has(text)),
  };
}

/**
 * The lines the operator approved (`verified.ts`), as `locale:key`. A pin
 * names a message whole; each branch the message says is approved with it.
 */
export function approvedFirst(
  verified: Readonly<Record<string, Readonly<Record<string, string>>>>,
  units: Readonly<Record<ReadLocale, readonly BackTranslationUnit[]>>,
): Set<string> {
  return new Set(
    READ_ORDER.flatMap((locale) => {
      const pinned = Object.keys(verified[locale] ?? {});
      return units[locale]
        .filter(({ key }) =>
          pinned.some((pin) => key === pin || key.startsWith(`${pin} [`)),
        )
        .map(({ key }) => `${locale}:${key}`);
    }),
  );
}

/**
 * Every line still to read, each once per locale, in the order a run sends
 * them, counted as Google bills what is sent, markup included: the lines the operator approved (`first`, as `locale:key`) before
 * everything else, so Google is proved on known-good copy before it is
 * trusted (#754 AC5), then each locale in `READ_ORDER`. A line that is
 * nothing but slots is never sent.
 */
export function readingPlan(
  units: Readonly<Record<ReadLocale, readonly BackTranslationUnit[]>>,
  store: ReadBackStore,
  first: ReadonlySet<string>,
): PlanItem[] {
  const all = READ_ORDER.flatMap((locale) =>
    units[locale].map((unit) => ({
      locale,
      text: unit.translation,
      approved: first.has(`${locale}:${unit.key}`),
    })),
  );
  const seen = new Set<string>();
  return [
    ...all.filter(({ approved }) => approved),
    ...all.filter(({ approved }) => !approved),
  ].flatMap(({ locale, text }) => {
    const id = `${locale}\n${text}`;
    if (sendable(text) === '' || text in store.readings[locale] || seen.has(id))
      return [];
    seen.add(id);
    return [{ locale, text, chars: [...googleHtml(text)].length }];
  });
}

/**
 * The plan as requests: one locale each, at most `maxTexts` texts and
 * `maxChars` characters, in plan order. A text longer than the limit goes on
 * its own rather than never. Nothing past `allowance` characters in all is
 * sent: the plan stops at the first text that would cross it.
 */
export function batches(
  plan: readonly PlanItem[],
  maxTexts: number,
  maxChars: number,
  allowance = Number.POSITIVE_INFINITY,
): PlanItem[][] {
  const out: PlanItem[][] = [];
  let current: PlanItem[] = [];
  let chars = 0;
  let sent = 0;
  for (const item of plan) {
    if (sent + item.chars > allowance) break;
    sent += item.chars;
    const full =
      current.length > 0 &&
      (current[0].locale !== item.locale ||
        current.length >= maxTexts ||
        chars + item.chars > maxChars);
    if (full) {
      out.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += item.chars;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** Code-unit order: the same on every machine, unlike `localeCompare`. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A run's review: a section per locale, each line beside its writer and
 * Google's reading, lowest score first. The score is a place to start, not a
 * verdict: a label read word for word can score near 0 and be right (#95).
 */
export function readBackReview(rows: readonly ReadRow[]): string {
  if (rows.length === 0) return 'Nothing was read in this run.';
  return READ_ORDER.flatMap((locale) => {
    const mine = rows
      .filter((row) => row.locale === locale)
      .sort((a, b) => a.score - b.score || byText(a.key, b.key));
    if (mine.length === 0) return [];
    return [
      [
        `## ${locale}: ${mine.length} lines read back by ${GOOGLE_ENGINE}`,
        '',
        'Google wrote none of these lines. Labels of three words or fewer are judged by eye: a score reads them word for word.',
        '',
        '| chrF | written by | key | English | translation | Google |',
        '| ---: | --- | --- | --- | --- | --- |',
        ...mine.map(
          (row) =>
            `| ${Math.round(row.score)} | ${row.writer} | \`${row.key}\` | ${cell(row.english)} | ${cell(row.translation)} | ${cell(row.reading)} |`,
        ),
      ].join('\n'),
    ];
  }).join('\n\n');
}

/** Read lines with no verdict, and lines judged wrong, by key. */
export function verdictProblems(
  locale: ReadLocale,
  units: readonly BackTranslationUnit[],
  store: ReadBackStore,
): { unjudged: string[]; wrong: string[] } {
  const read = units.flatMap((unit) => {
    const reading = store.readings[locale][unit.translation];
    return reading ? [{ key: unit.key, verdict: reading.verdict }] : [];
  });
  return {
    unjudged: read.filter(({ verdict }) => !verdict).map(({ key }) => key),
    wrong: read
      .filter(({ verdict }) => verdict === 'wrong')
      .map(({ key }) => key),
  };
}

/** One judgement, as the agent records it. */
export interface VerdictRow {
  readonly key: string;
  readonly verdict: string;
  readonly note?: string;
}

/**
 * The store with each row's verdict on the reading of its key's current
 * line. A row that names no line, a line Google has not read, a verdict
 * nobody defined, or a wrong or ambiguous verdict with no reason is refused,
 * so no judgement lands on the wrong line or says nothing.
 */
export function applyVerdicts(
  store: ReadBackStore,
  locale: ReadLocale,
  units: readonly BackTranslationUnit[],
  rows: readonly VerdictRow[],
): ReadBackStore {
  const readings = { ...store.readings[locale] };
  for (const { key, verdict, note } of rows) {
    const unit = units.find((candidate) => candidate.key === key);
    if (!unit) throw new Error(`${locale} ${key}: no such line`);
    const reading = readings[unit.translation];
    if (!reading)
      throw new Error(`${locale} ${key}: Google has not read this line`);
    if (!VERDICTS.includes(verdict as Verdict))
      throw new Error(
        `${locale} ${key}: ${JSON.stringify(verdict)} is not ${VERDICTS.slice(0, -1).join(', ')} or ${VERDICTS.at(-1)}`,
      );
    if (verdict !== 'agrees' && !note?.trim())
      throw new Error(
        `${locale} ${key}: a wrong or ambiguous verdict says why in a note`,
      );
    readings[unit.translation] = {
      english: reading.english,
      verdict: verdict as Verdict,
      ...(note?.trim() ? { note: note.trim() } : {}),
    };
  }
  return { ...store, readings: { ...store.readings, [locale]: readings } };
}

const VERDICT_ORDER = ['wrong', 'ambiguous', 'unjudged', 'agrees'] as const;

/**
 * Every judged line of a locale for the operator, who sees them all: wrong
 * first, then ambiguous, then any not yet judged, then those that agree.
 */
export function verdictReview(
  locale: ReadLocale,
  units: readonly BackTranslationUnit[],
  store: ReadBackStore,
): string {
  const rows = units
    .flatMap((unit) => {
      const reading = store.readings[locale][unit.translation];
      return reading
        ? [
            {
              unit,
              reading,
              verdict: (reading.verdict ??
                'unjudged') as (typeof VERDICT_ORDER)[number],
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) ||
        byText(a.unit.key, b.unit.key),
    );
  const count = (verdict: (typeof VERDICT_ORDER)[number]) =>
    rows.filter((row) => row.verdict === verdict).length;
  return [
    `## ${locale}: ${rows.length} lines judged against Google's reading (${count('wrong')} wrong, ${count('ambiguous')} ambiguous, ${count('unjudged')} unjudged, ${count('agrees')} agree)`,
    '',
    '| verdict | key | English | translation | Google | note |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      ({ unit, reading, verdict }) =>
        `| ${verdict === 'wrong' ? '**wrong**' : verdict} | \`${unit.key}\` | ${cell(unit.english)} | ${cell(unit.translation)} | ${cell(reading.english)} | ${cell(reading.note ?? '')} |`,
    ),
  ].join('\n');
}

/** The header of a verdict sheet: what is judged, then what is shown. */
export const SHEET_HEADER = [
  'locale',
  'key',
  'verdict',
  'note',
  'English',
  'translation',
  'Google',
  'chrF',
] as const;

/**
 * A judged verdict sheet (tab-separated, `SHEET_HEADER` first) as rows. Only
 * the first four columns are read; the rest are there to judge by.
 */
export function verdictRows(
  sheet: string,
): (VerdictRow & { locale: ReadLocale })[] {
  const lines = sheet.split('\n').filter((line) => line.trim() !== '');
  if (lines[0]?.split('\t').slice(0, 4).join(',') !== 'locale,key,verdict,note')
    throw new Error(
      'a verdict sheet starts with the header locale, key, verdict, note',
    );
  return lines.slice(1).map((line, at) => {
    const [locale, key = '', verdict = '', note = ''] = line.split('\t');
    if (!READ_ORDER.includes(locale as ReadLocale))
      throw new Error(
        `row ${at + 2}: ${JSON.stringify(locale)} is not a locale Google reads`,
      );
    return { locale: locale as ReadLocale, key, verdict, note };
  });
}
