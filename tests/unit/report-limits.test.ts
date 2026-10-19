import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  SECRET_MIN_LENGTH,
  connectionOf,
  counterKey,
  limitsSetting,
  utcDay,
} from '../../src/lib/report-limits';

const DEV = 'dev.shyden.co.uk';
const PROD = 'shyden.co.uk';
const on = (total: number, connection: number) => ({
  kind: 'on',
  limits: { total, connection },
});

describe('the defaults are the ruled figures (#872)', () => {
  it('50 in total and 5 per connection', () => {
    expect(DEFAULT_LIMITS).toEqual({ total: 50, connection: 5 });
  });
  it('a secret is at least 32 characters', () => {
    expect(SECRET_MIN_LENGTH).toBe(32);
  });
});

describe('limitsSetting off production (AC9)', () => {
  it.each([
    ['nothing set', {}, { kind: 'off' }],
    ['off', { REPORT_LIMITS: 'off' }, { kind: 'off' }],
    ['an empty switch', { REPORT_LIMITS: '' }, { kind: 'off' }],
    ['on', { REPORT_LIMITS: 'on' }, on(50, 5)],
    ['" On " (trimmed, any case)', { REPORT_LIMITS: ' On ' }, on(50, 5)],
    [
      'on with both numbers',
      {
        REPORT_LIMITS: 'on',
        REPORT_LIMIT_TOTAL: '10',
        REPORT_LIMIT_CONNECTION: '2',
      },
      on(10, 2),
    ],
    ['a switch of "yes"', { REPORT_LIMITS: 'yes' }, { kind: 'invalid' }],
    [
      'a total of 0',
      { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: '0' },
      { kind: 'invalid' },
    ],
    [
      'a total of -1',
      { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: '-1' },
      { kind: 'invalid' },
    ],
    [
      'a total of 1.5',
      { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: '1.5' },
      { kind: 'invalid' },
    ],
    [
      'a total of 1e3',
      { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: '1e3' },
      { kind: 'invalid' },
    ],
    [
      'a total of 05',
      { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: '05' },
      { kind: 'invalid' },
    ],
    [
      'a total of ten',
      { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: 'ten' },
      { kind: 'invalid' },
    ],
    [
      'a total over 1000000',
      { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: '1000001' },
      { kind: 'invalid' },
    ],
    [
      'off with a bad number',
      { REPORT_LIMITS: 'off', REPORT_LIMIT_CONNECTION: 'x' },
      { kind: 'invalid' },
    ],
    [
      'an empty number is unset',
      { REPORT_LIMITS: 'on', REPORT_LIMIT_TOTAL: '' },
      on(50, 5),
    ],
  ])('%s', (_name, env, expected) => {
    expect(limitsSetting(env, DEV)).toEqual(expected);
  });
});

describe('limitsSetting on production: always on (AC9)', () => {
  it.each([
    ['nothing set', {}, on(50, 5)],
    ['switched off', { REPORT_LIMITS: 'off' }, on(50, 5)],
    ['a switch of "banana"', { REPORT_LIMITS: 'banana' }, on(50, 5)],
    ['a total of 100', { REPORT_LIMIT_TOTAL: '100' }, on(100, 5)],
    ['a bad number', { REPORT_LIMIT_TOTAL: 'x' }, { kind: 'invalid' }],
  ])('%s', (_name, env, expected) => {
    expect(limitsSetting(env, PROD)).toEqual(expected);
  });
  it('reads the host in any case', () => {
    expect(limitsSetting({ REPORT_LIMITS: 'off' }, 'SHYDEN.CO.UK')).toEqual(
      on(50, 5),
    );
  });
});

describe('connectionOf: IPv4 by address, IPv6 by /64 (AC10)', () => {
  it.each([
    ['IPv4', '203.0.113.9', '203.0.113.9'],
    ['IPv6 in full', '2001:db8:1:2:3:4:5:6', '2001:0db8:0001:0002::/64'],
    [
      'IPv6 compressed, same /64',
      '2001:db8:1:2:ffff::1',
      '2001:0db8:0001:0002::/64',
    ],
    [
      'IPv6 upper case, trailing ::',
      '2001:DB8:1:2::',
      '2001:0db8:0001:0002::/64',
    ],
    ['the next /64', '2001:db8:1:3::1', '2001:0db8:0001:0003::/64'],
    ['loopback', '::1', '0000:0000:0000:0000::/64'],
    [
      'IPv4-mapped IPv6 counts as the IPv4',
      '::ffff:203.0.113.9',
      '203.0.113.9',
    ],
  ])('%s', (_name, address, expected) => {
    expect(connectionOf(address)).toBe(expected);
  });
  it.each([
    ['no header', null],
    ['empty', ''],
    ['a word', 'localhost'],
    ['an octet over 255', '203.0.113.256'],
    ['three octets', '203.0.113'],
    ['two ::', '1::2::3'],
    ['nine groups', '1:2:3:4:5:6:7:8:9'],
    ['a non-hex group', '2001:db8::g'],
    ['a zone id', 'fe80::1%eth0'],
    ['a five-digit group', '2001:db8:10000::1'],
    ['eight groups and ::', '1:2:3:4:5:6:7:8::'],
  ])('%s is no connection', (_name, address) => {
    expect(connectionOf(address)).toBeNull();
  });
});

describe('counterKey: HMAC-SHA-256 of day and connection (AC3)', () => {
  const SECRET = 'unit-test-secret-0123456789abcdef';
  // Literals from node:crypto createHmac('sha256', SECRET), 2026-10-19.
  it.each([
    [
      '2026-10-19',
      '203.0.113.9',
      '245a1b83ed3a0c41bb3ba3f6beb7fef1811168275c045a8af6a8ac0452dc803b',
    ],
    [
      '2026-10-20',
      '203.0.113.9',
      '759212e4c404d5521d3e53242aa9583576b01f84d452f57e42b5adececf0abac',
    ],
    [
      '2026-10-19',
      '2001:0db8:0001:0002::/64',
      '314a3b541e2cf3c62d6af6c2c44671ab471b44098a11e991b63e30e6c493f733',
    ],
  ])('%s %s', async (day, connection, expected) => {
    expect(await counterKey(SECRET, day, connection)).toBe(expected);
  });
});

describe('utcDay', () => {
  it.each([
    ['2026-10-19T23:59:59.999Z', '2026-10-19'],
    ['2026-10-20T00:00:00.000Z', '2026-10-20'],
  ])('%s is %s', (at, day) => {
    expect(utcDay(new Date(at))).toBe(day);
  });
});
