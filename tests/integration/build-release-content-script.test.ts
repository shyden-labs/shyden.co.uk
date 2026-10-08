import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EVIDENCE_MANIFEST,
  EVIDENCE_REPORT,
} from '../../scripts/evidence-files.mjs';
import { scratchGit } from '../git-env';
import { GH_STAND_IN, ghCalledWith } from '../gh-stand-in';

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
  dir = mkdtempSync(path.join(tmpdir(), 'release-content-'));
  mkdirSync(at('bin'));
  writeFileSync(at('bin', 'gh'), GH_STAND_IN);
  chmodSync(at('bin', 'gh'), 0o755);
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

/** Run the script in the scratch checkout, `gh` answering `devVerified`. */
const run = (args: string[], devVerified = '') => {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: at('repo'),
    encoding: 'utf8',
    env: {
      PATH: `${at('bin')}:/bin:/usr/bin`,
      GH_ARGS: at('gh-args'),
      GH_OUT: devVerified,
    },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
};

const check = () =>
  run([
    '--release',
    at('release.json'),
    '--head',
    'HEAD',
    '--check',
    '--listing',
    at('listing.json'),
  ]);
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
  it('says the release file holds for the head, and asks gh nothing', () => {
    const { code, out, err } = check();
    expect(err).toBe('');
    expect(out).toBe(
      `build-release-content: ${at('release.json')} holds for ${head}\n`,
    );
    expect(code).toBe(0);
    expect(ghCalledWith(at('gh-args'))).toBeNull();
  });

  it('refuses a release file that leaves the head unclassified', () => {
    writeRelease({ entries: {} });
    const { code, err } = check();
    expect(err).toContain(`${head} (feat: x (#1)) is unclassified`);
    expect(code).toBe(1);
  });

  it('refuses a release file with no headline, before it reads anything else', () => {
    writeRelease({ headline: undefined });
    const { code, err } = check();
    expect(err).toContain('release file: headline is not words');
    expect(code).toBe(1);
  });

  it('asks for a listing, as usage', () => {
    const { code, err } = run([
      '--release',
      at('release.json'),
      '--head',
      'HEAD',
      '--check',
    ]);
    expect(err).toContain('usage: build-release-content.mjs');
    expect(code).toBe(2);
  });

  it('names an option it does not know, and refuses', () => {
    const { code, err } = run(['--check', '--bogus']);
    expect(err).toContain("build-release-content: Unknown option '--bogus'");
    expect(err).toContain('usage: build-release-content.mjs');
    expect(code).toBe(2);
  });
});

describe('build-release-content.mjs building (#362)', () => {
  it("writes the page's content once dev-verified reads success", () => {
    const { code, out, err } = build('success');
    expect(err).toBe('');
    expect(out).toBe(`build-release-content: wrote ${at('content.json')}\n`);
    expect(code).toBe(0);
    expect(ghCalledWith(at('gh-args'))).toEqual([
      'api',
      `repos/{owner}/{repo}/commits/${head}/statuses`,
      '--jq',
      '[.[] | select(.context == "dev-verified")][0].state // ""',
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
  ])('refuses %s, and writes nothing', (_, answer, says) => {
    const { code, err } = build(answer);
    expect(err).toContain(`${head} reads ${says};`);
    expect(code).toBe(1);
    expect(() => readFileSync(at('content.json'))).toThrow(/ENOENT/);
  });
});
