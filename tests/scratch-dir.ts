import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished } from 'vitest';

/**
 * A fresh directory under the run's temporary directory, removed when the test
 * that asked for it finishes, whether it passed or not. Call it from inside a
 * test or a helper a test calls: vitest refuses `onTestFinished` anywhere else,
 * which is the point, since a directory made outside a test has no test to end.
 *
 * Seven test files made directories they never removed (#390 F56). One run left
 * 34, and the laptop's `$TMPDIR` held 2,717 of them, 890 from one helper. The
 * run-wide check in `tests/temporary-files.ts` now fails a run that leaves one.
 */
export function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Writes `text` to `path` under `dir`, making any directory the path needs:
 * how a test lays out the files of a scratch repository.
 */
export const writeUnder =
  (dir: string) =>
  (path: string, text: string): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
