import {
  COUNT_COLUMNS,
  type ReportsDatabase,
  type ReportsStatement,
} from '../src/lib/report';

/**
 * A reports table that answers `columns` to the health query and refuses
 * anything else. The real D1 in tests/functions always holds the migrated
 * table, so only a stand-in can show what health says about drift.
 */
export const tableWith = (
  reports: readonly string[],
  counts: readonly string[] = COUNT_COLUMNS,
): ReportsDatabase => ({
  prepare: () => ({
    bind() {
      throw new Error('health binds nothing');
    },
    all: async <T>() => ({
      results: [
        ...reports.map((name) => ({ tbl: 'reports', name })),
        ...counts.map((name) => ({ tbl: 'report_counts', name })),
      ] as T[],
    }),
  }),
  batch: async () => {
    throw new Error('health writes nothing');
  },
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
  interface Recorded extends ReportsStatement {
    readonly query: string;
    readonly values: unknown[];
  }
  const statement = (query: string, values: unknown[] = []): Recorded => ({
    query,
    values,
    bind: (...bound: unknown[]) => statement(query, bound),
    all: async () => {
      throw new Error('a report reads nothing back');
    },
  });
  return {
    rows,
    db: {
      prepare: (query) => statement(query),
      // A report's one batch (#872): the row is what its `INSERT INTO
      // reports` bound, and the answer is a stored report's, limits off
      // (two statements) or on (five).
      batch: async <T>(statements: ReportsStatement[]) => {
        const recorded = statements as Recorded[];
        for (const { query, values } of recorded)
          if (query.startsWith('INSERT INTO reports')) rows.push(values);
        return (recorded.length === 2 ? STORED_OFF : storedOn(1, 1)) as {
          results: T[];
        }[];
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
    all: async <T>(): Promise<{ results: T[] }> => {
      throw new Error(message);
    },
  };
  return {
    prepare: () => statement,
    batch: async () => {
      throw new Error(message);
    },
  };
};

/**
 * A database that answers each `batch` with the next scripted list of
 * results and records every statement it was given, query and bound values
 * (#872), so a test can read exactly what reached D1.
 */
export function scriptedDatabase(
  answers: readonly (readonly { results: unknown[] }[])[],
): {
  db: ReportsDatabase;
  batches: { query: string; values: unknown[] }[][];
} {
  const batches: { query: string; values: unknown[] }[][] = [];
  let next = 0;
  const statement = (query: string, values: unknown[] = []) => ({
    query,
    values,
    bind: (...bound: unknown[]) => statement(query, bound),
    all: async () => {
      throw new Error('a report runs its statements in one batch');
    },
  });
  return {
    batches,
    db: {
      prepare: (query) => statement(query),
      batch: async <T>(statements: unknown[]) => {
        batches.push(
          (statements as { query: string; values: unknown[] }[]).map(
            ({ query, values }) => ({ query, values }),
          ),
        );
        const answer = answers[next++];
        if (!answer) throw new Error(`no scripted answer for batch ${next}`);
        return answer as { results: T[] }[];
      },
    },
  };
}

/** The batch answers a report meets: stored, or refused with the day's total at `all`. */
export const STORED_OFF = [{ results: [] }, { results: [] }];
export const storedOn = (all: number, connection: number) => [
  { results: [] },
  { results: [{ id: 'stored' }] },
  { results: [] },
  { results: [] },
  {
    results: [
      { counter: 'all', count: all },
      { counter: 'x', count: connection },
    ],
  },
];
export const refusedOn = (all: number, connection: number) => [
  { results: [] },
  { results: [] },
  { results: [] },
  { results: [] },
  {
    results: [
      { counter: 'all', count: all },
      { counter: 'x', count: connection },
    ],
  },
];
