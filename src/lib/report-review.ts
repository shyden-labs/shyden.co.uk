/**
 * The decisions behind `npm run reports:review` (#348): which database, the
 * one command that reads it, what a stored row must look like, and the block
 * each report prints as. `scripts/reports-review.mjs` is the wiring.
 *
 * CLI-only (`cli-only.test.ts`), and every import carries its `.ts`
 * extension, because plain Node loads this file with no build step.
 */
import { catalogueLeaves } from './catalogue-leaves.ts';
import { DEFAULT_LOCALE, LOCALES, type Locale } from './i18n/locales.ts';

/** The two databases `docs/runbooks/translation-reports.md` names. */
export const REVIEW_DATABASES = [
  'shyden-reports-dev',
  'shyden-reports',
] as const;
export type ReviewDatabase = (typeof REVIEW_DATABASES)[number];

/** Every locale's tool and site catalogue, as `back-translate.ts` holds them. */
export type Catalogues = Readonly<
  Record<Locale, { readonly strings: unknown; readonly site: unknown }>
>;

/** One stored report, checked. */
export interface ReportRow {
  readonly id: string;
  readonly received_at: string;
  readonly locale: Locale;
  readonly page: string;
  readonly quote: string;
  readonly keys: readonly string[];
  readonly suggestion: string;
  readonly note: string;
}

/** What became of a report's suggestion on its way to the engine. */
export type BackTranslation =
  | { readonly kind: 'made'; readonly text: string }
  | { readonly kind: 'not-needed' }
  | { readonly kind: 'no-engine' }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * The columns `migrations/0001_reports.sql` creates, in its order. Spelled
 * here because `report.ts`, which holds them as `REPORT_COLUMNS`, cannot be
 * loaded by plain Node; `report-review.test.ts` pins the two equal.
 */
const COLUMNS = [
  'id',
  'received_at',
  'locale',
  'page',
  'quote',
  'keys',
  'suggestion',
  'note',
] as const;

/**
 * The only statement the script sends. A read: dealing with a report stays
 * the runbook's `DELETE`, typed by the operator.
 */
export const REVIEW_SELECT = `SELECT ${COLUMNS.join(', ')} FROM reports ORDER BY received_at, id`;

const USAGE = `usage: npm run reports:review <${REVIEW_DATABASES.join('|')}>`;

/** The database the operator named: exactly one argument, one of the two. */
export function databaseFrom(args: readonly string[]): ReviewDatabase {
  const [name] = args;
  const known = REVIEW_DATABASES.find((database) => database === name);
  if (args.length !== 1 || known === undefined)
    throw new Error(
      `${USAGE}\n  the database is ${REVIEW_DATABASES.map((database) => `"${database}"`).join(' or ')}; got ${JSON.stringify(args.join(' '))}`,
    );
  return known;
}

/** `wrangler`'s arguments: run `REVIEW_SELECT` remotely and answer in JSON. */
export const wranglerArgs = (database: ReviewDatabase): string[] => [
  'd1',
  'execute',
  database,
  '--remote',
  '--json',
  '--command',
  REVIEW_SELECT,
];

const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

function decodedKeys(id: string, raw: string): string[] {
  let keys: unknown;
  try {
    keys = JSON.parse(raw);
  } catch {
    keys = undefined;
  }
  if (!Array.isArray(keys) || !keys.every((key) => typeof key === 'string'))
    throw new Error(
      `report ${id}: keys is not a JSON list of catalogue keys: ${JSON.stringify(raw)}`,
    );
  return keys;
}

function checkedRow(result: unknown, at: number): ReportRow {
  const fields: Record<string, unknown> =
    result && typeof result === 'object' ? { ...result } : {};
  const id = typeof fields.id === 'string' ? fields.id : `at position ${at}`;
  const text: Record<string, string> = {};
  for (const column of COLUMNS) {
    const value = fields[column];
    if (typeof value !== 'string')
      throw new Error(`report ${id}: column ${column} is not text`);
    text[column] = value;
  }
  if (!isLocale(text.locale))
    throw new Error(
      `report ${id}: locale ${JSON.stringify(text.locale)} is not one the site has`,
    );
  return {
    id: text.id,
    received_at: text.received_at,
    locale: text.locale,
    page: text.page,
    quote: text.quote,
    keys: decodedKeys(id, text.keys),
    suggestion: text.suggestion,
    note: text.note,
  };
}

/**
 * The rows in wrangler's `--json` answer, checked and oldest first. A shape
 * the endpoint never writes is refused, naming the row, rather than printed
 * as far as it goes: a review that quietly drops a report looks complete.
 */
export function reportRows(output: unknown): ReportRow[] {
  if (!Array.isArray(output) || output.length !== 1)
    throw new Error(
      `expected wrangler to answer one statement, got ${String(JSON.stringify(output)).slice(0, 200)}`,
    );
  const [statement]: unknown[] = output;
  const answer: Record<string, unknown> =
    statement && typeof statement === 'object' ? { ...statement } : {};
  if (answer.success !== true || !Array.isArray(answer.results))
    throw new Error(
      `the SELECT did not succeed: ${String(JSON.stringify(statement)).slice(0, 200)}`,
    );
  return answer.results
    .map(checkedRow)
    .sort(
      (a, b) =>
        a.received_at.localeCompare(b.received_at) || a.id.localeCompare(b.id),
    );
}

/**
 * The text at `key` in one locale: tool copy by its bare path, site copy
 * under `site.`, both as `catalogueLeaves` spells them (which is how
 * `report.ts` stored them). `undefined` when no string lives there.
 */
export function catalogueText(
  catalogues: Catalogues,
  locale: Locale,
  key: string,
): string | undefined {
  const { strings, site } = catalogues[locale];
  const leaves = key.startsWith('site.')
    ? catalogueLeaves(site, 'site')
    : catalogueLeaves(strings);
  const text = leaves.find(([path]) => path === key)?.[1];
  return typeof text === 'string' ? text : undefined;
}

/** Only a suggestion with words in it, in a language other than English. */
export const needsBackTranslation = (row: ReportRow): boolean =>
  row.locale !== DEFAULT_LOCALE && row.suggestion.trim() !== '';

const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  '\n': 'n',
  '\r': 'r',
  '\t': 't',
};
const BACKSLASH = String.fromCharCode(92);

/**
 * Text for a terminal: a line break, a control or format character (a
 * terminal escape sequence, a right-to-left override) and the backslash that
 * introduces an escape are all written as escapes. Every letter of every
 * script the site speaks is left as it is.
 */
export const escaped = (text: string): string =>
  text.replace(/[\\\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) => {
    if (character === BACKSLASH) return BACKSLASH + BACKSLASH;
    const short = SHORT_ESCAPES[character];
    if (short) return BACKSLASH + short;
    return `${BACKSLASH}u{${(character.codePointAt(0) ?? 0).toString(16)}}`;
  });

const quoted = (text: string): string => `"${escaped(text)}"`;

function backTranslationLine(
  row: ReportRow,
  backTranslation: BackTranslation,
): string {
  const label = '  in English ';
  switch (backTranslation.kind) {
    case 'made':
      return label + quoted(backTranslation.text);
    case 'no-engine':
      return `${label}not made: BACK_TRANSLATE_URL is not set`;
    case 'failed':
      return `${label}FAILED: ${escaped(backTranslation.reason)}`;
    case 'not-needed':
      return `${label}not asked for: ${
        row.suggestion.trim() === ''
          ? 'no suggestion to read back'
          : 'the suggestion is English'
      }`;
  }
}

/** One report, as the operator reads it. Everything a visitor typed is escaped. */
export function reviewBlock(
  row: ReportRow,
  catalogues: Catalogues,
  backTranslation: BackTranslation,
): string {
  const keyLines = row.keys.flatMap((key) => {
    const english = catalogueText(catalogues, DEFAULT_LOCALE, key);
    const current = catalogueText(catalogues, row.locale, key);
    const found =
      english === undefined || current === undefined
        ? ['  missing from the catalogue']
        : [
            `  English   ${quoted(english)}`,
            `  ${row.locale.padEnd(2)} now    ${quoted(current)}`,
          ];
    return [`key         ${escaped(key)}`, ...found];
  });
  return [
    `── report ${escaped(row.id)}`,
    `received    ${escaped(row.received_at)}`,
    `locale      ${row.locale}`,
    `page        ${escaped(row.page)}`,
    `quoted      ${quoted(row.quote)}`,
    ...keyLines,
    `suggestion  ${row.suggestion === '' ? '(none)' : quoted(row.suggestion)}`,
    backTranslationLine(row, backTranslation),
    `note        ${row.note === '' ? '(none)' : quoted(row.note)}`,
    '            private: never copy the note into a public ticket',
  ].join('\n');
}
