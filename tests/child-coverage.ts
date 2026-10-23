import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Raw V8 coverage from the processes a test starts, never from Vitest's own
 * processes, and a ledger naming each one (#936).
 *
 * Vitest's main process and forks gain nothing from a raw file: Vitest's own
 * provider measures them, and `scripts/coverage-processes.mjs` skips their
 * transformed code (measured on run 39921734907: the main process's file held
 * nothing measured, and no fork wrote one). So the run names the directory
 * under `CHILD_COVERAGE`, and each fork copies it into its own environment
 * once started (`tests/child-coverage-setup.ts`). Node reads
 * `NODE_V8_COVERAGE` only at startup, so Vitest's processes write nothing,
 * while every process a test starts inherits the variable as before.
 *
 * Each of those also preloads `tests/coverage-ledger.mjs`, which writes its
 * pid and command as it starts: a raw file left empty by a writer that died
 * mid-write names only a pid, and the ledger turns it into a command.
 */
export const CHILD_COVERAGE = 'COVERAGE_CHILD_PROCESSES';

/** Every started process's ledger line (`tests/coverage-ledger.mjs`). */
const LEDGER = pathToFileURL(
  path.join(import.meta.dirname, 'coverage-ledger.mjs'),
).href;

/**
 * Hands the run's directory to every process started from `env`, with the
 * preload that writes each one's ledger line as it starts.
 */
export const measureChildren = (
  env: NodeJS.ProcessEnv,
  ledger: string = LEDGER,
): void => {
  const dir = env[CHILD_COVERAGE];
  if (!dir) return;
  env.NODE_V8_COVERAGE = dir;
  const preload = `--import=${ledger}`;
  env.NODE_OPTIONS = env.NODE_OPTIONS
    ? `${env.NODE_OPTIONS} ${preload}`
    : preload;
};
