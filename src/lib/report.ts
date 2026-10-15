/**
 * Translation reports (#97). Which strings a page offers a visitor to
 * report, how a quote is matched against them, and the `/api/report`
 * endpoint.
 *
 * ONE HOME (spec 4.2). The footer imports this at build time for its
 * `<datalist>`, and the Pages Functions import it at run time to validate a
 * report, so what is offered and what is accepted cannot drift apart. It is
 * site-safe: it must never import a CLI-only module (`cli-only.test.ts`),
 * and it runs on workerd, so no Node API either.
 */
import { catalogueLeaves } from './catalogue-leaves';
import {
  DEFAULT_LOCALE,
  getSiteStrings,
  isBetaLocale,
  isLocale,
  localisePath,
  rawCatalogue,
  type Locale,
  type SiteStrings,
} from './i18n';
import {
  isMessageTemplate,
  parseMessage,
  type MessagePart,
} from './i18n/message';

/** The pages whose footer carries the form: one form, the locale in the path. */
export const FOOTER_PAGE_IDS = [
  'home',
  'yeetalk-calculators',
  'classroom-groups',
] as const;
export type FooterPageId = (typeof FOOTER_PAGE_IDS)[number];

/**
 * Every value the endpoint's `page` field accepts. `not-found` is the 404
 * (#350, spec 14): one path for every locale, one form per translated block.
 */
export const PAGE_IDS = [...FOOTER_PAGE_IDS, 'not-found'] as const;
export type PageId = (typeof PAGE_IDS)[number];

export interface ReportForm {
  /** What the `<datalist>` offers: the literal text with each slot as an ellipsis. */
  readonly display: string;
  /** The literal text between slots: one more run than there are slots. */
  readonly runs: readonly string[];
}

export interface ReportableString {
  /** `site.<path>` for site copy, the bare catalogue path for tool copy. */
  readonly key: string;
  readonly forms: readonly ReportForm[];
}

const ELLIPSIS = String.fromCharCode(0x2026);
/** A private-use character: marks a slot inside a form, and never occurs in copy. */
const SLOT = String.fromCodePoint(0xe000);

interface PageEntry {
  /** The path in the default locale. */
  readonly route: string;
  /**
   * Whether the path names its locale. The 404's does not, so it answers on
   * one path in every locale and carries one form per locale (spec 14.3).
   */
  readonly localised: boolean;
  /** The site-catalogue section only this page reads. */
  readonly siteSection?: keyof SiteStrings;
  /** Whether the page reads the raw tool catalogue (`getStrings`). */
  readonly toolCatalogue: boolean;
  /** Whether the page's chrome speaks the report's locale. The 404's is English. */
  readonly chrome: boolean;
  /** Keys of `siteSection` the page never shows in a report's locale. */
  readonly unshown?: ReadonlySet<string>;
}

/** Spec section 4's table and section 14. The facts: HomePage reads `.home`, YeetalkCalculatorsPage `.calculators`, ClassroomGroupsPage `getStrings`, 404.astro `.notFound`. */
const PAGES: Record<PageId, PageEntry> = {
  home: {
    route: '/',
    localised: true,
    siteSection: 'home',
    toolCatalogue: false,
    chrome: true,
  },
  'yeetalk-calculators': {
    route: '/yeetalk-calculators',
    localised: true,
    siteSection: 'calculators',
    toolCatalogue: false,
    chrome: true,
  },
  'classroom-groups': {
    route: '/classroom-groups',
    localised: true,
    toolCatalogue: true,
    chrome: true,
  },
  'not-found': {
    route: '/404',
    localised: false,
    siteSection: 'notFound',
    toolCatalogue: false,
    chrome: false,
    // A document has one <title> and one description: the default locale's.
    unshown: new Set(['site.notFound.title', 'site.notFound.description']),
  },
};

export const isPageId = (value: unknown): value is PageId =>
  typeof value === 'string' && (PAGE_IDS as readonly string[]).includes(value);

/** A footer page only: the 404's footer is English and carries no form. */
export function pageIdFromPath(pathname: string): FooterPageId | null {
  const route =
    localisePath(pathname, DEFAULT_LOCALE).replace(/\/+$/, '') || '/';
  return FOOTER_PAGE_IDS.find((page) => PAGES[page].route === route) ?? null;
}

export const pagePath = (page: PageId, locale: Locale): string =>
  PAGES[page].localised
    ? localisePath(PAGES[page].route, locale)
    : PAGES[page].route;

/**
 * The stem of every id a form draws (`<stem>-quote`, `<stem>-sent`). A page
 * whose path names its locale has one form, and keeps `report`. The 404
 * carries one per locale on one path, so each carries its locale (spec 14.3).
 */
export const reportIdStem = (page: PageId, locale: Locale): string =>
  PAGES[page].localised ? 'report' : `report-${locale}`;

/** Chrome: every top-level site entry no single page owns, derived so a new one is offered the day it is added. */
function chromeSections(): string[] {
  const owned = new Set<string>();
  for (const page of PAGE_IDS) {
    const section = PAGES[page].siteSection;
    if (section) owned.add(section);
  }
  return Object.keys(getSiteStrings(DEFAULT_LOCALE)).filter(
    (section) => !owned.has(section),
  );
}

/** Every form a template can render, slots as SLOT, one per plural or select branch. */
function slotted(parts: readonly MessagePart[]): string[] {
  let forms = [''];
  for (const part of parts) {
    if (part.kind === 'text') forms = forms.map((form) => form + part.text);
    else if (part.kind === 'count' || part.kind === 'value')
      forms = forms.map((form) => form + SLOT);
    else {
      const branches = [...part.branches.values()].flatMap(slotted);
      forms = forms.flatMap((form) => branches.map((branch) => form + branch));
    }
  }
  return forms;
}

function formsOf(text: string, isMessage: boolean): ReportForm[] {
  const raw = isMessage ? slotted(parseMessage(text)) : [text];
  return [...new Set(raw)].map((form) => {
    const runs = form.split(SLOT);
    return { display: runs.join(ELLIPSIS), runs };
  });
}

const stringsOnly = (
  leaves: Array<[string, unknown]>,
): Array<[string, string]> =>
  leaves.filter(
    (leaf): leaf is [string, string] => typeof leaf[1] === 'string',
  );

function siteStrings(
  locale: Locale,
  sections: readonly string[],
): ReportableString[] {
  const table = getSiteStrings(locale) as Record<string, unknown>;
  return sections.flatMap((section) =>
    stringsOnly(catalogueLeaves(table[section], `site.${section}`)).map(
      ([key, text]) => ({
        key,
        forms: formsOf(text, false),
      }),
    ),
  );
}

/** English decides what is a message, and arrays are never compiled (`compileCatalogue`). */
function toolStrings(locale: Locale): ReportableString[] {
  const english = new Map(catalogueLeaves(rawCatalogue(DEFAULT_LOCALE)));
  return stringsOnly(catalogueLeaves(rawCatalogue(locale))).map(
    ([key, text]) => {
      const reference = english.get(key);
      const isMessage =
        !key.includes('[') &&
        typeof reference === 'string' &&
        isMessageTemplate(reference);
      return { key, forms: formsOf(text, isMessage) };
    },
  );
}

const tables = new Map<string, readonly ReportableString[]>();

export function reportableStrings(
  page: PageId,
  locale: Locale,
): readonly ReportableString[] {
  const cacheKey = `${page}:${locale}`;
  let table = tables.get(cacheKey);
  if (!table) {
    const { siteSection, toolCatalogue, chrome, unshown } = PAGES[page];
    const sections = [
      ...(siteSection ? [siteSection] : []),
      ...(chrome ? chromeSections() : []),
    ];
    table = [
      ...(toolCatalogue ? toolStrings(locale) : []),
      ...siteStrings(locale, sections).filter(({ key }) => !unshown?.has(key)),
    ];
    tables.set(cacheKey, table);
  }
  return table;
}

export const reportOptions = (
  page: PageId,
  locale: Locale,
): readonly string[] => [
  ...new Set(
    reportableStrings(page, locale).flatMap(({ forms }) =>
      forms.map(({ display }) => display),
    ),
  ),
];

const ZERO_WIDTH: ReadonlySet<number> = new Set([
  0x200b, 0x200c, 0x200d, 0x2060, 0xfeff,
]);
const SINGLE_QUOTES: ReadonlySet<number> = new Set([
  0x2018, 0x2019, 0x201a, 0x201b, 0x2032, 0x02bc, 0xff07,
]);
const DOUBLE_QUOTES: ReadonlySet<number> = new Set([
  0x201c, 0x201d, 0x201e, 0x201f, 0x2033, 0xff02,
]);

/** Spec 5's normalisation, applied to the quote and to every form alike. */
export function normalise(text: string, locale: Locale): string {
  const folded = [...text.normalize('NFC')]
    .filter((ch) => !ZERO_WIDTH.has(ch.codePointAt(0)!))
    .map((ch) => {
      const point = ch.codePointAt(0)!;
      if (SINGLE_QUOTES.has(point)) return "'";
      if (DOUBLE_QUOTES.has(point)) return '"';
      return ch;
    })
    .join('');
  return folded.replace(/\s+/gu, ' ').trim().toLocaleLowerCase(locale);
}

const segmenters = new Map<Locale, Intl.Segmenter>();

/**
 * Whether `text` holds at least two characters: graphemes where the runtime
 * segments them, code points otherwise (spec 11, assumption 3). It stops at
 * the second, because the endpoint asks this once per form (about 200 on
 * classroom-groups) of a quote of up to 1000 units, on workerd's CPU budget.
 */
function hasTwoCharacters(text: string, locale: Locale): boolean {
  let units: Iterator<unknown>;
  if (typeof Intl.Segmenter === 'function') {
    let segmenter = segmenters.get(locale);
    if (!segmenter) {
      segmenter = new Intl.Segmenter(locale, { granularity: 'grapheme' });
      segmenters.set(locale, segmenter);
    }
    units = segmenter.segment(text)[Symbol.iterator]();
  } else units = text[Symbol.iterator]();
  return !units.next().done && !units.next().done;
}

/** Rule 3 as an anchored literal scan: each slot a non-empty wildcard, no backtracking. */
function wholeMessage(quote: string, runs: readonly string[]): boolean {
  const first = runs[0];
  const last = runs[runs.length - 1];
  if (!quote.startsWith(first) || !quote.endsWith(last)) return false;
  let at = first.length;
  for (const run of runs.slice(1, -1)) {
    const found = quote.indexOf(run, at + 1);
    if (found < 0) return false;
    at = found + run.length;
  }
  return quote.length - last.length >= at + 1;
}

/**
 * Spec 5's three rules for one form. Both sides arrive normalised: `needle`
 * by `normalise`, the form's runs by normalising them joined on SLOT, so a
 * space either side of a slot survives.
 */
export function matchesForm(
  needle: string,
  form: ReportForm,
  locale: Locale,
): boolean {
  if (needle === '') return false;
  if (needle === form.display) return true;
  if (
    hasTwoCharacters(needle, locale) &&
    form.runs.some((run) => run.includes(needle))
  )
    return true;
  // Clarification 6: a form with under 2 characters of fixed wording would match anything.
  const wholeMessageAllowed =
    form.runs.length > 1 && hasTwoCharacters(form.runs.join(''), locale);
  return wholeMessageAllowed && wholeMessage(needle, form.runs);
}

const normalisedTables = new Map<string, readonly ReportableString[]>();

/** A page's strings with every form normalised once, cached per page and locale. */
function normalisedStrings(
  page: PageId,
  locale: Locale,
): readonly ReportableString[] {
  const cacheKey = `${page}:${locale}`;
  let table = normalisedTables.get(cacheKey);
  if (!table) {
    table = reportableStrings(page, locale).map(({ key, forms }) => ({
      key,
      forms: forms.map(({ runs }) => {
        const normalRuns = normalise(runs.join(SLOT), locale).split(SLOT);
        return { display: normalRuns.join(ELLIPSIS), runs: normalRuns };
      }),
    }));
    normalisedTables.set(cacheKey, table);
  }
  return table;
}

/** Every key whose forms the quote matches (spec 5); empty when it is `not-found`. */
export function matchingKeys(
  quote: string,
  page: PageId,
  locale: Locale,
): string[] {
  const needle = normalise(quote, locale);
  return normalisedStrings(page, locale)
    .filter(({ forms }) =>
      forms.some((form) => matchesForm(needle, form, locale)),
    )
    .map(({ key }) => key);
}

export const MAX_FIELD_UNITS = 1000;
export const MAX_BODY_BYTES = 65536;
/** The `reports` table's columns, as `migrations/0001_reports.sql` creates them. */
export const REPORT_COLUMNS = [
  'id',
  'received_at',
  'locale',
  'page',
  'quote',
  'keys',
  'suggestion',
  'note',
] as const;

export type Outcome = 'sent' | 'not-found' | 'rejected' | 'failed';

/** The slice of D1's prepared statement this module uses. */
export interface ReportsStatement {
  bind(...values: unknown[]): ReportsStatement;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
}

/** The slice of a D1 binding this module uses. */
export interface ReportsDatabase {
  prepare(query: string): ReportsStatement;
}

/** The Pages Functions' `env`: absent `REPORTS` is a real failure, reported as such. */
export interface ReportEnv {
  readonly REPORTS?: ReportsDatabase;
}

const JSON_STATUS: Record<Outcome, number> = {
  sent: 200,
  'not-found': 422,
  rejected: 400,
  failed: 503,
};
/** `_headers` does not apply to Function responses, so every answer sets its own (spec 6.1). */
const ALWAYS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;
const FORM_TYPE = 'application/x-www-form-urlencoded';
const INSERT = `INSERT INTO reports (${REPORT_COLUMNS.join(', ')}) VALUES (${REPORT_COLUMNS.map((_, at) => `?${at + 1}`).join(', ')})`;
const HEALTH_QUERY = "SELECT name FROM pragma_table_info('reports')";

const plain = (status: number, extra: Record<string, string> = {}): Response =>
  new Response(null, { status, headers: { ...ALWAYS, ...extra } });

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...ALWAYS, 'Content-Type': 'application/json; charset=utf-8' },
  });

const wantsJson = (request: Request): boolean =>
  (request.headers.get('Accept') ?? '').includes('application/json');

/** Redirect mode's target is built from checked values only: nothing the visitor typed reaches a header. */
const outcome = (
  result: Outcome,
  request: Request,
  locale: Locale,
  page: PageId,
): Response =>
  wantsJson(request)
    ? json({ outcome: result }, JSON_STATUS[result])
    : plain(303, {
        Location: `${pagePath(page, locale)}#${reportIdStem(page, locale)}-${result}`,
      });

/** Below U+0020 except TAB and LF, or U+007F–U+009F: nothing a browser form sends. */
const hasControlCharacter = (text: string): boolean =>
  [...text].some((ch) => {
    const point = ch.codePointAt(0)!;
    return (
      (point < 0x20 && point !== 0x09 && point !== 0x0a) ||
      (point >= 0x7f && point <= 0x9f)
    );
  });

const within = (text: string, min: number): boolean =>
  text.length >= min &&
  text.length <= MAX_FIELD_UNITS &&
  !hasControlCharacter(text);

/** A textarea's maxlength counts a line break as one unit; submission sends CRLF (spec 6.1). */
const field = (fields: URLSearchParams, name: string): string =>
  (fields.get(name) ?? '').replace(/\r\n/g, '\n');

const describeError = (error: unknown): string =>
  error instanceof Error
    ? `${error.name}: ${error.message}`
    : 'NonError: a value that is not an Error was thrown';

/**
 * The body, or null once it passes `cap` bytes. A chunked body declares no
 * Content-Length, so `arrayBuffer()` would hold all of it (up to the
 * platform's 100 MB) before check 4 could refuse it.
 */
async function readCapped(
  request: Request,
  cap: number,
): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(read.value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
}

export async function handleReport(
  request: Request,
  env: ReportEnv,
  log: (line: string) => void = console.error,
): Promise<Response> {
  if (request.method !== 'POST') return plain(405, { Allow: 'POST' });
  const origin = request.headers.get('Origin');
  if (origin === null || origin !== new URL(request.url).origin)
    return plain(403);
  const type = (request.headers.get('Content-Type') ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (type !== FORM_TYPE) return plain(415);
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES)
    return plain(413);
  const body = await readCapped(request, MAX_BODY_BYTES);
  if (body === null) return plain(413);

  const fields = new URLSearchParams(new TextDecoder().decode(body));
  const locale = fields.get('locale');
  const page = fields.get('page');
  if (!isLocale(locale) || !isBetaLocale(locale) || !isPageId(page))
    return wantsJson(request) ? json({ outcome: 'rejected' }, 400) : plain(400);

  if (field(fields, 'website') !== '')
    return outcome('sent', request, locale, page);

  const quote = field(fields, 'quote');
  const suggestion = field(fields, 'suggestion');
  const note = field(fields, 'note');
  if (
    !within(quote, 1) ||
    normalise(quote, locale) === '' ||
    !within(suggestion, 0) ||
    !within(note, 0)
  )
    return outcome('rejected', request, locale, page);

  const keys = matchingKeys(quote, page, locale);
  if (keys.length === 0) return outcome('not-found', request, locale, page);

  try {
    if (!env.REPORTS) throw new Error('the REPORTS binding is missing');
    await env.REPORTS.prepare(INSERT)
      .bind(
        crypto.randomUUID(),
        new Date().toISOString(),
        locale,
        page,
        quote,
        JSON.stringify(keys),
        suggestion,
        note,
      )
      .run();
  } catch (error) {
    log(`report failed: ${describeError(error)}`);
    return outcome('failed', request, locale, page);
  }
  return outcome('sent', request, locale, page);
}

export const schemaMatches = (columns: readonly string[]): boolean =>
  columns.length === REPORT_COLUMNS.length &&
  REPORT_COLUMNS.every((column) => columns.includes(column));

/** Proves the binding and the migration without writing a row, and returns no counts or content (spec 6.2). */
export async function reportHealth(
  request: Request,
  env: ReportEnv,
  log: (line: string) => void = console.error,
): Promise<Response> {
  if (request.method !== 'GET') return plain(405, { Allow: 'GET' });
  let ok = false;
  try {
    if (!env.REPORTS) throw new Error('the REPORTS binding is missing');
    const { results } = await env.REPORTS.prepare(HEALTH_QUERY).all<{
      name: string;
    }>();
    ok = schemaMatches(results.map(({ name }) => name));
    if (!ok)
      log('report health: the reports table does not match the migration');
  } catch (error) {
    log(`report health: ${describeError(error)}`);
  }
  return json({ ok }, ok ? 200 : 503);
}
