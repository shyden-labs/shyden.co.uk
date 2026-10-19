/**
 * The daily limits never keep an IP (#872 AC3). Every value bound to every
 * statement a report sends is read, with an address planted in the
 * CF-Connecting-IP header; none of them may hold it, in any spelling. The
 * control: the counter that IS bound is the day's HMAC, so an unread batch
 * cannot pass. The unit suite keeps the stand-in (report-endpoint.test.ts:
 * one fixed address's counter).
 */
import { describe, expect, it } from 'vitest';
import { handleReport } from '../../src/lib/report';
import { counterKey } from '../../src/lib/report-limits';
import { scriptedDatabase, storedOn } from '../report-fakes';
import { post, valid } from '../report-endpoint-shared';

const SECRET = 'logs-suite-secret-0123456789abcdef';
const NOW = () => new Date('2026-10-19T08:00:00.000Z');

const PLANTED: readonly (readonly [string, string, readonly string[]])[] = [
  ['an IPv4 address', '198.51.100.77', ['198.51.100.77', '198.51.100']],
  [
    'an IPv6 address',
    '2001:db8:aa:bb:1:2:3:4',
    ['2001:db8:aa:bb', '2001:0db8:00aa:00bb', '1:2:3:4'],
  ],
];

/** Every value one report from `ip` binds, and the lines it logs. */
async function sent(ip: string) {
  const { db, batches } = scriptedDatabase([storedOn(1, 1)]);
  const lines: string[] = [];
  await handleReport(
    post(valid(), { json: true, headers: { 'CF-Connecting-IP': ip } }),
    { REPORTS: db, REPORT_LIMITS: 'on', REPORT_COUNTER_SECRET: SECRET },
    (line) => lines.push(line),
    NOW,
  );
  return {
    bound: batches.flat().flatMap(({ values }) => values.map(String)),
    lines,
  };
}

describe('a counted report binds no part of the address (AC3)', () => {
  it.each(
    PLANTED.flatMap(([what, ip, needles]) =>
      needles.map((needle) => [what, needle, ip] as const),
    ),
  )('%s: no bound value holds %s', async (_what, needle, ip) => {
    const { bound, lines } = await sent(ip);
    expect(bound.filter((value) => value.includes(needle))).toEqual([]);
    expect(lines).toEqual([]);
  });
  it.each(PLANTED)(
    '%s: the batch was read, and binds the day key',
    async (_what, ip) => {
      const { bound } = await sent(ip);
      expect(bound).toHaveLength(21);
      expect(bound).toContain(
        await counterKey(
          SECRET,
          '2026-10-19',
          ip.includes(':') ? '2001:0db8:00aa:00bb::/64' : ip,
        ),
      );
    },
  );
  it('one address keys differently on two days', async () => {
    expect(await counterKey(SECRET, '2026-10-19', '198.51.100.77')).not.toBe(
      await counterKey(SECRET, '2026-10-20', '198.51.100.77'),
    );
  });
});
