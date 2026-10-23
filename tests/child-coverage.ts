/**
 * Raw V8 coverage from the processes a test starts, never from the fork that
 * runs the test (#936).
 *
 * Vitest stops each fork with SIGTERM and sends SIGKILL 500 ms later
 * (vitest 5.0.5, the fork pool's `stop()`). A fork that inherits
 * `NODE_V8_COVERAGE` writes its own file as it exits, and one whose file takes
 * longer than that is killed mid-write, leaving it empty or cut off. The fork
 * gains nothing from the file: Vitest's own provider measures it, and
 * `scripts/coverage-processes.mjs` skips its transformed code.
 *
 * So the run names the directory under `CHILD_COVERAGE`, and each fork copies
 * it into its own environment once started (`tests/child-coverage-setup.ts`).
 * Node reads `NODE_V8_COVERAGE` only at startup, so the fork writes nothing,
 * while every process a test starts inherits the variable as before.
 */
export const CHILD_COVERAGE = 'COVERAGE_CHILD_PROCESSES';

/** Hands the run's directory to every process started from `env`. */
export const measureChildren = (env: NodeJS.ProcessEnv): void => {
  const dir = env[CHILD_COVERAGE];
  if (dir) env.NODE_V8_COVERAGE = dir;
};
