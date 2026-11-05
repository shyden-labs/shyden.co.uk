// @ts-check
/**
 * Whether a pull request touches what the release capture reads (#774).
 *
 * The `capture` job runs the release page's selection under capture on four
 * heavy shards, so it runs only where a change can move a picture: the CI
 * cost matches the change. The safe way round is the one written here: the
 * capture runs UNLESS every changed path is shown to be outside it. A path is
 * outside only when it sits under one of the trees named below AND nothing the
 * capture runs reaches it by import, so a new file at the root, in `src/`, in
 * `public/` or in a directory nobody listed runs the capture by default, and a
 * helper under `tests/` or `scripts/` counts the day an e2e spec imports it.
 *
 * What the capture reaches is DERIVED: every tracked file under `tests/e2e/`
 * and the entry points below, followed through their relative imports to a
 * fixed point. An import that resolves to no file stops the trace, and a trace
 * that stops runs the capture: a reader that cannot see is never a reason to
 * skip. `tests/guards/capture-scope.test.ts` traces the real tree.
 */
import { posix } from 'node:path';

/**
 * Where the trace starts beside `tests/e2e/`: the two configs a capture run
 * loads (Playwright's, and Astro's for the build its web server makes) and
 * every script the job runs. `tests/guards/pipeline-wiring.test.ts` holds
 * the job's own scripts to this list.
 */
export const CAPTURE_ENTRIES = Object.freeze([
  'astro.config.mjs',
  'playwright.config.ts',
  'scripts/capture-coverage.mjs',
  'scripts/release-inventory.mjs',
  'scripts/test-e2e.mjs',
]);

/** The one file under an outside tree that changes the capture without an import: its job. */
export const CAPTURE_FILES = Object.freeze(['.github/workflows/ci.yml']);

/**
 * Trees whose files skip the capture unless an import reaches them: other
 * workflows, git hooks, documentation, and the scripts and tests the capture
 * never loads. A Markdown file at the root is documentation too.
 */
export const OUTSIDE_TREES = Object.freeze([
  '.github/',
  '.githooks/',
  'docs/',
  'scripts/',
  'tests/',
]);

/** Sources whose imports the trace follows; any other file it reaches is counted, not read. */
const SOURCE = /\.(?:astro|cjs|js|mjs|mts|ts|tsx)$/;

/**
 * A relative specifier after `from`, after a bare `import`, or inside
 * `import(...)`, in either quote. A package name never starts with a dot.
 */
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*(['"])(\.\.?\/[^'"\n]+?)\1/g;

/**
 * @typedef {{ status: string, paths: string[] }} Change
 * @typedef {{ capture: boolean, reasons: string[] }} CaptureVerdict
 * @typedef {{ read: (path: string) => string, exists: (path: string) => boolean }} Tree
 */

/**
 * The relative imports a source names, in order, each without its query.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function relativeSpecifiers(source) {
  return [...source.matchAll(SPECIFIER)].map(
    ([, , specifier]) => specifier.split('?')[0],
  );
}

/**
 * The file a specifier names from `from`, or undefined. TypeScript's ESM
 * style writes `./b.js` for `b.ts`, and a directory stands for its index.
 *
 * @param {string} from
 * @param {string} specifier
 * @param {Tree['exists']} exists
 */
const resolve = (from, specifier, exists) => {
  const path = posix.join(posix.dirname(from), specifier);
  return [
    path,
    `${path}.ts`,
    `${path}.mjs`,
    `${path}.js`,
    `${path}.astro`,
    path.replace(/\.js$/, '.ts'),
    path.replace(/\.mjs$/, '.mts'),
    `${path}/index.ts`,
  ].find(exists);
};

/**
 * Every file the roots reach through relative imports, roots included.
 *
 * @param {readonly string[]} roots
 * @param {Tree} tree
 * @returns {Set<string>}
 */
export function importClosure(roots, { read, exists }) {
  for (const root of roots)
    if (!exists(root))
      throw new Error(`${root} is a root of the trace and does not exist`);
  const reached = new Set(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const file = /** @type {string} */ (queue.shift());
    if (!SOURCE.test(file)) continue;
    for (const specifier of relativeSpecifiers(read(file))) {
      const target = resolve(file, specifier, exists);
      if (target === undefined)
        throw new Error(
          `${file} imports '${specifier}', which resolves to no file`,
        );
      if (reached.has(target)) continue;
      reached.add(target);
      queue.push(target);
    }
  }
  return reached;
}

/**
 * Whether a changed path can move a picture: reached by the trace, the
 * capture's own job, or anywhere outside the trees that skip it.
 *
 * @param {string} path
 * @param {ReadonlySet<string>} closure
 * @returns {boolean}
 */
export function isCapturePath(path, closure) {
  if (closure.has(path) || CAPTURE_FILES.includes(path)) return true;
  const rootMarkdown = !path.includes('/') && path.endsWith('.md');
  return !rootMarkdown && !OUTSIDE_TREES.some((tree) => path.startsWith(tree));
}

/**
 * Whether a pull request's changes run the capture, naming each path that
 * does. Both paths of a rename or copy are judged.
 *
 * @param {readonly Change[]} changes
 * @param {ReadonlySet<string>} closure
 * @returns {CaptureVerdict}
 */
export function captureVerdict(changes, closure) {
  if (changes.length === 0)
    return {
      capture: true,
      reasons: ['the diff is empty, so nothing shows the capture is untouched'],
    };
  const reasons = changes.flatMap(({ status, paths }) =>
    paths
      .filter((path) => isCapturePath(path, closure))
      .map((path) => `${status} ${path}: the capture reads it`),
  );
  return { capture: reasons.length > 0, reasons };
}

/**
 * The verdict on the diff `pullRequestChanges` read (`scripts/docs-only.mjs`):
 * a run that has no pull request's diff, or a trace that cannot finish, runs
 * the capture.
 *
 * @param {{ diff: { changes: Change[] } | { reasons: string[] }, git: (args: readonly string[]) => string } & Tree} input
 * @returns {CaptureVerdict}
 */
export function captureFromDiff({ diff, git, read, exists }) {
  if (!('changes' in diff)) return { capture: true, reasons: diff.reasons };
  try {
    const specs = git(['ls-files', '-z', '--', 'tests/e2e/'])
      .split('\0')
      .filter(Boolean);
    const closure = importClosure([...specs, ...CAPTURE_ENTRIES], {
      read,
      exists,
    });
    return captureVerdict(diff.changes, closure);
  } catch (error) {
    return {
      capture: true,
      reasons: [
        `the capture's files could not be traced: ${/** @type {Error} */ (error).message}`,
      ],
    };
  }
}
