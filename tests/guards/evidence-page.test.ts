import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutTsComments } from '../unit/source-text';
import { filesUnder, tsFilesUnder, searched } from '../source-files';
import { floorBreach } from '../floors';
import { oneAttemptEach, reportLocation } from '../../scripts/test-e2e.mjs';
import {
  CONTRACT_MODULE,
  EVIDENCE_JPEG_QUALITY,
  EVIDENCE_MANIFEST,
  EVIDENCE_REPORT,
  manifestRow,
} from '../../scripts/evidence-files.mjs';
import { captureOptions } from '../e2e/evidence';
import {
  assertPageFits,
  assertPublishLimits,
  capturesOfThisRun,
  earlierLine,
  imageSize,
  mediaType,
  PAGE_MAX_BYTES,
  PUBLISH_MAX_BYTES,
  PUBLISH_MAX_FILES,
  PUBLISH_NOTE,
  reconcileFiles,
  renderEvidencePage,
  videoCandidates,
  ASSET_MAX_FILES,
  ASSET_MAX_BYTES,
  ASSET_MAX_FILE_BYTES,
  assetUploads,
  assetVideoPaths,
  assertAssetLimits,
  flattenReport,
} from '../../scripts/build-evidence-page.mjs';
import {
  CONTENT,
  REPORT,
  capture,
  reportOf,
  writeRecording,
} from '../evidence-page-shared';

/** Two engines, one journey, two assertions each -- four captures. */
const MANIFEST = [
  {
    project: 'chromium',
    title: 'suite > a journey',
    order: 1,
    label: 'first thing',
    file: 'chromium/a__01.png',
  },
  {
    project: 'chromium',
    title: 'suite > a journey',
    order: 2,
    label: 'second thing',
    file: 'chromium/a__02.png',
  },
  {
    project: 'webkit',
    title: 'suite > a journey',
    order: 1,
    label: 'first thing',
    file: 'webkit/a__01.png',
  },
  {
    project: 'webkit',
    title: 'suite > a journey',
    order: 2,
    label: 'second thing',
    file: 'webkit/a__02.png',
  },
];

const SHOTS = new Map(
  MANIFEST.map((m) => [m.file, `data:image/png;base64,AAAA${m.file}`]),
);

const build = (over = {}) =>
  renderEvidencePage({
    manifest: MANIFEST,
    report: REPORT,
    content: CONTENT,
    shots: SHOTS,
    videos: new Map(),
    ...over,
  });

/**
 * A json report whose journeys sit inside NESTED describes, so the block a
 * journey belongs to is a real ancestor rather than punctuation in its title.
 */
const blockedReport = (
  file: string,
  rows: { block: string; journey: string; video?: string }[],
) => ({
  ...REPORT,
  suites: [
    {
      file,
      suites: [...new Set(rows.map((r) => r.block))].map((block) => ({
        title: block,
        specs: rows
          .filter((r) => r.block === block)
          .map((r) => ({
            title: r.journey,
            file,
            tests: [
              {
                projectName: 'chromium',
                results: [
                  {
                    status: 'passed',
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
              },
            ],
          })),
      })),
    },
  ],
});

/**
 * A `/_blob/<id>` as the asset store answers with one. The id is server-minted
 * and opaque, so a test fabricates a stable stand-in from the key -- the SHAPE
 * is what the page has to handle, and the shape is fixed.
 */
const blobPath = (key: string) =>
  `/_blob/${[...key]
    .reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .padStart(32, '0')}`;

describe('the evidence page is derived from the run', () => {
  it('emits exactly one image per captured assertion', () => {
    const html = build();
    const figures = html.match(/class="shot"/g) ?? [];
    expect(figures).toHaveLength(MANIFEST.length);
  });

  it('refuses to emit a page that silently drops evidence', () => {
    // A page missing captures an operator was told it contains is worse than
    // no page: it looks like proof of assertions nobody can see.
    expect(() => build({ shots: new Map() })).toThrow(/missing/i);
  });

  it('takes its engines from the report, never from an argument', () => {
    const html = build();
    expect(html).toContain('chromium');
    expect(html).toContain('webkit');
    // firefox is in neither the manifest nor the report.
    expect(html).not.toContain('firefox');
  });

  it('reports the run stats it was given rather than a hardcoded verdict', () => {
    const html = build({
      report: { ...REPORT, stats: { ...REPORT.stats, expected: 41, flaky: 7 } },
    });
    // Asserted as the stat cell, not as a bare substring: "7" alone matches
    // any stray digit in the stylesheet, which is a check that cannot fail.
    expect(html).toContain('<span class="n">41</span>');
    expect(html).toContain('<span class="n">7</span>');
  });
});

describe('a missing recording says WHICH kind of missing it is (#214)', () => {
  it('reads as policy for a spec that never asked, and a gap for one that did', () => {
    // The two facts a single wording used to hide. A spec that opted in and
    // recorded on one engine but not another has lost evidence (#165); a spec
    // that never opted in is the default working as designed. Derived from
    // the report -- a spec RECORDS when any result of its own carries a video
    // -- so there is no list to fall out of step with the specs.
    const html = build({
      report: reportOf([
        // Asked, and recorded on chromium only: webkit is a GAP.
        {
          journey: 'a-journey',
          project: 'chromium',
          video: '/r/a.webm',
          file: 'tests/e2e/acts.spec.ts',
        },
        {
          journey: 'a-journey',
          project: 'webkit',
          file: 'tests/e2e/acts.spec.ts',
        },
        // Never asked: both engines are POLICY.
        {
          journey: 'b-journey',
          project: 'chromium',
          file: 'tests/e2e/still.spec.ts',
        },
        {
          journey: 'b-journey',
          project: 'webkit',
          file: 'tests/e2e/still.spec.ts',
        },
      ]),
      manifest: [],
      shots: new Map(),
      videos: new Map([['a-journey|chromium', 'evidence/a-chromium.webm']]),
    });

    expect(html, 'the opted-in spec lost its webkit recording').toContain(
      '<div class="novid mono">recording missing</div><figcaption class="mono">webkit</figcaption>',
    );
    // Counted, not just present: two engines of the spec that never asked.
    expect(
      [...html.matchAll(/not recorded by policy/g)],
      'both engines of the spec that never asked',
    ).toHaveLength(2);
    // And the two wordings are genuinely different text, or this whole test
    // would pass on a page that still says one thing.
    expect(html).not.toContain('not embedded');
  });
});

describe('a run that recorded nothing still publishes (#214 AC7)', () => {
  it('carries an empty set through candidates, files and reconciliation', () => {
    // With video opt-in, a perfectly ordinary evidence run can produce NO
    // recordings at all. None of the three seams may refuse that, and
    // `reconcileFiles` must still clear a namespace it no longer fills.
    const report = reportOf([
      {
        journey: 'a-journey',
        project: 'chromium',
        file: 'tests/e2e/still.spec.ts',
      },
    ]);
    // What `videoCandidates` walks: one row per result the report holds.
    const results = flattenReport(report);
    const candidates = videoCandidates(report);
    expect(
      searched(candidates, { of: results, what: 'report results' }),
    ).toEqual([]);
    expect(
      floorBreach('evidence-page/report-results-no-recording', results.length),
    ).toBeUndefined();
    // Empty by design, so the inputs are the population (operator ruling
    // 2026-10-09): one case each, counted, and every entry either call
    // returns is an assertion failure.
    const uploadCases = [{ case: 'a run that recorded nothing', candidates }];
    expect(
      searched(
        uploadCases.flatMap(({ candidates: fed }) =>
          Object.entries(assetUploads(fed)),
        ),
        { of: uploadCases, what: 'candidate lists fed to assetUploads' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('evidence-page/empty-upload-cases', uploadCases.length),
    ).toBeUndefined();
    const reconcileCases = [
      {
        case: 'nothing desired and nothing published',
        desired: {},
        published: [],
      },
    ];
    expect(
      searched(
        reconcileCases.flatMap(({ desired, published }) =>
          Object.entries(reconcileFiles({ desired, published })),
        ),
        { of: reconcileCases, what: 'file sets fed to reconcileFiles' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('evidence-page/empty-reconcile-cases', reconcileCases.length),
    ).toBeUndefined();
    // A page that USED to carry recordings as supporting files must retract
    // them, rather than leaving files nothing on the page names. Since #268
    // that is every capture: recordings are assets, so `desired` is always
    // empty and this is the only thing `reconcileFiles` still does.
    expect(
      reconcileFiles({
        desired: {},
        published: ['evidence/a-chromium.webm'],
      }),
    ).toEqual({ 'evidence/a-chromium.webm': null });
  });
});

describe('a journey whose engine recorded nothing says so on the page', () => {
  it('shows, per journey, which engine has no recording', () => {
    // An ordinary run records nothing, so a result with no recording is not a
    // loss, and the page reports which engines it holds. Nothing is left out
    // for SIZE any more: recordings travel beside the page, and one the disk
    // does not have is refused outright, below.
    const html = build({
      videos: new Map([['a-journey|chromium', 'data:video/webm;base64,AAAA']]),
    });
    expect(html).toContain('Journey recordings (1 of 2 engines embedded)');
    // The default report carries no video attachment, so nothing asked to be
    // recorded and the absence is the policy working (#214), not a loss.
    expect(html).toContain(
      '<div class="novid mono">not recorded by policy</div><figcaption class="mono">webkit</figcaption>',
    );
  });
});
describe('the recording policy is read per block, not per file (#292)', () => {
  it('a block that never records says so, beside one in the same file that does', () => {
    // A spec opts in as a WHOLE -- `test.use(recorded)` at the top of the
    // file -- so asking the FILE whether it records answers for every journey
    // in it. A block that opts out, because it renders nothing (it reads
    // bytes out of `dist/` and never navigates), then reads as a recording
    // that went astray: #165's wording on #214's fact. The page must not
    // spell those the same way, so the policy is keyed by the block.
    const file = 'tests/e2e/mixed.spec.ts';
    // NESTED suites, not a title with ` > ` in it: the block is a structural
    // fact the builder reads off the ancestors, so a fixture that spells it
    // into the title would agree with a builder that never looked.
    const html = build({
      report: blockedReport(file, [
        { block: 'a block that acts', journey: 'it shuffles', video: 'v.webm' },
        { block: 'a block that renders nothing', journey: 'the assets ship' },
      ]),
      manifest: [],
      shots: new Map(),
      videos: new Map([
        // Keyed by the journey's SLUG, as `slugOf` builds it, not its title.
        ['a-block-that-acts-it-shuffles|chromium', 'evidence/acts.webm'],
      ]),
    });

    expect(
      html,
      'the block that opted out is the policy working, not a lost recording',
    ).toContain('<div class="novid mono">not recorded by policy</div>');
    // The FILE records, so a file-keyed policy reaches the other wording --
    // this is the half that fails before the block key exists.
    expect(html, 'nothing here went astray').not.toContain('recording missing');
  });
});

describe('a captured journey the report never ran says which kind of missing it is', () => {
  it('does not claim a recording policy it never had a spec file to read', () => {
    // `order` is built from the manifest as well as the report, so a captured
    // journey whose spec produced no result carries no spec file at all. The
    // page cannot read that spec's recording policy, and a third fact wearing
    // the second's words is the exact defect #214 exists to stop. Note the
    // test is `has`, not `get() === undefined`: a journey the report DOES
    // carry, whose entry has no file, is still a spec whose policy reads as
    // "did not ask" -- pinned by the sibling test above.
    const html = build({
      manifest: [
        {
          project: 'chromium',
          title: 'suite > a journey the report never ran',
          order: 1,
          label: 'first thing',
          file: 'chromium/orphan__01.png',
        },
      ],
      shots: new Map([
        ['chromium/orphan__01.png', 'data:image/png;base64,AAAA'],
      ]),
      report: reportOf([
        {
          journey: 'a journey that opted in',
          project: 'chromium',
          file: 'tests/e2e/moves.spec.ts',
          video: 'evidence/moves-chromium.webm',
        },
      ]),
      videos: new Map(),
    });

    // The orphan: no spec file, so no policy to report.
    expect(html, 'a captured journey with no test result').toContain(
      '<div class="novid mono">no test result</div>',
    );
    // Its neighbour opted in and lost the file -- the wording that means
    // something went astray, so the two are proven to be different text
    // rather than one string the page prints everywhere.
    expect(html, 'the opted-in spec lost its recording').toContain(
      '<div class="novid mono">recording missing</div>',
    );
    // And neither is the policy wording, which nothing here has grounds for.
    // What the page printed under a journey that has no recording: the
    // wordings the policy reading chooses between.
    const notes = [...html.matchAll(/<div class="novid mono">[^<]*<\/div>/g)];
    expect(
      searched([...html.matchAll(/not recorded by policy/g)], {
        of: notes,
        what: 'no-recording notes',
      }),
      'nothing here read a policy',
    ).toHaveLength(0);
    expect(
      floorBreach('evidence-page/no-recording-notes', notes.length),
    ).toBeUndefined();
  });
});

/**
 * A recording the report names is on disk, or there is no page.
 *
 * #165: Playwright wrote the videos into `test-results/`, the next ordinary run
 * cleared that directory as it started, and all 25 were gone while the captures
 * and the report beside them survived. The builder skipped each missing file
 * and built anyway -- "0 of 5 engines embedded" on every journey, which reads
 * exactly like a budget decision. A dangling path is lost evidence, and the
 * build names it.
 */
describe('a recording the report names is on disk, or the build refuses', () => {
  let scratch = '';
  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'evidence-recordings-'));
  });
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  /** A real file, so the check reads the disk rather than a stand-in for it. */
  const recording = (name: string, size: number) =>
    writeRecording(scratch, name, size);

  it('names every journey and engine whose recording is gone', () => {
    const report = reportOf([
      {
        journey: 'a journey',
        project: 'chromium',
        video: recording('kept.webm', 10),
      },
      {
        journey: 'a journey',
        project: 'webkit',
        video: join(scratch, 'gone.webm'),
      },
      {
        journey: 'another journey',
        project: 'firefox',
        video: join(scratch, 'also-gone.webm'),
      },
    ]);

    let refusal = 'the build did not refuse';
    try {
      videoCandidates(report);
    } catch (error) {
      refusal = (error as Error).message;
    }
    expect(refusal).toContain('"a journey" on webkit');
    expect(refusal).toContain('"another journey" on firefox');
    expect(
      refusal,
      'a recording that IS on disk was reported missing',
    ).not.toContain('on chromium');
  });

  it('keeps every recording on disk, resolved to the file a publish carries', () => {
    // No base64 charge any more. A recording is PUBLISHED, not inlined, so the
    // 4/3 inflation a data URI paid is not a cost it can incur, and nothing
    // reads a charge from here: `assertPublishLimits` sizes each file on the
    // disk it will be read from. A second number describing the same file is
    // one that can drift from it.
    const chromium = recording('a-chromium.webm', 1000);
    const webkit = recording('a-webkit.webm', 2000);
    expect(
      videoCandidates(
        reportOf([
          { journey: 'a journey', project: 'chromium', video: chromium },
          { journey: 'a journey', project: 'webkit', video: webkit },
        ]),
      ),
    ).toEqual([
      { key: 'a-journey|chromium', abs: chromium },
      { key: 'a-journey|webkit', abs: webkit },
    ]);
  });

  it('reads a result with no recording as nothing to embed, not as a loss', () => {
    // An ordinary run records no video, so a missing attachment is not the
    // defect; a path to a file that is not there is.
    const report = reportOf([{ journey: 'a journey', project: 'chromium' }]);
    const results = flattenReport(report);
    expect(
      searched(videoCandidates(report), {
        of: results,
        what: 'report results',
      }),
    ).toEqual([]);
    expect(
      floorBreach('evidence-page/results-without-recording', results.length),
    ).toBeUndefined();
  });
});

/**
 * An earlier run's captures never reach a page built from a later run (#171).
 *
 * The harness APPENDS to the manifest and nothing clears it, so a second run
 * into one evidence directory kept the first run's rows and pictures. Measured:
 * webkit, then chromium, into one directory built a page embedding 15 webkit
 * captures under a report that ran chromium alone. Every row is now stamped as
 * it is written, and the builder keeps only the rows the reported run wrote.
 */
describe('an earlier run in the same evidence directory stays off the page', () => {
  let scratch = '';
  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'evidence-runs-'));
  });
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  const START = Date.parse(REPORT.stats.startTime);
  const MINUTE = 60_000;

  /** A row as the harness writes it, `offsetMs` after the reported run began. */
  const stamped = (project: string, order: number, offsetMs: number) =>
    manifestRow(capture(project, order), new Date(START + offsetMs));

  it('stamps each manifest row with the instant it was written, keeping what it records', () => {
    expect(
      manifestRow(capture('webkit', 2), new Date('2026-01-01T00:00:05.000Z')),
    ).toEqual({ ...capture('webkit', 2), at: '2026-01-01T00:00:05.000Z' });
  });

  it('keeps the rows the reported run wrote and sets aside the ones from before it began', () => {
    const before = stamped('webkit', 1, -MINUTE);
    const during = stamped('chromium', 1, 5_000);
    expect(capturesOfThisRun([before, during], REPORT)).toEqual({
      current: [during],
      earlier: [before],
    });
  });

  it("counts a row stamped at the very instant the run began as the run's own", () => {
    const { current, earlier } = capturesOfThisRun(
      [stamped('chromium', 1, 0), stamped('chromium', 2, -1)],
      REPORT,
    );
    expect(current.map((row: { order: number }) => row.order)).toEqual([1]);
    expect(earlier.map((row: { order: number }) => row.order)).toEqual([2]);
  });

  it("reads a row with no stamp as an earlier run's: the harness stamps every row it writes", () => {
    const unstamped = capture('webkit', 1);
    const during = stamped('chromium', 1, 5_000);
    expect(capturesOfThisRun([unstamped, during], REPORT)).toEqual({
      current: [during],
      earlier: [unstamped],
    });
  });

  it('refuses a report whose start it cannot read, rather than dating every row as current', () => {
    const rows = [stamped('chromium', 1, 5_000)];
    // Date.parse reads '0' as midnight on 1 January 2000 and '2026' as that
    // year's first instant, so a lenient parse dates an earlier run's rows too.
    for (const startTime of [
      undefined,
      '',
      '0',
      '2026',
      '2026-13-01T00:00:00.000Z',
      START,
    ])
      expect(
        () =>
          capturesOfThisRun(rows, {
            ...REPORT,
            stats: { ...REPORT.stats, startTime },
          }),
        `stats.startTime ${JSON.stringify(startTime)}`,
      ).toThrow(/stats\.startTime/);
    expect(() => capturesOfThisRun(rows, { suites: [] })).toThrow(
      /stats\.startTime/,
    );
  });

  it('refuses a stamp that is not an instant, rather than guessing which run wrote the row', () => {
    for (const at of [null, '', 'yesterday', '0', START])
      expect(
        () => capturesOfThisRun([{ ...capture('chromium', 1), at }], REPORT),
        `at ${JSON.stringify(at)}`,
      ).toThrow('chromium/a__01.png');
  });

  it('refuses a directory where nothing belongs to the reported run, and names what is there', () => {
    let refusal = 'the build did not refuse';
    try {
      capturesOfThisRun(
        [
          stamped('webkit', 1, -MINUTE),
          stamped('webkit', 2, -MINUTE + 1),
          capture('firefox', 1),
        ],
        REPORT,
      );
    } catch (error) {
      refusal = (error as Error).message;
    }
    expect(refusal).toContain(REPORT.stats.startTime);
    expect(refusal).toContain('webkit 2');
    expect(refusal).toContain('firefox 1');
    // A manifest with no rows is a run that reached no assertion at all.
    expect(() => capturesOfThisRun([], REPORT)).toThrow(REPORT.stats.startTime);
  });

  it('names on the build line how many rows it set aside, and from which engines', () => {
    expect(
      earlierLine([
        capture('webkit', 1),
        capture('webkit', 2),
        capture('firefox', 1),
      ]),
    ).toBe(
      ' EARLIER=3 (captured before this run started): webkit 2, firefox 1',
    );
    expect(earlierLine([])).toBe('');
  });
});

describe('the generator carries no ticket prose', () => {
  it('contains none of the content file it renders', () => {
    // Derived from the example content rather than a list of banned words: a
    // hand-written blocklist would miss the phrase somebody actually pastes.
    const source = withoutTsComments(
      readFileSync('scripts/build-evidence-page.mjs', 'utf8'),
    );
    const prose = [
      CONTENT.headline,
      CONTENT.lede,
      CONTENT.sections[0].heading,
      CONTENT.sections[0].body,
      CONTENT.notCovered,
      CONTENT.mutations[0].what,
    ];
    for (const phrase of prose)
      expect(
        source,
        `the generator hardcodes ${JSON.stringify(phrase)}`,
      ).not.toContain(phrase);
  });
});

/**
 * The Playwright config as Playwright loads it, with `EVIDENCE_DIR` as given.
 *
 * The config reads the switch while it loads, so each call evaluates the module
 * afresh: a copy loaded under some other environment would be a verdict about
 * a run nobody is making.
 */
const configUnder = async (evidence: string | undefined) => {
  vi.stubEnv('EVIDENCE_DIR', evidence);
  vi.resetModules();
  try {
    return (await import('../../playwright.config')).default;
  } finally {
    vi.unstubAllEnvs();
  }
};

/** `recorded` as a spec would receive it under that `EVIDENCE_DIR`. */
const recordedUnder = async (evidence: string | undefined) => {
  vi.stubEnv('EVIDENCE_DIR', evidence);
  vi.resetModules();
  try {
    return (await import('../e2e/evidence')).recorded;
  } finally {
    vi.unstubAllEnvs();
  }
};

/**
 * The run has to LEAVE BEHIND what the builder reads.
 *
 * `playwright.config.ts` states that an evidence run is exactly
 * `EVIDENCE_DIR=<dir> npm run test:e2e -- <spec>` and "needs no second flag
 * anybody could forget". That sentence was false when it was written: the
 * builder reads `<EVIDENCE_DIR>/report.json`, the config declares no reporter,
 * and the runner wrote its json into a `mkdtemp` directory it deleted in a
 * `finally`. The captures landed, the run went green, and the page could not
 * be built -- the failure surfacing one step away from its cause.
 *
 * The recordings had the same hole one step further out (#165). Playwright
 * wrote them into its default `test-results/`, which every run clears as it
 * starts, so the next ordinary run took all 25 while the captures and the
 * report beside them survived: a directory that looks complete and builds a
 * page with no video in it.
 *
 * A comment is not an implementation, so the promise is asserted here instead
 * of restated there.
 */
describe('an evidence run leaves the builder exactly what it reads', () => {
  it('writes the report INTO the evidence directory, and keeps it', () => {
    expect(reportLocation({ EVIDENCE_DIR: '/e' })).toEqual({
      dir: '/e',
      path: join('/e', EVIDENCE_REPORT),
      ephemeral: false,
    });
  });

  it('still uses a throwaway directory when no evidence was asked for', () => {
    const location = reportLocation({});
    // The point of the flag is that the ordinary run is unchanged: ~2200 tests
    // must not start littering the tree with reports nobody reads.
    expect(location.ephemeral).toBe(true);
    expect(location.dir).not.toBe('/e');
    expect(location.path).toBe(join(location.dir, EVIDENCE_REPORT));
  });

  it('never deletes a directory the operator was asked to keep', () => {
    // `reportLocation` returning `ephemeral: false` is only half the control:
    // it is the CALL SITE that deletes, and an unconditional `rmSync` there
    // would take the captures and the video with it. Asserted against the
    // construct -- the guard around the call -- not the bare name, and against
    // the stripped source, because the paragraph above the line says
    // "ephemeral" too.
    const runner = withoutTsComments(
      readFileSync('scripts/test-e2e.mjs', 'utf8'),
    );
    const deletions = [...runner.matchAll(/rmSync\(reportDir[^)]*\)/g)];

    expect(
      searched(deletions, { of: deletions.length, what: 'report cleanups' }),
      'the runner stopped deleting its temp report directory at all',
    ).toHaveLength(1);
    expect(
      floorBreach('evidence-page/report-cleanups', deletions.length),
    ).toBeUndefined();
    expect(runner, 'the report directory is deleted unconditionally').toMatch(
      /if \(ephemeral\)\s*rmSync\(reportDir/,
    );
  });

  it('refuses a second attempt of any test, which would overwrite the first one’s captures', () => {
    // `shoot` numbers a test's captures per worker, and Playwright runs a retry
    // in a fresh worker, so attempt 2 writes `01-…`, `02-…` over attempt 1's
    // files while the manifest keeps both attempts' rows: the sign-off page
    // shows one picture twice. A repeat collides the same way.
    const evidence = { EVIDENCE_DIR: '/e' };
    for (const argv of [
      ['--retries=1'],
      ['--retries', '2'],
      ['tests/e2e/x.spec.ts', '--retries=1'],
    ])
      expect(() => oneAttemptEach(argv, evidence), argv.join(' ')).toThrow(
        /an evidence run takes one attempt of each test: --retries=[12] /,
      );
    for (const argv of [['--repeat-each=2'], ['--repeat-each', '3']])
      expect(() => oneAttemptEach(argv, evidence), argv.join(' ')).toThrow(
        /an evidence run takes one attempt of each test: --repeat-each=[23] /,
      );
    for (const argv of [['--retries'], ['--repeat-each']])
      expect(() => oneAttemptEach(argv, evidence), argv.join(' ')).toThrow(
        /^--(retries|repeat-each) was given no value$/,
      );
  });

  it('allows one attempt of each test, and leaves an ordinary run its retries', () => {
    for (const argv of [
      [],
      ['--retries=0'],
      ['--retries', '0'],
      ['--repeat-each=1'],
      ['--workers', '2', '--project=chromium'],
    ])
      expect(oneAttemptEach(argv, { EVIDENCE_DIR: '/e' }), argv.join(' ')).toBe(
        'one attempt',
      );
    // Without EVIDENCE_DIR nothing is captured, so nothing can be overwritten.
    for (const argv of [['--retries=2'], ['--repeat-each', '3']])
      expect(oneAttemptEach(argv, {}), argv.join(' ')).toBe(
        'not an evidence run',
      );
  });

  it('is asked before the suite is listed or run', () => {
    // A refusal that arrives after the run has spent its minutes is a refusal
    // nobody needed. Read from the stripped source: the docblock names it too.
    const runner = withoutTsComments(
      readFileSync('scripts/test-e2e.mjs', 'utf8'),
    );
    const main = runner.slice(runner.indexOf('function main()'));
    const asked = main.indexOf('oneAttemptEach(argv, process.env)');
    // `listSuite` holds the `--list` itself (#438); main() calls it.
    const listed = main.indexOf('listSuite(argv)');
    expect(listed, 'main() no longer lists the suite').toBeGreaterThan(0);
    expect(asked, 'main() never asks oneAttemptEach').toBeGreaterThan(0);
    expect(asked, 'main() lists the suite before it asks').toBeLessThan(listed);
  });

  it('keeps the recordings in a directory of their own inside the evidence directory', async () => {
    // #165. The seam is the config Playwright actually loads, not a helper it
    // could stop calling. Playwright clears its output directory as a run
    // starts, so the recordings need a subdirectory: pointed at the evidence
    // directory itself, that clearing would take the captures with it.
    for (const evidence of ['/e', 'evidence-run']) {
      const { outputDir, use } = await configUnder(evidence);
      // The SHARED config records nothing (#214). An evidence run recording
      // every test is what spent 100 of the 255 entries a publish may carry
      // on pages where nothing moves; a spec now ASKS, with
      // `test.use(recorded)`. Both halves are pinned here because this seam
      // exists to say what an evidence run leaves the builder, and "it
      // records" moved from the config to the opt-in.
      expect(
        use?.video,
        `EVIDENCE_DIR=${evidence} still records from the shared config`,
      ).toBe('off');
      expect(
        (await recordedUnder(evidence)).video,
        `EVIDENCE_DIR=${evidence} stopped recording the specs that opted in`,
      ).toBe('on');

      const within = relative(
        resolve(evidence),
        resolve(outputDir ?? 'test-results'),
      );
      expect(
        within !== '' && !within.startsWith('..') && !isAbsolute(within),
        `EVIDENCE_DIR=${evidence} records into ${outputDir ?? 'test-results/'}`,
      ).toBe(true);
    }
  });

  it('costs an ordinary run nothing, however many specs opt in', async () => {
    // AC2. `recorded` is `'off'` outside an evidence run, so the 18 specs
    // that declare it pay nothing on `npm run test:e2e`.
    expect((await recordedUnder(undefined)).video).toBe('off');
    expect((await configUnder(undefined)).use?.video).toBe('off');
  });

  it('refuses an evidence directory that an ordinary run would clear', async () => {
    // Inside test-results/, the next ordinary run deletes the whole evidence
    // directory; `.` would put the recordings back into test-results/ itself.
    for (const evidence of [
      join('test-results', 'evidence'),
      'test-results',
      '.',
    ])
      await expect(
        configUnder(evidence),
        `EVIDENCE_DIR=${evidence}`,
      ).rejects.toThrow(/test-results/);
  });

  it('accepts a directory that merely begins with the same name', async () => {
    // A string-prefix containment check would refuse this one.
    const { outputDir } = await configUnder('test-results-evidence');
    expect(outputDir).toBe(resolve('test-results-evidence', 'test-results'));
  });

  it('leaves an ordinary run inside the directory CI uploads when a job fails', async () => {
    // ci.yml and deploy-dev.yml keep test-results/ on failure. An ordinary run
    // writing anywhere else would upload an empty directory and say nothing.
    //
    // Asserted as that PROPERTY rather than as Playwright's default, which is
    // what this once pinned. #230 moved each concurrently launched gauntlet
    // group into a folder of its own beneath it -- they collided over one
    // artifacts directory otherwise -- and `undefined` was only ever a proxy
    // for "where CI looks". The proxy would have refused a correct change; the
    // property still refuses an outputDir pointed anywhere CI never opens.
    const uploaded = resolve('test-results');
    for (const evidence of [undefined, '']) {
      const { outputDir, use } = await configUnder(evidence);
      const actual = resolve(outputDir ?? 'test-results');
      expect(
        actual === uploaded || actual.startsWith(uploaded + sep),
        `EVIDENCE_DIR=${JSON.stringify(evidence)}: ${actual} is outside ${uploaded}, which is what CI uploads`,
      ).toBe(true);
      expect(use?.video).toBe('off');
    }
  });

  it('pins the two filenames the evidence directory is defined by', () => {
    // A literal pin against the contract, separate from any guard that derives
    // from it: both sides moving together would otherwise pass at any name.
    expect(EVIDENCE_REPORT).toBe('report.json');
    expect(EVIDENCE_MANIFEST).toBe('manifest.jsonl');
  });

  it('has no consumer spelling an evidence filename for itself', () => {
    // Derived from the filesystem, not from a list: the sweep that missed five
    // survivors (#65) was driven by the file list in its own ticket.
    //
    // `tests/e2e` was itself one of those lists. #189 added a second capture
    // leg under `tests/device` -- the iOS journeys write the same manifest
    // through the same contract, because `shoot` is Playwright-only and they
    // run under Vitest against a real phone -- and this guard could not see it.
    // The population is now every test file, so a leg that lands somewhere new
    // is covered the day it appears rather than the day someone remembers.
    //
    // This file exempts itself for the same reason the contract module does:
    // the literal pin above spells both names ON PURPOSE, and a guard that
    // flagged its own pin would be teaching the next author to delete it.
    const self = relative(process.cwd(), fileURLToPath(import.meta.url));
    const consumers = [
      ...filesUnder('scripts', (p) => p.endsWith('.mjs')),
      ...tsFilesUnder('tests'),
    ].filter((p) => !p.endsWith(CONTRACT_MODULE) && p !== self);

    const respellings = consumers.filter((path) => {
      const code = withoutTsComments(readFileSync(path, 'utf8'));
      return (
        code.includes(`'${EVIDENCE_REPORT}'`) ||
        code.includes(`'${EVIDENCE_MANIFEST}'`)
      );
    });

    expect(
      searched(respellings, { of: consumers, what: 'evidence consumers' }),
      'a filename spelled twice is two filenames the day one of them moves',
    ).toEqual([]);
    expect(
      floorBreach('evidence-page/consumers', consumers.length),
    ).toBeUndefined();
  });
});

/**
 * The page asks for a decision it can only keep if the PUBLISH granted it.
 *
 * The sign-off ticks and the verdict are written through `claude.use('db')`,
 * which resolves `null` unless the publish declared the `db` capability. The
 * page degrades honestly -- it says "ticks are local to this view" -- and that
 * line is easy to read as a quirk rather than as "nothing you decide here is
 * recorded". Found on #138's page at publish time: the first version was
 * published without the declaration, so the operator's sign-off would have
 * been kept nowhere and could not have been read back.
 *
 * The declaration is a publish ARGUMENT, so no code in this repo can enforce
 * it. What can be enforced is that the build SAYS so, and that the note and
 * the page never drift apart.
 */
describe('the build says what the publish has to grant', () => {
  it('names the capability the sign-off is written through', () => {
    expect(PUBLISH_NOTE).toContain('capabilities');
    expect(PUBLISH_NOTE).toContain('db');
  });

  it('names a capability the RENDERED page actually reaches for', () => {
    // The seam. A note naming a capability the page stopped using is the same
    // defect in the other direction -- advice nobody can act on, still read as
    // authoritative.
    //
    // Asserted against the rendered output, NOT the generator's source: the
    // note itself spells use('db'), so a source-text check would be satisfied
    // by the very sentence it is supposed to be corroborating.
    expect(build(), 'the page no longer reaches for db').toContain("use('db')");
  });

  it('names the capability the recordings need, and what it costs', () => {
    // Recordings moved from supporting files to the asset store (#268), and
    // the upload is refused unless the publish declared `assets` -- every
    // journey would then reference a recording nothing stored, and a broken
    // `src` reads as a journey that was never recorded. A publish argument
    // cannot be enforced from in here, so the note is its only carrier.
    expect(PUBLISH_NOTE).toContain('"assets": {}');
    // And the consequence the operator accepted, carried with it: a page
    // declaring assets can never be made public. Written where the person
    // publishing reads it, not only in the ticket.
    expect(PUBLISH_NOTE).toContain('organization-internal');
  });
});

/**
 * The page carries whatever the run captured, and knows what it is.
 *
 * Captures were PNG, which stores a screenshot of photographs losslessly at
 * roughly ten times the size of a quality-90 JPEG -- a fidelity nobody
 * consumes, since the page is read by an eye and pixel-exact comparison
 * belongs to the visual-regression suite and its own baselines. Measured on
 * #138: 80 shots came to 18.9 MiB, a 25.34 MiB page that could not be
 * published at all, and the budget then dropped ALL EIGHTY videos against
 * bytes the shots had already spent -- so the standing requirement of a video
 * per journey was silently unmet (#146). That budget is gone: recordings are
 * published beside the page (#158), so shots can no longer spend what the
 * recordings need.
 *
 * The media type is read from the bytes, never from the extension: a capture
 * whose name and content disagree must still render, and an unknown format
 * must throw rather than emit a data URI the browser will not paint.
 */
describe('an evidence capture is identified by its own bytes', () => {
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]),
    Buffer.from('IHDR'),
    Buffer.from([0, 0, 2, 0]), // 512
    Buffer.from([0, 0, 1, 0]), // 256
  ]);

  /** SOI, then `segments`, then EOI. */
  const jpeg = (...segments: Buffer[]) =>
    Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      ...segments,
      Buffer.from([0xff, 0xd9]),
    ]);

  /** A marker segment: FF, marker, 2-byte length INCLUDING the length field. */
  const segment = (marker: number, payload: Buffer) =>
    Buffer.concat([
      Buffer.from([0xff, marker]),
      Buffer.from([(payload.length + 2) >> 8, (payload.length + 2) & 0xff]),
      payload,
    ]);

  /** SOFn payload: precision, height, width, component count. */
  const frame = (marker: number, w: number, h: number) =>
    segment(marker, Buffer.from([8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3]));

  it('names the two formats a capture can arrive in', () => {
    expect(mediaType(PNG)).toBe('image/png');
    expect(mediaType(jpeg(frame(0xc0, 4, 4)))).toBe('image/jpeg');
  });

  it('refuses a format it cannot identify rather than emitting a broken src', () => {
    // A data URI claiming a type the bytes are not paints nothing, and a page
    // of blank frames looks exactly like a page of captures that failed.
    expect(() => mediaType(Buffer.from('GIF89a not a capture'))).toThrow(
      /unrecognised/i,
    );
  });

  it('reads intrinsic size from PNG and from JPEG alike', () => {
    // Without width/height the page reserves no space, the document grows as
    // shots decode, and a sign-off row jumps out from under the pointer --
    // already measured once at 23642px -> 31760px. The new format must not
    // bring it back.
    expect(imageSize(PNG)).toEqual({ w: 512, h: 256 });
    expect(imageSize(jpeg(frame(0xc0, 1280, 720)))).toEqual({
      w: 1280,
      h: 720,
    });
  });

  it('finds the frame header behind EXIF and a restart interval', () => {
    // The size lives in the SOFn marker, never at a fixed offset: Playwright's
    // encoder is free to put APP1/APP2 and a DRI segment in front of it.
    const withPreamble = jpeg(
      segment(0xe1, Buffer.from('Exif\0\0padding-that-is-not-a-frame')),
      segment(0xdd, Buffer.from([0x00, 0x10])),
      frame(0xc2, 828, 1792),
    );
    expect(imageSize(withPreamble)).toEqual({ w: 828, h: 1792 });
  });

  it('is not fooled by a marker that carries no length field', () => {
    // RSTn and TEM are standalone: reading two bytes after them as a length
    // walks the parser into the middle of the entropy-coded data.
    const withStandalone = jpeg(
      Buffer.from([0xff, 0x01]),
      Buffer.from([0xff, 0xd0]),
      frame(0xc1, 64, 48),
    );
    expect(imageSize(withStandalone)).toEqual({ w: 64, h: 48 });
  });

  it('pins the capture format against the ticket that chose it', () => {
    // A literal pin, separate from the derived checks: quality is a judgement
    // about legible Thai glyphs, and nothing computed from the constant can
    // test its LEVEL.
    expect(EVIDENCE_JPEG_QUALITY).toBe(90);
    expect(captureOptions('/tmp/a.jpg')).toEqual({
      path: '/tmp/a.jpg',
      scale: 'css',
      type: 'jpeg',
      quality: 90,
    });
  });
});

/**
 * Where the published-path rules used to be.
 *
 * Until #268 a recording travelled as a supporting file under `evidence/`, and
 * two rules lived here: every recording mapped to a relative published path,
 * and two recordings landing on one path was a THROW. Both are gone with the
 * route that needed them -- an asset is keyed by the raw journey key, which is
 * unique by construction, so the collision cannot be spelled. What replaced
 * them is `recordings travel in the asset store (#268)` at the end of this
 * file, and the historical collision pair is asserted there so the reason this
 * is now impossible does not become folklore.
 */

/**
 * A second capture must not leave the first capture's recordings behind.
 *
 * Files left out of a redeploy's `files` map are KEPT, not removed, which is the
 * opposite of what the word "publish" suggests and the hazard #158 was filed
 * against. Two ways it bites. Orphans accumulate against the 64 MB and
 * 255-entry ceilings until a publish is refused outright. Far worse, a journey
 * id that survives a re-capture while its recording does not leaves YESTERDAY'S
 * video sitting beside TODAY'S assertion -- and nothing about that page looks
 * wrong, which makes it worse than one that drops the recording honestly.
 *
 * So the removals are emitted explicitly, as `null` against every published
 * path this capture did not produce.
 */
describe('a capture removes the recordings a previous one published', () => {
  it('removes a recording this run did not produce, rather than orphaning it', () => {
    expect(
      reconcileFiles({
        desired: { 'evidence/a-chromium.webm': '/run/a.webm' },
        published: ['evidence/a-chromium.webm', 'evidence/b-webkit.webm'],
      }),
    ).toEqual({
      'evidence/a-chromium.webm': '/run/a.webm',
      'evidence/b-webkit.webm': null,
    });
  });

  it('never removes a published file outside the recordings, so the page survives', () => {
    // The published listing is everything the artifact currently serves, which
    // includes the page itself. "Remove whatever this capture did not produce"
    // reads as correct and deletes `index.html` with it -- and `preflight.js`
    // at the artifact root is reserved, so a publish that nulls it is refused
    // outright. Only the recordings namespace is this builder's to clear.
    expect(
      reconcileFiles({
        desired: { 'evidence/a-chromium.webm': '/run/a.webm' },
        published: ['index.html', 'preflight.js', 'evidence/a-chromium.webm'],
      }),
    ).toEqual({ 'evidence/a-chromium.webm': '/run/a.webm' });
  });
});

/**
 * The publish ceilings are asserted here, loudly, rather than discovered.
 *
 * Silent degradation is what #146 was filed for and what this ticket removes,
 * so the ceilings get a guard that refuses the build -- never a build that
 * quietly emits less. There are two, and they count different things.
 */
describe('a publish that would exceed the artifact ceilings is refused', () => {
  it('refuses more than 255 entries, counting removals as entries', () => {
    // A REMOVAL IS STILL AN ENTRY. `{path: null}` carries no bytes and still
    // occupies one of the 255 slots, so a capture publishing recordings while
    // clearing a previous capture's spends two slots per journey that changed.
    // A guard counting only the entries WITH content passes, and the platform
    // refuses the publish anyway -- reassuring and wrong.
    const files: Record<string, string | null> = {};
    for (let i = 0; i < 200; i += 1)
      files[`evidence/j${i}-chromium.webm`] = `/run/${i}.webm`;
    for (let i = 0; i < 56; i += 1)
      files[`evidence/gone${i}-webkit.webm`] = null;

    let refusal = 'the build did not refuse';
    try {
      assertPublishLimits({ files, sizeOf: () => 10 });
    } catch (error) {
      refusal = (error as Error).message;
    }
    expect(refusal).toContain('256');
    expect(refusal).toContain('255');
  });

  it('refuses more bytes than one publish may carry, whatever the entry count', () => {
    // Ten files, so the entry count is nowhere near its ceiling: a guard that
    // returned after the entry check would pass this without looking at a byte.
    const files: Record<string, string | null> = {};
    for (let i = 0; i < 10; i += 1)
      files[`evidence/j${i}-chromium.webm`] = `/run/${i}.webm`;

    let refusal = 'the build did not refuse';
    try {
      assertPublishLimits({ files, sizeOf: () => 7 * 1024 * 1024 });
    } catch (error) {
      refusal = (error as Error).message;
    }
    expect(refusal).toContain('70.00MB');
    expect(refusal).toContain('64');
  });

  it('pins both ceilings to the numbers a publish actually enforces', () => {
    // A literal pin, separate from the guards that derive from it. Asserting
    // `64 * 1024 * 1024` would restate the expression that DEFINES the
    // constant, so it would hold at any level -- the #117 tautology. The raw
    // literal is what makes lowering a ceiling to get a build through fail
    // here, which is the escape hatch worth closing.
    expect(PUBLISH_MAX_FILES).toBe(255);
    expect(PUBLISH_MAX_BYTES).toBe(67108864);
  });
});

/**
 * A page too large to publish is a REFUSAL, never a smaller page.
 *
 * This is the whole of AC5 and the reason the drop path is gone. The old build
 * met a tight budget by emitting less and saying so on a line nobody reads, so
 * the operator was handed a page that looked complete and held less than he was
 * told (#146, and again at a different scope in #189). With the recordings
 * published beside it, the page holds shots alone -- and there is no honest
 * reason to drop an assertion shot, so not fitting is a build failure.
 *
 * `DROPPED=` can no longer appear on a successful build because the concept is
 * gone, rather than guarded against.
 */
describe('a page too large to publish is refused, not trimmed', () => {
  it('refuses a document over the ceiling, naming both sizes', () => {
    let refusal = 'the build did not refuse';
    try {
      assertPageFits(PAGE_MAX_BYTES + 1);
    } catch (error) {
      refusal = (error as Error).message;
    }
    expect(refusal).toContain('16.00MB');
  });

  it('accepts a document exactly at the ceiling', () => {
    // The boundary belongs to the page: a ceiling is what a publish ALLOWS,
    // so refusing at exactly the limit would reject a page that publishes.
    expect(() => assertPageFits(PAGE_MAX_BYTES)).not.toThrow();
  });

  it('pins the document ceiling to the one a publish enforces', () => {
    // The raw literal, for the same reason as the publish ceilings above:
    // asserting 16 * 1024 * 1024 would restate the defining expression.
    expect(PAGE_MAX_BYTES).toBe(16777216);
  });
});

/**
 * Every media reference the page emits is one the ARTIFACT can serve.
 *
 * This rule used to read "nothing root-relative", and that was right for as
 * long as a recording was a supporting file: an artifact serves those by
 * relative path, so a leading slash was a broken `<video>` on a journey that
 * then read as never recorded. #268 moved recordings into the asset store,
 * which serves `/_blob/<id>` -- root-relative -- in every view, so the old rule
 * would now go red on a correct page.
 *
 * Widening it to "anything goes" would have retired the guard instead of
 * re-aiming it, so it asserts the property it always meant: every `src` is
 * something this artifact serves, which is a `data:` URI for a shot or a
 * `/_blob/` path for a recording, and nothing else. A relative `evidence/...`
 * path is now as broken as `/evidence/...` was, and both fail here.
 *
 * Asserted over the page's own rendered bytes, because the path is built in
 * one place and interpolated into markup in another with no compiler between.
 */
describe('the page references its recordings by a path the artifact serves', () => {
  it('emits only media references the artifact serves', () => {
    const key = 'a-journey|chromium';
    const html = build({ videos: new Map([[key, blobPath(key)]]) });
    const srcs = [...html.matchAll(/src="([^"]*)"/g)].map((m) => m[1]);

    const unservable = srcs.filter(
      (src) => !src.startsWith('data:') && !src.startsWith('/_blob/'),
    );
    expect(
      searched(unservable, { of: srcs, what: 'media references' }),
    ).toEqual([]);
    expect(
      floorBreach('evidence-page/media-references', srcs.length),
    ).toBeUndefined();
    // A positive control on the POPULATION, not merely on its size: the shots
    // are data URIs and would satisfy `searched` on their own, leaving the
    // recording -- the only blob path here -- entirely unexamined.
    expect(srcs).toContain(blobPath(key));
  });
});

/**
 * A journey the report names is on the page, captured or not.
 *
 * The journey list was derived from the MANIFEST alone, so a test that asserted
 * without calling `shoot()` got no section -- while the upload stores one for
 * EVERY recording, because `video` is `on` for the whole run whenever
 * `EVIDENCE_DIR` is set. Two populations with no compiler between them: entries
 * come from the recordings, `src` attributes come from the journey list.
 *
 * Measured on #158's own full-scope proof run: 120 recordings published, 100
 * referenced, 20 files served to a page naming their journeys nowhere. The
 * waste is the smaller half. Four real journeys ran on five engines and
 * appeared on NO evidence page -- including `no console errors on load` -- so
 * the page under-reported the coverage an operator signs off against, and did
 * so silently, which is the failure this whole ticket exists to remove.
 */
describe('a journey that captured nothing is still on the page', () => {
  const JOURNEY = 'a recorded journey';
  const SLUG = 'a-recorded-journey';
  const reportNamingAnUncapturedJourney = {
    ...REPORT,
    suites: [
      ...REPORT.suites,
      {
        specs: [
          {
            title: JOURNEY,
            tests: [
              {
                projectName: 'chromium',
                results: [{ status: 'passed', duration: 7, attachments: [] }],
              },
            ],
          },
        ],
      },
    ],
  };

  it('gives it a section although no manifest row names it', () => {
    // The precondition IS part of the assertion: add a manifest row for this
    // title and the old manifest-derived list renders it anyway, leaving a
    // guard that passes without testing what it claims to.
    const naming = MANIFEST.filter((m) => m.title.endsWith(JOURNEY));
    expect(searched(naming, { of: MANIFEST, what: 'manifest rows' })).toEqual(
      [],
    );
    expect(
      floorBreach('evidence-page/manifest-rows', MANIFEST.length),
    ).toBeUndefined();

    const html = build({ report: reportNamingAnUncapturedJourney });

    expect(html).toContain(`id="j-${SLUG}"`);
    expect(html).toContain(JOURNEY);
    // Control on the population: a page that rendered no journey at all cannot
    // satisfy this, so the assertion above is about derivation, not emptiness.
    expect(html).toContain('id="j-a-journey"');
  });

  it('references every recording it was given', () => {
    const videos = new Map(
      [`${SLUG}|chromium`, 'a-journey|chromium'].map((key) => [
        key,
        blobPath(key),
      ]),
    );
    const html = build({ report: reportNamingAnUncapturedJourney, videos });
    const keys = [...videos.keys()];

    const unreferenced = keys.filter(
      (key) => !html.includes(`src="${blobPath(key)}"`),
    );
    expect(
      searched(unreferenced, {
        of: keys,
        what: 'recordings handed to the page',
      }),
    ).toEqual([]);
    expect(
      floorBreach('evidence-page/handed-recordings', keys.length),
    ).toBeUndefined();
  });
});

/**
 * #263. A journey is identified by its FULL title path, not by its leaf.
 *
 * `shoot` writes `info.titlePath.slice(1).join(' > ')` -- the describes and
 * the test, file dropped -- while the builder read `spec.title`, the leaf
 * alone, and threw the describe titles away. Everything downstream then keyed
 * a journey by that leaf, so two tests sharing a test name in different
 * describes were ONE journey: captures pooled into a single strip, per-engine
 * results taken from whichever spec matched first. Measured on a 7-spec run:
 * 275 distinct leaf titles, 5 used twice, every pair an English block and its
 * Indonesian counterpart. The published-path map was the only thing that noticed,
 * because it alone demands a unique path, and it refused the whole build.
 */
describe('a journey is identified by its full title path', () => {
  /**
   * A report whose specs sit inside real, NESTED describe suites -- one suite
   * per level, the spec at the deepest. A helper that flattened the levels
   * into a single title could not disagree with the builder about nesting,
   * and a fixture that cannot disagree with the contract is not a fixture.
   */
  const nestSuites = (
    describes: readonly string[],
    spec: unknown,
  ): Record<string, unknown> =>
    describes.length === 0
      ? { specs: [spec] }
      : { title: describes[0], suites: [nestSuites(describes.slice(1), spec)] };

  const passedOn = (projects: readonly string[]) =>
    projects.map((p) => ({
      projectName: p,
      results: [{ status: 'passed', duration: 500, attachments: [] }],
    }));

  /** The page escapes `>`, so a title reaches the HTML as `a &gt; b`. */
  const rendered = (title: string) => title.split(' > ').join(' &gt; ');

  it('keeps two describes that share a test name apart', () => {
    const blocks = ['the print panel', 'the print panel — Indonesian'];
    const leaf = 'all three tick boxes start ticked';
    const report = {
      ...REPORT,
      suites: [
        {
          title: 'a-file.spec.ts',
          suites: blocks.map((title) =>
            nestSuites([title], { title: leaf, tests: passedOn(['chromium']) }),
          ),
        },
      ],
    };
    const manifest = blocks.map((b, n) => ({
      project: 'chromium',
      title: `${b} > ${leaf}`,
      order: 1,
      label: `label-${n}`,
      file: `chromium/b${n}__01.png`,
    }));
    const html = build({
      report,
      manifest,
      shots: new Map(
        manifest.map((m) => [m.file, `data:image/png;base64,${m.file}`]),
      ),
    });

    // The EXACT set of journey headings, not `toContain`. Mutation proved the
    // difference: keyed by the leaf, the manifest-derived journeys collapse
    // into one -- and `order` then appends the report's own titles, putting
    // both full titles back on the page. A `toContain` for each one passed
    // over THREE journeys where there should be two, which is the pooling this
    // test exists to catch. A count is the whole property here.
    const headings = [...html.matchAll(/<h3>([^<]*)<\/h3>/g)].map((m) => m[1]);
    expect(headings).toEqual(blocks.map((b) => rendered(`${b} > ${leaf}`)));
    // And each journey carries its OWN capture.
    for (const m of manifest) expect(html).toContain(m.label);
  });

  it('resolves per-engine results for a test two describes deep', () => {
    // Keyed by the leaf, `specs.find((s) => s.title === short)` matched
    // nothing for a nested test, and the journey rendered as not-run on every
    // engine -- a page reporting no result for a test that passed.
    const title = 'an outer block > an inner block > a nested journey';
    const report = {
      ...REPORT,
      suites: [
        {
          title: 'a-file.spec.ts',
          suites: [
            nestSuites(['an outer block', 'an inner block'], {
              title: 'a nested journey',
              tests: passedOn(['chromium']),
            }),
          ],
        },
      ],
    };
    const html = build({
      report,
      manifest: [
        {
          project: 'chromium',
          title,
          order: 1,
          label: 'nested',
          file: 'chromium/n__01.png',
        },
      ],
      shots: new Map([['chromium/n__01.png', 'data:image/png;base64,n']]),
    });

    expect(html).toContain(rendered(title));
    expect(html).toContain('title="passed"');
    expect(html).not.toContain('title="not run"');
  });
});

/**
 * #268. A recording travels in the artifact's ASSET STORE, not as a published
 * supporting file.
 *
 * Measured 2026-09-22 against the real runtime, prediction recorded first: one
 * artifact holds **5000 assets and 1 GiB**, where a publish carries **255
 * entries and 64 MB**. Six specs produce 199 recordings and seven produce 280,
 * so the seven-spec run #263's AC6 asks for could not be published at all. The
 * asset store does not economise against that ceiling, it removes it.
 *
 * An id is assigned by the server, so the build is TWO passes by construction:
 * `--plan` writes what to upload, the upload answers with `/_blob/<id>` for
 * each, and the build proper is given that map. There is no one-pass shape --
 * an id cannot be known before the upload that mints it.
 */
describe('recordings travel in the asset store (#268)', () => {
  it('pins the ceilings that were measured, not assumed', () => {
    // The literals are the measurement. A derived-looking expression here
    // would move with the code and assert nothing about the platform (#117).
    expect(ASSET_MAX_FILES).toBe(5000);
    expect(ASSET_MAX_BYTES).toBe(1073741824);
    expect(ASSET_MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
  });

  it('plans one upload per recording, keyed by the journey it belongs to', () => {
    expect(
      assetUploads([
        { key: 'a journey|chromium', abs: '/tmp/one.webm' },
        { key: 'a journey|webkit', abs: '/tmp/two.webm' },
      ]),
    ).toEqual({
      'a journey|chromium': '/tmp/one.webm',
      'a journey|webkit': '/tmp/two.webm',
    });
  });

  it('cannot collide on a slug, because nothing is slugged', () => {
    // The published path joined journey and engine on the separator the key
    // itself uses, so `a-b|c` and `a|b-c` both became `a-b-c.webm` and the
    // build refused. An asset is keyed by the raw key, which is unique by
    // construction, so this pair is two uploads rather than a refusal.
    const planned = assetUploads([
      { key: 'a-b|c', abs: '/tmp/one.webm' },
      { key: 'a|b-c', abs: '/tmp/two.webm' },
    ]);
    // The pair that used to collide: slugged on the key's own separator, both
    // became `evidence/a-b-c.webm`. Asserted as the whole population, so the
    // two survive as two and the reason is not left as folklore.
    expect(planned).toEqual({
      'a-b|c': '/tmp/one.webm',
      'a|b-c': '/tmp/two.webm',
    });
  });

  it('refuses two recordings whose journeys slug to one key', () => {
    // NOT the retired collision. The key is `slugOf(title)|project`, and
    // `videoCandidates` returns an array, so `a journey` and `a-journey` slug
    // the same way and arrive as two candidates under one key. A Map keeps the
    // last in silence. Found by a failing expectation while writing the plan
    // test, after the first draft of `assetUploads` claimed the key was unique
    // by construction -- it is not.
    let refusal = 'the build did not refuse';
    try {
      assetUploads([
        { key: 'a-journey|chromium', abs: '/run/one.webm' },
        { key: 'a-journey|chromium', abs: '/run/two.webm' },
      ]);
    } catch (error) {
      refusal = (error as Error).message;
    }
    expect(refusal).toContain('a-journey|chromium');
    expect(refusal).toContain('/run/one.webm');
    expect(refusal).toContain('/run/two.webm');
  });

  it('resolves the page src from the uploaded map', () => {
    expect(
      assetVideoPaths({
        uploaded: { 'a journey|chromium': '/_blob/deadbeef' },
        candidates: [{ key: 'a journey|chromium', abs: '/tmp/one.webm' }],
      }),
    ).toEqual(new Map([['a journey|chromium', '/_blob/deadbeef']]));
  });

  it('refuses a recording the uploaded map does not carry', () => {
    // Nothing is silently dropped: a journey whose recording never uploaded
    // would render with no `src` and read as never recorded, which is the
    // failure this whole file exists to prevent.
    expect(() =>
      assetVideoPaths({
        uploaded: {},
        candidates: [{ key: 'a journey|chromium', abs: '/tmp/one.webm' }],
      }),
    ).toThrow(/1 recording\(s\) were planned but never uploaded/);
  });

  it('refuses an uploaded entry no recording asked for', () => {
    // The other direction: a stale map from an earlier run would pair a
    // current journey with an older recording and look entirely normal.
    expect(() =>
      assetVideoPaths({
        uploaded: {
          'a journey|chromium': '/_blob/a',
          'gone|webkit': '/_blob/b',
        },
        candidates: [{ key: 'a journey|chromium', abs: '/tmp/one.webm' }],
      }),
    ).toThrow(/1 uploaded asset\(s\) belong to no recording in this run/);
  });

  it('refuses a blob path that is not one', () => {
    expect(() =>
      assetVideoPaths({
        uploaded: { 'a journey|chromium': 'https://example.test/x.webm' },
        candidates: [{ key: 'a journey|chromium', abs: '/tmp/one.webm' }],
      }),
    ).toThrow(/is not a \/_blob\/ path/);
  });

  it('refuses more assets than one artifact holds', () => {
    const uploads = Object.fromEntries(
      Array.from({ length: ASSET_MAX_FILES + 1 }, (_, i) => [
        `j${i}|chromium`,
        `/tmp/${i}.webm`,
      ]),
    );
    expect(() => assertAssetLimits({ uploads, sizeOf: () => 10 })).toThrow(
      /5001 assets, over the 5000 one artifact holds/,
    );
  });

  it('refuses a recording over the per-asset ceiling', () => {
    expect(() =>
      assertAssetLimits({
        uploads: { 'a|chromium': '/tmp/big.webm' },
        sizeOf: () => ASSET_MAX_FILE_BYTES + 1,
      }),
    ).toThrow(
      /\/tmp\/big\.webm at 20\.00MB, over the 20\.00MB one asset allows/,
    );
  });

  it('allows a recording exactly at the per-asset ceiling', () => {
    // The boundary itself, because `>` and `>=` are one character apart and
    // only a test at the exact value can tell them apart. 20 MiB is allowed;
    // one byte more is not, which the row below asserts.
    expect(
      assertAssetLimits({
        uploads: { 'a|chromium': '/tmp/exact.webm' },
        sizeOf: () => ASSET_MAX_FILE_BYTES,
      }),
    ).toBeUndefined();
  });

  it('allows a run exactly at the store ceiling', () => {
    // Spread over 1024 files of 1 MiB, not one file of 1 GiB: a single file
    // that size breaches the PER-ASSET ceiling first, so the version of this
    // test that used one file was asserting the wrong refusal and failed.
    const uploads = Object.fromEntries(
      Array.from({ length: 1024 }, (_, i) => [
        `j${i}|chromium`,
        `/tmp/${i}.webm`,
      ]),
    );
    expect(
      assertAssetLimits({ uploads, sizeOf: () => 1048576 }),
    ).toBeUndefined();
    // And one byte more, spread the same way, is refused.
    expect(() =>
      assertAssetLimits({
        uploads: { ...uploads, 'extra|chromium': '/tmp/extra.webm' },
        sizeOf: () => 1048576,
      }),
    ).toThrow(/over the 1024\.00MB one artifact holds/);
  });

  it('allows exactly as many assets as one artifact holds', () => {
    const uploads = Object.fromEntries(
      Array.from({ length: ASSET_MAX_FILES }, (_, i) => [
        `j${i}|chromium`,
        `/tmp/${i}.webm`,
      ]),
    );
    expect(assertAssetLimits({ uploads, sizeOf: () => 10 })).toBeUndefined();
  });

  it('refuses a run whose recordings exceed the store', () => {
    expect(() =>
      assertAssetLimits({
        uploads: { 'a|chromium': '/tmp/a.webm', 'b|chromium': '/tmp/b.webm' },
        sizeOf: () => ASSET_MAX_BYTES / 2 + 1,
      }),
    ).toThrow(/over the 1024\.00MB one artifact holds/);
  });

  it('accepts a run that fits, and says nothing', () => {
    expect(
      assertAssetLimits({
        uploads: { 'a|chromium': '/tmp/a.webm' },
        sizeOf: () => 1024,
      }),
    ).toBeUndefined();
  });
});
