import { readFileSync } from 'node:fs';

/**
 * The run's one reading of the repository (#631): the reader half.
 *
 * A unit test starts no process, so what git says about the tree is asked
 * once per run, in the global setup (`tests/tree-reading-setup.ts`), and
 * written to one JSON file in the run's own temporary directory. The path
 * reaches every worker as this environment variable, the way the directory
 * itself does (`tests/temporary-files.ts`).
 *
 * This file imports no `child_process`, and has no fallback that spawns git:
 * a missing snapshot is a wiring defect and says so, rather than quietly
 * answering from a second source.
 */
export const TREE_READING = 'SHYDEN_TREE_READING';

export interface TreeReading {
  /** `git ls-files -z`, as git printed it. */
  tracked: string[];
  /** `git ls-files -z --others --exclude-standard --cached`. */
  committable: string[];
  /** For each path in `ignoreQuestions()`, whether `git check-ignore` ignores it. */
  ignored: Record<string, boolean>;
  /** `git ls-files -z -- <docsPathspec()>`. */
  docsPathspecSelected: string[];
  /** `git grep` over `docsNamingArgs()`. */
  docsNaming: string[];
}

let cached: TreeReading | undefined;

/** The snapshot the global setup wrote; throws, naming the setup, if there is none. */
export function treeReading(
  env: Readonly<Record<string, string | undefined>> = process.env,
): TreeReading {
  const path = env[TREE_READING];
  if (path === undefined || path === '')
    throw new Error(
      `${TREE_READING} is not set: the tree reading is built by the ` +
        'globalSetup tests/tree-reading-setup.ts, which this run did not ' +
        'load. Run the suite through vitest.config.ts.',
    );
  if (env === process.env && cached !== undefined) return cached;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `the tree reading at ${path} cannot be read (${String(error)}); ` +
        'tests/tree-reading-setup.ts writes it before any test runs.',
    );
  }
  const reading = parsed as Partial<TreeReading>;
  if (
    !Array.isArray(reading.tracked) ||
    !Array.isArray(reading.committable) ||
    typeof reading.ignored !== 'object' ||
    reading.ignored === null ||
    !Array.isArray(reading.docsPathspecSelected) ||
    !Array.isArray(reading.docsNaming)
  )
    throw new Error(
      `the tree reading at ${path} is not in the shape tests/tree-reading.ts reads`,
    );
  if (env === process.env) cached = reading as TreeReading;
  return reading as TreeReading;
}
