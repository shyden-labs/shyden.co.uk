import { COUNT_COLUMNS, type ReportsDatabase } from '../src/lib/report';

/**
 * A database whose two tables answer the health query with the `reports`
 * and `counts` columns given, and that refuses anything else. The real D1 in
 * tests/functions always holds the migrated tables, so only a stand-in can
 * show what health says about drift.
 */
export const tableWith = (
  reports: readonly string[],
  counts: readonly string[] = COUNT_COLUMNS,
): ReportsDatabase => ({
  prepare: () => ({
    bind() {
      throw new Error('health binds nothing');
    },
    run() {
      throw new Error('health writes nothing');
    },
    all: async <T>() => ({
      results: [
        ...reports.map((name) => ({ tbl: 'reports', name })),
        ...counts.map((name) => ({ tbl: 'report_counts', name })),
      ] as T[],
    }),
  }),
});

/**
 * A reports table that keeps every row the endpoint writes, as the values it
 * bound in column order, so a test can read the stored row WHOLE (#830).
 */
export function recordingTable(): {
  db: ReportsDatabase;
  rows: unknown[][];
} {
  const rows: unknown[][] = [];
  return {
    rows,
    db: {
      prepare: () => {
        let bound: unknown[] = [];
        const statement = {
          bind(...values: unknown[]) {
            bound = values;
            return statement;
          },
          run: async () => {
            rows.push(bound);
          },
          all: async <T>(): Promise<{ results: T[] }> => {
            throw new Error('a report reads nothing back');
          },
        };
        return statement;
      },
    },
  };
}

/**
 * A binding whose every call fails with `message`, as a D1 error can, its
 * text naming whatever was bound (#829): the log must never repeat it.
 */
export const failingWith = (message: string): ReportsDatabase => {
  const statement = {
    bind: () => statement,
    run: async () => {
      throw new Error(message);
    },
    all: async <T>(): Promise<{ results: T[] }> => {
      throw new Error(message);
    },
  };
  return { prepare: () => statement };
};
