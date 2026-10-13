/**
 * `npm run reports:review` (#348): the operator's read of the `reports`
 * table, each report beside its English source and a back-translation of the
 * suggestion. The decisions are pure (`src/lib/report-review.ts`); the engine
 * client is exercised against a real local HTTP server, not a stub.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { en } from '../../src/lib/i18n/en';
import { siteEn, siteVi } from '../../src/lib/i18n/site';
import { vi as viStrings } from '../../src/lib/i18n/vi';
import { CATALOGUES } from '../../src/lib/i18n/back-translate';
import { REPORT_COLUMNS } from '../../src/lib/report';
import {
  REVIEW_DATABASES,
  REVIEW_SELECT,
  catalogueText,
  databaseFrom,
  escaped,
  needsBackTranslation,
  reportRows,
  reviewBlock,
  wranglerArgs,
  type Catalogues,
  type ReportRow,
} from '../../src/lib/report-review';
import { call, readBack } from '../../scripts/back-translate-client.mjs';
import { backTranslations } from '../../scripts/reports-review.mjs';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import { codeWithoutComments } from './source-text';

const ESC = String.fromCharCode(92);
/** LibreTranslate's `GET /languages`, for the locales these tests send. */
const LANGUAGES = [
  { code: 'en', targets: ['vi', 'th'] },
  { code: 'vi', targets: ['en'] },
  { code: 'th', targets: ['en'] },
];
const BELL = String.fromCharCode(7);
const RLO = String.fromCharCode(0x202e);

/** A row as wrangler prints it: every column a string, `keys` JSON-encoded. */
const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 'a7d1a431-a963-49e4-8b9a-02614a2d3017',
  received_at: '2026-09-26T09:50:40.538Z',
  locale: 'vi',
  page: 'home',
  quote: 'Báo lỗi bản dịch',
  keys: '["site.report.open"]',
  suggestion: '',
  note: '',
  ...overrides,
});

/** wrangler's `--json` answer around some rows, as measured on the dev database. */
const answer = (results: unknown[]) => [
  { results, success: true, meta: { changes: 0, rows_read: results.length } },
];

const row = (overrides: Record<string, unknown> = {}): ReportRow =>
  reportRows(answer([stored(overrides)]))[0];

/** Fixture tables: small, and different in every locale that matters here. */
const fixture: Catalogues = {
  en: {
    strings: { greet: 'Hello', list: ['one', 'two'] },
    site: { nav: { home: 'Home' } },
  },
  id: {
    strings: { greet: 'Halo', list: ['satu', 'dua'] },
    site: { nav: { home: 'Beranda' } },
  },
  zh: {
    strings: { greet: '你好', list: ['一', '二'] },
    site: { nav: { home: '首页' } },
  },
  vi: {
    strings: { greet: 'Xin chào', list: ['một', 'hai'] },
    site: { nav: { home: 'Trang chủ' } },
  },
  th: {
    strings: { greet: 'สวัสดี', list: ['หนึ่ง', 'สอง'] },
    site: { nav: { home: 'หน้าแรก' } },
  },
};

describe('the database is named, and only one of two (AC1)', () => {
  it('accepts each of the two databases', () => {
    expect(REVIEW_DATABASES).toEqual(['shyden-reports-dev', 'shyden-reports']);
    for (const name of REVIEW_DATABASES)
      expect(databaseFrom([name])).toBe(name);
  });

  it.each([
    ['no argument', []],
    ['another database', ['shyden-reports-prod']],
    ['two databases', ['shyden-reports-dev', 'shyden-reports']],
    ['a flag', ['--remote']],
  ])('refuses %s, naming the two it accepts', (_, args) => {
    expect(() => databaseFrom(args)).toThrow(
      /^usage: npm run reports:review <shyden-reports-dev\|shyden-reports>/,
    );
  });
});

describe('the one command it builds only reads (AC5)', () => {
  it('selects every stored column, oldest first', () => {
    expect(REVIEW_SELECT).toBe(
      `SELECT ${REPORT_COLUMNS.join(', ')} FROM reports ORDER BY received_at, id`,
    );
    expect(REVIEW_SELECT).not.toMatch(
      /;|\b(DELETE|UPDATE|INSERT|DROP|ALTER)\b/i,
    );
  });

  it('is d1 execute, remote, as JSON, with that SELECT and nothing else', () => {
    expect(wranglerArgs('shyden-reports-dev')).toEqual([
      'd1',
      'execute',
      'shyden-reports-dev',
      '--remote',
      '--json',
      '--command',
      REVIEW_SELECT,
    ]);
  });

  it('is the only process the script starts', () => {
    const file = 'scripts/reports-review.mjs';
    const code = codeWithoutComments(file, readFileSync(file, 'utf8'));
    const starts = [
      ...code.matchAll(
        /\b(execFileSync|execSync|spawnSync|spawn|exec|execFile|fork)\s*\(/g,
      ),
    ].map(([, callee]) => callee);
    expect(starts).toEqual(['execFileSync']);
    expect(code).toMatch(
      /execFileSync\(\s*WRANGLER,\s*wranglerArgs\(database\)/,
    );
  });
});

describe('a stored row is checked before it is printed (AC2)', () => {
  it('reads the rows wrangler prints, keys decoded', () => {
    expect(row({ keys: '["site.report.open","greet"]' })).toEqual({
      ...stored(),
      keys: ['site.report.open', 'greet'],
    });
  });

  it('puts the rows in received order, then by id', () => {
    const rows = reportRows(
      answer([
        stored({ id: 'c', received_at: '2026-09-26T12:00:00.000Z' }),
        stored({ id: 'b', received_at: '2026-09-26T09:00:00.000Z' }),
        stored({ id: 'a', received_at: '2026-09-26T12:00:00.000Z' }),
      ]),
    );
    expect(rows.map(({ id }) => id)).toEqual(['b', 'a', 'c']);
  });

  it('reads an empty table as no reports', () => {
    const statements = answer([]);
    expect(
      searched(reportRows(statements), {
        of: statements,
        what: 'statements in the answer',
      }),
    ).toEqual([]);
    expect(
      floorBreach('report-review/empty-table-statements', statements.length),
    ).toBeUndefined();
  });

  it.each([
    [
      'a failed statement',
      [{ results: [], success: false }],
      /did not succeed/,
    ],
    ['no statement', [], /one statement/],
    ['two statements', [...answer([]), ...answer([])], /one statement/],
    ['not a list', { results: [] }, /one statement/],
    [
      'a missing column',
      answer([{ ...stored(), note: undefined }]),
      /a7d1a431.*note/,
    ],
    [
      'a column that is not text',
      answer([stored({ page: 3 })]),
      /a7d1a431.*page/,
    ],
    [
      'keys that are not JSON',
      answer([stored({ keys: 'site.x' })]),
      /a7d1a431.*keys/,
    ],
    [
      'keys that are not a list of text',
      answer([stored({ keys: '[1]' })]),
      /a7d1a431.*keys/,
    ],
    [
      'a locale the site does not have',
      answer([stored({ locale: 'fr' })]),
      /a7d1a431.*locale "fr"/,
    ],
  ])('refuses %s, naming what is wrong', (_, output, message) => {
    expect(() => reportRows(output)).toThrow(message);
  });
});

describe('each key is read from the catalogues (AC3)', () => {
  it('reads tool copy by its bare path, and site copy under site.', () => {
    expect(catalogueText(fixture, 'vi', 'greet')).toBe('Xin chào');
    expect(catalogueText(fixture, 'vi', 'list[1]')).toBe('hai');
    expect(catalogueText(fixture, 'vi', 'site.nav.home')).toBe('Trang chủ');
    expect(catalogueText(fixture, 'en', 'site.nav.home')).toBe('Home');
  });

  it('reads a tool key that merely starts with "site" as tool copy', () => {
    // Only `site.` names the site table: a tool key spelled `siteName` is
    // tool copy, and a bare `site` prefix check would look for it in the
    // wrong table and print it as missing (#390).
    const catalogues: Catalogues = {
      ...fixture,
      vi: { ...fixture.vi, strings: { siteName: 'Tên trang' } },
    };
    expect(catalogueText(catalogues, 'vi', 'siteName')).toBe('Tên trang');
  });

  it('has nothing for a missing key, or for a key naming a table', () => {
    expect(catalogueText(fixture, 'vi', 'gone')).toBeUndefined();
    expect(catalogueText(fixture, 'vi', 'site.nav')).toBeUndefined();
    expect(catalogueText(fixture, 'vi', 'site.greet')).toBeUndefined();
  });

  it('reads the real catalogues the way report.ts spells their keys', () => {
    expect(siteVi.report.open).not.toBe(siteEn.report.open);
    expect(catalogueText(CATALOGUES, 'vi', 'site.report.open')).toBe(
      siteVi.report.open,
    );
    expect(catalogueText(CATALOGUES, 'en', 'site.report.open')).toBe(
      siteEn.report.open,
    );
    expect(viStrings.rosterColSex).not.toBe(en.rosterColSex);
    expect(catalogueText(CATALOGUES, 'vi', 'rosterColSex')).toBe(
      viStrings.rosterColSex,
    );
  });

  it('prints the English and the locale text for every matched key', () => {
    const block = reviewBlock(
      row({ keys: '["greet","site.nav.home"]', quote: 'Xin chào' }),
      fixture,
      { kind: 'not-needed' },
    );
    expect(block).toContain('key         greet');
    expect(block).toContain('  English   "Hello"');
    expect(block).toContain('  vi now    "Xin chào"');
    expect(block).toContain('key         site.nav.home');
    expect(block).toContain('  English   "Home"');
    expect(block).toContain('  vi now    "Trang chủ"');
    expect(block.indexOf('greet')).toBeLessThan(block.indexOf('site.nav.home'));
  });

  it("prints a key only English holds as missing, never the locale's text as undefined", () => {
    const catalogues: Catalogues = {
      ...fixture,
      en: { ...fixture.en, strings: { fresh: 'New' } },
    };
    const block = reviewBlock(row({ keys: '["fresh"]' }), catalogues, {
      kind: 'not-needed',
    });
    expect(block).toContain('key         fresh');
    expect(block).toContain('  missing from the catalogue');
  });

  it('prints a key the catalogue no longer holds, rather than skipping it', () => {
    const block = reviewBlock(row({ keys: '["gone"]' }), fixture, {
      kind: 'not-needed',
    });
    expect(block).toContain('key         gone');
    expect(block).toContain('  missing from the catalogue');
    expect(block).not.toMatch(/^ {2}(English|vi now) /m);
  });
});

describe('the block carries every field (AC2)', () => {
  const block = () =>
    reviewBlock(
      row({ suggestion: 'Báo cáo lỗi dịch', note: 'seen on a phone' }),
      fixture,
      { kind: 'made', text: 'Report a translation error' },
    );

  it('names the report, when, where and in which language', () => {
    const text = block();
    expect(text.split('\n')[0]).toBe(
      '── report a7d1a431-a963-49e4-8b9a-02614a2d3017',
    );
    expect(text).toContain('received    2026-09-26T09:50:40.538Z');
    expect(text).toContain('locale      vi');
    expect(text).toContain('page        home');
    expect(text).toContain('quoted      "Báo lỗi bản dịch"');
  });

  it('gives the suggestion, what it says in English, and the note marked private', () => {
    const text = block();
    expect(text).toContain('suggestion  "Báo cáo lỗi dịch"');
    expect(text).toContain('  in English "Report a translation error"');
    expect(text).toContain('note        "seen on a phone"');
    expect(text).toContain(
      '            private: never copy the note into a public ticket',
    );
  });
});

describe('a back-translation is asked for only where it can say something (AC4)', () => {
  it('sends a suggestion in a translated locale', () => {
    expect(needsBackTranslation(row({ suggestion: 'Báo cáo' }))).toBe(true);
  });

  it.each([
    ['an empty suggestion', { suggestion: '' }],
    ['a blank suggestion', { suggestion: ' \n\t ' }],
    ['an English report', { locale: 'en', suggestion: 'Report a problem' }],
  ])('never sends %s', (_, overrides) => {
    expect(needsBackTranslation(row(overrides))).toBe(false);
  });

  it('says why nothing was sent, per report', () => {
    const none = reviewBlock(row(), fixture, { kind: 'not-needed' });
    expect(none).toContain('suggestion  (none)');
    expect(none).toContain(
      '  in English not asked for: no suggestion to read back',
    );
    const english = reviewBlock(
      row({ locale: 'en', suggestion: 'Report it' }),
      fixture,
      { kind: 'not-needed' },
    );
    expect(english).toContain(
      '  in English not asked for: the suggestion is English',
    );
    const unset = reviewBlock(row({ suggestion: 'Báo cáo' }), fixture, {
      kind: 'no-engine',
    });
    expect(unset).toContain(
      '  in English not made: BACK_TRANSLATE_URL is not set',
    );
  });

  it('prints an engine failure in the report it failed for', () => {
    const failed = reviewBlock(row({ suggestion: 'Báo cáo' }), fixture, {
      kind: 'failed',
      reason: 'POST http://x/translate answered 500: boom',
    });
    expect(failed).toContain(
      '  in English FAILED: POST http://x/translate answered 500: boom',
    );
  });
});

describe('what a visitor typed prints escaped, never raw (AC6)', () => {
  it('escapes line breaks, control and format characters, and the backslash', () => {
    expect(escaped(`a\nb\tc${BELL}d${RLO}e${ESC}f`)).toBe(
      `a${ESC}nb${ESC}tc${ESC}u{7}d${ESC}u{202e}e${ESC}${ESC}f`,
    );
  });

  it('leaves every script the site speaks alone', () => {
    const copy = 'Báo lỗi 报告翻译 รายงานคำแปล Laporkan';
    expect(escaped(copy)).toBe(copy);
  });

  it('escapes the page and an engine failure too, which the row and the engine supply', () => {
    const block = reviewBlock(
      row({ page: `home${BELL}`, suggestion: 'Báo cáo' }),
      fixture,
      {
        kind: 'failed',
        reason: `engine said ${String.fromCharCode(27)}[2J`,
      },
    );
    expect(block).toContain(`page        home${ESC}u{7}`);
    expect(block).toContain(`  in English FAILED: engine said ${ESC}u{1b}[2J`);
  });

  it('never lets a note put a raw control character on the terminal', () => {
    const block = reviewBlock(
      row({
        note: `line one\nline two${BELL}`,
        quote: `x${String.fromCharCode(27)}[2J`,
      }),
      fixture,
      { kind: 'not-needed' },
    );
    expect(block).toContain(`note        "line one${ESC}nline two${ESC}u{7}"`);
    expect(block).toContain(`quoted      "x${ESC}u{1b}[2J"`);
    const body = block.split('\n');
    for (const line of body)
      expect(line, line).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
    expect(body.length).toBeGreaterThan(8);
  });
});

/** Longer than the 200 characters a refusal quotes. */
const BAD_GATEWAY = `<html>${'bad gateway '.repeat(30)}</html>`;

describe('the engine client has one home (AC4)', () => {
  let server: Server;
  let url: string;
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      let raw = '';
      request.on('data', (chunk) => (raw += chunk));
      request.on('end', () => {
        if (request.method === 'GET' && request.url === '/languages') {
          requests.push({ path: request.url, body: {} });
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify(LANGUAGES));
          return;
        }
        const body = JSON.parse(raw) as { q: string[] };
        requests.push({ path: request.url ?? '', body });
        // What a proxy sends when the engine behind it is down: HTML.
        if (body.q.includes('html please')) {
          response.writeHead(502, { 'content-type': 'text/html' });
          response.end(BAD_GATEWAY);
          return;
        }
        if (body.q.includes('plain please')) {
          response.writeHead(200, { 'content-type': 'text/plain' });
          response.end('OK');
          return;
        }
        if (body.q.includes('short please')) {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ translatedText: [] }));
          return;
        }
        if (body.q.includes('refuse me')) {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'unsupported text' }));
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            translatedText: body.q.map((text) => `EN(${text})`),
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  /**
   * Send a sentinel, and split what the stand-in recorded into the requests
   * made before it and the whole record. The sentinel proves the stand-in is
   * recording, so "none before it" means none were made (#118).
   */
  const sentinelSent = async () => {
    await call(`${url}/languages`);
    expect(requests.at(-1)?.path).toBe('/languages');
    return { before: requests.slice(0, -1), all: [...requests] };
  };

  it('reads texts back in batches of 25, in order', async () => {
    requests.length = 0;
    const texts = Array.from({ length: 30 }, (_, index) => `t${index}`);
    const back = await readBack(url, 'k', 'vi', texts);
    expect(back).toEqual(texts.map((text) => `EN(${text})`));
    expect(
      requests.map(({ path, body }) => [path, (body.q as string[]).length]),
    ).toEqual([
      ['/translate', 25],
      ['/translate', 5],
    ]);
    expect(requests[0].body).toMatchObject({
      source: 'vi',
      target: 'en',
      api_key: 'k',
    });
  });

  it("surfaces the engine's own words when it refuses", async () => {
    await expect(readBack(url, undefined, 'vi', ['refuse me'])).rejects.toThrow(
      /answered 400: unsupported text/,
    );
  });

  it('quotes the start of a refusal that is not JSON, naming the request', async () => {
    await expect(
      readBack(url, undefined, 'vi', ['html please']),
    ).rejects.toMatchObject({
      message: `POST ${url}/translate answered 502: ${BAD_GATEWAY.slice(0, 200)}`,
    });
  });

  it('refuses an answer that is not JSON', async () => {
    await expect(
      readBack(url, undefined, 'vi', ['plain please']),
    ).rejects.toMatchObject({
      message: `POST ${url}/translate answered with no JSON`,
    });
  });

  it('refuses an answer with fewer texts than it was sent', async () => {
    await expect(
      readBack(url, undefined, 'vi', ['short please']),
    ).rejects.toMatchObject({
      message: 'expected 1 translatedText entries, got 0',
    });
  });

  it('says which engine it could not reach, and why', async () => {
    // A port nothing listens on: the engine's container is not running.
    const closed = createServer();
    await new Promise<void>((done) => closed.listen(0, '127.0.0.1', done));
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>((done) => closed.close(() => done()));
    await expect(
      call(`http://127.0.0.1:${port}/languages`),
    ).rejects.toMatchObject({
      message: `GET http://127.0.0.1:${port}/languages could not be reached: connect ECONNREFUSED 127.0.0.1:${port}`,
    });
  });

  describe('the script asks the engine only where it can say something', () => {
    const rows = () => [
      row({ id: 'empty', suggestion: '' }),
      row({ id: 'english', locale: 'en', suggestion: 'Report it' }),
      row({ id: 'vi', suggestion: 'Báo cáo' }),
      row({ id: 'refused', suggestion: 'refuse me' }),
      row({ id: 'zh', locale: 'zh', suggestion: '报告' }),
    ];

    it('reads each suggestion back, and keeps a failure with its report', async () => {
      requests.length = 0;
      expect(
        await backTranslations(rows(), { BACK_TRANSLATE_URL: `${url}/` }),
      ).toEqual([
        { kind: 'not-needed' },
        { kind: 'not-needed' },
        { kind: 'made', text: 'EN(Báo cáo)' },
        {
          kind: 'failed',
          reason: expect.stringMatching(/answered 400: unsupported text/),
        },
        {
          kind: 'failed',
          reason: expect.stringMatching(/cannot read zh into English/),
        },
      ]);
      expect(requests.map(({ path, body }) => [path, body.q])).toEqual([
        ['/languages', undefined],
        ['/translate', ['Báo cáo']],
        ['/translate', ['refuse me']],
      ]);
    });

    it('makes none, and says so per report, without BACK_TRANSLATE_URL', async () => {
      requests.length = 0;
      expect(await backTranslations(rows(), {})).toEqual([
        { kind: 'not-needed' },
        { kind: 'not-needed' },
        { kind: 'no-engine' },
        { kind: 'no-engine' },
        { kind: 'no-engine' },
      ]);
      const recorded = await sentinelSent();
      expect(
        searched(recorded.before, {
          of: recorded.all,
          what: 'requests the engine stand-in recorded, the sentinel included',
        }),
      ).toEqual([]);
      expect(
        floorBreach('report-review/no-engine-requests', recorded.all.length),
      ).toBeUndefined();
    });

    it('reports an engine it cannot reach in every report that needed it', async () => {
      const results = await backTranslations(rows(), {
        BACK_TRANSLATE_URL: 'localhost:5000',
      });
      expect(results.map(({ kind }) => kind)).toEqual([
        'not-needed',
        'not-needed',
        'failed',
        'failed',
        'failed',
      ]);
      expect(results[2]).toEqual({
        kind: 'failed',
        reason: expect.stringMatching(/^BACK_TRANSLATE_URL must be/),
      });
    });

    it('never calls the engine when no report needs it', async () => {
      requests.length = 0;
      const results = await backTranslations([row({ suggestion: '' })], {
        BACK_TRANSLATE_URL: url,
      });
      expect(results).toEqual([{ kind: 'not-needed' }]);
      const recorded = await sentinelSent();
      expect(
        searched(recorded.before, {
          of: recorded.all,
          what: 'requests the engine stand-in recorded, the sentinel included',
        }),
      ).toEqual([]);
      expect(
        floorBreach('report-review/not-needed-requests', recorded.all.length),
      ).toBeUndefined();
    });
  });

  it('is what i18n-back-translate.mjs uses, not a copy', () => {
    const file = 'scripts/i18n-back-translate.mjs';
    const code = codeWithoutComments(file, readFileSync(file, 'utf8'));
    expect(code).toMatch(
      /import \{[^}]*\bcall\b[^}]*\breadBack\b[^}]*\} from '\.\/back-translate-client\.mjs'/,
    );
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/function\s+call\b/);
  });
});
