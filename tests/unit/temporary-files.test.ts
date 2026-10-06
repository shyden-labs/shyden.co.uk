import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scratchDir } from '../scratch-dir';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import { RUN_MARKER, RUN_TMPDIR, leakedEntries } from '../temporary-files';

/**
 * The end-of-run check in `tests/temporary-files.ts` (#390 F56). What it
 * reports is decided here; that it runs at all is held by its setup file, which
 * refuses a worker whose temporary directory is not the run's.
 */
describe('leakedEntries: what a test left in the run directory', () => {
  it('reports a directory and a file, sorted', () => {
    const dir = scratchDir('leaked-');
    mkdirSync(join(dir, 'scaffold-main-Ab12Cd'));
    writeFileSync(join(dir, 'COMMIT_EDITMSG'), '');
    expect(leakedEntries(dir)).toEqual([
      'COMMIT_EDITMSG',
      'scaffold-main-Ab12Cd',
    ]);
  });

  it("passes over the run marker and the tools' own caches, each as measured", () => {
    const dir = scratchDir('caches-');
    const kept = [
      RUN_MARKER,
      'node-compile-cache',
      'playwright-transform-cache-501',
      'uA0etn34iXsF6_Zg7BvV2',
    ];
    writeFileSync(join(dir, RUN_MARKER), '');
    mkdirSync(join(dir, 'node-compile-cache'));
    mkdirSync(join(dir, 'playwright-transform-cache-501'));
    mkdirSync(join(dir, 'uA0etn34iXsF6_Zg7BvV2', 'ssr'), { recursive: true });
    expect(
      searched(leakedEntries(dir), { of: kept, what: 'cache entries' }),
    ).toEqual([]);
    expect(
      floorBreach('temporary-files/kept-cache-entries', kept.length),
    ).toBeUndefined();
  });

  it('reports what only looks like a module cache', () => {
    // A 21-character directory holding more than `ssr`, a 21-character FILE,
    // and a test's own directory holding only `ssr`: the name and the
    // contents both have to match.
    const dir = scratchDir('lookalike-');
    mkdirSync(join(dir, 'nIWSclig0jW8grtzoQ_px', 'ssr'), { recursive: true });
    writeFileSync(join(dir, 'nIWSclig0jW8grtzoQ_px', 'notes.txt'), '');
    writeFileSync(join(dir, '37RQnaJ1OG-QLDz10P8uA'), 'ssr');
    mkdirSync(join(dir, 'vite-run-Ab12Cd', 'ssr'), { recursive: true });
    expect(leakedEntries(dir)).toEqual([
      '37RQnaJ1OG-QLDz10P8uA',
      'nIWSclig0jW8grtzoQ_px',
      'vite-run-Ab12Cd',
    ]);
  });

  it('refuses a directory holding nothing, rather than pass on it', () => {
    expect(() => leakedEntries(scratchDir('empty-'))).toThrow(
      "the unit run's directory",
    );
  });

  it('runs in the directory the end-of-run check reads', () => {
    expect(tmpdir()).toBe(process.env[RUN_TMPDIR]);
  });
});
