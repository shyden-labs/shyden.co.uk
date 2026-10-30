import { describe, expect, it } from 'vitest';
import { uncaptured } from '../../scripts/capture-coverage.mjs';
import { manifestRow } from '../../scripts/evidence-files.mjs';
import { searched } from '../source-files';

/**
 * #774: every case the release page cites must take its picture. A capture
 * run's report says which cases passed on which engine; its manifest says
 * which took a picture. A passed case with no row is named, every one of
 * them, by engine and title.
 */
const START = '2026-10-15T00:00:00.000Z';
const AFTER = new Date(Date.parse(START) + 1000);

/** A Playwright report: one file, one describe, these results. */
const report = (
  cases: { title: string; project: string; status?: string }[],
) => ({
  stats: { startTime: START },
  suites: [
    {
      file: 'cases.spec.ts',
      suites: [
        {
          title: 'a page',
          specs: cases.map((c) => ({
            title: c.title,
            file: 'cases.spec.ts',
            tests: [
              {
                projectName: c.project,
                results: [{ status: c.status ?? 'passed', duration: 10 }],
              },
            ],
          })),
        },
      ],
    },
  ],
});

const row = (title: string, project: string, at = AFTER) =>
  manifestRow(
    {
      project,
      title: `a page > ${title}`,
      order: 1,
      label: 'x',
      file: `${project}/${title}.png`,
    },
    at,
  );

describe('uncaptured: the cited cases that took no picture', () => {
  it('passes a case that took its picture', () => {
    const { judged, missing } = uncaptured({
      report: report([{ title: 'shows', project: 'chromium' }]),
      manifest: [row('shows', 'chromium')],
    });
    expect(searched(missing, { of: judged, what: 'passed cases' })).toEqual([]);
    expect(
      floorBreach('capture-coverage/one-case', judged.length),
    ).toBeUndefined();
  });

  it('names a passed case with no picture, by engine and title', () => {
    expect(
      uncaptured({
        report: report([
          { title: 'shows', project: 'chromium' },
          { title: 'hides', project: 'chromium' },
        ]),
        manifest: [row('shows', 'chromium')],
      }).missing,
    ).toEqual(['chromium › a page > hides']);
  });

  it('names every case with no picture, on every engine, in one run', () => {
    expect(
      uncaptured({
        report: report([
          { title: 'shows', project: 'chromium' },
          { title: 'shows', project: 'webkit' },
          { title: 'hides', project: 'firefox' },
        ]),
        manifest: [row('shows', 'chromium')],
      }).missing,
    ).toEqual(['webkit › a page > shows', 'firefox › a page > hides']);
  });

  it('does not count a picture taken on another engine', () => {
    expect(
      uncaptured({
        report: report([{ title: 'shows', project: 'webkit' }]),
        manifest: [row('shows', 'chromium'), row('other', 'webkit')],
      }).missing,
    ).toEqual(['webkit › a page > shows']);
  });

  it('does not judge a case that did not pass: the e2e suite judges that', () => {
    const { judged, missing } = uncaptured({
      report: report([
        { title: 'shows', project: 'chromium' },
        { title: 'broke', project: 'chromium', status: 'failed' },
        { title: 'skipped', project: 'chromium', status: 'skipped' },
      ]),
      manifest: [row('shows', 'chromium')],
    });
    expect(judged.map((s: { title: string }) => s.title)).toEqual([
      'a page > shows',
    ]);
    expect(searched(missing, { of: judged, what: 'passed cases' })).toEqual([]);
    expect(
      floorBreach('capture-coverage/passed-of-three', judged.length),
    ).toBeUndefined();
  });

  it("does not count an earlier run's picture", () => {
    expect(
      uncaptured({
        report: report([
          { title: 'shows', project: 'chromium' },
          { title: 'old', project: 'chromium' },
        ]),
        manifest: [
          row('shows', 'chromium'),
          row('old', 'chromium', new Date(Date.parse(START) - 60_000)),
        ],
      }).missing,
    ).toEqual(['chromium › a page > old']);
  });

  it('refuses an empty manifest: a run that captured nothing proves nothing', () => {
    expect(() =>
      uncaptured({
        report: report([{ title: 'shows', project: 'chromium' }]),
        manifest: [],
      }),
    ).toThrow('nothing in manifest.jsonl was captured by the run');
  });

  it('refuses a report in which no case passed', () => {
    expect(() =>
      uncaptured({
        report: report([
          { title: 'broke', project: 'chromium', status: 'failed' },
        ]),
        manifest: [row('broke', 'chromium')],
      }),
    ).toThrow(
      'capture-coverage: no case passed in this run, so nothing was judged',
    );
  });
});
