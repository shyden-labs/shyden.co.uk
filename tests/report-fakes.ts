import type { ReportsDatabase } from '../src/lib/report';

/**
 * A reports table that answers `columns` to the health query and refuses
 * anything else. The real D1 in tests/functions always holds the migrated
 * table, so only a stand-in can show what health says about drift.
 */
export const tableWith = (columns: readonly string[]): ReportsDatabase => ({
  prepare: () => ({
    bind() {
      throw new Error('health binds nothing');
    },
    run() {
      throw new Error('health writes nothing');
    },
    all: async <T>() => ({
      results: columns.map((name) => ({ name })) as T[],
    }),
  }),
});

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
