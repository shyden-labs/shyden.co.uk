import './tests/main-coverage.ts';
import { defineConfig } from 'vitest/config';
import LoadReporter from './tests/load-reporter.ts';
import unit from './vitest.config.ts';
import { LOAD_SETUP, SHARED_SETUP } from './tests/setup-files.ts';

/**
 * The logs suite (#822): every check of a log line or an audit trail the code
 * writes, keeps or replays. Global rule (Shyden, 2026-10-16): "separate test
 * suite for logging and auditing. run in ci as a pre-requisite to a release".
 * It runs before every production deploy (`logs.yml`, called by
 * `deploy-prod.yml` ahead of the approval), never on a pull request.
 *
 * Here: what the report endpoint and its health check write to the Functions
 * log, and the reports table, which the endpoint writes and the review script
 * reads back. The unit suite keeps a narrower stand-in of each check's logic,
 * so a pull request still meets it (global rule: a cut never drops a real run,
 * it moves).
 *
 * There is NO time limit in this file: the suite's one measured limit is on
 * the command that runs it (`npm run test:logs`), pinned by
 * `tests/unit/suite-budgets.test.ts`.
 */
export default defineConfig({
  test: {
    include: ['tests/logs/**/*.test.ts'],
    // The shared setup, then the measurement of loading each file (#696).
    setupFiles: [...SHARED_SETUP, LOAD_SETUP],
    // The verbose listing, then what loading each file cost.
    reporters: ['verbose', new LoadReporter({ suite: 'logs' })],
    globalSetup: unit.test?.globalSetup,
  },
});
