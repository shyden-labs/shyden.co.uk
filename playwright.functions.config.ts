import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, PASSWORD } from './tests/functions/local.mjs';
import { unmeasured } from './tests/coverage-options';
import { ENGINES, engineUse } from './tests/engines';

/**
 * The Functions-runtime suite (#97, spec 10): real submissions to the real
 * Pages Functions on workerd, through `wrangler pages dev`. One worker,
 * because every test shares one server and one local database. Every engine
 * the e2e suite renders on (#350): a form posted by a real browser is the
 * claim, and each engine posts it its own way.
 */
export default defineConfig({
  testDir: './tests/functions',
  workers: 1,
  forbidOnly: !!process.env.CI,
  webServer: {
    command: unmeasured('node tests/functions/serve.mjs'),
    // webServer takes no credentials, and the dev gate answers 401 without
    // them, which Playwright counts as up. So readiness only means "serving";
    // the health test, first in the file with one worker, is what proves the
    // binding and the migration.
    url: `${BASE_URL}/`,
    // Never reuse: a server left running would hold an older build, and a
    // mutation would then be tested against code it never reached.
    reuseExistingServer: false,
    timeout: 240_000,
  },
  use: {
    baseURL: BASE_URL,
    colorScheme: 'dark',
    httpCredentials: { username: 'dev', password: PASSWORD, send: 'always' },
  },
  projects: ENGINES.map(({ name, device }) => ({
    name,
    use: engineUse(devices[device], process.env),
  })),
});
