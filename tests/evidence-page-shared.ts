import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The evidence page generator, which must stay a TOOL and not become a page
 * about one ticket.
 *
 * #96 produced the first of these by hand, in a session scratchpad, so the
 * next ticket would have rebuilt it from nothing -- exactly the cost the
 * capture harness (`tests/e2e/evidence.ts`) was written to remove. Promoting it
 * only helps if the ticket's own prose stays OUT of the script; a generator
 * with "#96" baked into it produces a page that confidently describes the
 * wrong feature for every ticket after it.
 *
 * Everything structural is DERIVED from the run: engines, journeys and
 * assertions come from Playwright's JSON report and the capture manifest, never
 * from an argument. A sixth engine, or a spec that runs on fewer, is reflected
 * without touching this code.
 */

export const CONTENT = {
  title: 'Example Evidence',
  eyebrow: 'example · evidence',
  headline: 'A headline only this ticket would use',
  lede: 'A lede only this ticket would use.',
  sections: [{ heading: 'A section heading', body: 'A section body.' }],
  mutations: [
    { id: 'M1', what: 'something broken', predicted: '1 red', actual: '1 red' },
  ],
  signoffKey: 'ticket-000',
  notCovered: 'Something out of scope.',
};

export const REPORT = {
  stats: {
    startTime: '2026-01-01T00:00:00.000Z',
    duration: 1000,
    expected: 2,
    unexpected: 0,
    flaky: 0,
    skipped: 0,
  },
  suites: [
    {
      specs: [
        {
          title: 'a journey',
          tests: [
            {
              projectName: 'chromium',
              results: [{ status: 'passed', duration: 500, attachments: [] }],
            },
            {
              projectName: 'webkit',
              results: [{ status: 'passed', duration: 500, attachments: [] }],
            },
          ],
        },
      ],
    },
  ],
};

/** A json report with one result per entry, grouped by journey. */
export const reportOf = (
  results: {
    journey: string;
    project: string;
    video?: string;
    status?: string;
    file?: string;
  }[],
) => ({
  ...REPORT,
  suites: [
    {
      specs: [...new Set(results.map((r) => r.journey))].map((title) => ({
        title,
        file: results.find((r) => r.journey === title)?.file,
        tests: results
          .filter((r) => r.journey === title)
          .map((r) => ({
            projectName: r.project,
            results: [
              {
                status: r.status ?? 'passed',
                duration: 500,
                attachments: r.video
                  ? [
                      {
                        name: 'video',
                        contentType: 'video/webm',
                        path: r.video,
                      },
                    ]
                  : [],
              },
            ],
          })),
      })),
    },
  ],
});

/** What `shoot` records about one capture, before the stamp. */
export const capture = (project: string, order: number) => ({
  project,
  title: 'suite > a journey',
  order,
  label: `thing ${order}`,
  file: `${project}/a__0${order}.png`,
});

/** A file of `size` zero bytes under `dir`, for a check that reads the disk. */
export const writeRecording = (dir: string, name: string, size: number) => {
  const path = join(dir, name);
  writeFileSync(path, Buffer.alloc(size));
  return path;
};
