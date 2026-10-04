import { defineConfig, devices } from '@playwright/test';
import { onBuild } from './tests/sanity-on-build';

// Post-deploy PROD config: runs tests/prod/*.spec.ts against the REAL deployed
// production site (no local webServer unless SANITY_ON_BUILD, below), mirroring
// playwright.dev.config.ts.
//
// This exists because production was verified by `curl` — status codes and
// grepping fetched HTML. That is a text assertion, and this repo has already
// shipped a bug for a whole release that no text assertion can see: `display:
// flex` ate authored whitespace while `textContent` still contained it, so
// every text-based check passed. curl also cannot tell whether the CSS loaded,
// whether the calculators' JS ran, or whether the page scrolls sideways at
// 320px. `prod-verified` should mean a browser rendered production.
//
// The curl smoke itself lives here too since #390 (tests/prod/prod-smoke.spec.ts,
// requests and no browser), so a pull request's `sanity-on-build` runs it
// against that PR's own prod build before any deploy can meet it.
//
// baseURL is env-driven so the target can move without editing this file. It
// defaults to the PUBLIC production domain — the host real visitors get.
//
// It previously defaulted to the `shyden-site.pages.dev` deployment alias,
// chosen while the apex DNS had not yet cut over to this project. That cutover
// has happened: the apex serves 200, while the alias answers 401 behind Basic
// auth. Verifying the alias therefore meant `prod-verified` attested that a
// password-locked staging URL rendered, and said nothing about whether
// shyden.co.uk resolved, presented a valid certificate, or routed here at all.
//
// It sends no credential: the apex is not behind Basic auth. The release used to
// hand this config the DEV password for a prod run, which prod must never hold
// (#241).
//
// With SANITY_ON_BUILD=1 it measures this tree's own production build instead
// (#335). A build inherits the whole environment, and a config cannot unset a
// variable for it, so a PUBLIC_SHYTALK_URL or PUBLIC_WORDFARER_URL left in
// the shell would build DEV product links into what this run calls
// production. Either is refused.
const build = onBuild(4399, {});
for (const variable of ['PUBLIC_SHYTALK_URL', 'PUBLIC_WORDFARER_URL'])
  if (build && process.env[variable] !== undefined)
    throw new Error(
      `SANITY_ON_BUILD: ${variable} is set (${process.env[variable]}), ` +
        'so this build would not be production. Unset it and run again.',
    );

export default defineConfig({
  testDir: './tests/prod',
  // A stray `test.only` fails the run in CI rather than narrowing it (#390).
  forbidOnly: !!process.env.CI,
  // No retries (#445). This held one, so that "a single network blip"
  // would not block a release, and a check that failed once and then passed
  // posted `prod-verified`. The operator's rule, 2026-10-02: a retry is not
  // a fix. A blip against the live site is a finding to read, and
  // browser-matrix.test.ts refuses a retry in any config. The timeout keeps a
  // hung check from holding the release.
  retries: 0,
  timeout: 30_000,
  webServer: build?.webServer,
  grepInvert: build?.grepInvert,
  use: {
    baseURL:
      build?.baseURL ?? process.env.WEB_BASE_URL ?? 'https://shyden.co.uk',
    colorScheme: 'dark',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
