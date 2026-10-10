import { defineConfig, devices } from '@playwright/test';
import { ENGINES } from './tests/engines';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Specs that assert HTTP responses and DOM text, and never render.
 *
 * A sitemap's URLs, a canonical tag, a locale's copy reaching its page:
 * `textContent` is spec-defined, so these bytes do not vary by engine. Running
 * them on all five projects cost four extra runs each and returned nothing the
 * first run had not already proven.
 *
 * The boundary is mechanical, not editorial -- a spec is content-only exactly
 * when it neither drives the viewport nor reads layout -- so it is enforced
 * rather than trusted: tests/unit/browser-matrix.test.ts fails if anything
 * listed here does either (`tests/unit/engine-dependence.ts` names what counts
 * and reads it from the parse tree, never from comments), if a name here stops
 * matching a real file, or if any engine project stops ignoring these.
 *
 * `site-meta.spec.ts` is deliberately NOT here. It mixes three content
 * assertions with a parameterised 404 layout test that does resize, and the
 * layout half has to keep running everywhere.
 *
 * `rendered-text.spec.ts` is not here either (#198). Whether two words come out
 * touching is a question about where the browser put them, and the answer
 * depends on width: below 720px the nav is hidden and the header's last text
 * box is a different one. Listed here, it ran at 1280px only, and a real phone
 * was the first place it ever failed. A spec can read layout without resizing,
 * which is why the boundary asks about reading as well as driving.
 *
 * The skip link's WCAG 2.4.1 tests left `head-and-sitemap.spec.ts` for
 * `skip-link.spec.ts` for the same reason (#198). They read layout
 * (`toBeInViewport`) and ask which engine they are on (`browserName`), and
 * while listed here they ran on one engine, though their comment promised
 * WebKit.
 */
export const CONTENT_ONLY_SPECS = [
  'head-and-sitemap.spec.ts',
  'seo.spec.ts',
  'baseurl-guard.spec.ts',
  'locale-parity.spec.ts',
  'copy-reaches-a-page.spec.ts',
  'theme-script.spec.ts',
  'floors-under-playwright.spec.ts',
];

const contentOnly = new RegExp(
  `(?:${CONTENT_ONLY_SPECS.map((s) => s.replace(/\./g, '\\.')).join('|')})$`,
);

/**
 * The visual-regression suite, scoped to its own single-engine project (#33).
 *
 * It cannot join `content`: that project's specs are guarded as ones which
 * never drive the viewport, and a baseline needs a desktop width AND a mobile
 * one. It must not join the five engines either -- that would demand five sets
 * of baselines for a question about OUR css, not about WebKit's.
 */
// Anchored on a path boundary, not just the suffix. `/visual\.spec\.ts$/`
// also claims `audiovisual.spec.ts` -- and because the five engines IGNORE
// this pattern, a spec so named would silently stop running everywhere.
// Same substring trap as `/glory-points` matching `/id/glory-points` in
// #21 Stage 4; caught here by the guard rather than in production.
const visualOnly = /(?:^|\/)visual\.spec\.ts$/;

/**
 * One engine, one set of baselines -- and OPT-IN, behind `VISUAL=1`.
 *
 * Exported so `tests/unit/browser-matrix.test.ts` can pin its shape without
 * the env var set, and conditional so the ordinary `npm run test:e2e` run is
 * unchanged: a bare GitHub runner and the pinned container render text
 * differently, and comparing container-made baselines on a bare runner fails
 * for a reason that has nothing to do with the site.
 *
 * A wrong env var cannot make this pass vacuously. `--project=visual` against
 * a config that does not declare it is a hard Playwright error, not an empty
 * run -- the liveness control is the tool's own.
 *
 * The widths come from `test.use` inside the spec rather than from a device
 * here, so the two viewports sit beside the assertions that depend on them.
 */
export const VISUAL_PROJECT = {
  name: 'visual',
  use: { ...devices['Desktop Chrome'] },
  testMatch: visualOnly,
};

/**
 * The MEASURING twin of `VISUAL_PROJECT` (#224).
 *
 * Same spec and the same committed baselines -- `snapshotPathTemplate` carries
 * no `{projectName}`, so this resolves the very files the gating project
 * compares -- but at ZERO per-pixel tolerance.
 *
 * `threshold: 0.1` permits a YIQ distance of about 352 per pixel before that
 * pixel COUNTS as differing, so a difference nobody is looking at (a font
 * rasterised on another architecture, a baseline captured before a CSS change)
 * is scored identical and never reaches `maxDiffPixelRatio`, which is already
 * 0. It does not eat a pixel budget; it moves the reference point a later
 * regression is measured from. At `threshold: 0` each of those differences is
 * reported with its own numbers instead, which is the measurement.
 *
 * Declared only under `VISUAL_MEASURE=1`, exactly as `visual` is declared only
 * under `VISUAL=1`, so an ordinary run keeps precisely the projects it had. A
 * wrong environment variable here can only make a comparison STRICTER, never
 * weaker: it cannot turn a real difference into a pass. It never gates -- the
 * job that runs it tolerates the failure and reports the numbers.
 */
export const VISUAL_MEASURE_PROJECT = {
  name: 'visual-measure',
  use: { ...devices['Desktop Chrome'] },
  testMatch: visualOnly,
  expect: { toHaveScreenshot: { threshold: 0 } },
  // A folder of its own, never the gate's (#311). Playwright deletes the
  // outputDir of every project a run selects as that run starts, and CI
  // measures straight after the gate -- after a red one above all. Sharing
  // the gate's folder, the measurement deleted the comparison's expected,
  // actual and diff images before the job could upload them. Still under
  // `test-results/`, so the one upload keeps both.
  outputDir: 'test-results/visual-measure',
};

/** Whether `path` is `dir` itself or anywhere beneath it. */
const isWithin = (dir: string, path: string): boolean => {
  const rel = relative(dir, path);
  return !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
};

/**
 * Where an evidence run keeps what Playwright writes, recordings included --
 * or `undefined`, which leaves an ordinary run on its own folder,
 * `test-results/desktop` (see `outputDir` below).
 *
 * Playwright clears its output directory when a run starts. Left at the
 * default, an evidence run's recordings lasted until the next run of any kind:
 * 25 of 25 were gone while the captures and the report beside them survived,
 * a directory that looked complete and built a page with no video in it
 * (#165). So the switch that turns recording on also moves the output into the
 * evidence directory, in a subdirectory of its own -- that clearing must never
 * reach the captures, the manifest or the report.
 *
 * Resolved against the working directory, as `tests/e2e/evidence.ts` and
 * `scripts/test-e2e.mjs` resolve `EVIDENCE_DIR`, so all three name one place.
 * An ordinary run stays under `test-results/` because `ci.yml` uploads that
 * folder when a job fails.
 */
const evidenceOutputDir = (
  evidence: string | undefined,
): string | undefined => {
  if (!evidence) return undefined;
  const outputDir = resolve(evidence, 'test-results');
  const cleared = resolve('test-results');
  if (isWithin(cleared, outputDir))
    throw new Error(
      `EVIDENCE_DIR=${evidence} would keep the recordings in ${outputDir}, ` +
        `inside ${cleared}, which every Playwright run clears as it starts ` +
        '(#165). Choose an evidence directory outside test-results/.',
    );
  return outputDir;
};

export default defineConfig({
  testDir: './tests/e2e',
  // An evidence run keeps its recordings inside EVIDENCE_DIR; an ordinary run
  // writes to a folder OF ITS OWN. See `evidenceOutputDir` above.
  //
  // `test-results/desktop`, not `test-results/`, because Playwright wipes its
  // entire outputDir at the start of every invocation, unconditionally and
  // not scoped to its own artifacts -- and `npm run test:devices` launches
  // this config and `playwright.device.config.ts` CONCURRENTLY against this
  // same checkout (#230). Sharing one folder meant a worker stopping in one
  // group deleted the artifacts folder a live worker in the other was still
  // writing into: reproduced in isolation, three `mobile-chrome` failures on
  // the 2026-09-18 run, all `ENOENT ... .playwright-artifacts-N/traces/...`.
  // The folder is named by WORKER INDEX alone, so two processes numbering
  // their workers independently collide by construction.
  outputDir:
    evidenceOutputDir(process.env.EVIDENCE_DIR) ?? 'test-results/desktop',
  fullyParallel: true,
  // A stray `test.only` fails the run in CI rather than narrowing it (#390).
  forbidOnly: !!process.env.CI,
  // Measure the bytes that ship, not the ones the dev server improvises.
  // `astro dev` renders on request and skips build-time steps — compressHTML,
  // asset hashing, the sitemap — so a suite pointed at it can be entirely
  // green about a page nobody will ever receive. The build is ~1.5s; there is
  // no reason to test anything else.
  //
  // `reuseExistingServer` used to be hardcoded `false` for exactly that
  // reason: left on unconditionally, a dev server already listening on 4321
  // is silently adopted and the whole suite goes back to measuring the wrong
  // thing, with nothing in the output to say so. That hazard is still real —
  // this is now `!!process.env.PW_REUSE_SERVER` instead of always-false
  // because `scripts/test-devices.mjs` (`npm run test:devices`) needs desktop,
  // Android and iOS to share ONE build and ONE server rather than each
  // rebuilding and fighting over port 4321. The invariant this guards is now
  // upheld by the runner, not by this file: `PW_REUSE_SERVER` is set by
  // nothing else, and the runner sets it only after it has (a) freed port
  // 4321 itself, (b) run a fresh `npm run build`, (c) started
  // `astro preview` itself, and (d) fetched a page and confirmed it equals
  // the file in `dist/` byte for byte — proof the server is previewing this
  // build, not something already-running and stale. (A `/_astro/` reference
  // was the check until #390 F52, and every build carries one.) A run
  // of this config that does NOT go through the runner (e.g. a bare
  // `npx playwright test`) never has `PW_REUSE_SERVER` set, so it keeps the
  // original safe behaviour unchanged: refuse an already-listening server.
  /**
   * `{platform}` is in the path DELIBERATELY, not for tidiness.
   *
   * Playwright renders differently on macOS and Linux -- font rasterisation
   * and scrollbars alone are enough -- so a baseline captured on a laptop is
   * not the baseline CI compares against. Spelling the platform into the
   * filename makes that visible in the diff instead of surfacing as a missing
   * snapshot on a runner nobody was looking at.
   */
  snapshotPathTemplate: 'tests/e2e/__screenshots__/{arg}-{platform}{ext}',
  /**
   * Playwright 1.63 defaults this to `'missing'` (`runner/index.js:583`), and
   * under that default a run whose baseline is absent WRITES the PNG before
   * failing on a soft error. The failure means nothing is silently accepted --
   * but an ordinary CI run still produces a baseline nobody reviewed, and the
   * only guard on that behaviour watched the `--update-snapshots` flag in the
   * workflow. The flag and this default are two doors into the same room, and
   * only one of them was being watched.
   *
   * `'none'` refuses outright and writes nothing, and it is the only value for
   * which `applySuggestedRebaselines` returns early instead of being willing
   * to rewrite expectations during a normal run. Baselines change exactly one
   * way: `npm run test:visual:update`, reviewed as a diff in a PR.
   */
  updateSnapshots: 'none',
  expect: {
    toHaveScreenshot: {
      // The flake policy, MEASURED rather than assumed (#134).
      //
      // 0.002 sounds small and is not: it is a fraction of the IMAGE, and
      // these are full-page screenshots. On `home-en-mobile` (390x2250) it
      // permitted 1,755 differing pixels. A 1px border around a ~180x48
      // button is roughly 2*(180+48) = 456 pixels, so a recolour of every
      // control boundary on the page could never reach the allowance. Not
      // hypothetical: 13 control borders were recoloured for #133 and SEVEN
      // OF EIGHT screenshots reported green. Proven by regenerating every
      // baseline with `--update-snapshots=all` and asking git which files
      // actually changed -- all eight had.
      //
      // Zero, because the render is deterministic and that was measured too:
      // two consecutive `--update-snapshots=all` runs in the pinned container
      // on a clean tree rewrote all eight baselines byte-identically, `git
      // status` empty both times. An allowance only buys flake resistance if
      // there is flake to resist. `threshold` below still absorbs sub-visible
      // per-pixel noise -- it decides what COUNTS as a differing pixel, which
      // is the correct place for that tolerance.
      //
      // If a dependency bump ever changes text rasterisation, every
      // screenshot fails at once. That is the intended behaviour: it is a
      // real change to what users see, and it belongs in a reviewed diff.
      maxDiffPixelRatio: 0,
      // The PER-PIXEL tolerance, and the half that was nearly left defaulted.
      // Playwright scores pixels in YIQ space and allows 35215 * threshold^2;
      // the default 0.2 permits ~1409, while recolouring the accent from
      // #0a7d66 to #0a66c2 -- a green button turning blue -- scores only ~488.
      // Every screenshot passed on that change until this line existed. A
      // ratio without a threshold is half a policy: it bounds HOW MANY pixels
      // may differ while letting each one differ almost arbitrarily.
      threshold: 0.1,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4321',
    reuseExistingServer: !!process.env.PW_REUSE_SERVER,
  },
  use: {
    baseURL: 'http://localhost:4321',
    // #142: the palette every existing test was written against. A light-theme run declares light itself.
    colorScheme: 'dark',
    // #44. A test that times out inside `page.goto` leaves ONE LINE of text
    // behind, and the run is gone: `retries` is 0 and nothing is kept. Two
    // occurrences have now been reasoned about from a stack trace and a
    // memory of what the test does.
    //
    // What points away from load is the SIGNATURE, not the margin: the first
    // occurrence was "WebKit encountered an internal error" inside
    // `page.goto` — a browser-process failure, before any assertion ran —
    // and the failing test appears in no project's slowest three.
    //
    // The MARGIN no longer supports the comfort this comment used to claim.
    // It said mobile-safari's max "sits around 10-11.6s against a 30s
    // budget". Measured on the build CI actually runs — the Linux image
    // `mcr.microsoft.com/playwright:v1.63.0-noble` at `--workers=2`, which is
    // what a 4-core GitHub runner takes — whole-test maxima across two full
    // runs were **17.1s and 19.1s**: about 64% of the 30s budget, and roughly
    // twice every other project's tail. `page.goto: Test timeout of 30000ms
    // exceeded` is the TEST timeout, so that is the budget to compare with.
    //
    // A green run on this machine is not evidence either way: CI is
    // `ubuntu-26.04`, so `webkit` and `mobile-safari` there are WebKit-GTK,
    // while a macOS checkout runs WebKit-Mac. Different binaries.
    //
    // None of that licenses raising a timeout. These are whole-test
    // durations: they bound the problem, they do not separate a slow
    // navigation from a slow test around one. The next occurrence needs to be
    // diagnosable, not re-argued. See #44 for the full table and the harness
    // that produced it.
    //
    // SINCE THEN THAT SEPARATION IS COLLECTED ON EVERY RUN.
    // `tests/reporters/nav-timing-reporter.ts` reads each navigation's own
    // duration out of the step tree -- it cannot come from the json report,
    // which strips every `pw:api` step -- and `npm run test:e2e` prints them
    // per project beside the whole-test table, into the job summary in CI.
    // So the next occurrence arrives with the navigation's own number
    // attached, and the paragraph above can be settled instead of repeated.
    //
    // `retain-on-failure`, not `on`: a trace per test across ~2200 tests is
    // hundreds of megabytes of artefact for runs that told us nothing. This
    // costs nothing on a green run.
    trace: 'retain-on-failure',

    // NOT recorded here, and the literal `'off'` is the safety property: a
    // spec ASKS to be recorded by declaring `test.use(recorded)`, and
    // `recorded` (tests/e2e/evidence.ts) is the one home that switch lives in.
    // A new static spec is therefore covered the day it is written, with
    // nobody remembering to exclude it -- the opposite default would need an
    // exclusion list, which is the shape that missed `#cg-io-toggle`.
    //
    // This read `process.env.EVIDENCE_DIR ? 'on' : 'off'`: one global switch,
    // so an evidence run recorded EVERY test. Operator, 2026-09-18:
    // "recordings are pointless and useless on static content." Measured on
    // #205's preview -- 100 recordings beside 155 screenshots, so 100 of the
    // 255 entries a publish may carry went on pages where nothing moves.
    //
    // An evidence run still leaves in `<dir>` everything the page is built
    // from: the captures and `manifest.jsonl` (tests/e2e/evidence.ts),
    // `report.json` (`reportLocation` in scripts/test-e2e.mjs) and the
    // recordings, under `<dir>/test-results/` (`evidenceOutputDir` above).
    // That sentence was false twice -- the report first landed in a temp
    // directory that was deleted, then the recordings stayed in the root
    // `test-results/`, which the next run of any kind clears (#165). Both are
    // pinned by the seam guards in `tests/guards/evidence-page.test.ts`.
    video: 'off',
  },
  projects: [
    // Bytes and DOM text are identical on every engine, so running these five
    // times bought four repeats of a result the first run already had. Once is
    // enough. See CONTENT_ONLY_SPECS.
    {
      name: 'content',
      use: { ...devices['Desktop Chrome'] },
      testMatch: contentOnly,
      // Most of these specs open a page, but `copy-reaches-a-page.spec.ts`
      // only reads built files, so a run of this project alone can record no
      // navigation with the collector healthy. The json report carries this
      // mark, and `navTimingVerdict` in `scripts/test-e2e.mjs` leaves the
      // project out of the count it judges (#355).
      metadata: { requiresNavigation: false },
    },
    // Everything that renders, on every engine it has to render on. A collapsed
    // nav wrapper once pushed the header links off-screen and only a real
    // engine could see it -- this half of the matrix is not negotiable.
    ...ENGINES.map(({ name, device }) => ({
      name,
      use: { ...devices[device] },
      testIgnore: [contentOnly, visualOnly],
    })),
    ...(process.env.VISUAL === '1' ? [VISUAL_PROJECT] : []),
    ...(process.env.VISUAL_MEASURE === '1' ? [VISUAL_MEASURE_PROJECT] : []),
  ],
});
