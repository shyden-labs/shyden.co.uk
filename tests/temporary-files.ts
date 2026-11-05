import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { everythingUnder, nonEmpty } from './source-files';

/**
 * The unit run's own temporary directory (#390 F56), as vitest's
 * `globalSetup`. Every worker, and every process a test starts, inherits it as
 * `TMPDIR`, which `os.tmpdir()` reads on each call (measured: a worker's
 * `mkdtempSync` landed in it). At the end of the run anything a test left there
 * fails the run, and the directory goes either way, so a leak can neither pass
 * unseen nor pile up: before this, the laptop's `$TMPDIR` held 2,717
 * directories the suite had made and never removed.
 */

/** Where `setup` put the run, for `tests/temporary-files-setup.ts` to check. */
export const RUN_TMPDIR = 'SHYDEN_UNIT_TMPDIR';

/**
 * Written by `setup`, so the directory the check reads is never empty and is
 * provably the one `setup` made: a check that read some other, empty directory
 * would otherwise pass on nothing.
 */
export const RUN_MARKER = '.unit-run';

/**
 * What the tools leave beside the tests, by shape, so they are not counted as
 * a test's leak: Node's compile cache, Playwright's transform cache (named for
 * the user id), and vite's module cache, a 21-character id holding only `ssr`
 * (all three measured in one whole-suite run).
 */
const isToolCache = (dir: string, name: string): boolean =>
  name === 'node-compile-cache' ||
  /^playwright-transform-cache-\d+$/.test(name) ||
  (/^[\w-]{21}$/.test(name) &&
    existsSync(join(dir, name, 'ssr')) &&
    nonEmpty(
      readdirSync(join(dir, name)),
      `${name}, which holds ssr`,
    ).join() === 'ssr');

/**
 * Everything in `dir` a test left behind, sorted. `dir` holds at least the run
 * marker, or this refuses rather than answer for a directory it never saw.
 */
export function leakedEntries(dir: string): string[] {
  return nonEmpty(readdirSync(dir), `the unit run's directory, ${dir}`)
    .filter((name) => name !== RUN_MARKER && !isToolCache(dir, name))
    .sort();
}

let runDir = '';

export function setup(): void {
  runDir = mkdtempSync(join(tmpdir(), 'shyden-unit-'));
  writeFileSync(join(runDir, RUN_MARKER), '');
  process.env.TMPDIR = runDir;
  process.env[RUN_TMPDIR] = runDir;
}

/** How many paths a refusal lists before it only counts the rest. */
export const LEAK_LISTING_LIMIT = 40;

/**
 * The refusal for what a test left in `dir`, or undefined where it left
 * nothing. It lists every path under each leaked entry with its size and when
 * it was last written (#788): the directory goes with the run, so the refusal
 * is the only evidence of whether a test never removed it or something wrote
 * it back afterwards.
 */
export function leakRefusal(dir: string): string | undefined {
  const leaked = leakedEntries(dir);
  if (leaked.length === 0) return undefined;
  const lines = leaked
    .flatMap((name) => everythingUnder(join(dir, name)))
    .map((path) => {
      const { mtime, size } = lstatSync(path);
      const at = mtime.toISOString();
      const shown = path.slice(dir.length + 1);
      return path.endsWith('/')
        ? `  ${shown}  ${at}`
        : `  ${shown}  ${size} B  ${at}`;
    });
  const left = lines.length - LEAK_LISTING_LIMIT;
  return [
    `the unit run left ${leaked.length} entr${leaked.length === 1 ? 'y' : 'ies'} in its ` +
      `temporary directory: ${leaked.join(', ')}. Make a test's directory with ` +
      "scratchDir() from 'tests/scratch-dir', which removes it when the test ends. It holds:",
    ...lines.slice(0, LEAK_LISTING_LIMIT),
    ...(left > 0 ? [`  … and ${left} more`] : []),
  ].join('\n');
}

export function teardown(): void {
  try {
    const refusal = leakRefusal(runDir);
    if (refusal !== undefined) throw new Error(refusal);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
}
