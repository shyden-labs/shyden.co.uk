/**
 * What the report endpoint and its health check write to the Functions log
 * (#302, #822). The log is read in Cloudflare's dashboard and kept there, so a
 * line must say why a report failed and nothing a visitor sent: no field they
 * typed and no header their browser added. Each line is asserted WHOLE, so
 * the visitor's value cannot be in it whatever it is.
 *
 * The unit suite keeps a stand-in of each: one fixed request and the count
 * of lines (tests/unit/report-endpoint.test.ts). The real case, every field
 * and every header a visitor's request carries, runs here, before every
 * release.
 */
import { describe, expect, it } from 'vitest';
import {
  REPORT_COLUMNS,
  handleReport,
  reportHealth,
} from '../../src/lib/report';
import { tableWith } from '../report-fakes';
import { HEALTH, NO_DB, post, valid } from '../report-endpoint-shared';

const FAILED = 'report failed: Error: the REPORTS binding is missing';

/** The lines one report writes, against no database: check 9 fails. */
const linesFor = async (request: Request): Promise<string[]> => {
  const lines: string[] = [];
  await handleReport(request, NO_DB, (line) => lines.push(line));
  return lines;
};

describe('a failed report logs why, and nothing the visitor sent', () => {
  it('writes one line for the quote, which is page copy and never in it', async () => {
    expect(await linesFor(post(valid()))).toEqual([FAILED]);
  });

  it.each(['suggestion', 'note'])(
    'writes one line, holding none of the %s the visitor typed',
    async (field) => {
      const typed = `${field}-${crypto.randomUUID()}`;
      expect(await linesFor(post(valid({ [field]: typed })))).toEqual([FAILED]);
    },
  );

  it.each([
    'User-Agent',
    'Referer',
    'Accept-Language',
    'X-Forwarded-For',
    'CF-Connecting-IP',
    'CF-IPCountry',
  ])('writes one line, holding none of the %s header', async (header) => {
    const sent = `${header.toLowerCase()}-${crypto.randomUUID()}`;
    expect(
      await linesFor(post(valid(), { headers: { [header]: sent } })),
    ).toEqual([FAILED]);
  });
});

describe('the health check logs exactly why it is unhealthy', () => {
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
