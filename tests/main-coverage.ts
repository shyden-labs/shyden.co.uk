/**
 * Vitest's main process is measured, and nothing it starts is (#912).
 *
 * The coverage commands start Vitest with `NODE_V8_COVERAGE`, so its main
 * process writes raw V8 coverage of what it loads natively: the configs
 * (`--configLoader native`) and the reporters and modules they import.
 * Every config imports this module first, and it takes the variable out of
 * the environment: Node read it at startup, so the main process still
 * writes, while the forks and the processes they start inherit nothing.
 * A fork killed mid-write once left an empty raw file (#936);
 * `tests/child-coverage.ts` hands a test's own children their directory.
 */
export const keepFromChildren = (env: NodeJS.ProcessEnv): void => {
  delete env.NODE_V8_COVERAGE;
};

keepFromChildren(process.env);
