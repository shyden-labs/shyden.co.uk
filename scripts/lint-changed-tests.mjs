/**
 * The pre-push lint for test code (#662): the three meta-guards that judge
 * tests -- floorless-searches, absence-liveness, anchored-presence -- applied
 * to the test files this branch changed against `origin/develop`, so a new
 * test meets them before the push instead of at the PR's CI or the floor
 * record. Two record cycles were lost to exactly that (#651, #658).
 *
 * A lint, not a suite (operator ruling 2026-10-12): it reads the changed
 * files and reports; the guards stay CI's and judge the whole tree. The
 * finders are TypeScript with extensionless imports, which plain `node`
 * cannot resolve, so they load through the Vite server `vitest/node`
 * exports -- the resolver the guards themselves run under, from a declared
 * dependency, with no test file of its own for the meta-guards to judge.
 *
 *   node scripts/lint-changed-tests.mjs     (npm run lint:tests; pre-push)
 */
import { execFileSync } from 'node:child_process';

/** What the changed files are measured against. */
export const BASE = 'origin/develop';

/**
 * The test files in `git diff --name-only` output: TypeScript under `tests/`,
 * once each, sorted.
 *
 * @param {string} names
 * @returns {string[]}
 */
export const changedTestFiles = (names) =>
  [
    ...new Set(
      names
        .split('\n')
        .map((line) => line.trim())
        .filter((path) => path.startsWith('tests/') && path.endsWith('.ts')),
    ),
  ].sort();

/**
 * `count` beside the word that fits it.
 *
 * @param {number} count
 * @param {string} one
 * @param {string} many
 * @returns {string}
 */
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * What the lint prints, and whether the push stops. An empty change set says
 * so in words: a pass over nothing is not a pass.
 *
 * @param {string} base
 * @param {readonly string[]} changed
 * @param {import('../tests/changed-tests').ChangedTestsLint | undefined} lint
 * @returns {{ lines: string[], failed: boolean }}
 */
export function lintReport(base, changed, lint) {
  if (changed.length === 0 || lint === undefined)
    return {
      lines: [
        `lint-changed-tests: no test file changed against ${base}: nothing to lint.`,
      ],
      failed: false,
    };
  const { searches, absences, presence } = lint.judged;
  return {
    lines: [
      ...lint.findings,
      `lint-changed-tests: ${plural(lint.findings.length, 'finding', 'findings')} in ${plural(changed.length, 'changed test file', 'changed test files')} (read ${plural(searches, 'search', 'searches')}, ${plural(absences, 'absence', 'absences')}, ${plural(presence, 'presence assertion', 'presence assertions')} against ${base}).`,
    ],
    failed: lint.findings.length > 0,
  };
}

async function main() {
  if (process.argv.length > 2) {
    console.error(
      'usage: node scripts/lint-changed-tests.mjs (takes no arguments)',
    );
    process.exit(1);
  }
  /** @param {string[]} args */
  const git = (args) => execFileSync('git', args, { encoding: 'utf8' });
  const mergeBase = git(['merge-base', BASE, 'HEAD']).trim();
  // Against the working tree, deletions left out: a deleted file holds no test.
  const changed = changedTestFiles(
    git(['diff', '--name-only', '--diff-filter=d', mergeBase, '--', 'tests']),
  );
  let lint;
  if (changed.length > 0) {
    const { createViteServer } = await import('vitest/node');
    const server = await createViteServer({
      root: process.cwd(),
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      /** @type {typeof import('../tests/changed-tests')} */
      const core = /** @type {any} */ (
        await server.ssrLoadModule('/tests/changed-tests.ts')
      );
      lint = core.lintChangedTests(
        changed,
        core.testTree(),
        core.BURN_DOWN_LISTS,
      );
    } finally {
      await server.close();
    }
  }
  const { lines, failed } = lintReport(BASE, changed, lint);
  for (const line of lines) console.log(line);
  if (failed) process.exitCode = 1;
}

if (import.meta.main) await main();
