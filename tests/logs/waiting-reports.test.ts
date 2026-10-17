/**
 * The waiting-reports count (#349, #822) reads the reports table and posts
 * what it found on a public issue, so the statement it reads with, the one
 * fixed sentence it posts when it cannot read, and every answer it must
 * refuse rather than read as a count are checks of an audit trail, run here
 * before every release. The unit suite keeps a stand-in: one count read
 * (tests/unit/waiting-reports.test.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  COUNT_SQL,
  FAILURE_NOTICE,
  REPORTS_DATABASE,
  countFrom,
} from '../../src/lib/waiting-reports';
import { counted } from '../waiting-reports-shared';

describe('the statement it reads and the sentence it posts', () => {
  it('counts every row of the production reports table', () => {
    expect(COUNT_SQL).toBe('SELECT count(*) FROM reports');
    expect(REPORTS_DATABASE).toBe('shyden-reports');
  });

  it('the failure notice is one fixed sentence holding no digit', () => {
    expect(FAILURE_NOTICE).toBe('The waiting-reports count could not be read.');
    expect(FAILURE_NOTICE).not.toMatch(/\d/);
  });
});

describe('countFrom refuses what it cannot read as a count', () => {
  it.each([
    ['a string', '3'],
    ['a fraction', 1.5],
    ['a negative', -1],
    ['null', null],
    ['a missing count', undefined],
    ['an unsafe integer', 2 ** 53],
  ])('throws on %s, never reading it as a count', (_, value) => {
    expect(() => countFrom(counted(value))).toThrow(/not a whole number/);
  });

  it('throws on success: false', () => {
    expect(() =>
      countFrom({ ...counted(3), success: false, errors: [] }),
    ).toThrow('the D1 query says success: false');
  });

  it('throws when the statement itself failed', () => {
    const answer = counted(3);
    answer.result[0].success = false;
    expect(() => countFrom(answer)).toThrow(/statement failed/);
  });

  it.each([
    ['no statement', { success: true, result: [] }, /answered no statement/],
    [
      'no rows',
      { success: true, result: [{ success: true, results: [] }] },
      /exactly one row/,
    ],
    [
      'two rows',
      {
        success: true,
        result: [
          {
            success: true,
            results: [{ 'count(*)': 1 }, { 'count(*)': 2 }],
          },
        ],
      },
      /exactly one row/,
    ],
  ])('throws on %s', (_, answer, message) => {
    expect(() => countFrom(answer)).toThrow(message);
  });
});
