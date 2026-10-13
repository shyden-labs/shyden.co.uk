import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import { nonEmpty } from '../scripts/errors.mjs';

/**
 * The unit test files that load the TypeScript parser (#688), derived from
 * their static imports rather than listed. Loading `typescript` costs ~135 ms
 * of CPU in every isolated test file (measured 2026-10-11): each of these
 * files read 260-369 ms to load on the CI runner, against 190 ms at most for
 * every other unit file. The unit suite runs them in a project of their own
 * that loads the parser once per worker (operator 2026-10-11, "500 ms, share
 * the parser first").
 *
 * Read before any test runs, from `vitest.config.ts`, so it imports nothing
 * that loads the parser itself.
 */

/**
 * A static `import … from '…'`, `export … from '…'` or bare `import '…'`,
 * anchored at the start of a line: a comment line (`// import`, ` * import`)
 * cannot match, and an import over several lines still does. Read without a
 * comment stripper, because this runs each time `vitest.config.ts` is
 * imported and stripping every file it reaches cost ~90-150 ms (#688).
 */
const IMPORT =
  /^[ \t]*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]|^[ \t]*import\s*['"]([^'"]+)['"]/gm;

const EXTENSIONS = [
  '',
  '.ts',
  '.mts',
  '.mjs',
  '.js',
  '/index.ts',
  '/index.mjs',
];

/**
 * Each file's static import specifiers, read and comment-stripped once per
 * derivation: one entry's walk reaches the same helpers as the next.
 */
const importsReader = (read: (path: string) => string | undefined) => {
  const cache = new Map<string, readonly string[] | undefined>();
  return (path: string): readonly string[] | undefined => {
    if (!cache.has(path)) {
      const source = read(path);
      cache.set(
        path,
        source === undefined
          ? undefined
          : [...source.matchAll(IMPORT)].map((match) => match[1] ?? match[2]),
      );
    }
    return cache.get(path);
  };
};

/**
 * Whether `entry` reaches `pkg` through its static imports, following
 * relative ones transitively. `read` returns a file's source, or `undefined`
 * where there is no such file.
 */
export function reachesPackage(
  entry: string,
  pkg: string,
  read: (path: string) => string | undefined,
  importsOf = importsReader(read),
): boolean {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importsOf(file) ?? []) {
      if (specifier === pkg) return true;
      if (!specifier.startsWith('.')) continue;
      const base = posix.normalize(posix.join(posix.dirname(file), specifier));
      const found = EXTENSIONS.map((extension) => base + extension).find(
        (path) => importsOf(path) !== undefined,
      );
      if (found !== undefined) pending.push(found);
    }
  }
  return false;
}

const readIfFile = (path: string): string | undefined =>
  existsSync(path) && statSync(path).isFile()
    ? readFileSync(path, 'utf8')
    : undefined;

/** Every unit test file that loads the parser, sorted. */
export const parserTestFiles = (): string[] => {
  const importsOf = importsReader(readIfFile);
  return nonEmpty(readdirSync('tests/unit'), 'unit test files')
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => `tests/unit/${name}`)
    .filter((file) => reachesPackage(file, 'typescript', readIfFile, importsOf))
    .sort();
};
