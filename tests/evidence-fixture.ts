import {
  imageSize,
  renderEvidencePage,
} from '../scripts/build-evidence-page.mjs';

/**
 * A 1x1 transparent RGBA PNG whose chunk CRCs and compressed data all check,
 * so no capture on a fixture page is a broken image. The one it replaced
 * failed both: Chromium drew it, Firefox refused it (#363).
 * `tests/unit/evidence-fixture.test.ts` decodes it strictly.
 */
const PIXEL_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
  'base64',
);
const PIXEL = `data:image/png;base64,${PIXEL_BYTES.toString('base64')}`;

/**
 * An evidence page exactly as the builder renders it for a ticket with these
 * journeys, each with one passed capture on chromium. The one home for this
 * fixture: the page's unit tests, its browser tests and the pre-merge check's
 * tests all sign off the same page.
 *
 * The manifest and the report spell each journey the same way, as the builder
 * requires since #263. A prefix on one side alone renders every journey
 * twice, once with its capture and once without, which the browser fixture
 * did, unnoticed, until #197 counted its journeys.
 */
export const evidencePageOf = (
  titles: readonly string[],
  signoffKey: string,
  extra: Readonly<Record<string, unknown>> = {},
): string => {
  const manifest = titles.map((title, index) => ({
    project: 'chromium',
    title,
    order: 1,
    label: `what ${title} shows`,
    file: `chromium/journey-${index + 1}.png`,
  }));
  return renderEvidencePage({
    manifest,
    report: {
      stats: {
        startTime: '2026-09-14T15:09:00.000Z',
        duration: 1000,
        expected: titles.length,
        unexpected: 0,
        flaky: 0,
        skipped: 0,
      },
      suites: [
        {
          specs: titles.map((title) => ({
            title,
            tests: [
              {
                projectName: 'chromium',
                results: [{ status: 'passed', duration: 100, attachments: [] }],
              },
            ],
          })),
        },
      ],
    },
    content: {
      title: 'Evidence page fixture',
      eyebrow: 'fixture',
      headline: `A page with ${titles.length} journeys to sign off`,
      lede: 'Rendered by the real builder.',
      signoffKey,
      ...extra,
    },
    shots: new Map(manifest.map((entry) => [entry.file, PIXEL])),
    // The size read the way the real build reads it, so each capture reserves
    // its box: without it, one that decodes late moves everything below it
    // while a click is in progress (#96, #363).
    dims: new Map(
      manifest.map((entry) => [entry.file, imageSize(PIXEL_BYTES)]),
    ),
  });
};

/**
 * A rendered page as a reader receives it once published. The builder emits
 * the page's body alone, and the artifact runtime wraps it in a document
 * skeleton at publish time: a doctype, a UTF-8 charset and a device-width
 * viewport. A browser test served the bare fragment instead ran in quirks
 * mode at a 980px layout on every phone, and WebKit, which ignores the
 * charset on a route Playwright fulfils, read every non-ASCII character as
 * Windows-1252: "Not saved yet — …" showed as "Not saved yet â€” …".
 */
export const asPublished = (html: string): string =>
  '<!doctype html><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  html;
