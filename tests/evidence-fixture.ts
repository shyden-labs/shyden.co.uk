import { renderEvidencePage } from '../scripts/build-evidence-page.mjs';

/** A real 1x1 PNG, so no capture on a fixture page is a broken image. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

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
  });
};
