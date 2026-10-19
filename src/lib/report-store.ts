/**
 * Where a report is written (#872): one D1 batch, which D1 runs as one
 * transaction, so two reports arriving together at the last slot cannot both
 * be stored. Probed on SQLite 2026-10-19 (node:sqlite): the 6th from one
 * counter and the 51st in all are refused, another counter is not, and the
 * next day's first report deletes the day before.
 */
import type { ReportLimits } from './report-limits';

/**
 * The `reports` table's columns, as `migrations/0001_reports.sql` creates
 * them, and `report_counts`', as `0002` does. They live here, not in
 * report.ts, because report.ts imports this module: a constant read at load
 * time across that cycle would be read before it exists.
 */
export const REPORT_COLUMNS = [
  'id',
  'received_at',
  'locale',
  'page',
  'quote',
  'keys',
  'suggestion',
  'note',
] as const;
export const COUNT_COLUMNS = ['day', 'counter', 'count'] as const;

/** The slice of D1's prepared statement this module uses. */
export interface ReportsStatement {
  bind(...values: unknown[]): ReportsStatement;
  all<T>(): Promise<{ results: T[] }>;
}

/** The slice of a D1 binding the endpoint uses. */
export interface ReportsDatabase {
  prepare(query: string): ReportsStatement;
  batch<T = Record<string, unknown>>(
    statements: ReportsStatement[],
  ): Promise<{ results: T[] }[]>;
}

export type Stored = 'sent' | 'form-full' | 'connection-full';

const COLUMNS = REPORT_COLUMNS.join(', ');
const VALUES = REPORT_COLUMNS.map((_, at) => `?${at + 1}`).join(', ');
const PRUNE = 'DELETE FROM report_counts WHERE day <> ?1';
const INSERT = `INSERT INTO reports (${COLUMNS}) VALUES (${VALUES})`;
const INSERT_WITHIN = `INSERT INTO reports (${COLUMNS}) SELECT ${VALUES}
 WHERE COALESCE((SELECT count FROM report_counts WHERE day = ?9 AND counter = 'all'), 0) < ?10
   AND COALESCE((SELECT count FROM report_counts WHERE day = ?9 AND counter = ?11), 0) < ?12
 RETURNING id`;
const COUNT = `INSERT INTO report_counts (day, counter, count)
 SELECT ?1, ?2, 1 WHERE EXISTS (SELECT 1 FROM reports WHERE id = ?3)
 ON CONFLICT (day, counter) DO UPDATE SET count = count + 1`;
const READ =
  "SELECT counter, count FROM report_counts WHERE day = ?1 AND counter IN ('all', ?2)";

export async function storeReport(
  db: ReportsDatabase,
  row: readonly unknown[],
  day: string,
  count: { counter: string; limits: ReportLimits } | null,
): Promise<Stored> {
  const prune = db.prepare(PRUNE).bind(day);
  if (!count) {
    await db.batch([prune, db.prepare(INSERT).bind(...row)]);
    return 'sent';
  }
  const id = row[0];
  const { counter, limits } = count;
  // MUTANT: the five statements run one by one, outside a transaction.
  const statements = [
    prune,
    db
      .prepare(INSERT_WITHIN)
      .bind(...row, day, limits.total, counter, limits.connection),
    db.prepare(COUNT).bind(day, 'all', id),
    db.prepare(COUNT).bind(day, counter, id),
    db.prepare(READ).bind(day, counter),
  ];
  const results: { results: { counter?: string; count?: number }[] }[] = [];
  for (const statement of statements)
    results.push(await statement.all<{ counter?: string; count?: number }>());
  if ((results[1]?.results.length ?? 0) === 1) return 'sent';
  const all =
    results[4]?.results.find((result) => result.counter === 'all')?.count ?? 0;
  return all >= limits.total ? 'form-full' : 'connection-full';
}
