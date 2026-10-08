/**
 * The two filenames an evidence directory is defined by.
 *
 * An evidence run and the page built from it are two programs separated by a
 * directory, and nothing between them checks that they agree. They stopped
 * agreeing once already: `playwright.config.ts` promised that an evidence run
 * "needs no second flag anybody could forget", while the builder read a
 * `report.json` that invocation never produced. The captures landed, the run
 * went green, and the page could not be built.
 *
 * So the names live HERE, once, and every consumer imports them --
 * `tests/e2e/evidence.ts` writes the manifest, `scripts/test-e2e.mjs` writes
 * the report, `scripts/build-evidence-page.mjs` reads both.
 * `tests/guards/evidence-page.test.ts` asserts no consumer spells either name
 * for itself, derived from the filesystem rather than a list, because a
 * filename spelled twice is two filenames the day one of them moves.
 *
 * `.mjs` deliberately: the builder is plain node with no TypeScript step, so a
 * `.ts` home could not be the one home.
 */

import { createHash } from 'node:crypto';

/** Playwright's json report, as the page builder expects to find it. */
export const EVIDENCE_REPORT = 'report.json';

/** One line per captured assertion, appended as the run goes. */
export const EVIDENCE_MANIFEST = 'manifest.jsonl';

/**
 * The capture format, and the quality it is encoded at.
 *
 * A screenshot of a page containing photographs stores losslessly at roughly
 * ten times the size of a quality-90 JPEG, for a fidelity nobody consumes: the
 * page is read by an eye, and pixel-exact comparison belongs to the
 * visual-regression suite, which keeps its own PNG baselines. Measured on #138
 * before the change: 80 shots = 18.9 MiB, a 25.34 MiB page that exceeded the
 * publish limit, and every one of its 80 journey videos dropped against a
 * budget the shots had already spent (#146).
 *
 * 90, not 80: the operator judges whether a Thai capture is really Thai, so
 * the glyphs are the thing the encoder must not soften. That is why 90 is the
 * DEFAULT and the override below is an env var -- an ordinary run is unchanged
 * and keeps the glyphs.
 *
 * Overridable because the same collision recurred on #189, where the captures
 * are LAYOUT rather than script: 105 shots at 90 came to 10.0MB, which alone
 * produced a 13.2MB page and pushed all 35 videos out of it -- and a page with
 * screenshots and no video does not meet the standing rule. Scoping the run to
 * that ticket's own journeys did not help; the shots alone were over budget. At
 * 55 they came to 5.9MB and the page kept 35/35 videos. A clipped group card is
 * exactly as visible at 55, and the videos are what the smaller number buys.
 *
 * Twice now the shots have spent a budget the videos needed, so the real fix is
 * #158: publish captures as supporting files, and stop making scope and video
 * compete for one page.
 *
 * An override outside 1 to 100, or not a whole number, is refused rather than
 * replaced with 90: a capture at a quality nobody asked for is a run nobody
 * asked for, and nothing would say so.
 *
 * @returns {number}
 */
export const jpegQuality = (/** @type {string | undefined} */ asked) => {
  if (asked === undefined || asked === '') return 90;
  const quality = Number(asked);
  if (!Number.isInteger(quality) || quality < 1 || quality > 100)
    throw new Error(
      `EVIDENCE_JPEG_QUALITY=${asked} is not a JPEG quality: ` +
        'expected a whole number from 1 to 100',
    );
  return quality;
};

/** The quality this run captures at: `jpegQuality` of the environment. */
export const EVIDENCE_JPEG_QUALITY = jpegQuality(
  process.env.EVIDENCE_JPEG_QUALITY,
);

/**
 * Filesystem-safe, still readable in a directory listing.
 *
 * Here rather than beside `shoot` because there are now two capture legs and
 * only one naming scheme. `tests/e2e/evidence.ts` is Playwright-only -- it
 * reads `test.info()` -- while the iOS journeys run under Vitest and drive a
 * real phone over WebDriver, so they cannot import it at all. Two slug
 * implementations would be two schemes the day one of them changed, and the
 * page would show a picture nobody could trace back to a run.
 *
 * @param {string} s
 * @returns {string}
 */
export const slug = (s) =>
  s
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .toLowerCase();

/**
 * Where one capture is written, relative to the evidence directory. Both
 * capture legs name their files here, so there is one scheme to change.
 *
 * `slug` alone is not a name: it keeps 80 characters of a title path and
 * drops case and punctuation, and on the #390 listing 650 of 4,109 tests
 * shared a slug with another test in the same project. Two such tests
 * shooting the same order and label wrote one file, and the evidence page
 * showed one test's picture under the other's name. Eight characters of a
 * hash over the project and the full title keep each test's own file; the
 * slugs keep the name readable in a listing.
 *
 * @param {{
 *   project: string,
 *   title: string,
 *   order: number,
 *   label: string,
 *   ext: 'jpg' | 'png',
 * }} capture
 * @returns {string}
 */
export const captureFile = ({ project, title, order, label, ext }) => {
  const test = createHash('sha256')
    .update(`${project}\n${title}`)
    .digest('hex')
    .slice(0, 8);
  const shot = `${String(order).padStart(2, '0')}-${slug(label)}`;
  return `${slug(project)}/${slug(title)}-${test}__${shot}.${ext}`;
};

/**
 * What one assertion shot records about itself.
 *
 * A JSDoc typedef rather than a TypeScript type because this module is `.mjs`
 * on purpose (see the header): the builder is plain node. TypeScript reads
 * this as a first-class annotation, so both legs are still checked against it
 * (#157).
 *
 * @typedef {object} Capture
 * @property {string} project
 * @property {string} title
 * @property {number} order
 * @property {string} label
 * @property {string} file
 */

/**
 * One manifest line: a capture, stamped with the instant it was written.
 *
 * The manifest is appended to and never cleared, so a second run into the same
 * evidence directory left the first run's rows -- and their pictures -- on a
 * page built from the second run's report (#171). The stamp is how
 * `scripts/build-evidence-page.mjs` tells them apart: a run's rows are the ones
 * stamped once its report's `stats.startTime` had passed.
 *
 * PURE, with the clock as an argument, so `tests/guards/evidence-page.test.ts`
 * feeds the builder rows this function wrote rather than a copy of their shape.
 *
 * @param {Capture} capture
 * @param {Date} now
 */
export const manifestRow = (capture, now) => ({
  ...capture,
  at: now.toISOString(),
});

/**
 * This file's own basename.
 *
 * The guard against re-spelling has to exempt the module that does the
 * spelling, and naming it here keeps that exemption from being a string in the
 * test that outlives a rename.
 */
export const CONTRACT_MODULE = 'evidence-files.mjs';
