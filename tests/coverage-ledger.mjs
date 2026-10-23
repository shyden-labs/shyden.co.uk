/**
 * Preloaded into every process an integration test starts (#936, through
 * `NODE_OPTIONS`, `tests/child-coverage.ts`): as the process starts, it
 * writes its pid and command into the raw coverage directory's `ledger/`.
 * Node names a raw file by its writer's pid alone, and a writer that died
 * mid-write is gone by the time the file is read, so this is how
 * `scripts/coverage-processes.mjs` names the command that wrote an empty
 * file. A process run with the variable empty writes nothing.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.env.NODE_V8_COVERAGE;
if (dir) {
  const ledger = path.join(dir, 'ledger');
  mkdirSync(ledger, { recursive: true });
  writeFileSync(
    path.join(ledger, `${process.pid}.json`),
    JSON.stringify({ pid: process.pid, argv: process.argv }),
  );
}
