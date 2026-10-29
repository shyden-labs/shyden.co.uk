import { describe, it, expect } from 'vitest';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scratchDir } from '../scratch-dir';
import { searched } from '../source-files';
import { floorBreach } from '../floors';
import {
  LEAK_LISTING_LIMIT,
  RUN_MARKER,
  RUN_TMPDIR,
  leakRefusal,
  leakedEntries,
} from '../temporary-files';

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

/**
 * A leak names what it holds (#788): the directory was gone from every run
 * that refused it, so the refusal itself has to carry each path, its size and
 * when it was last written, to say whether a test never removed it or
 * something wrote it back afterwards.
 */
describe('leakRefusal: a leaked entry names what it holds', () => {
  const AT = new Date('2026-10-29T01:02:03.000Z');
  /** Plants `paths` under `dir` (a trailing `/` makes a directory), each written at `AT`. */
  const plant = (dir: string, paths: readonly string[]) => {
    for (const path of paths)
      if (path.endsWith('/')) mkdirSync(join(dir, path), { recursive: true });
      else writeFileSync(join(dir, path), 'x'.repeat(path.length));
    for (const path of [...paths].reverse())
      utimesSync(join(dir, path), AT, AT);
  };

  it('lists every path under the entry, hidden ones and directories included', () => {
    const dir = scratchDir('refusal-');
    writeFileSync(join(dir, RUN_MARKER), '');
    plant(dir, [
      'docs-only-Ab12Cd/',
      'docs-only-Ab12Cd/.git/',
      'docs-only-Ab12Cd/.git/objects/',
      'docs-only-Ab12Cd/.git/objects/maintenance.lock',
      'docs-only-Ab12Cd/a.md',
    ]);
    expect(leakRefusal(dir)?.split('\n').slice(1)).toEqual([
      '  docs-only-Ab12Cd/  2026-10-29T01:02:03.000Z',
      '  docs-only-Ab12Cd/.git/  2026-10-29T01:02:03.000Z',
      '  docs-only-Ab12Cd/.git/objects/  2026-10-29T01:02:03.000Z',
      '  docs-only-Ab12Cd/.git/objects/maintenance.lock  46 B  2026-10-29T01:02:03.000Z',
      '  docs-only-Ab12Cd/a.md  21 B  2026-10-29T01:02:03.000Z',
    ]);
  });

  it('opens with what the end-of-run check has always said', () => {
    const dir = scratchDir('refusal-');
    writeFileSync(join(dir, RUN_MARKER), '');
    plant(dir, ['docs-only-Ab12Cd/']);
    expect(leakRefusal(dir)?.split('\n')[0]).toBe(
      'the unit run left 1 entry in its temporary directory: docs-only-Ab12Cd. ' +
        "Make a test's directory with scratchDir() from 'tests/scratch-dir', " +
        'which removes it when the test ends. It holds:',
    );
  });

  it('stops at its limit and says how many it left out', () => {
    const dir = scratchDir('refusal-');
    writeFileSync(join(dir, RUN_MARKER), '');
    const files = Array.from(
      { length: LEAK_LISTING_LIMIT + 4 },
      (_, n) => `big-Ab12Cd/f${String(n).padStart(3, '0')}`,
    );
    plant(dir, ['big-Ab12Cd/', ...files]);
    const lines = leakRefusal(dir)?.split('\n') ?? [];
    expect(lines.slice(1, -1)).toHaveLength(LEAK_LISTING_LIMIT);
    expect(lines.at(-1)).toBe('  … and 5 more');
  });

  it('says nothing for a run that left nothing', () => {
    const dir = scratchDir('refusal-');
    writeFileSync(join(dir, RUN_MARKER), '');
    expect(leakRefusal(dir)).toBeUndefined();
  });
});
