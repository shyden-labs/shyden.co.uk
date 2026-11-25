import { defineConfig, devices } from '@playwright/test';
import { DEV_DOOR_HOST } from './functions/_lib/dev-door.ts';
import { mintPass } from './scripts/dev-pass/pass.ts';
import { BASE_URL, TEST_PASS_KEYS_ENV } from './tests/functions/local.mjs';
import { ENGINES, engineUse } from './tests/engines';

/** This run's DEV pass, signed by the throwaway key the local server trusts. */
const TEST_PASS_ENV = 'FUNCTIONS_TEST_PASS';

/**
 * The run's key and pass are made once, in the first process to load this
 * config, and carried in the environment: the server and every worker inherit
 * it, so all of them agree on one key (#1262 AC2). A machine pass lasts an hour.
 */
async function runPass(): Promise<string> {
  const made = process.env[TEST_PASS_ENV];
  if (made) return made;
  const pair = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const { x } = await crypto.subtle.exportKey('jwk', pair.publicKey);
  process.env[TEST_PASS_KEYS_ENV] = JSON.stringify({ 'functions-local': x });
  const pass = await mintPass(
    { aud: DEV_DOOR_HOST, sub: 'functions-suite', kind: 'machine' },
    { kid: 'functions-local', privateKey: pair.privateKey },
    Math.floor(Date.now() / 1000),
  );
  process.env[TEST_PASS_ENV] = pass;
  return pass;
}

const pass = await runPass();

/**
 * The environment a browser is launched with: everything but the run's key and
 * pass, which belong to the server and the request headers, never a browser.
 */
const launchEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => name !== TEST_PASS_ENV && name !== TEST_PASS_KEYS_ENV,
  ),
);

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
    // Measured, unlike every other web server: the script clears the
    // measurement for everything it starts (#913).
    command: 'node tests/functions/serve.mjs',
    // webServer sends no pass, and the dev gate answers 401 without one,
    // which Playwright counts as up. So readiness only means "serving";
    // the health test, first in the file with one worker, is what proves the
    // binding and the migration.
    url: `${BASE_URL}/`,
    // Never reuse: a server left running would hold an older build, and a
    // mutation would then be tested against code it never reached.
    reuseExistingServer: false,
    timeout: 240_000,
    // Without this Playwright SIGKILLs the server, and a killed process never
    // writes its coverage (#913). serve.mjs passes SIGTERM on to wrangler and
    // exits when it does; past 10 s Playwright still kills it.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
  use: {
    baseURL: BASE_URL,
    colorScheme: 'dark',
    extraHTTPHeaders: { 'X-Dev-Pass': pass },
  },
  projects: ENGINES.map(({ name, device }) => ({
    name,
    use: engineUse(devices[device], launchEnv),
  })),
});
