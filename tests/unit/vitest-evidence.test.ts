import { describe, expect, it } from 'vitest';
import { playwrightShapeOfVitest } from '../../scripts/vitest-evidence.mjs';
import {
  capturesOfThisRun,
  evidenceReportOf,
  flattenReport,
} from '../../scripts/build-evidence-page.mjs';
import { manifestRow } from '../../scripts/evidence-files.mjs';

/**
 * #354: the real-device iOS leg runs under Vitest and writes Vitest's JSON
 * report; the evidence page reads Playwright's. Each case below builds a
 * Vitest report and reads it back through `flattenReport`, the function the
 * page itself uses, so "the same shape" is judged by the reader, not by a
 * structure this file hand-copies.
 */
const ROOT = '/repo';
const PROJECT = 'ios-safari-real-device';
const START_MS = 1792040156736;

/** One Vitest assertion result, passed unless told otherwise. */
const assertion = (over: Record<string, unknown> = {}) => ({
  ancestorTitles: ['en'],
  title: 'Journey 1 -- groups render',
  fullName: 'en Journey 1 -- groups render',
  status: 'passed',
  duration: 1234,
  failureMessages: [],
  meta: {},
  ...over,
});

/** A Vitest JSON report holding one file of the given assertions. */
const vitestReport = (
  assertions: unknown[] = [assertion()],
  over: Record<string, unknown> = {},
) => ({
  startTime: START_MS,
  success: true,
  testResults: [
    {
      name: `${ROOT}/tests/device/ios/journeys.journey.ts`,
      status: 'passed',
      startTime: START_MS,
      endTime: START_MS + 5000,
      assertionResults: assertions,
    },
  ],
  ...over,
});

const read = (report: unknown) =>
  flattenReport(
    playwrightShapeOfVitest(report, { project: PROJECT, root: ROOT }),
  );

describe('playwrightShapeOfVitest: a Vitest run read as a Playwright report', () => {
  it('stamps the run start as the ISO instant capturesOfThisRun reads', () => {
    expect(
      playwrightShapeOfVitest(vitestReport(), { project: PROJECT, root: ROOT })
        .stats.startTime,
    ).toBe(new Date(START_MS).toISOString());
  });

  it('gives a test inside a describe one journey, titled as currentTestName spells it', () => {
    expect(read(vitestReport())).toEqual([
      {
        title: 'en > Journey 1 -- groups render',
        block: 'en',
        project: PROJECT,
        status: 'passed',
        duration: 1234,
        file: 'tests/device/ios/journeys.journey.ts',
        video: undefined,
      },
    ]);
  });

  it('keeps a title that contains the separator as one title', () => {
    expect(
      read(vitestReport([assertion({ title: 'Journey 14 -- a > b' })]))[0],
    ).toMatchObject({ title: 'en > Journey 14 -- a > b', block: 'en' });
  });

  it('nests two describes as two blocks of one journey', () => {
    expect(
      read(
        vitestReport([assertion({ ancestorTitles: ['en', 'the board'] })]),
      )[0],
    ).toMatchObject({
      title: 'en > the board > Journey 1 -- groups render',
      block: 'en > the board',
    });
  });

  it('keeps a test with no describe at the top of its file', () => {
    expect(
      read(vitestReport([assertion({ ancestorTitles: [] })]))[0],
    ).toMatchObject({
      title: 'Journey 1 -- groups render',
      block: '',
    });
  });

  it('carries every assertion, in order', () => {
    expect(
      read(
        vitestReport([
          assertion({ title: 'one' }),
          assertion({ ancestorTitles: ['id'], title: 'two' }),
        ]),
      ).map((s) => s.title),
    ).toEqual(['en > one', 'id > two']);
  });

  it('reads a failed test as failed', () => {
    expect(
      read(vitestReport([assertion({ status: 'failed' })]))[0].status,
    ).toBe('failed');
  });

  it.each(['skipped', 'pending', 'todo', 'disabled'])(
    'reads a %s test as skipped, with no duration of its own',
    (status) => {
      expect(
        read(vitestReport([assertion({ status, duration: null })]))[0],
      ).toMatchObject({ status: 'skipped', duration: 0 });
    },
  );

  it('refuses a status it does not know, naming it', () => {
    expect(() => read(vitestReport([assertion({ status: 'flaky' })]))).toThrow(
      'en > Journey 1 -- groups render: Vitest status "flaky" is not one this reader knows',
    );
  });

  it('refuses a run test with no duration, naming it', () => {
    expect(() => read(vitestReport([assertion({ duration: null })]))).toThrow(
      'en > Journey 1 -- groups render: a passed test carries no duration',
    );
  });

  it('refuses a report with no start time', () => {
    expect(() =>
      read(vitestReport(undefined, { startTime: undefined })),
    ).toThrow('the Vitest report has no startTime');
  });

  it('refuses a report with no testResults list', () => {
    expect(() => read({ startTime: START_MS })).toThrow(
      'the Vitest report has no testResults list',
    );
  });

  it('rounds a test duration to the whole milliseconds Playwright reports', () => {
    expect(
      read(vitestReport([assertion({ duration: 1559.7103330000027 })]))[0]
        .duration,
    ).toBe(1560);
  });

  it('refuses a file with no end time, naming it', () => {
    expect(() =>
      read(
        vitestReport(undefined, {
          testResults: [
            {
              name: `${ROOT}/tests/device/ios/journeys.journey.ts`,
              assertionResults: [assertion()],
            },
          ],
        }),
      ),
    ).toThrow(
      `${ROOT}/tests/device/ios/journeys.journey.ts has no endTime, so the run's wall clock is unknown`,
    );
  });

  it('refuses a file outside the root it was told', () => {
    expect(() =>
      read(
        vitestReport(undefined, {
          testResults: [
            {
              name: '/elsewhere/x.journey.ts',
              assertionResults: [assertion()],
            },
          ],
        }),
      ),
    ).toThrow('/elsewhere/x.journey.ts is not under /repo');
  });
});

describe("the page's summary of a Vitest run (#354 AC2)", () => {
  // The page's tiles read Playwright's stats: passed, failed, flaky, skipped
  // and the wall clock. A real iPhone run of 80 passing tests rendered as
  // "0 passed ... 0.0s" until the adapter wrote them (measured 2026-10-18).
  const stats = (report: unknown) =>
    playwrightShapeOfVitest(report, { project: PROJECT, root: ROOT }).stats;

  it('counts each test once, by the outcome its dot shows', () => {
    expect(
      stats(
        // Three counts that differ, so no outcome can stand in for another.
        vitestReport([
          assertion({ title: 'a' }),
          assertion({ title: 'b' }),
          assertion({ title: 'c' }),
          assertion({ title: 'd', status: 'failed' }),
          assertion({ title: 'e', status: 'failed' }),
          assertion({ title: 'f', status: 'todo', duration: null }),
        ]),
      ),
    ).toMatchObject({ expected: 3, unexpected: 2, flaky: 0, skipped: 1 });
  });

  it('gives the wall clock from the run start to the last file to end, in whole milliseconds', () => {
    const file = (name: string, endTime: number) => ({
      name: `${ROOT}/tests/device/ios/${name}`,
      startTime: START_MS,
      endTime,
      assertionResults: [assertion()],
    });
    expect(
      stats(
        vitestReport(undefined, {
          // The last to end is neither the first file listed nor the last.
          testResults: [
            file('early.journey.ts', START_MS + 5_000),
            file('late.journey.ts', START_MS + 65_287.4),
            file('middle.journey.ts', START_MS + 30_000),
          ],
        }),
      ).duration,
    ).toBe(65_287);
  });
});

describe('evidenceReportOf: the one report an evidence directory holds', () => {
  const DIR = '/runs/ios';
  const PLAYWRIGHT = {
    stats: { startTime: '2026-10-15T00:00:00.000Z' },
    suites: [],
  };
  const holding = (files: Record<string, unknown>) => ({
    dir: DIR,
    root: ROOT,
    exists: (file: string) => file in files,
    read: (file: string) => files[file],
  });

  it('returns a Playwright report as it is', () => {
    expect(
      evidenceReportOf(holding({ [`${DIR}/report.json`]: PLAYWRIGHT })),
    ).toBe(PLAYWRIGHT);
  });

  it('reads a Vitest report as the real-device iOS leg', () => {
    const report = evidenceReportOf(
      holding({ [`${DIR}/vitest-report.json`]: vitestReport() }),
    );
    expect(flattenReport(report).map((s) => s.project)).toEqual([PROJECT]);
  });

  it('refuses a directory holding neither, naming both files it looked for', () => {
    expect(() => evidenceReportOf(holding({}))).toThrow(
      `${DIR} holds neither report.json (Playwright) nor vitest-report.json (Vitest)`,
    );
  });

  it('refuses a directory holding both, rather than choosing one', () => {
    expect(() =>
      evidenceReportOf(
        holding({
          [`${DIR}/report.json`]: PLAYWRIGHT,
          [`${DIR}/vitest-report.json`]: vitestReport(),
        }),
      ),
    ).toThrow(`${DIR} holds both report.json and vitest-report.json`);
  });
});

describe("an earlier run's iOS captures are set aside (#354 AC3)", () => {
  it('keeps the rows stamped at or after the Vitest run started, and sets the rest aside', () => {
    const capture = (label: string, at: number) =>
      manifestRow(
        {
          project: PROJECT,
          title: 'en > Journey 1 -- groups render',
          order: 1,
          label,
          file: `ios/${label}.png`,
        },
        new Date(at),
      );
    const before = capture('an earlier run', START_MS - 60_000);
    const during = capture('this run', START_MS + 1_000);
    const { current, earlier } = capturesOfThisRun(
      [before, during],
      playwrightShapeOfVitest(vitestReport(), { project: PROJECT, root: ROOT }),
    );
    expect(current).toEqual([during]);
    expect(earlier).toEqual([before]);
  });
});
