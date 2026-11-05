/**
 * The row a report stores holds nothing that identifies the visitor (#830):
 * no IP address, user agent, cookie, referrer or account. Shyden ruled
 * 2026-10-16 that a translation report needs none of it, so the `reports`
 * table keeps only what the form asks for.
 *
 * Every row is asserted WHOLE, column by column, so a planted value cannot be
 * in it wherever it was planted: a header, Cloudflare's `request.cf`, or a
 * form field the endpoint does not read. The control beside them plants the
 * same kind of value in a field the row DOES keep, and watches it arrive, so
 * an empty or unread row cannot pass them.
 *
 * The unit suite keeps the stand-in: one fixed request's row
 * (tests/unit/report-endpoint.test.ts). The planted cases run here, before
 * every release.
 */
import { describe, expect, it } from 'vitest';
import {
  REPORT_COLUMNS,
  handleReport,
  matchingKeys,
} from '../../src/lib/report';
import { recordingTable } from '../report-fakes';
import { post, quote, valid, type Fields } from '../report-endpoint-shared';

const ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECEIVED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The one row a request stores, read back against a recording table. */
async function storedRow(request: Request): Promise<unknown[]> {
  const table = recordingTable();
  const response = await handleReport(request, { REPORTS: table.db }, () => {
    throw new Error('a stored report logs nothing');
  });
  expect(response.status, 'the report was accepted and stored').toBe(303);
  expect(table.rows).toHaveLength(1);
  return table.rows[0]!;
}

/** The whole row `fields` must store: the form's own values, nothing else. */
function expectRow(row: unknown[], fields: Fields): void {
  expect(row).toHaveLength(REPORT_COLUMNS.length);
  const [id, receivedAt, ...rest] = row;
  expect(id).toMatch(ID);
  expect(receivedAt).toMatch(RECEIVED_AT);
  expect(rest).toEqual([
    'vi',
    'home',
    quote,
    JSON.stringify(matchingKeys(quote, 'home', 'vi')),
    fields.suggestion ?? '',
    fields.note ?? '',
  ]);
}

const planted = (where: string): string =>
  `planted-${where.toLowerCase()}-${crypto.randomUUID()}`;

describe('the control: the row is read, and keeps what the form sends', () => {
  it.each(['suggestion', 'note'])(
    'a value planted in the %s arrives in the row',
    async (field) => {
      const fields = valid({ [field]: planted(field) });
      const row = await storedRow(post(fields));
      expectRow(row, fields);
      expect(row).toContain(fields[field]);
    },
  );
});

describe('a stored report keeps nothing that identifies the visitor', () => {
  // The headers a browser, a proxy or Cloudflare can put on the request that
  // name the visitor, their device, where they came from or who they are.
  it.each([
    'CF-Connecting-IP',
    'CF-Connecting-IPv6',
    'X-Forwarded-For',
    'X-Real-IP',
    'True-Client-IP',
    'CF-IPCountry',
    'CF-Ray',
    'User-Agent',
    'Sec-CH-UA',
    'Sec-CH-UA-Platform',
    'Sec-CH-UA-Model',
    'Accept-Language',
    'Cookie',
    'Referer',
    'Authorization',
    'Cf-Access-Jwt-Assertion',
    'Cf-Access-Authenticated-User-Email',
  ])('the %s header never reaches the row', async (header) => {
    const fields = valid();
    const row = await storedRow(
      post(fields, { headers: { [header]: planted(header) } }),
    );
    expectRow(row, fields);
  });

  // Cloudflare's own reading of the connection, on `request.cf` in a Worker.
  it.each([
    'city',
    'country',
    'region',
    'postalCode',
    'latitude',
    'longitude',
    'timezone',
    'asn',
    'asOrganization',
    'clientTcpRtt',
  ])('request.cf.%s never reaches the row', async (property) => {
    const fields = valid();
    const request = post(fields);
    Object.defineProperty(request, 'cf', {
      value: { [property]: planted(property) },
    });
    expectRow(await storedRow(request), fields);
  });

  // A field the form does not have, sent by a script or a changed page.
  it.each(['name', 'email', 'phone', 'account', 'ip', 'userAgent'])(
    'a form field named %s never reaches the row',
    async (name) => {
      const fields = valid();
      const row = await storedRow(post({ ...fields, [name]: planted(name) }));
      expectRow(row, fields);
    },
  );
});
