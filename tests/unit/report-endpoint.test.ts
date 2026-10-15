import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MAX_BODY_BYTES,
  MAX_FIELD_UNITS,
  REPORT_COLUMNS,
  handleReport,
  reportHealth,
  schemaMatches,
} from '../../src/lib/report';
import { getSiteStrings } from '../../src/lib/i18n';
import { codeWithoutComments, withoutSqlComments } from './source-text';
import { tableWith } from '../report-fakes';

/**
 * Real `Request` objects, no stand-in database (spec 10). Checks 1–8 return
 * before the database is touched, so they need none; `failed` runs with the
 * REPORTS binding absent, which is a real failure the health check also
 * reports. Check 9 succeeding is proved on a real local D1 (Task 10).
 */
const ORIGIN = 'https://dev.shyden.co.uk';
const ENDPOINT = `${ORIGIN}/api/report`;
const HEALTH = `${ORIGIN}/api/report/health`;
const FORM = 'application/x-www-form-urlencoded';
const quote = getSiteStrings('vi').report.open;
const NO_DB = {};

type Fields = Record<string, string>;
const valid = (extra: Fields = {}): Fields => ({
  locale: 'vi',
  page: 'home',
  quote,
  suggestion: '',
  note: '',
  website: '',
  ...extra,
});

function post(
  fields: Fields | string,
  init: {
    headers?: Record<string, string>;
    json?: boolean;
    method?: string;
  } = {},
) {
  const body =
    typeof fields === 'string'
      ? fields
      : new URLSearchParams(fields).toString();
  return new Request(ENDPOINT, {
    method: init.method ?? 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': FORM,
      ...(init.json ? { Accept: 'application/json' } : {}),
      ...init.headers,
    },
    body: init.method && init.method !== 'POST' ? undefined : body,
  });
}

const answer = async (request: Request, lines: string[] = []) =>
  handleReport(request, NO_DB, (line) => lines.push(line));
const outcomeOf = async (response: Response) =>
  ((await response.json()) as { outcome: string }).outcome;

describe('checks 1-4: the request itself', () => {
  // Every method a form or a script can send, not only GET: a guard written
  // as "refuse GET" passed the GET-only version of this test (#390).
  it.each(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    '1: refuses %s with 405 and Allow',
    async (method) => {
      const response = await answer(post(valid(), { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('POST');
    },
  );

  it('2: refuses a missing Origin, a foreign one, and "null"', async () => {
    for (const origin of [undefined, 'https://evil.example', 'null']) {
      const headers: Record<string, string> = { 'Content-Type': FORM };
      if (origin) headers.Origin = origin;
      const response = await answer(
        new Request(ENDPOINT, {
          method: 'POST',
          headers,
          body: new URLSearchParams(valid()).toString(),
        }),
      );
      expect(response.status, String(origin)).toBe(403);
    }
  });

  it('3: refuses any content type but a urlencoded form, parameters allowed', async () => {
    expect(
      (
        await answer(
          post(valid(), { headers: { 'Content-Type': 'application/json' } }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await answer(
          post(valid(), {
            headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
          }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await answer(
          post(valid(), {
            headers: { 'Content-Type': `${FORM}; charset=UTF-8` },
          }),
        )
      ).status,
    ).not.toBe(415);
    // A media type is case-insensitive (RFC 9110 8.3.1).
    expect(
      (
        await answer(
          post(valid(), {
            headers: { 'Content-Type': 'Application/X-WWW-Form-URLEncoded' },
          }),
        )
      ).status,
    ).not.toBe(415);
  });

  it('4: accepts a body of exactly 64 KiB and refuses one byte more', async () => {
    const base = new URLSearchParams(valid()).toString() + '&pad=';
    const exact = base + 'a'.repeat(MAX_BODY_BYTES - base.length);
    expect(new TextEncoder().encode(exact).byteLength).toBe(MAX_BODY_BYTES);
    expect((await answer(post(exact))).status).not.toBe(413);
    expect((await answer(post(exact + 'a'))).status).toBe(413);
  });

  it('4: stops reading a body that declares no length once it passes 64 KiB', async () => {
    // A chunked body carries no Content-Length, so only the read itself can
    // enforce the cap. This one holds 1 MiB; buffering it all would pull 64
    // chunks, and stopping at the cap pulls about five.
    const chunk = new TextEncoder().encode('a'.repeat(16 * 1024));
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 64) controller.close();
        else controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request(ENDPOINT, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': FORM },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(request.headers.get('Content-Length')).toBeNull();
    expect((await answer(request)).status).toBe(413);
    expect(pulled).toBeLessThan(10);
    // Stopping is not enough: the rest of the body is released, not left open.
    expect(cancelled).toBe(true);
  });

  it('4: refuses a body that declares more than 64 KiB without reading it', async () => {
    // A string body carries no Content-Length on a Request, so the test above
    // and the exact-size test both reach the read. Only a declared length
    // shows the check that refuses before any byte is pulled.
    let pulled = 0;
    // highWaterMark 0: a stream pulls once on construction to fill its queue
    // otherwise, and that pull would read as the handler reading the body.
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled += 1;
          controller.enqueue(new TextEncoder().encode('locale=vi'));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request(ENDPOINT, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': FORM,
        'Content-Length': String(MAX_BODY_BYTES + 1),
      },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(request.headers.get('Content-Length')).toBe(
      String(MAX_BODY_BYTES + 1),
    );
    expect((await answer(request)).status).toBe(413);
    expect(pulled).toBe(0);
  });
});

describe('check 5 and the honeypot', () => {
  it('5: accepts the 404 as not-found and answers on /404 with the block stem', async () => {
    const heading = getSiteStrings('th').notFound.heading;
    const response = await answer(
      post(valid({ locale: 'th', page: 'not-found', quote: heading })),
    );
    // No database: the quote matched, so it reached the insert and failed.
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/404#report-th-failed');
  });

  it('8: the 404 matches only its own block, never the footer chrome', async () => {
    const footer = getSiteStrings('vi').report.open;
    const response = await answer(
      post(valid({ page: 'not-found', quote: footer })),
    );
    expect(response.headers.get('Location')).toBe('/404#report-vi-not-found');
  });

  it('5: refuses English, an unknown locale and an unknown page with a plain 400', async () => {
    for (const fields of [
      valid({ locale: 'en' }),
      valid({ locale: 'fr' }),
      valid({ page: 'admin' }),
      valid({ page: '' }),
    ]) {
      const response = await answer(post(fields));
      expect(response.status, JSON.stringify(fields)).toBe(400);
      expect(response.headers.get('Location')).toBeNull();
    }
  });

  it('5 comes before the honeypot: a filled honeypot with an unknown page is a 400, never a redirect', async () => {
    const response = await answer(
      post(valid({ page: 'https://evil.example', website: 'x' })),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('Location')).toBeNull();
  });

  it('6: a filled honeypot answers sent and stores nothing, even with no database', async () => {
    const lines: string[] = [];
    const response = await answer(
      post(valid({ website: 'http://spam.example' })),
      lines,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/vi/#report-sent');
    // The same report without the honeypot reaches the missing database,
    // which logs one line. One line in all, so the log was live and the
    // honeypot request never tried to store.
    await answer(post(valid()), lines);
    expect(lines).toHaveLength(1);
  });
});

describe('check 7: lengths and content', () => {
  const units = (n: number) => 'x'.repeat(n);

  it('refuses an empty, a blank and a zero-width-only quote', async () => {
    for (const q of ['', '   ', String.fromCharCode(0x200b, 0x200b)]) {
      const response = await answer(post(valid({ quote: q })));
      expect(response.headers.get('Location'), JSON.stringify(q)).toBe(
        '/vi/#report-rejected',
      );
    }
  });

  it(`accepts a suggestion and note of ${MAX_FIELD_UNITS} units and refuses ${MAX_FIELD_UNITS + 1}`, async () => {
    for (const field of ['suggestion', 'note']) {
      const at = await answer(post(valid({ [field]: units(MAX_FIELD_UNITS) })));
      expect(at.headers.get('Location'), field).not.toBe(
        '/vi/#report-rejected',
      );
      const over = await answer(
        post(valid({ [field]: units(MAX_FIELD_UNITS + 1) })),
      );
      expect(over.headers.get('Location'), field).toBe('/vi/#report-rejected');
    }
  });

  it('refuses a quote of 1001 units', async () => {
    const response = await answer(
      post(valid({ quote: units(MAX_FIELD_UNITS + 1) })),
    );
    expect(response.headers.get('Location')).toBe('/vi/#report-rejected');
  });

  it('counts an emoji as two units, as maxlength does', async () => {
    const emoji = String.fromCodePoint(0x1f600);
    const at = await answer(
      post(valid({ note: emoji.repeat(MAX_FIELD_UNITS / 2) })),
    );
    expect(at.headers.get('Location')).not.toBe('/vi/#report-rejected');
    const over = await answer(
      post(valid({ note: emoji.repeat(MAX_FIELD_UNITS / 2) + 'x' })),
    );
    expect(over.headers.get('Location')).toBe('/vi/#report-rejected');
  });

  it('folds CRLF before counting: a 1000-unit note that arrives longer is allowed', async () => {
    const line = 'x'.repeat(99);
    const note = Array.from({ length: 10 }, () => line).join('\r\n');
    expect(note.length).toBe(1008);
    expect(note.replace(/\r\n/g, '\n').length).toBe(999);
    const response = await answer(post(valid({ note })));
    expect(response.headers.get('Location')).not.toBe('/vi/#report-rejected');
  });

  it('refuses a control character other than TAB and LF, in any field', async () => {
    // The quote keeps its real match in front, so without check 7 it would be
    // sent (a CR folds to a space) or not-found, and never rejected.
    for (const name of ['quote', 'suggestion', 'note'])
      for (const code of [0x00, 0x07, 0x0d, 0x1b, 0x7f, 0x85]) {
        const ch = String.fromCharCode(code);
        const value = name === 'quote' ? `${quote}${ch}` : `a${ch}b`;
        const response = await answer(post(valid({ [name]: value })));
        expect(
          response.headers.get('Location'),
          `${name} ${code.toString(16)}`,
        ).toBe('/vi/#report-rejected');
      }
    const tabbed = await answer(post(valid({ note: 'a\tb\nc' })));
    expect(tabbed.headers.get('Location')).not.toBe('/vi/#report-rejected');
  });
});

describe('check 8 and the redirect', () => {
  it('answers not-found for a quote on no page', async () => {
    const response = await answer(
      post(valid({ quote: 'on no page at all, anywhere' })),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/vi/#report-not-found');
  });

  it('builds Location from the checked locale and page only, never from Referer', async () => {
    const response = await answer(
      post(valid({ page: 'classroom-groups', quote: 'on no page at all' }), {
        headers: { Referer: 'https://evil.example/x' },
      }),
    );
    expect(response.headers.get('Location')).toBe(
      '/vi/classroom-groups#report-not-found',
    );
  });
});

describe('check 9 with no database: failed, and a clean log line', () => {
  it('answers failed when the REPORTS binding is absent', async () => {
    const response = await answer(post(valid()));
    expect(response.headers.get('Location')).toBe('/vi/#report-failed');
  });

  it('logs the error name and message, and no visitor text or header', async () => {
    const lines: string[] = [];
    const secret = 'the-suggestion-7f3a';
    await answer(
      post(valid({ suggestion: secret, note: 'note-9c1d' }), {
        headers: { 'User-Agent': 'agent-2b8e' },
      }),
      lines,
    );
    expect(lines).toEqual([
      'report failed: Error: the REPORTS binding is missing',
    ]);
    for (const leak of [secret, 'note-9c1d', 'agent-2b8e', quote, ORIGIN])
      expect(lines[0]).not.toContain(leak);
  });
});

describe('JSON mode', () => {
  it.each([
    [valid({ website: 'x' }), 200, 'sent'],
    [valid({ quote: 'on no page at all, anywhere' }), 422, 'not-found'],
    [valid({ quote: ' ' }), 400, 'rejected'],
    [valid({ page: 'admin' }), 400, 'rejected'],
    [valid(), 503, 'failed'],
  ])('%j answers %i %s', async (fields, status, outcome) => {
    const response = await answer(post(fields, { json: true }));
    expect(response.status).toBe(status);
    expect(response.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(await outcomeOf(response)).toBe(outcome);
  });

  it('keeps checks 1-4 on their own codes', async () => {
    expect(
      (
        await answer(
          post(valid(), {
            json: true,
            headers: { Origin: 'https://evil.example' },
          }),
        )
      ).status,
    ).toBe(403);
  });
});

describe('every response', () => {
  it('carries no-store and nosniff', async () => {
    const requests = [
      new Request(ENDPOINT, { method: 'GET' }),
      post(valid(), { headers: { Origin: 'https://evil.example' } }),
      post(valid({ page: 'admin' })),
      post(valid()),
      post(valid(), { json: true }),
    ];
    for (const request of requests) {
      const response = await answer(request);
      expect(response.headers.get('Cache-Control'), `${response.status}`).toBe(
        'no-store',
      );
      expect(
        response.headers.get('X-Content-Type-Options'),
        `${response.status}`,
      ).toBe('nosniff');
    }
  });
});

describe('the health check', () => {
  it('answers 503 ok:false with no binding, and logs why', async () => {
    const lines: string[] = [];
    const response = await reportHealth(new Request(HEALTH), NO_DB, (line) =>
      lines.push(line),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(lines).toHaveLength(1);
  });

  it('refuses any method but GET with 405 and Allow, before touching the binding', async () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    const response = await reportHealth(
      new Request(HEALTH, { method: 'POST' }),
      NO_DB,
      log,
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    // A GET with no binding logs why, so one line in all proves the log was
    // live and the POST never reached the binding.
    await reportHealth(new Request(HEALTH), NO_DB, log);
    expect(lines).toHaveLength(1);
  });

  it('matches the migration column set exactly, in any order', () => {
    expect(REPORT_COLUMNS).toEqual([
      'id',
      'received_at',
      'locale',
      'page',
      'quote',
      'keys',
      'suggestion',
      'note',
    ]);
    expect(schemaMatches([...REPORT_COLUMNS].reverse())).toBe(true);
    expect(schemaMatches(REPORT_COLUMNS.slice(1))).toBe(false);
    expect(schemaMatches([...REPORT_COLUMNS, 'status'])).toBe(false);
    expect(schemaMatches([])).toBe(false);
    // Same count, one name changed: a length check alone would pass it.
    expect(schemaMatches([...REPORT_COLUMNS.slice(1), 'status'])).toBe(false);
  });

  it('answers 200 ok:true for the migrated table, and logs nothing', async () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    const response = await reportHealth(
      new Request(HEALTH),
      { REPORTS: tableWith(REPORT_COLUMNS) },
      log,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    // A call with no binding through the same log proves it live, so one
    // line in all is the healthy call's silence, not a dead listener.
    await reportHealth(new Request(HEALTH), NO_DB, log);
    expect(lines).toEqual([
      'report health: Error: the REPORTS binding is missing',
    ]);
  });

  it('answers 503 ok:false for a drifted table, and logs the drift', async () => {
    const lines: string[] = [];
    const response = await reportHealth(
      new Request(HEALTH),
      { REPORTS: tableWith([...REPORT_COLUMNS.slice(1), 'status']) },
      (line) => lines.push(line),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
    expect(lines).toEqual([
      'report health: the reports table does not match the migration',
    ]);
  });
});

describe('the migration', () => {
  // Comments stripped, both forms: the migration's own column notes must not
  // satisfy this. A private `--` replace stood here, and a block comment below
  // the table holding the old `quote` line passed the anchored check while the
  // column itself allowed 100000 characters (#390 F160).
  const sql = () =>
    withoutSqlComments(readFileSync('migrations/0001_reports.sql', 'utf8'));

  it('creates exactly the columns the endpoint writes and the health check expects', () => {
    const body = /CREATE TABLE reports \(([\s\S]*)\);/.exec(sql())?.[1];
    expect(body, 'a CREATE TABLE reports statement').toBeDefined();
    const columns = body!
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[0]);
    expect(columns).toEqual([...REPORT_COLUMNS]);
  });

  it('bounds every text column the way check 7 does', () => {
    // Anchored to each column's own line, so no other text can satisfy them
    // (`anchored-presence.test.ts`). The literal 1000 is tied to check 7 by
    // the pin on MAX_FIELD_UNITS.
    expect(MAX_FIELD_UNITS).toBe(1000);
    const text = sql();
    expect(text).toMatch(
      /^\s*quote\s+TEXT NOT NULL CHECK \(length\(quote\) BETWEEN 1 AND 1000\),\s*$/m,
    );
    expect(text).toMatch(
      /^\s*suggestion\s+TEXT NOT NULL DEFAULT '' CHECK \(length\(suggestion\) <= 1000\),\s*$/m,
    );
    expect(text).toMatch(
      /^\s*note\s+TEXT NOT NULL DEFAULT '' CHECK \(length\(note\) <= 1000\)\s*$/m,
    );
  });
});

describe('the Pages Functions are plumbing only', () => {
  it.each([
    ['functions/api/report/index.js', 'handleReport'],
    ['functions/api/report/health.js', 'reportHealth'],
  ])('%s hands the request to %s', (file, handler) => {
    const code = codeWithoutComments(file, readFileSync(file, 'utf8'));
    expect(code).toMatch(
      new RegExp(
        `import \\{ ${handler} \\} from '\\.\\./\\.\\./\\.\\./src/lib/report'`,
      ),
    );
    // The title promises the hand-off, so the export's whole body is
    // pinned: an `onRequest` that imported the handler and answered
    // anything else passed the bare `export const onRequest` match (#390).
    expect(code).toMatch(
      new RegExp(
        `^export const onRequest = \\(\\{ request, env \\}\\) =>\\s+${handler}\\(request, env\\);$`,
        'm',
      ),
    );
  });
});

describe('the runbook', () => {
  // Anchored to whole lines, so the block's own `--` notes cannot satisfy them.
  const runbook = () =>
    readFileSync('docs/runbooks/translation-reports.md', 'utf8');

  it('starts a review with the script, before any DELETE (#348 AC7)', () => {
    const lines = runbook().split('\n');
    const script = lines.findIndex((line) =>
      /^(BACK_TRANSLATE_URL=\S+ )?npm run reports:review shyden-reports(-dev)?$/.test(
        line,
      ),
    );
    const firstDelete = lines.findIndex((line) =>
      /^DELETE FROM reports\b/.test(line),
    );
    expect(script, 'an npm run reports:review line').toBeGreaterThanOrEqual(0);
    expect(firstDelete, 'a DELETE line').toBeGreaterThanOrEqual(0);
    expect(script).toBeLessThan(firstDelete);
  });

  it('lists every stored column, and holds both deletes (AC7)', () => {
    const text = runbook();
    const select = /^SELECT (.+)$/m.exec(text)?.[1];
    expect(select, 'a SELECT line in the runbook').toBeDefined();
    expect(select!.split(', ')).toEqual([...REPORT_COLUMNS]);
    expect(text).toMatch(/^DELETE FROM reports WHERE id = '<id>';$/m);
    expect(text).toMatch(
      /^DELETE FROM reports WHERE note LIKE 'automated dev check %';$/m,
    );
  });

  it('documents the WAF rate limit for the operator (AC5)', () => {
    expect(runbook()).toMatch(
      /^.*`\/api\/report`.*more than 2 requests in 10 s.*Block for 10 s\.$/m,
    );
  });
});
