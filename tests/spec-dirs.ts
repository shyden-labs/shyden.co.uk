import { dirname } from 'node:path';
import { committableFiles, specFilesUnder } from './source-files';

const TESTS_DIR = 'tests';

/**
 * The directories a source-scanning guard should read, derived from disk.
 *
 * Four guards each carried their own `[tests/e2e, tests/device]` — written
 * when those were the only two spec directories, and never revisited when
 * `tests/dev` and `tests/prod` were added. Those two produce `dev-verified`,
 * a required check on main's branch protection, and were scanned by none of
 * them: a `test.fixme` planted in `tests/dev` left `parked-tests.test.ts`
 * green at 11/11, and widening the scan immediately found a real defect
 * (#67).
 */
export const specDirs = (): string[] =>
  [...new Set(specFilesUnder(TESTS_DIR).map((path) => dirname(path)))].sort();

/**
 * Every TypeScript file git has in a directory that holds a spec, the
 * directories read from git's list as well: what
 * `specDirs().flatMap(tsFilesUnder)` walks, read without the disk walk, so a
 * guard can check its walk against it (#477). Untracked files count, as in
 * `committableFiles`.
 */
export const specDirFilesGitHas = (): string[] => {
  const known = committableFiles(
    (path) => path.startsWith(`${TESTS_DIR}/`) && /\.tsx?$/.test(path),
  );
  const dirs = [
    ...new Set(known.filter((path) => path.endsWith('.spec.ts')).map(dirname)),
  ];
  return known.filter((path) => dirs.some((dir) => path.startsWith(`${dir}/`)));
};
