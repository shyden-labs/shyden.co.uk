import { chmodSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { scratchDir } from './scratch-dir';

/**
 * Puts an executable called `name`, running `script`, first on PATH for each
 * test in the calling suite, and restores PATH afterwards.
 *
 * For the device tools (`adb`, `xcrun`), which cannot answer for real without
 * a phone attached: a stand-in on PATH runs through the same `execFileSync`
 * the real tool would, deadline and all.
 */
export function standInOnPath(name: string, script: string): void {
  let saved: string | undefined;
  beforeEach(() => {
    const bin = scratchDir(`${name}-stand-in-`);
    writeFileSync(join(bin, name), script);
    chmodSync(join(bin, name), 0o755);
    saved = process.env.PATH;
    process.env.PATH = `${bin}${delimiter}${saved ?? ''}`;
  });
  afterEach(() => {
    process.env.PATH = saved;
  });
}
