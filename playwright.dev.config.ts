import { defineConfig, devices } from '@playwright/test';
import { onBuild } from './tests/sanity-on-build';

// Post-deploy sanity config: runs tests/dev/*.spec.ts against the REAL
// deployed dev site (no local webServer unless SANITY_ON_BUILD, below).
// baseURL + the Basic-auth credential come from env so CI — and a local
// run — can point at https://dev.shyden.co.uk. Kept separate from
// playwright.config.ts (testDir ./tests/e2e) so the normal
// `npm run test:e2e` never picks these remote specs up.
//
// With SANITY_ON_BUILD=1 (`npm run test:sanity`, CI's `sanity-on-build` job) it
// measures this tree's own build instead, built with the dev ShyTalk and
// Yawelo Idle URLs, Yawelo Idle's dev media host and dev ShyDesk as deploy-dev.yml builds it, and leaves out the
// @deployed-only tests (#335).
const password = process.env.DEV_BASIC_AUTH_PASSWORD;
const build = onBuild(4398, {
  PUBLIC_SHYTALK_URL: 'https://dev.shytalk.app',
  PUBLIC_YAWELO_IDLE_URL: 'https://dev.yaweloidle.com',
  PUBLIC_YAWELO_MEDIA_URL: 'https://dev-media.yaweloidle.com',
  PUBLIC_SHYDESK_URL: 'https://shydesk.shydesk-non-prod.workers.dev',
});

export default defineConfig({
  testDir: './tests/dev',
  // A stray `test.only` fails the run in CI rather than narrowing it (#390).
  forbidOnly: !!process.env.CI,
  webServer: build?.webServer,
  grepInvert: build?.grepInvert,
  use: {
    baseURL:
      build?.baseURL ?? process.env.WEB_BASE_URL ?? 'https://dev.shyden.co.uk',
    colorScheme: 'dark',
    // A failing test leaves its screenshot for the workflow to upload;
    // never a trace or a video: a trace records every
    // request's headers, these runs carry credentials, and this repository's
    // artifacts are public (#1233).
    screenshot: 'only-on-failure',
    // Username half is ignored by the gate; only the password matters.
    httpCredentials: password ? { username: 'dev', password } : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
