/**
 * The daily limits never keep an IP (#872 AC3). Every value bound to every
 * statement a counted report sends is read WHOLE against the exact list it
 * must be, with an address planted in the CF-Connecting-IP header, so the
 * address cannot be among them in any spelling. The unit suite keeps the
 * stand-in (report-endpoint.test.ts: one fixed address's counter).
 */
import { describe, expect, it } from 'vitest';
import { handleReport, matchingKeys } from '../../src/lib/report';
import { counterKey } from '../../src/lib/report-limits';
import { scriptedDatabase, storedOn } from '../report-fakes';
import { post, quote, valid } from '../report-endpoint-shared';

const SECRET = 'logs-suite-secret-0123456789abcdef';
const DAY = '2026-10-19';
const NOW = () => new Date(`${DAY}T08:00:00.000Z`);
const ID = expect.stringMatching(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);

describe('a counted report binds exactly its own values, never the address (AC3)', () => {
  it.each([
    ['an IPv4 address', '198.51.100.77', '198.51.100.77'],
    ['an IPv6 address', '2001:db8:aa:bb:1:2:3:4', '2001:0db8:00aa:00bb::/64'],
  ])('%s', async (_what, ip, connection) => {
    const { db, batches } = scriptedDatabase([storedOn(1, 1)]);
    await handleReport(
      post(valid(), { json: true, headers: { 'CF-Connecting-IP': ip } }),
      { REPORTS: db, REPORT_LIMITS: 'on', REPORT_COUNTER_SECRET: SECRET },
      () => {
        throw new Error('a stored report logs nothing');
      },
      NOW,
    );
    const key = await counterKey(SECRET, DAY, connection);
    expect(batches.flat().flatMap(({ values }) => values)).toEqual([
      DAY,
      ID,
      `${DAY}T08:00:00.000Z`,
      'vi',
      'home',
      quote,
      JSON.stringify(matchingKeys(quote, 'home', 'vi')),
      '',
      '',
      DAY,
      50,
      key,
      5,
      DAY,
      'all',
      ID,
      DAY,
      key,
      ID,
      DAY,
      key,
    ]);
  });

  it('one address keys differently on two days', async () => {
    expect(await counterKey(SECRET, DAY, '198.51.100.77')).not.toBe(
      await counterKey(SECRET, '2026-10-20', '198.51.100.77'),
    );
  });
});
