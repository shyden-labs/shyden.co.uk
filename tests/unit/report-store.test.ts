import { describe, expect, it } from 'vitest';
import { retiredBefore, storeReport } from '../../src/lib/report-store';
import {
  refusedOn,
  scriptedDatabase,
  storedOn,
  STORED_OFF,
} from '../report-fakes';

const ROW = [
  'id-1',
  '2026-10-19T08:00:00.000Z',
  'vi',
  'home',
  'q',
  '[]',
  '',
  '',
];
const DAY = '2026-10-19';
const COUNT = { counter: 'k'.repeat(64), limits: { total: 50, connection: 5 } };

describe('storeReport with the limits off', () => {
  it('prunes other days, inserts the row, then retires year-old reports, in one batch', async () => {
    const { db, batches } = scriptedDatabase([STORED_OFF]);
    expect(await storeReport(db, ROW, DAY, null)).toBe('sent');
    expect(batches).toHaveLength(1);
    expect(
      batches[0]!.map(({ query }) => query.split(' ').slice(0, 3).join(' ')),
    ).toEqual([
      'DELETE FROM report_counts',
      'INSERT INTO reports',
      'DELETE FROM reports',
    ]);
    expect(batches[0]![0]!.values).toEqual([DAY]);
    expect(batches[0]![1]!.values).toEqual(ROW);
  });
});

/**
 * Reports are kept for a year (Shyden, 2026-11-11, #1140): every write also
 * deletes the reports received before the same day a year earlier.
 */
describe('a report older than a year is deleted when the next one is written', () => {
  it('the cutoff is the day 365 days earlier', () => {
    expect(retiredBefore('2026-10-19')).toBe('2025-10-19');
    // Across a leap day the cutoff is still 365 days back.
    expect(retiredBefore('2028-03-01')).toBe('2027-03-02');
  });

  it('ends the batch with the delete, bound to the cutoff, with the limits off', async () => {
    const { db, batches } = scriptedDatabase([STORED_OFF]);
    await storeReport(db, ROW, DAY, null);
    const last = batches[0]!.at(-1)!;
    expect(last.query).toBe('DELETE FROM reports WHERE received_at < ?1');
    expect(last.values).toEqual(['2025-10-19']);
  });

  it('ends the batch with the same delete with the limits on, and still answers sent', async () => {
    const { db, batches } = scriptedDatabase([storedOn(1, 1)]);
    expect(await storeReport(db, ROW, DAY, COUNT)).toBe('sent');
    const last = batches[0]!.at(-1)!;
    expect(last.query).toBe('DELETE FROM reports WHERE received_at < ?1');
    expect(last.values).toEqual(['2025-10-19']);
  });
});

describe('storeReport with the limits on', () => {
  it('binds the day, the limits and the counter, never anything else', async () => {
    const { db, batches } = scriptedDatabase([storedOn(1, 1)]);
    expect(await storeReport(db, ROW, DAY, COUNT)).toBe('sent');
    const [prune, insert, all, connection, read] = batches[0]!;
    expect(prune!.values).toEqual([DAY]);
    expect(insert!.values).toEqual([...ROW, DAY, 50, COUNT.counter, 5]);
    expect(all!.values).toEqual([DAY, 'all', 'id-1']);
    expect(connection!.values).toEqual([DAY, COUNT.counter, 'id-1']);
    expect(read!.values).toEqual([DAY, COUNT.counter]);
  });
  it('answers form-full when the day has taken its total', async () => {
    const { db } = scriptedDatabase([refusedOn(50, 2)]);
    expect(await storeReport(db, ROW, DAY, COUNT)).toBe('form-full');
  });
  it('answers connection-full when only the connection is at its limit', async () => {
    const { db } = scriptedDatabase([refusedOn(12, 5)]);
    expect(await storeReport(db, ROW, DAY, COUNT)).toBe('connection-full');
  });
  it('answers form-full when both are full: the total refuses everyone', async () => {
    const { db } = scriptedDatabase([refusedOn(50, 5)]);
    expect(await storeReport(db, ROW, DAY, COUNT)).toBe('form-full');
  });
  it('answers connection-full when no total row exists yet', async () => {
    const { db } = scriptedDatabase([
      [
        { results: [] },
        { results: [] },
        { results: [] },
        { results: [] },
        { results: [] },
      ],
    ]);
    expect(await storeReport(db, ROW, DAY, COUNT)).toBe('connection-full');
  });
});
