import { defineConfig } from '@playwright/test';
import { VISUAL_PROJECT } from './playwright.config';

// Set here rather than only in the runner so that a bare `npx playwright test
// --config=playwright.device.config.ts` behaves identically to the scripted run. Playwright
// loads the config in every worker before any spec file, so fixtures.ts sees it.
process.env.PW_REAL_DEVICE = '1';

export default defineConfig({
  testDir: './tests',
  // A stray `test.only` fails the run in CI rather than narrowing it (#390).
  forbidOnly: !!process.env.CI,
  // A folder of its own, and a SIBLING of the desktop group's rather than a
  // path inside it: Playwright wipes its whole outputDir at the start of
  // every invocation, so nesting one group's folder under another's would
  // reproduce the very collision this separation removes (#230).
  outputDir: 'test-results/android',
  // One phone, one shared context, one localStorage origin.
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: 'npm run build && npm run preview -- --host 0.0.0.0',
    url: 'http://localhost:4321',
    reuseExistingServer: !!process.env.PW_REUSE_SERVER,
  },
  use: { baseURL: 'http://localhost:4321', colorScheme: 'dark' },
  // Never write a baseline during a run (#194). Playwright's default,
  // 'missing', writes the PNG before it fails, which is how a device run left
  // eight untracked `-android-chrome-darwin` files in the repo. Baselines
  // change one way only, in the pinned container (see playwright.config.ts).
  updateSnapshots: 'none',
  projects: [
    { name: 'android-preflight', testMatch: /android-preflight\.setup\.ts/ },
    {
      name: 'android-chrome',
      dependencies: ['android-preflight'],
      // `testDir` is './tests' (not './tests/e2e') so this project can also reach
      // tests/device/real-device.spec.ts, but that widens the sweep to every other
      // directory under tests/ too. An allowlist is deliberate, not a style choice: a
      // denylist that only named the preflight file let this project try to collect
      // tests/unit/*.test.ts (Vitest, crashes -- there is no Vitest runtime under
      // Playwright) and tests/dev/dev-sanity.spec.ts (targets the deployed dev site
      // under its own playwright.dev.config.ts; running it here would mix that
      // environment's assertions into a local-build run). Measured by running
      // `--list` against the denylist version, not assumed.
      testMatch: [
        /tests\/e2e\/.*\.spec\.ts$/,
        /tests\/device\/real-device\.spec\.ts$/,
      ],
      // The visual suite stays out, and ONLY the visual suite (#194). A
      // baseline belongs to one project on one platform, so a phone can never
      // hold one CI would read: claimed here, the suite failed eight times by
      // construction and buried the run's one real failure among them. The
      // pattern is the visual project's own, imported rather than restated.
      //
      // The content-only specs are NOT excluded, although the five engines
      // ignore them: `rendered-text.spec.ts` reads layout, and this project is
      // the only run that measures it at phone width (#198).
      testIgnore: VISUAL_PROJECT.testMatch,
      // A real phone has one screen: `page.setViewportSize`/`test.use({ viewport })`
      // would "succeed" against CDP and report numbers describing nothing physical
      // (see tests/guards/viewport-tagging.test.ts, which is what keeps every such
      // test actually carrying this tag). Scoped to this project alone -- the
      // preflight project runs exactly one setup file that never touches the
      // viewport, and must not be affected by a grep option meant for the suite.
      //
      // `@requires-isolated-context` is the second, structurally identical exclusion
      // (tests/guards/isolated-context-tagging.test.ts is what keeps every such test tagged):
      // `test.use({ javaScriptEnabled: false })` only takes effect on a context Playwright
      // itself creates fresh. The real device has exactly ONE adopted context for the whole
      // run (`browser.newContext()` measured to fail against it -- "Protocol error
      // (Target.createBrowserContext): Failed to create browser context", tests/e2e/fixtures.ts's
      // own `context` fixture comment), so the option is silently inert: JavaScript keeps
      // running. classroom-groups-privacy.spec.ts's "privacy — with JavaScript blocked" tests
      // are excluded here rather than left to fail (or, worse, pass for the wrong reason --
      // see docs/superpowers/specs/2026-08-08-real-device-test-harness-design.md) for exactly
      // the same "physically impossible on one real device" reason @emulated-viewport already
      // covers for the screen.
      // Downloads are NOT excluded (#308). The tests that read a download's bytes
      // were, on the belief that the phone could not give them back: every
      // download read "canceled". The cause was Playwright, which attached over
      // plain CDP and pointed the phone's downloads at a folder on the MAC. The
      // real-device fixture now points them at a folder on the phone
      // (tests/device/device-downloads.ts), and the bytes are read back over adb.
      grepInvert: /@emulated-viewport|@requires-isolated-context/,
    },
  ],
});
