import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { withoutMarkupComments } from '../unit/source-text';
import {
  EVIDENCE_MANIFEST,
  EVIDENCE_REPORT,
  manifestRow,
} from '../../scripts/evidence-files.mjs';
import { scriptCheckout, type ScriptCheckout } from '../unit/script-checkout';
import { ASSET_MAX_FILES } from '../../scripts/build-evidence-page.mjs';
import {
  CONTENT,
  REPORT,
  capture,
  reportOf,
  writeRecording,
} from '../evidence-page-shared';

/** The PNG signature and an IHDR `width` px wide: all the builder reads of a capture. */
const png = (width: number) => {
  const size = Buffer.alloc(8);
  size.writeUInt32BE(width, 0);
  size.writeUInt32BE(1, 4);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
    size,
  ]);
};

/**
 * Where a built page points for one screenshot: the `/_blob/` path the stood-in
 * upload gave its `shot:` key (#368). A capture is proved SHOWN by that `src`
 * on the page, and proved ABSENT by its key missing from the upload plan.
 */
const shotSrc = (dir: string, file: string) => {
  const assets: Record<string, string> = JSON.parse(
    readFileSync(join(dir, 'assets.json'), 'utf8'),
  );
  const src = assets[`shot:${file}`];
  if (src === undefined) throw new Error(`no shot:${file} in the uploaded map`);
  return `src="${src}"`;
};
const plannedKeys = (page: string) =>
  Object.keys(JSON.parse(readFileSync(`${page}.uploads.json`, 'utf8')));

/**
 * The builder as an operator runs it: its own process, reading only the disk.
 *
 * TWO PASSES since #268, because an asset id is minted by the upload and
 * cannot be known before it. `--plan` writes what to upload; the upload here
 * is stood in for, since the store is a platform the unit suite does not
 * reach, and the ids it invents are the only fabricated thing in this harness.
 * A plan that refuses is returned as-is: the refusals these tests assert all
 * happen before anything would be uploaded.
 */
const runBuilder = (
  dir: string,
  page: string,
  script = 'scripts/build-evidence-page.mjs',
  extra: string[] = [],
) => {
  const content = join(dir, 'content.json');
  writeFileSync(content, JSON.stringify(CONTENT));
  const planned = spawnSync(
    process.execPath,
    [script, '--plan', '--evidence', dir, '--out', page],
    { encoding: 'utf8' },
  );
  if (planned.status !== 0) return planned;
  const uploads: Record<string, string> = JSON.parse(
    readFileSync(`${page}.uploads.json`, 'utf8'),
  );
  const assets = join(dir, 'assets.json');
  writeFileSync(
    assets,
    JSON.stringify(
      Object.fromEntries(
        Object.keys(uploads).map((key, n) => [
          key,
          `/_blob/${n.toString(16).padStart(32, '0')}`,
        ]),
      ),
    ),
  );
  return spawnSync(
    process.execPath,
    [
      script,
      '--evidence',
      dir,
      '--content',
      content,
      '--out',
      page,
      '--assets',
      assets,
      ...extra,
    ],
    { encoding: 'utf8' },
  );
};

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

  it('refuses at the command line, before a page is written', () => {
    // The seam: `main` has to ask `videoCandidates` BEFORE it writes. A page
    // written anyway is the #165 page again, whatever the function would say.
    const dir = mkdtempSync(join(scratch, 'run-'));
    mkdirSync(join(dir, 'chromium'));
    writeFileSync(join(dir, 'chromium', 'a__01.png'), png(1));
    // Stamped five seconds into the reported run, as the harness stamps it.
    writeFileSync(
      join(dir, EVIDENCE_MANIFEST),
      JSON.stringify(
        manifestRow(
          {
            project: 'chromium',
            title: 'suite > a journey',
            order: 1,
            label: 'first thing',
            file: 'chromium/a__01.png',
          },
          new Date(Date.parse(REPORT.stats.startTime) + 5_000),
        ),
      ) + '\n',
    );
    const page = join(dir, 'page.html');
    const buildWith = (video: string) => {
      writeFileSync(
        join(dir, EVIDENCE_REPORT),
        JSON.stringify(
          reportOf([{ journey: 'a journey', project: 'chromium', video }]),
        ),
      );
      return runBuilder(dir, page);
    };

    const refused = buildWith(join(dir, 'gone.webm'));
    expect(refused.status, refused.stdout).not.toBe(0);
    expect(refused.stderr).toContain('"a journey" on chromium');
    expect(existsSync(page), 'a page was written without its recordings').toBe(
      false,
    );

    // Positive control: the same directory builds once the recording exists,
    // so the refusal above is about the recording and nothing else.
    const built = buildWith(recording('present.webm', 10));
    expect(built.status, built.stderr).toBe(0);
    expect(built.stdout).toContain('videos=1/1');
    expect(existsSync(page)).toBe(true);
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

  /** A directory as runs leave it: a distinct capture per file, the rows, the report. */
  const directory = (rows: { file: string }[], report: object) => {
    const dir = mkdtempSync(join(scratch, 'run-'));
    [...new Set(rows.map((row) => row.file))].forEach((file, i) => {
      mkdirSync(join(dir, dirname(file)), { recursive: true });
      writeFileSync(join(dir, file), png(10 + i));
    });
    writeFileSync(
      join(dir, EVIDENCE_MANIFEST),
      rows.map((row) => JSON.stringify(row) + '\n').join(''),
    );
    writeFileSync(join(dir, EVIDENCE_REPORT), JSON.stringify(report));
    return dir;
  };

  /** A capture exactly as the page embeds it. */
  const base64Of = (dir: string, file: string) =>
    readFileSync(join(dir, file)).toString('base64');

  it('builds the page from the second of two runs into one directory, and deletes nothing', () => {
    // #171's measured scenario in miniature: webkit captured a minute before
    // the reported run began, then chromium into the same directory.
    const webkit = [
      stamped('webkit', 1, -MINUTE),
      stamped('webkit', 2, -MINUTE + 1),
    ];
    const chromium = [
      stamped('chromium', 1, 5_000),
      stamped('chromium', 2, 5_001),
    ];
    const rows = [...webkit, ...chromium];
    const dir = directory(
      rows,
      reportOf([{ journey: 'a journey', project: 'chromium' }]),
    );
    const page = join(dir, 'page.html');

    const built = runBuilder(dir, page);

    expect(built.status, built.stderr).toBe(0);
    expect(built.stdout).toContain('shots=2 videos=0/0');
    expect(built.stdout).toContain(
      'EARLIER=2 (captured before this run started): webkit 2',
    );
    const html = readFileSync(page, 'utf8');
    // A capture is SHOWN only outside a comment: one left inside `<!-- -->`
    // would pass on the raw page while the gallery showed nothing (#225).
    // Absence reads the raw page, so it fails even then.
    const shown = withoutMarkupComments(html);
    for (const row of chromium)
      expect(shown, `${row.file} is missing from the page`).toContain(
        shotSrc(dir, row.file),
      );
    for (const row of webkit) {
      expect(
        plannedKeys(page),
        `${row.file}, from the earlier run, was planned for upload`,
      ).not.toContain(`shot:${row.file}`);
      expect(
        html,
        `${row.file}, from the earlier run, is on the page`,
      ).not.toContain(base64Of(dir, row.file));
    }
    // Set aside, never deleted: every capture and every row is still there.
    for (const row of rows)
      expect(existsSync(join(dir, row.file)), row.file).toBe(true);
    expect(
      readFileSync(join(dir, EVIDENCE_MANIFEST), 'utf8').trim().split('\n'),
    ).toHaveLength(rows.length);
  });

  it('shows no picture for an assertion this run did not reach, though an earlier run captured it', () => {
    // The first run reached both assertions. The second, after a change,
    // failed before its second shot and overwrote only the first capture.
    const first = [
      stamped('chromium', 1, -MINUTE),
      stamped('chromium', 2, -MINUTE + 1),
    ];
    const second = stamped('chromium', 1, 5_000);
    const dir = directory(
      [...first, second],
      reportOf([
        { journey: 'a journey', project: 'chromium', status: 'failed' },
      ]),
    );
    const page = join(dir, 'page.html');

    const built = runBuilder(dir, page);

    expect(built.status, built.stderr).toBe(0);
    expect(built.stdout).toContain('shots=1 videos=0/0');
    const html = readFileSync(page, 'utf8');
    expect(withoutMarkupComments(html)).toContain(shotSrc(dir, second.file));
    expect(
      plannedKeys(page),
      "the unreached assertion's earlier picture was planned for upload",
    ).not.toContain(`shot:${first[1]?.file}`);
    expect(
      html,
      "the unreached assertion carries the earlier run's picture",
    ).not.toContain(base64Of(dir, first[1].file));
  });

  it("never reads an earlier run's capture, so one deleted since is no reason to refuse", () => {
    const gone = stamped('webkit', 1, -MINUTE);
    const kept = stamped('chromium', 1, 5_000);
    const dir = directory(
      [gone, kept],
      reportOf([{ journey: 'a journey', project: 'chromium' }]),
    );
    rmSync(join(dir, gone.file));
    const page = join(dir, 'page.html');

    const built = runBuilder(dir, page);

    expect(built.status, built.stderr).toBe(0);
    expect(built.stdout).toContain('shots=1 videos=0/0');
    expect(built.stdout).toContain(
      'EARLIER=1 (captured before this run started): webkit 1',
    );
  });

  it("refuses at the command line when nothing is this run's, and writes no page", () => {
    const dir = directory(
      [stamped('webkit', 1, -MINUTE)],
      reportOf([
        { journey: 'a journey', project: 'chromium', status: 'failed' },
      ]),
    );
    const page = join(dir, 'page.html');

    const refused = runBuilder(dir, page);

    expect(refused.status, refused.stdout).not.toBe(0);
    expect(refused.stderr).toContain('webkit 1');
    expect(
      existsSync(page),
      'a page was written with no capture from its run',
    ).toBe(false);
  });
});

describe('the builder builds its page from any checkout path (#221)', () => {
  // Its entry check once compared `import.meta.url` with a `file://` template
  // around `process.argv[1]`. The URL is percent-encoded and the path is not,
  // so from a checkout whose path held a space `main()` never ran, and the
  // build exited 0 having written nothing.
  let checkout: ScriptCheckout;
  let dir = '';
  beforeAll(() => {
    checkout = scriptCheckout();
    dir = mkdtempSync(join(tmpdir(), 'evidence-entry-'));
  });
  afterAll(() => {
    checkout.remove();
    rmSync(dir, { recursive: true, force: true });
  });

  it('builds it when run from a checkout whose path holds a space', () => {
    const row = manifestRow(
      {
        project: 'chromium',
        title: 'suite > a journey',
        order: 1,
        label: 'thing 1',
        file: 'chromium/a__01.png',
      },
      new Date(Date.parse(REPORT.stats.startTime) + 5_000),
    );
    mkdirSync(join(dir, 'chromium'));
    writeFileSync(join(dir, row.file), png(10));
    writeFileSync(join(dir, EVIDENCE_MANIFEST), `${JSON.stringify(row)}\n`);
    writeFileSync(
      join(dir, EVIDENCE_REPORT),
      JSON.stringify(reportOf([{ journey: 'a journey', project: 'chromium' }])),
    );
    const page = join(dir, 'page.html');

    const built = runBuilder(
      dir,
      page,
      join(checkout.spaced, 'build-evidence-page.mjs'),
    );

    // The precondition, so the test cannot drift into proving nothing.
    expect(checkout.spaced).toContain(' ');
    expect(built.stdout, built.stderr).toContain('shots=1 videos=0/0');
    expect(built.status, built.stderr).toBe(0);
    // On the page, not in a comment on it.
    expect(withoutMarkupComments(readFileSync(page, 'utf8'))).toContain(
      shotSrc(dir, row.file),
    );
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
  let scratch = '';
  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'evidence-assets-'));
  });
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  /** A recording on disk, because the builder reads every one it is told of. */
  const recording = (name: string, size: number) =>
    writeRecording(scratch, name, size);

  /**
   * An evidence directory with one captured assertion and one recording, as a
   * run leaves it. The manifest row is stamped inside the reported run, or
   * `capturesOfThisRun` reads it as an earlier run's and refuses.
   */
  const runDirectory = (name: string) => {
    const dir = mkdtempSync(join(scratch, name));
    mkdirSync(join(dir, 'chromium'));
    writeFileSync(join(dir, 'chromium', 'a__01.png'), png(1));
    writeFileSync(
      join(dir, EVIDENCE_MANIFEST),
      JSON.stringify(
        manifestRow(
          {
            project: 'chromium',
            title: 'suite > a journey',
            order: 1,
            label: 'first thing',
            file: 'chromium/a__01.png',
          },
          new Date(Date.parse(REPORT.stats.startTime) + 5_000),
        ),
      ) + '\n',
    );
    writeFileSync(
      join(dir, EVIDENCE_REPORT),
      JSON.stringify(
        reportOf([
          {
            journey: 'a journey',
            project: 'chromium',
            video: recording(`${name}.webm`, 10),
          },
        ]),
      ),
    );
    return dir;
  };

  it('plans the upload from paths alone, before any content', () => {
    // The plan pass runs before content and before any capture is read: it
    // needs the recordings and the manifest's screenshot paths (#368), and a
    // plan refused over a missing --content would be a pass refusing an
    // argument it does not use.
    const dir = runDirectory('plan-');
    const page = join(dir, 'page.html');
    const planned = spawnSync(
      process.execPath,
      [
        'scripts/build-evidence-page.mjs',
        '--plan',
        '--evidence',
        dir,
        '--out',
        page,
      ],
      { encoding: 'utf8' },
    );
    expect(planned.status, planned.stderr).toBe(0);
    expect(JSON.parse(readFileSync(`${page}.uploads.json`, 'utf8'))).toEqual({
      'a-journey|chromium': join(scratch, 'plan-.webm'),
      'shot:chromium/a__01.png': join(dir, 'chromium/a__01.png'),
    });
    expect(existsSync(page), 'the plan pass wrote a page').toBe(false);
  });

  it('refuses to build a page for recordings nothing uploaded', () => {
    // Without the map every journey would render with no source, which reads
    // exactly like a run that recorded nothing. The refusal is at the command
    // line and leaves no page behind, for the same reason a missing recording
    // does: a page on disk invites publishing it anyway.
    const dir = runDirectory('unmapped-');
    const content = join(dir, 'content.json');
    writeFileSync(content, JSON.stringify(CONTENT));
    const page = join(dir, 'page.html');
    const refused = spawnSync(
      process.execPath,
      [
        'scripts/build-evidence-page.mjs',
        '--evidence',
        dir,
        '--content',
        content,
        '--out',
        page,
      ],
      { encoding: 'utf8' },
    );
    expect(refused.status, refused.stdout).not.toBe(0);
    expect(refused.stderr).toContain('no --assets map was given');
    expect(existsSync(page), 'a page was written with no recordings').toBe(
      false,
    );
  });

  /**
   * The command line, parsed strictly (#390). The hand-rolled reader ignored
   * an option it did not know, so `--publishd` cost the publish every removal
   * without a word, and took the next word whatever it was, so
   * `--evidence --out page` read a directory called `--out`.
   *
   * Run from the scratch directory: a builder that misreads its command
   * writes wherever it was started, and a mutation that brought the loose
   * parser back left a plan called `true.uploads.json` in the checkout.
   */
  const builder = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [resolve('scripts/build-evidence-page.mjs'), ...args],
      { encoding: 'utf8', cwd: scratch },
    );

  it('refuses an option it does not know, by name, before reading anything', () => {
    const dir = runDirectory('unknown-option-');
    const page = join(dir, 'page.html');
    const refused = builder(
      '--plan',
      '--evidence',
      dir,
      '--out',
      page,
      '--publishd',
      join(dir, 'listing.json'),
    );
    expect(refused.status, refused.stderr).toBe(2);
    expect(refused.stderr).toContain(
      "build-evidence-page: Unknown option '--publishd'",
    );
    expect(refused.stderr).toContain('usage: build-evidence-page.mjs');
    expect(existsSync(`${page}.uploads.json`), 'the plan was written').toBe(
      false,
    );
  });

  it('refuses an option whose value is another option', () => {
    const dir = runDirectory('ambiguous-');
    const refused = builder(
      '--plan',
      '--evidence',
      '--out',
      join(dir, 'page.html'),
    );
    expect(refused.status, refused.stderr).toBe(2);
    expect(refused.stderr).toContain(
      "build-evidence-page: Option '--evidence' argument is ambiguous.",
    );
  });

  it('refuses an option given no value, naming it', () => {
    const dir = runDirectory('no-value-');
    const refused = builder('--plan', '--evidence', dir, '--out');
    expect(refused.status, refused.stderr).toBe(2);
    expect(refused.stderr).toContain(
      "build-evidence-page: Option '--out <value>' argument missing",
    );
  });

  it('refuses a plan pass that is also handed the answer to it', () => {
    const dir = runDirectory('both-passes-');
    const refused = builder(
      '--plan',
      '--assets',
      join(dir, 'assets.json'),
      '--evidence',
      dir,
      '--out',
      join(dir, 'page.html'),
    );
    expect(refused.status, refused.stderr).toBe(2);
    expect(refused.stderr).toContain(
      'build-evidence-page: --plan writes the upload list; --assets reads the ' +
        'answer to it. Passing both asks for one pass to be two.',
    );
  });

  it('says a refusal in one line, with no stack under it', () => {
    // A decision is not a crash: `at main (...)` under it shows the reader an
    // internal error where the answer belongs (#227).
    const dir = runDirectory('one-line-');
    const content = join(dir, 'content.json');
    writeFileSync(content, JSON.stringify(CONTENT));
    const refused = builder(
      '--evidence',
      dir,
      '--content',
      content,
      '--out',
      join(dir, 'page.html'),
    );
    expect(refused.status, refused.stderr).toBe(1);
    expect(refused.stderr).toMatch(
      /^✗ build-evidence-page: .*no --assets map was given/,
    );
    expect(refused.stderr).not.toMatch(/^\s+at /m);
  });

  it('names a report that is not JSON', () => {
    const dir = runDirectory('bad-report-');
    writeFileSync(join(dir, EVIDENCE_REPORT), '{"stats":');
    const refused = builder(
      '--plan',
      '--evidence',
      dir,
      '--out',
      join(dir, 'p.html'),
    );
    expect(refused.status, refused.stderr).toBe(1);
    expect(refused.stderr).toContain(
      `✗ build-evidence-page: the evidence report at ${join(dir, EVIDENCE_REPORT)} is not JSON:`,
    );
  });

  it('names the manifest line that is not JSON, counting blank lines', () => {
    const dir = runDirectory('bad-manifest-');
    const manifest = join(dir, EVIDENCE_MANIFEST);
    writeFileSync(
      manifest,
      `\n${readFileSync(manifest, 'utf8').trim()}\n{"project":\n`,
    );
    const refused = builder(
      '--plan',
      '--evidence',
      dir,
      '--out',
      join(dir, 'p.html'),
    );
    expect(refused.status, refused.stderr).toBe(1);
    expect(refused.stderr).toContain(
      `✗ build-evidence-page: the evidence manifest at ${manifest} line 3 is not JSON:`,
    );
  });

  it('names an evidence directory with no report in it', () => {
    const dir = mkdtempSync(join(scratch, 'empty-'));
    const refused = builder(
      '--plan',
      '--evidence',
      dir,
      '--out',
      join(dir, 'p.html'),
    );
    expect(refused.status, refused.stderr).toBe(1);
    expect(refused.stderr).toContain(
      `✗ build-evidence-page: could not read the evidence report at ${join(dir, EVIDENCE_REPORT)}: ENOENT`,
    );
  });

  it('removes what an earlier publish served, from the --published listing', () => {
    // Driven through the command: only reconcileFiles itself was tested, so
    // the option that hands it the listing could be dropped with every test
    // green.
    const dir = runDirectory('published-');
    const listing = join(dir, 'listing.json');
    writeFileSync(listing, JSON.stringify(['index.html', 'evidence/old.webm']));
    const page = join(dir, 'page.html');
    const built = runBuilder(dir, page, undefined, ['--published', listing]);
    expect(built.status, built.stderr).toBe(0);
    expect(JSON.parse(readFileSync(`${page}.files.json`, 'utf8'))).toEqual({
      'evidence/old.webm': null,
    });
  });

  it.each([
    ['a list holding an object', [{ path: 'evidence/old.webm' }]],
    ['an object, not a list', { files: ['evidence/old.webm'] }],
  ])('refuses a published listing that is %s, naming it', (_, shape) => {
    const dir = runDirectory('listing-shape-');
    const listing = join(dir, 'listing.json');
    writeFileSync(listing, JSON.stringify(shape));
    const page = join(dir, 'page.html');
    const refused = runBuilder(dir, page, undefined, ['--published', listing]);
    expect(refused.status, refused.stderr).toBe(1);
    expect(refused.stderr).toContain(
      `✗ build-evidence-page: the published file listing at ${listing} is not a list of paths -- got ${JSON.stringify(shape)}`,
    );
    expect(existsSync(page), 'a page was written').toBe(false);
  });
});

/**
 * #368. Screenshots travel in the artifact's asset store beside the
 * recordings, so a five-engine release page is not 105 MB of base64 in a
 * document that carries 16 MB. Each is planned as `shot:<manifest file>`,
 * uploaded with the recordings, and referenced at the `/_blob/` path the
 * upload answered with, checked in both directions as recordings are.
 */
describe('screenshots travel in the asset store (#368)', () => {
  let scratch = '';
  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'evidence-shots-'));
  });
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  const START = Date.parse(REPORT.stats.startTime);
  const row = (order: number, project = 'chromium') =>
    manifestRow(
      {
        project,
        title: 'suite > a journey',
        order,
        label: `thing ${order}`,
        file: `${project}/a__${String(order).padStart(2, '0')}.png`,
      },
      new Date(START + 5_000 + order),
    );

  /** A run: one capture file per row (distinct bytes unless `same`), the rows, the report. */
  const run = (rows: { file: string }[], same = false) => {
    const dir = mkdtempSync(join(scratch, 'run-'));
    rows.forEach(({ file }, i) => {
      mkdirSync(join(dir, dirname(file)), { recursive: true });
      writeFileSync(join(dir, file), png(same ? 10 : 10 + i));
    });
    writeFileSync(
      join(dir, EVIDENCE_MANIFEST),
      rows.map((r) => `${JSON.stringify(r)}\n`).join(''),
    );
    writeFileSync(
      join(dir, EVIDENCE_REPORT),
      JSON.stringify(reportOf([{ journey: 'a journey', project: 'chromium' }])),
    );
    return dir;
  };
  const plannedOf = (page: string): Record<string, string> =>
    JSON.parse(readFileSync(`${page}.uploads.json`, 'utf8'));
  const assetsOf = (dir: string): Record<string, string> =>
    JSON.parse(readFileSync(join(dir, 'assets.json'), 'utf8'));

  /** The second pass alone, against a map the test writes. */
  const buildWith = (dir: string, page: string, assets: object) => {
    const content = join(dir, 'content.json');
    writeFileSync(content, JSON.stringify(CONTENT));
    const map = join(dir, 'assets-by-hand.json');
    writeFileSync(map, JSON.stringify(assets));
    return spawnSync(
      process.execPath,
      [
        'scripts/build-evidence-page.mjs',
        '--evidence',
        dir,
        '--content',
        content,
        '--out',
        page,
        '--assets',
        map,
      ],
      { encoding: 'utf8' },
    );
  };

  it('plans every screenshot as shot:<file>, beside the recordings, and says how many of each', () => {
    const rows = [row(1), row(2)];
    const dir = run(rows);
    const page = join(dir, 'page.html');
    const planned = spawnSync(
      process.execPath,
      [
        'scripts/build-evidence-page.mjs',
        '--plan',
        '--evidence',
        dir,
        '--out',
        page,
      ],
      { encoding: 'utf8' },
    );
    expect(planned.status, planned.stderr).toBe(0);
    expect(plannedOf(page)).toEqual(
      Object.fromEntries(
        rows.map((r) => [`shot:${r.file}`, join(dir, r.file)]),
      ),
    );
    expect(planned.stdout).toContain(
      'planned 2 screenshot(s) and 0 recording(s)',
    );
  });

  it('references each screenshot at the blob path the map gives, and inlines none', () => {
    const rows = [row(1), row(2)];
    const dir = run(rows);
    const page = join(dir, 'page.html');
    const built = runBuilder(dir, page);
    expect(built.status, built.stderr).toBe(0);
    const html = readFileSync(page, 'utf8');
    const shown = withoutMarkupComments(html);
    const assets = assetsOf(dir);
    for (const { file } of rows) {
      const src = assets[`shot:${file}`];
      expect(src, file).toMatch(/^\/_blob\/[0-9a-f]{32}$/);
      expect(shown, file).toContain(`src="${src}"`);
    }
    expect(html).not.toContain('data:image');
    // Still sized from the local file, so the page reserves the space.
    expect(shown).toMatch(
      /<img loading="lazy" width="\d+" height="\d+" src="\/_blob\//,
    );
  });

  it('refuses a planned screenshot the map does not carry, and names it', () => {
    const rows = [row(1), row(2)];
    const dir = run(rows);
    const page = join(dir, 'page.html');
    const refused = buildWith(dir, page, {
      [`shot:${rows[0]?.file}`]: `/_blob/${'1'.repeat(32)}`,
    });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain(
      '1 screenshot(s) were planned but never uploaded',
    );
    expect(refused.stderr).toContain(`shot:${rows[1]?.file}`);
    expect(existsSync(page), 'a page was written without a screenshot').toBe(
      false,
    );
  });

  it('refuses a shot: entry for a file this run did not capture', () => {
    const rows = [row(1)];
    const dir = run(rows);
    const page = join(dir, 'page.html');
    const refused = buildWith(dir, page, {
      [`shot:${rows[0]?.file}`]: `/_blob/${'1'.repeat(32)}`,
      'shot:webkit/gone__01.png': `/_blob/${'2'.repeat(32)}`,
    });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain(
      '1 uploaded asset(s) belong to no screenshot in this run',
    );
    expect(refused.stderr).toContain('shot:webkit/gone__01.png');
  });

  it('counts screenshots against the files one artifact holds', () => {
    const rows = Array.from({ length: ASSET_MAX_FILES + 1 }, (_, i) =>
      row(i + 1),
    );
    const dir = run(rows, true);
    const page = join(dir, 'page.html');
    const planned = spawnSync(
      process.execPath,
      [
        'scripts/build-evidence-page.mjs',
        '--plan',
        '--evidence',
        dir,
        '--out',
        page,
      ],
      { encoding: 'utf8' },
    );
    expect(planned.status).not.toBe(0);
    expect(planned.stderr).toContain(
      `${ASSET_MAX_FILES + 1} assets, over the ${ASSET_MAX_FILES} one artifact holds`,
    );
  });

  it('refuses a screenshot that is not an image, though no data URI carries it now', () => {
    const rows = [row(1)];
    const dir = run(rows);
    writeFileSync(join(dir, rows[0]?.file ?? ''), 'GIF89a not a capture');
    const page = join(dir, 'page.html');
    const refused = runBuilder(dir, page);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain('unrecognised capture format');
    expect(existsSync(page), 'a page was written around a blank frame').toBe(
      false,
    );
  });

  it('renders two byte-identical screenshots from the one stored asset', () => {
    const rows = [row(1), row(2)];
    const dir = run(rows, true);
    const page = join(dir, 'page.html');
    const one = `/_blob/${'a'.repeat(32)}`;
    const built = buildWith(
      dir,
      page,
      Object.fromEntries(rows.map((r) => [`shot:${r.file}`, one])),
    );
    expect(built.status, built.stderr).toBe(0);
    const shown = withoutMarkupComments(readFileSync(page, 'utf8'));
    expect(shown.split(`src="${one}"`)).toHaveLength(rows.length + 1);
  });
});
