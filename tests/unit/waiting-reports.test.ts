import { describe, it, expect } from 'vitest';
import {
  FAILURE_NOTICE,
  NOTICE_AUTHOR,
  REQUEST_TIMEOUT_MS,
  countFrom,
  databaseIdFrom,
  noticeFor,
  postedToday,
  startOfUtcDay,
} from '../../src/lib/waiting-reports';
import { counted } from '../waiting-reports-shared';

/**
 * The waiting-reports count (#349, spec section 15). Every malformed answer
 * must THROW: a zero posts nothing, so an answer misread as zero would
 * silence the operator's notice without anyone noticing.
 */

const PROD_ID = '0b9e6c1a-2f4d-4e8a-9c3b-5d7e1f2a3b4c';
const DEV_ID = '7f3a2b1c-9d8e-4f6a-8b5c-1e2d3c4b5a69';

/** A D1 list answer, in Cloudflare's envelope. */
const listing = (databases: unknown[]) => ({
  success: true,
  errors: [],
  messages: [],
  result: databases,
});

// The statement that reads the reports table and the sentence posted in
// public are the logs suite's (#822).
describe('the constants are pinned to their literal values', () => {
  it('the notice author is the workflow token, and requests give up after 30s', () => {
    expect(NOTICE_AUTHOR).toBe('github-actions[bot]');
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
  });
});

describe('databaseIdFrom', () => {
  it('picks the exact name out of a list holding the dev database beside it', () => {
    const list = listing([
      { uuid: DEV_ID, name: 'shyden-reports-dev' },
      { uuid: PROD_ID, name: 'shyden-reports' },
    ]);
    expect(databaseIdFrom(list)).toBe(PROD_ID);
  });

  it('throws when only the dev database is listed', () => {
    const list = listing([{ uuid: DEV_ID, name: 'shyden-reports-dev' }]);
    expect(() => databaseIdFrom(list)).toThrow(
      /holds 0 databases named shyden-reports/,
    );
  });

  it('throws when two databases carry the name', () => {
    const list = listing([
      { uuid: PROD_ID, name: 'shyden-reports' },
      { uuid: DEV_ID, name: 'shyden-reports' },
    ]);
    expect(() => databaseIdFrom(list)).toThrow(
      /holds 2 databases named shyden-reports/,
    );
  });

  it('throws on an id that is not a UUID, since it goes into a URL path', () => {
    const list = listing([{ uuid: '../../x', name: 'shyden-reports' }]);
    expect(() => databaseIdFrom(list)).toThrow(/has no uuid/);
  });

  it.each([`../${PROD_ID}`, `${PROD_ID}/../x`, ` ${PROD_ID}`])(
    'throws on a UUID with anything around it: %j',
    (uuid) => {
      // A real UUID inside the value is not the value being one: the check
      // is anchored at both ends, or a path could ride in beside it (#390).
      const list = listing([{ uuid, name: 'shyden-reports' }]);
      expect(() => databaseIdFrom(list)).toThrow(/has no uuid/);
    },
  );

  it.each([
    ['missing', undefined],
    ['the string "true"', 'true'],
    ['1', 1],
  ])('throws when success is %s, since only true is success', (_, success) => {
    const list = {
      ...listing([{ uuid: PROD_ID, name: 'shyden-reports' }]),
      success,
    };
    expect(() => databaseIdFrom(list)).toThrow(/database list says success: /);
    expect(() => countFrom({ ...counted(3), success })).toThrow(
      /query says success: /,
    );
  });

  it('throws on success: false, naming Cloudflare errors', () => {
    const list = {
      success: false,
      errors: [{ code: 10000, message: 'Authentication error' }],
      result: null,
    };
    expect(() => databaseIdFrom(list)).toThrow(
      'the D1 database list says success: false (10000 Authentication error)',
    );
  });

  it('throws when the result is not a list', () => {
    expect(() => databaseIdFrom({ success: true, result: {} })).toThrow(
      /no list of databases/,
    );
    expect(() => databaseIdFrom('<html>')).toThrow(/not a JSON object/);
  });
});

// Stand-in (#822): a count read. Every answer it must refuse rather than
// read as a count is the logs suite's (tests/logs/waiting-reports.test.ts).
describe('countFrom', () => {
  it('reads a zero and a three', () => {
    expect(countFrom(counted(0))).toBe(0);
    expect(countFrom(counted(3))).toBe(3);
  });
});

describe('noticeFor', () => {
  it('says nothing at zero, the singular at one and the plural above', () => {
    expect(noticeFor(0)).toBeNull();
    expect(noticeFor(1)).toBe('1 translation report is waiting.');
    expect(noticeFor(2)).toBe('2 translation reports are waiting.');
    expect(noticeFor(117)).toBe('117 translation reports are waiting.');
  });
});

describe('startOfUtcDay', () => {
  it("is midnight UTC on the instant's UTC day, even where local time differs", () => {
    expect(startOfUtcDay(new Date('2026-09-26T23:59:59.999Z'))).toBe(
      '2026-09-26T00:00:00Z',
    );
    expect(startOfUtcDay(new Date('2026-09-27T00:00:00.000+07:00'))).toBe(
      '2026-09-26T00:00:00Z',
    );
  });
});

describe('postedToday', () => {
  const NOW = new Date('2026-09-26T01:17:30Z');
  const comment = (login: string, body: string, created_at: string) => ({
    user: { login },
    body,
    created_at,
  });

  it("finds the bot's count from earlier the same UTC day", () => {
    const comments = [
      comment(
        NOTICE_AUTHOR,
        '3 translation reports are waiting.',
        '2026-09-26T00:00:00Z',
      ),
    ];
    expect(postedToday(comments, NOW)).toBe(true);
  });

  it("does not count yesterday's count, one second before midnight UTC", () => {
    const comments = [
      comment(
        NOTICE_AUTHOR,
        '3 translation reports are waiting.',
        '2026-09-25T23:59:59Z',
      ),
    ];
    expect(postedToday(comments, NOW)).toBe(false);
  });

  it('does not count a failure notice, so a re-run still reports', () => {
    const comments = [
      comment(
        NOTICE_AUTHOR,
        `${FAILURE_NOTICE}\n\nhttps://github.com/o/r/actions/runs/1`,
        '2026-09-26T01:17:10Z',
      ),
    ];
    expect(postedToday(comments, NOW)).toBe(false);
  });

  it('does not count a count posted by anyone else', () => {
    const comments = [
      comment(
        'ShydenMcM',
        '1 translation report is waiting.',
        '2026-09-26T01:00:00Z',
      ),
    ];
    expect(postedToday(comments, NOW)).toBe(false);
  });

  it('does not count a bot comment that only resembles a count', () => {
    const comments = [
      comment(
        NOTICE_AUTHOR,
        '1 translation reports are waiting.',
        '2026-09-26T01:00:00Z',
      ),
      comment(
        NOTICE_AUTHOR,
        '0 translation reports are waiting.',
        '2026-09-26T01:00:00Z',
      ),
      comment(
        NOTICE_AUTHOR,
        '3 translation reports are waiting. Quote: x',
        '2026-09-26T01:00:00Z',
      ),
    ];
    expect(postedToday(comments, NOW)).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(postedToday([], NOW)).toBe(false);
  });

  it('throws on a list it cannot read, rather than risk a second count', () => {
    expect(() => postedToday({ message: 'Not Found' }, NOW)).toThrow(
      /not a list/,
    );
  });

  it("finds today's count beside comments it cannot read, which are not counts", () => {
    const unreadable = [
      { body: '3 translation reports are waiting.' },
      {
        user: null,
        body: '3 translation reports are waiting.',
        created_at: '2026-09-26T01:00:00Z',
      },
      {
        user: { login: NOTICE_AUTHOR },
        body: '3 translation reports are waiting.',
        created_at: 'soon',
      },
    ];
    expect(postedToday(unreadable, NOW)).toBe(false);
    expect(
      postedToday(
        [
          ...unreadable,
          comment(
            NOTICE_AUTHOR,
            '3 translation reports are waiting.',
            '2026-09-26T01:00:00Z',
          ),
        ],
        NOW,
      ),
    ).toBe(true);
  });
});
