import { defineConfig, devices } from '@playwright/test';
import { ENGINES, engineUse } from './tests/engines';
import { onBuild } from './tests/sanity-on-build';
import { PASS_COOKIE } from './scripts/dev-pass/door.ts';

// Post-deploy sanity config: runs tests/dev/*.spec.ts against the REAL
// deployed dev site (no local webServer unless SANITY_ON_BUILD, below).
// baseURL + the DEV pass (#1262 AC2) come from env so CI — and a local
// run — can point at https://dev.shyden.co.uk. Kept separate from
// playwright.config.ts (testDir ./tests/e2e) so the normal
// `npm run test:e2e` never picks these remote specs up.
//
// With SANITY_ON_BUILD=1 (`npm run test:sanity`, CI's `sanity-on-build` job) it
// measures this tree's own build instead, built with the dev ShyTalk and
// Yawelo Idle URLs, Yawelo Idle's dev media host and dev ShyDesk as deploy-dev.yml builds it, and leaves out the
// @deployed-only tests (#335).
const pass = process.env.DEV_PASS;
const build = onBuild(4398, {
  PUBLIC_SHYTALK_URL: 'https://dev.shytalk.app',
  PUBLIC_YAWELO_IDLE_URL: 'https://dev.yaweloidle.com',
  PUBLIC_YAWELO_MEDIA_URL: 'https://dev-media.yaweloidle.com',
  PUBLIC_SHYDESK_URL: 'https://shydesk.shydesk-non-prod.workers.dev',
});

const baseURL =
  build?.baseURL ?? process.env.WEB_BASE_URL ?? 'https://dev.shyden.co.uk';

/**
 * The machine pass, as the door's own host-only cookie: sent to the dev host
 * alone, never to the other products' hosts its pages load from (#1262 AC2).
 */
const passCookie = pass
  ? {
      cookies: [
        {
          name: PASS_COOKIE,
          value: pass,
          domain: new URL(baseURL).hostname,
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax' as const,
        },
      ],
      origins: [],
    }
  : undefined;

export default defineConfig({
  testDir: './tests/dev',
  // A stray `test.only` fails the run in CI rather than narrowing it (#390).
  forbidOnly: !!process.env.CI,
  webServer: build?.webServer,
  grepInvert: build?.grepInvert,
  use: {
    baseURL,
    colorScheme: 'dark',
    // A failing test leaves its screenshot for the workflow to upload;
    // never a trace or a video: a trace records every
    // request's headers, these runs carry credentials, and this repository's
    // artifacts are public (#1233).
    screenshot: 'only-on-failure',
    storageState: passCookie,
  },
  // Every engine on every dev deploy (#1032 AC5, Shyden 2026-11-22).
  // The e2e suite's own three, WebKit into the silent audio sink (#919).
  projects: ENGINES.map(({ name, device }) => ({
    name,
    use: engineUse(devices[device], process.env),
  })),
});
