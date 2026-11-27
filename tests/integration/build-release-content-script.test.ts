import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LISTING_CAVEAT } from '../../scripts/build-release-content.mjs';
import { checkoutScratch } from '../checkout-scratch';
import {
  EVIDENCE_MANIFEST,
  EVIDENCE_REPORT,
} from '../../scripts/evidence-files.mjs';
import { scratchGit } from '../git-env';

/**
 * `scripts/build-release-content.mjs` as the release is built with it: in a
 * checkout, from a release file, with `gh` on the PATH.
 *
 * `build-release-content.test.ts` covers what the content says. This file
 * covers `main()`: the two modes, their refusals and what each prints, none
 * of which any test ran. `gh` is the stand-in `dependabot-labels` uses; git
 * is real, in a scratch repository whose head changes one `src/` file.
 */

const SCRIPT = path.resolve(
  import.meta.dirname,
  '../../scripts/build-release-content.mjs',
);
const TITLE = 'a describe > a journey';
const REPORT = {
  stats: { startTime: '2026-09-27T08:00:00.000Z' },
  suites: [
    {
      file: 'x.spec.ts',
      suites: [
        {
          title: 'a describe',
          specs: [
            {
              title: 'a journey',
              tests: [
                {
                  projectName: 'chromium',
                  results: [{ status: 'passed', duration: 1, attachments: [] }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
const MANIFEST_ROW = {
  project: 'chromium',
  title: TITLE,
  order: 1,
  label: 'l',
  file: 'chromium/a.jpg',
  at: '2026-09-27T08:00:01.000Z',
};

let dir = '';
let base = '';
let head = '';
const at = (...parts: string[]) => path.join(dir, ...parts);

/** The release file, with `change` in place of any field it names. */
const writeRelease = (change: Record<string, unknown> = {}) =>
  writeFileSync(
    at('release.json'),
    JSON.stringify({
      base,
      headline: 'The headline',
      lede: 'The lede',
      signoff: { lede: 'Yours.', approve: 'Release' },
      gapGroup: 'Shown by no journey',
      checks: [{ id: 'dev-home', group: 'On dev', label: 'Open it' }],
      entries: { [head]: { kind: 'visible', journeys: [TITLE] } },
      ...change,
    }),
  );

beforeEach(() => {
  dir = checkoutScratch('release-content');
  mkdirSync(at('repo', 'src'), { recursive: true });
  const git = scratchGit(at('repo'));
  git(['init', '-q']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(at('repo', 'README.md'), 'production\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'the production tree']);
  base = git(['rev-parse', 'HEAD']).trim();
  writeFileSync(at('repo', 'src', 'x.astro'), 'x\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: x (#1)']);
  head = git(['rev-parse', 'HEAD']).trim();
  writeRelease();
  writeFileSync(at('listing.json'), JSON.stringify(REPORT));
  mkdirSync(at('evidence'));
  writeFileSync(at('evidence', EVIDENCE_REPORT), JSON.stringify(REPORT));
  writeFileSync(
    at('evidence', EVIDENCE_MANIFEST),
    `${JSON.stringify(MANIFEST_ROW)}\n`,
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Every request the stand-in GitHub API received, with its token. */
let asked: { url: string; authorization: string | undefined }[] = [];

/**
 * Run the script in the scratch checkout against a local stand-in for GitHub's
 * API that answers `devVerified` as the head's newest `dev-verified` status
 * (none when empty). The script asks GitHub itself, never `gh` (#1295).
 */
const run = async (args: string[], devVerified = '') => {
  asked = [];
  const statuses = devVerified
    ? [{ context: 'dev-verified', state: devVerified }]
    : [{ context: 'build-and-test', state: 'success' }];
  const server: Server = createServer((request, response) => {
    asked.push({
      url: request.url ?? '',
      authorization: request.headers.authorization,
    });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(statuses));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await new Promise<{ code: number; out: string; err: string }>(
      (resolve) => {
        execFile(
          process.execPath,
          [SCRIPT, ...args],
          {
            cwd: at('repo'),
            encoding: 'utf8',
            env: {
              PATH: '/bin:/usr/bin',
              GITHUB_API_URL: `http://127.0.0.1:${port}`,
              GITHUB_REPOSITORY: 'o/r',
              GITHUB_TOKEN: 'the-token',
            },
          },
          (error, out, err) =>
            resolve({
              code: error ? Number(error.code ?? 1) : 0,
              out,
              err,
            }),
        );
      },
    );
  } finally {
    server.close();
  }
};

const checkWith = (...against: string[]) =>
  run([
    '--release',
    at('release.json'),
    '--head',
    'HEAD',
    '--check',
    ...against,
  ]);
const check = () => checkWith('--manifest', at('evidence', EVIDENCE_MANIFEST));
const build = (devVerified: string) =>
  run(
    [
      '--release',
      at('release.json'),
      '--head',
      'HEAD',
      '--evidence',
      at('evidence'),
      '--out',
      at('content.json'),
    ],
    devVerified,
  );

describe('build-release-content.mjs --check (#362)', () => {
  it('says the release file holds for the head, and asks GitHub nothing', async () => {
    const { code, out, err } = await check();
    expect(err).toBe('');
    expect(out).toBe(
      `build-release-content: ${at('release.json')} holds for ${head}: every cited journey captured in ${at('evidence', EVIDENCE_MANIFEST)}\n`,
    );
    expect(code).toBe(0);
    expect(asked).toEqual([]);
  });

  it('refuses a release file that leaves the head unclassified', async () => {
    writeRelease({ entries: {} });
    const { code, err } = await check();
    expect(err).toContain(`${head} (feat: x (#1)) is unclassified`);
    expect(code).toBe(1);
  });

  it('refuses a release file with no headline, before it reads anything else', async () => {
    writeRelease({ headline: undefined });
    const { code, err } = await check();
    expect(err).toContain('release file: headline is not words');
    expect(code).toBe(1);
  });

  it('asks for a manifest or a listing, as usage', async () => {
    const { code, err } = await run([
      '--release',
      at('release.json'),
      '--head',
      'HEAD',
      '--check',
    ]);
    expect(err).toContain('usage: build-release-content.mjs');
    expect(code).toBe(2);
  });

  it('names every cited title the capture never recorded, each with its entry', async () => {
    writeRelease({
      entries: {
        [head]: {
          kind: 'visible',
          journeys: [TITLE, 'a describe > no picture', 'a describe > none'],
        },
      },
    });
    const { code, out, err } = await check();
    expect(out).toBe('');
    expect(err).toContain('2 cited titles are not journeys of this run');
    expect(err).toContain(
      `"a describe > no picture", cited by ${head}, is not a journey of this run`,
    );
    expect(err).toContain(
      `"a describe > none", cited by ${head}, is not a journey of this run`,
    );
    expect(code).toBe(1);
  });

  it("refuses a manifest with no report beside it, which cannot tell this run's rows", async () => {
    rmSync(at('evidence', EVIDENCE_REPORT));
    const { code, err } = await check();
    expect(err).toContain(EVIDENCE_REPORT);
    expect(code).toBe(1);
  });

  it('refuses a listing alone, saying it proves a title runs, not that it captures', async () => {
    const { code, out, err } = await checkWith('--listing', at('listing.json'));
    expect(out).toBe('');
    expect(err).toContain(LISTING_CAVEAT);
    expect(err).toContain('--listing-only');
    expect(code).toBe(2);
  });

  it('runs the listing-only check when asked for by name, and says what it proves', async () => {
    const { code, out, err } = await checkWith(
      '--listing',
      at('listing.json'),
      '--listing-only',
    );
    expect(err).toBe('');
    expect(out).toBe(
      `build-release-content: ${at('release.json')} holds for ${head}, as a listing: ${LISTING_CAVEAT}\n`,
    );
    expect(code).toBe(0);
  });

  it('names an option it does not know, and refuses', async () => {
    const { code, err } = await run(['--check', '--bogus']);
    expect(err).toContain("build-release-content: Unknown option '--bogus'");
    expect(err).toContain('usage: build-release-content.mjs');
    expect(code).toBe(2);
  });
});

describe('build-release-content.mjs building (#362)', () => {
  it("writes the page's content once dev-verified reads success", async () => {
    const { code, out, err } = await build('success');
    expect(err).toBe('');
    expect(out).toBe(`build-release-content: wrote ${at('content.json')}\n`);
    expect(code).toBe(0);
    expect(asked).toEqual([
      {
        url: `/repos/o/r/commits/${head}/statuses?per_page=100`,
        authorization: 'Bearer the-token',
      },
    ]);
    const content = JSON.parse(readFileSync(at('content.json'), 'utf8'));
    expect(content).toMatchObject({
      title: 'The headline',
      eyebrow: `Release ${base.slice(0, 7)} → ${head.slice(0, 7)}`,
      headline: 'The headline',
      lede: 'The lede',
      signoffKey: `release-${head.slice(0, 7)}`,
    });
    expect(content.sections.map((s: { heading: string }) => s.heading)).toEqual(
      ['What changes for a visitor', 'Everything else in the release'],
    );
  });

  it.each([
    ['no dev-verified at all', '', 'dev-verified=absent'],
    ['a failed dev-verified', 'failure', 'dev-verified=failure'],
  ])('refuses %s, and writes nothing', async (_, answer, says) => {
    const { code, err } = await build(answer);
    expect(err).toContain(`${head} reads ${says};`);
    expect(code).toBe(1);
    expect(() => readFileSync(at('content.json'))).toThrow(/ENOENT/);
  });
});
