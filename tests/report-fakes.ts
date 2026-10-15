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
