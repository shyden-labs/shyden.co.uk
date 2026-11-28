import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach } from 'vitest';
import { scratchDir } from './scratch-dir';

/**
 * Writes an executable called `name`, running `script`, into a fresh scratch
 * folder before each test in the calling suite, and answers its path.
 *
 * For the device tools (`adb`, `xcrun`), which cannot answer for real without
 * a phone attached: the code under test is handed the stand-in's path in place
 * of the tool's own absolute path (#1294), and runs it through the same
 * `execFileSync` the real tool would, deadline and all.
 */
export function standInProgram(name: string, script: string): () => string {
  let file = '';
  beforeEach(() => {
    file = join(scratchDir(`${name}-stand-in-`), name);
    writeFileSync(file, script);
    chmodSync(file, 0o755);
  });
  return () => file;
}
