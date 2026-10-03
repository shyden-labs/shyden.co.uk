import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { closingKeywordOffences } from '../../scripts/closing-keywords.mjs';
import {
  LABEL,
  MAX_PNG_BYTES,
  buildManifest,
  commentBody,
  commitMessage,
  dispatchable,
  failedBaselines,
  gateAgrees,
  lockRequired,
  qualify,
  testsIn,
  validateArtifact,
} from '../../scripts/visual-rebaseline.mjs';

/**
 * The visual rebaseline (#459) and the decisions it makes. Fixtures are
 * written here, never imported from the code under test.
 */

/**
 * #26's real lockfile entries (c6af312, @playwright/test 1.61.1 to 1.63.0),
 * copied verbatim. The bump changed the root devDependency, these three
 * entries, and REMOVED `node_modules/playwright/node_modules/fsevents`, so a
 * rule naming only the three entries would have refused the one real
 * Playwright update this repository has had.
 */
const PLAYWRIGHT_ENTRIES = {
  '1.61.1': {
    'node_modules/@playwright/test': {
      version: '1.61.1',
      resolved: 'https://registry.npmjs.org/@playwright/test/-/test-1.61.1.tgz',
      integrity:
        'sha512-8nKv6+0RJSL9FE4jYOEGXnPeM/Hg12qZpmqzZjRh3qM0Y7c3z1mrOTfFLids72RDQYVh9WpLEfR5WdpNX4fkig==',
      dev: true,
      license: 'Apache-2.0',
      dependencies: { playwright: '1.61.1' },
      bin: { playwright: 'cli.js' },
      engines: { node: '>=18' },
    },
    'node_modules/playwright': {
      version: '1.61.1',
      resolved: 'https://registry.npmjs.org/playwright/-/playwright-1.61.1.tgz',
      integrity:
        'sha512-DWnY5o3YbLWK4GovuAVwpqL+1VwGNdUGrRr++8j8PtQQzvAVZUIMjKQ90fY689sEJZJBbZVw1rXaOKSTitkzPQ==',
      dev: true,
      license: 'Apache-2.0',
      dependencies: { 'playwright-core': '1.61.1' },
      bin: { playwright: 'cli.js' },
      engines: { node: '>=18' },
      optionalDependencies: { fsevents: '2.3.2' },
    },
    'node_modules/playwright/node_modules/fsevents': {
      version: '2.3.2',
      resolved: 'https://registry.npmjs.org/fsevents/-/fsevents-2.3.2.tgz',
      integrity:
        'sha512-xiqMQR4xAeHTuB9uWm+fFRcIOgKBMiOBP+eXiyT7jsgVCq1bkVygt00oASowB7EdtpOHaaPgKt812P9ab+DDKA==',
      dev: true,
      hasInstallScript: true,
      license: 'MIT',
      optional: true,
      os: ['darwin'],
      engines: { node: '^8.16.0 || ^10.6.0 || >=11.0.0' },
    },
    'node_modules/playwright-core': {
      version: '1.61.1',
      resolved:
        'https://registry.npmjs.org/playwright-core/-/playwright-core-1.61.1.tgz',
      integrity:
        'sha512-h7Qlt6m4REp25qvIdvbDtVmD4LqVXfpRxhORv9L0jzETM05p4fuPJ3dKyuSXQxDSbXnmS79HAgi9589lGSpLkg==',
      dev: true,
      license: 'Apache-2.0',
      bin: { 'playwright-core': 'cli.js' },
      engines: { node: '>=18' },
    },
  },
  '1.63.0': {
    'node_modules/@playwright/test': {
      version: '1.63.0',
      resolved: 'https://registry.npmjs.org/@playwright/test/-/test-1.63.0.tgz',
      integrity:
        'sha512-oxMK4vllB9RK5NQ2l1pq1IfOf2AvnEuj/vYGDj0H2nMtmtZpKtCwt/l00GEO6xjGfpBNAvjovvYdCm50dRQkpQ==',
      dev: true,
      license: 'Apache-2.0',
      dependencies: { playwright: '1.63.0' },
      bin: { playwright: 'cli.js' },
      engines: { node: '>=20' },
    },
    'node_modules/playwright': {
      version: '1.63.0',
      resolved: 'https://registry.npmjs.org/playwright/-/playwright-1.63.0.tgz',
      integrity:
        'sha512-+7ziBLidS4NaNCdt57SUDT+wYmmd5fmiQejUic/kb+YsYSCPyOOE9sebzMjNmQrsnNpDJqd4WHvV/8lfKfUDUg==',
      dev: true,
      license: 'Apache-2.0',
      dependencies: { 'playwright-core': '1.63.0' },
      bin: { playwright: 'cli.js' },
      engines: { node: '>=20' },
    },
    'node_modules/playwright-core': {
      version: '1.63.0',
      resolved:
        'https://registry.npmjs.org/playwright-core/-/playwright-core-1.63.0.tgz',
      integrity:
        'sha512-rYCsBF/M5HjUch52bbtVONEFjv6Xu8sm8h72dNlR5bzIE1fvC/bxgspzkjSfU+MweEMmPM8KJebG6nnyxo5mCg==',
      dev: true,
      license: 'Apache-2.0',
      bin: { 'playwright-core': 'cli.js' },
      engines: { node: '>=20' },
    },
  },
} as const;

type Release = keyof typeof PLAYWRIGHT_ENTRIES;

const npmEntry = (name: string, version: string) => ({
  version,
  resolved: `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`,
  integrity: `sha512-${name}-${version}`,
  dev: true,
  license: 'MIT',
});

interface LockChange {
  readonly astro?: string;
  readonly root?: Record<string, string>;
  readonly extra?: Record<string, unknown>;
  readonly top?: Record<string, unknown>;
}

/** A lockfile shaped like this repository's. */
const lockAt = (playwright: Release, change: LockChange = {}) =>
  JSON.stringify(
    {
      name: 'shyden-co-uk',
      version: '0.1.0',
      lockfileVersion: 3,
      requires: true,
      ...change.top,
      packages: {
        '': {
          name: 'shyden-co-uk',
          version: '0.1.0',
          dependencies: { astro: `^${change.astro ?? '7.3.5'}` },
          devDependencies: {
            '@playwright/test': `^${playwright}`,
            ...change.root,
          },
        },
        'node_modules/astro': npmEntry('astro', change.astro ?? '7.3.5'),
        ...PLAYWRIGHT_ENTRIES[playwright],
        ...change.extra,
      },
    },
    null,
    2,
  );

const pkgAt = (
  playwright: Release,
  change: { astro?: string; build?: string } = {},
) =>
  JSON.stringify(
    {
      name: 'shyden-co-uk',
      version: '0.1.0',
      scripts: { build: change.build ?? 'astro build' },
      dependencies: { astro: `^${change.astro ?? '7.3.5'}` },
      devDependencies: { '@playwright/test': `^${playwright}` },
    },
    null,
    2,
  );

const dockerfileAt = (version: string, comment = '# The image CI runs.') =>
  `${comment}\nFROM mcr.microsoft.com/playwright:v${version}-noble@sha256:${'a'.repeat(64)}\n`;

const OLD = {
  lock: lockAt('1.61.1'),
  pkg: pkgAt('1.61.1'),
  dockerfile: dockerfileAt('1.61.1'),
};
const NEW = {
  lock: lockAt('1.63.0'),
  pkg: pkgAt('1.63.0'),
  dockerfile: dockerfileAt('1.61.1'),
};
const REPO = 'shyden-labs/shyden.co.uk';

/** #26 as a pull request: Dependabot's, level, the lockfile and package.json. */
const pr = (change: Partial<Parameters<typeof qualify>[0]> = {}) => ({
  author: 'dependabot[bot]',
  headRepo: REPO,
  baseRepo: REPO,
  files: ['package-lock.json', 'package.json'],
  changedFiles: 2,
  behindBy: 0,
  base: OLD,
  head: NEW,
  ...change,
});

const reasonOf = (verdict: ReturnType<typeof qualify>) =>
  verdict.qualifies ? '(it qualified)' : verdict.reason;

describe('qualify: a Playwright update and nothing else (#459)', () => {
  it('qualifies #26, the real bump, nested fsevents removed', () => {
    expect(qualify(pr())).toEqual({
      qualifies: true,
      versions:
        '@playwright/test 1.61.1 → 1.63.0, playwright 1.61.1 → 1.63.0, ' +
        'playwright-core 1.61.1 → 1.63.0',
    });
  });

  it('qualifies a bump that also brings the Dockerfile pin level', () => {
    const verdict = qualify(
      pr({
        files: [
          'docker/playwright/Dockerfile',
          'package-lock.json',
          'package.json',
        ],
        changedFiles: 3,
        head: { ...NEW, dockerfile: dockerfileAt('1.63.0') },
      }),
    );
    expect(verdict.qualifies).toBe(true);
  });

  it('qualifies a downgrade, the move the end-to-end proof makes', () => {
    expect(qualify(pr({ base: NEW, head: OLD }))).toEqual({
      qualifies: true,
      versions:
        '@playwright/test 1.63.0 → 1.61.1, playwright 1.63.0 → 1.61.1, ' +
        'playwright-core 1.63.0 → 1.61.1',
    });
  });

  it('refuses a pull request a person opened', () => {
    expect(reasonOf(qualify(pr({ author: 'ShydenMcM' })))).toBe(
      'opened by ShydenMcM, not dependabot[bot]',
    );
  });

  it('refuses a fork', () => {
    expect(reasonOf(qualify(pr({ headRepo: 'someone/shyden.co.uk' })))).toBe(
      'the head is someone/shyden.co.uk, not shyden-labs/shyden.co.uk',
    );
  });

  it('throws on a truncated file list rather than answering', () => {
    expect(() => qualify(pr({ changedFiles: 3 }))).toThrow(
      'the file list holds 2 of 3 changed files, so it is truncated',
    );
  });

  for (const path of [
    'src/pages/index.astro',
    'tests/e2e/__screenshots__/home-linux.png',
    '.github/workflows/ci.yml',
    'package-lock.json.orig',
  ])
    it(`refuses a pull request that also changes ${path}`, () => {
      expect(
        reasonOf(
          qualify(
            pr({
              files: ['package-lock.json', 'package.json', path],
              changedFiles: 3,
            }),
          ),
        ),
      ).toBe(`it changes more than dependencies: ${path}`);
    });

  it('refuses a rename into package.json, recorded as old → new', () => {
    expect(
      reasonOf(
        qualify(
          pr({ files: ['package-lock.json', 'docs/x.json → package.json'] }),
        ),
      ),
    ).toBe('it changes more than dependencies: docs/x.json → package.json');
  });

  it('refuses a head behind its base', () => {
    expect(reasonOf(qualify(pr({ behindBy: 2 })))).toBe(
      'it is 2 commit(s) behind its base; bringing it level runs this again',
    );
  });

  it('refuses Playwright grouped with Astro', () => {
    const head = {
      ...NEW,
      lock: lockAt('1.63.0', { astro: '7.4.0' }),
      pkg: pkgAt('1.63.0', { astro: '7.4.0' }),
    };
    expect(reasonOf(qualify(pr({ head })))).toBe(
      "package-lock.json's root entry changes more than @playwright/test",
    );
  });

  it('refuses Playwright grouped with a font', () => {
    const font = (version: string) => ({
      'node_modules/@fontsource-variable/instrument-sans': npmEntry(
        '@fontsource-variable/instrument-sans',
        version,
      ),
    });
    const base = { ...OLD, lock: lockAt('1.61.1', { extra: font('5.3.0') }) };
    const head = { ...NEW, lock: lockAt('1.63.0', { extra: font('5.2.4') }) };
    expect(reasonOf(qualify(pr({ base, head })))).toBe(
      "package-lock.json changes node_modules/@fontsource-variable/instrument-sans, outside Playwright's tree",
    );
  });

  it("refuses a package added outside Playwright's tree", () => {
    const head = {
      ...NEW,
      lock: lockAt('1.63.0', {
        extra: { 'node_modules/left-pad': npmEntry('left-pad', '1.3.0') },
      }),
    };
    expect(reasonOf(qualify(pr({ head })))).toBe(
      "package-lock.json changes node_modules/left-pad, outside Playwright's tree",
    );
  });

  it("refuses a package removed outside Playwright's tree", () => {
    const base = {
      ...OLD,
      lock: lockAt('1.61.1', {
        extra: { 'node_modules/left-pad': npmEntry('left-pad', '1.3.0') },
      }),
    };
    expect(reasonOf(qualify(pr({ base })))).toBe(
      "package-lock.json changes node_modules/left-pad, outside Playwright's tree",
    );
  });

  it("refuses a package nested in another package's tree", () => {
    const head = {
      ...NEW,
      lock: lockAt('1.63.0', {
        extra: {
          'node_modules/astro/node_modules/fsevents': npmEntry(
            'fsevents',
            '2.3.3',
          ),
        },
      }),
    };
    expect(reasonOf(qualify(pr({ head })))).toBe(
      "package-lock.json changes node_modules/astro/node_modules/fsevents, outside Playwright's tree",
    );
  });

  it('refuses a lookalike of a Playwright entry', () => {
    const head = {
      ...NEW,
      lock: lockAt('1.63.0', {
        extra: {
          'node_modules/playwright-extra': npmEntry(
            'playwright-extra',
            '4.3.6',
          ),
        },
      }),
    };
    expect(reasonOf(qualify(pr({ head })))).toBe(
      "package-lock.json changes node_modules/playwright-extra, outside Playwright's tree",
    );
  });

  it('refuses a root-entry change besides @playwright/test', () => {
    const head = {
      ...NEW,
      lock: lockAt('1.63.0', { root: { vitest: '^5.0.2' } }),
    };
    expect(reasonOf(qualify(pr({ head })))).toBe(
      "package-lock.json's root entry changes more than @playwright/test",
    );
  });

  it('refuses a lockfile change outside its packages', () => {
    const head = {
      ...NEW,
      lock: lockAt('1.63.0', { top: { lockfileVersion: 4 } }),
    };
    expect(reasonOf(qualify(pr({ head })))).toBe(
      'package-lock.json changes outside its packages',
    );
  });

  it('refuses a package.json change besides @playwright/test', () => {
    const head = {
      ...NEW,
      pkg: pkgAt('1.63.0', { build: 'astro build && true' }),
    };
    expect(reasonOf(qualify(pr({ head })))).toBe(
      'package.json changes more than @playwright/test',
    );
  });

  it('refuses a Dockerfile change besides its FROM pin', () => {
    const verdict = qualify(
      pr({
        files: [
          'docker/playwright/Dockerfile',
          'package-lock.json',
          'package.json',
        ],
        changedFiles: 3,
        head: { ...NEW, dockerfile: dockerfileAt('1.63.0', '# Edited.') },
      }),
    );
    expect(reasonOf(verdict)).toBe(
      'docker/playwright/Dockerfile changes more than its FROM pin',
    );
  });

  it('refuses a Dockerfile-only pull request: no Playwright version moved', () => {
    const verdict = qualify(
      pr({
        files: ['docker/playwright/Dockerfile'],
        changedFiles: 1,
        head: { ...OLD, dockerfile: dockerfileAt('1.63.0') },
      }),
    );
    expect(reasonOf(verdict)).toBe('no Playwright version moved');
  });
});

/**
 * Results shaped as Playwright 1.63.0's JSON reporter writes them, measured
 * on 2026-10-03: a failed `toHaveScreenshot` attaches `<name>-expected.png`
 * at the COMMITTED baseline's own path, plus `-actual` and `-diff`; a missing
 * baseline attaches neither; messages carry ANSI colour.
 */
const ROOT = '/__w/shyden.co.uk/shyden.co.uk';
const ESC = String.fromCharCode(27);
const coloured = (text: string) => `${ESC}[31m${text}${ESC}[39m`;
const baselineOf = (name: string) =>
  `tests/e2e/__screenshots__/${name}-linux.png`;

const passed = () => ({ status: 'passed', errors: [], attachments: [] });
const pixelFailure = (
  name: string,
  detail = '1234 pixels (ratio 0.01 of all image pixels) are different.',
) => ({
  status: 'failed',
  errors: [
    {
      message: `Error: expect(page).${coloured('toHaveScreenshot')}(expected) failed\n\n  ${detail}\n\n  Snapshot: ${name}.png`,
    },
  ],
  attachments: [
    {
      name: `${name}-expected.png`,
      contentType: 'image/png',
      path: `${ROOT}/${baselineOf(name)}`,
    },
    {
      name: `${name}-actual.png`,
      contentType: 'image/png',
      path: `${ROOT}/test-results/v/${name}-actual.png`,
    },
    {
      name: `${name}-diff.png`,
      contentType: 'image/png',
      path: `${ROOT}/test-results/v/${name}-diff.png`,
    },
    {
      name: 'error-context',
      contentType: 'text/markdown',
      path: `${ROOT}/test-results/v/error-context.md`,
    },
  ],
});
const missingBaseline = (name: string) => ({
  status: 'failed',
  errors: [
    {
      message: `Error: A snapshot doesn't exist at ${ROOT}/${baselineOf(name)}.\n\n> 16 |   await expect(page).toHaveScreenshot('${name}.png');`,
    },
  ],
  attachments: [
    {
      name: 'error-context',
      contentType: 'text/markdown',
      path: `${ROOT}/test-results/v/error-context.md`,
    },
  ],
});
const ordinaryFailure = () => ({
  status: 'failed',
  errors: [
    {
      message:
        'Error: expect(locator).toHaveText(expected) failed\n\nExpected: "y"',
    },
  ],
  attachments: [],
});

/** A report whose tests sit inside a file suite and a describe suite, as Playwright nests them. */
const reportOf = (
  results: readonly unknown[],
  errors: readonly unknown[] = [],
) => ({
  suites: [
    {
      title: 'visual.spec.ts',
      specs: [],
      suites: [
        {
          title: 'visual',
          specs: results.map((result, index) => ({
            title: `case ${index}`,
            tests: [{ results: [result] }],
          })),
        },
      ],
    },
  ],
  errors,
});

describe('failedBaselines: the gate failed on pixels alone, or the run refuses (#459)', () => {
  it('counts tests nested inside describe suites', () => {
    expect(testsIn(reportOf([passed(), passed(), passed()]))).toHaveLength(3);
  });

  it('finds nothing to rebaseline when the gate passed', () => {
    expect(failedBaselines(reportOf([passed(), passed()]), 2, ROOT)).toEqual(
      [],
    );
  });

  it('names the committed baseline and pixel count of a screenshot failure', () => {
    expect(
      failedBaselines(
        reportOf([passed(), pixelFailure('home-mobile')]),
        2,
        ROOT,
      ),
    ).toEqual([{ path: baselineOf('home-mobile'), pixels: 1234 }]);
  });

  it('counts a page that changed height as a screenshot failure', () => {
    const resized = pixelFailure(
      'home',
      'Expected an image 1280px by 800px, received 1280px by 820px. 8000 pixels (ratio 0.29 of all image pixels) are different.',
    );
    expect(failedBaselines(reportOf([resized]), 1, ROOT)).toEqual([
      { path: baselineOf('home'), pixels: 8000 },
    ]);
  });

  it('keeps a screenshot failure whose message gives no count, with no count', () => {
    const reworded = pixelFailure('home', 'The images differ.');
    expect(failedBaselines(reportOf([reworded]), 1, ROOT)).toEqual([
      { path: baselineOf('home'), pixels: null },
    ]);
  });

  it('refuses a missing baseline', () => {
    expect(() =>
      failedBaselines(reportOf([missingBaseline('home')]), 1, ROOT),
    ).toThrow(
      "case 0 failed on something besides one screenshot comparison: Error: A snapshot doesn't exist",
    );
  });

  it('refuses an ordinary assertion failure', () => {
    expect(() =>
      failedBaselines(reportOf([ordinaryFailure()]), 1, ROOT),
    ).toThrow(
      'case 0 failed on something besides one screenshot comparison: Error: expect(locator).toHaveText(expected) failed',
    );
  });

  it('refuses a test that made two screenshot comparisons', () => {
    const one = pixelFailure('home');
    const other = pixelFailure('menu');
    const both = {
      ...one,
      errors: [...one.errors, ...other.errors],
      attachments: [...one.attachments, ...other.attachments],
    };
    expect(() => failedBaselines(reportOf([both]), 1, ROOT)).toThrow(
      'case 0 failed on something besides one screenshot comparison',
    );
  });

  it('refuses a run with a screenshot failure beside an ordinary one', () => {
    expect(() =>
      failedBaselines(
        reportOf([pixelFailure('home'), ordinaryFailure()]),
        2,
        ROOT,
      ),
    ).toThrow('case 1 failed on something besides one screenshot comparison');
  });

  for (const status of ['timedOut', 'skipped', 'interrupted'])
    it(`refuses a test that ended ${status}`, () => {
      expect(() =>
        failedBaselines(reportOf([{ ...passed(), status }]), 1, ROOT),
      ).toThrow(`case 0 ended ${status}`);
    });

  it('refuses a test that ran twice', () => {
    const report = reportOf([passed()]);
    report.suites[0].suites[0].specs[0].tests[0].results.push(passed());
    expect(() => failedBaselines(report, 1, ROOT)).toThrow(
      'case 0 has 2 results, and the gate runs each test once',
    );
  });

  it('refuses a report that holds fewer tests than the listing', () => {
    expect(() => failedBaselines(reportOf([passed()]), 2, ROOT)).toThrow(
      'the report holds 1 tests and the listing 2',
    );
  });

  it('refuses an empty listing, which would make an empty report agree', () => {
    expect(() => failedBaselines(reportOf([]), 0, ROOT)).toThrow(
      'the listing holds no visual tests',
    );
  });

  it('refuses an error outside any test', () => {
    expect(() =>
      failedBaselines(
        reportOf(
          [passed()],
          [{ message: `${coloured('Error')}: config failed\nat x` }],
        ),
        1,
        ROOT,
      ),
    ).toThrow('the run failed outside any test: Error: config failed');
  });

  it('refuses an expected image with no diff beside it', () => {
    const failure = pixelFailure('home');
    failure.attachments = failure.attachments.filter(
      (a) => !a.name.endsWith('-diff.png'),
    );
    expect(() => failedBaselines(reportOf([failure]), 1, ROOT)).toThrow(
      'case 0: home has no diff image, so no comparison ran',
    );
  });

  it('refuses an expected image that is not a committed baseline', () => {
    const failure = pixelFailure('home');
    failure.attachments[0] = {
      ...failure.attachments[0],
      path: `${ROOT}/test-results/v/home-expected.png`,
    };
    expect(() => failedBaselines(reportOf([failure]), 1, ROOT)).toThrow(
      'case 0: test-results/v/home-expected.png is not a committed baseline',
    );
  });
});

describe("gateAgrees: the gate's exit and its report tell one story (#459)", () => {
  const one = [{ path: baselineOf('home'), pixels: 1 }];

  it('accepts a clean exit with no failure', () => {
    expect(() => gateAgrees(0, [])).not.toThrow();
  });

  it('accepts a red exit with failures', () => {
    expect(() => gateAgrees(1, one)).not.toThrow();
  });

  it('refuses a clean exit with failures', () => {
    expect(() => gateAgrees(0, one)).toThrow(
      'the gate exited 0 but its report holds 1 failed screenshot(s)',
    );
  });

  it('refuses a red exit with no failure in its report', () => {
    expect(() => gateAgrees(1, [])).toThrow(
      'the gate exited 1 with no failed screenshot in its report',
    );
  });
});

const hex = (content: Uint8Array) =>
  createHash('sha256').update(content).digest('hex');

describe('buildManifest: what the capture uploads (#459)', () => {
  const committed = Uint8Array.from([1, 2, 3]);
  const recaptured = Uint8Array.from([1, 2, 3, 4]);
  const failed = [
    { path: baselineOf('home'), pixels: 99, before: hex(committed) },
  ];

  it("records each recaptured file's hash, size and pixel count", () => {
    expect(
      buildManifest({
        pr: 42,
        headSha: 'c'.repeat(40),
        playwright: '1.58.2',
        failed,
        contentOf: () => recaptured,
      }),
    ).toEqual({
      pr: 42,
      headSha: 'c'.repeat(40),
      playwright: '1.58.2',
      files: [
        {
          path: baselineOf('home'),
          sha256: hex(recaptured),
          bytes: 4,
          pixels: 99,
        },
      ],
    });
  });

  it('refuses a baseline the recapture left unchanged', () => {
    expect(() =>
      buildManifest({
        pr: 42,
        headSha: 'c'.repeat(40),
        playwright: '1.58.2',
        failed,
        contentOf: () => committed,
      }),
    ).toThrow(
      `the gate failed ${baselineOf('home')}, and the recapture left it unchanged`,
    );
  });
});

const HEAD_SHA = 'c'.repeat(40);
const PATH_A = baselineOf('home-mobile');
const PATH_B = baselineOf('glory-points-desktop');
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (seed: number) => Uint8Array.from([...SIGNATURE, seed, seed + 1]);
const RUN = { pr: 42, headSha: HEAD_SHA };
const HEAD_PATHS = new Set([PATH_A, PATH_B, 'package.json']);

interface Staged {
  readonly path: string;
  readonly content: Uint8Array;
}
const STAGED: readonly Staged[] = [
  { path: PATH_A, content: png(1) },
  { path: PATH_B, content: png(2) },
];
const manifestFor = (files: readonly Staged[]) => ({
  pr: 42,
  headSha: HEAD_SHA,
  playwright: '1.58.2',
  files: files.map(({ path, content }) => ({
    path,
    sha256: hex(content),
    bytes: content.length,
    pixels: 10,
  })),
});
const DIRECTORIES = ['tests', 'tests/e2e', 'tests/e2e/__screenshots__'].map(
  (name) => ({ name, kind: 'directory' as const }),
);
const entriesFor = (manifest: unknown, files: readonly Staged[] = STAGED) => [
  {
    name: 'manifest.json',
    kind: 'file' as const,
    content: new TextEncoder().encode(
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    ),
  },
  ...DIRECTORIES,
  ...files.map(({ path, content }) => ({
    name: path,
    kind: 'file' as const,
    content,
  })),
];
/** Validate a manifest that differs from the good one by `change`. */
const withManifest = (change: Record<string, unknown>) => () =>
  validateArtifact({
    entries: entriesFor({ ...manifestFor(STAGED), ...change }),
    run: RUN,
    headPaths: HEAD_PATHS,
  });
/** Validate a manifest whose first file entry differs by `change`. */
const withFile = (change: Record<string, unknown>) => {
  const manifest = manifestFor(STAGED);
  manifest.files[0] = { ...manifest.files[0], ...change };
  return () =>
    validateArtifact({
      entries: entriesFor(manifest),
      run: RUN,
      headPaths: HEAD_PATHS,
    });
};

describe('validateArtifact: the commit trusts nothing it did not check (#459)', () => {
  it('yields the files of a well-formed artifact', () => {
    const { manifest, files } = validateArtifact({
      entries: entriesFor(manifestFor(STAGED)),
      run: RUN,
      headPaths: HEAD_PATHS,
    });
    expect(manifest.pr).toBe(42);
    expect(files.map(({ path }) => path)).toEqual([PATH_A, PATH_B]);
    expect(files[1].content).toEqual(png(2));
  });

  it('refuses a manifest that is not JSON', () => {
    expect(() =>
      validateArtifact({
        entries: entriesFor('{"pr":'),
        run: RUN,
        headPaths: HEAD_PATHS,
      }),
    ).toThrow('manifest.json is not JSON');
  });

  it('refuses a manifest with a key it does not document', () => {
    expect(withManifest({ extra: 1 })).toThrow(
      "manifest.json's keys are not exactly files, headSha, playwright, pr",
    );
  });

  it('refuses a manifest missing a key', () => {
    expect(withManifest({ playwright: undefined })).toThrow(
      "manifest.json's keys are not exactly files, headSha, playwright, pr",
    );
  });

  it('refuses a pull request number that is not a positive integer', () => {
    expect(withManifest({ pr: '42' })).toThrow(
      'manifest.json names no pull request number',
    );
  });

  it('refuses a head that is not 40 hex', () => {
    expect(withManifest({ headSha: 'C'.repeat(40) })).toThrow(
      'manifest.json names no head SHA',
    );
  });

  it('refuses a Playwright version that is not semver', () => {
    expect(withManifest({ playwright: '1.58.2<b>' })).toThrow(
      'manifest.json names no Playwright version',
    );
  });

  it('refuses a manifest for another pull request', () => {
    expect(withManifest({ pr: 43 })).toThrow(
      'manifest.json names #43, and the capture ran for #42',
    );
  });

  it('refuses a manifest for another head', () => {
    expect(withManifest({ headSha: 'd'.repeat(40) })).toThrow(
      `manifest.json names ${'d'.repeat(40)}, and the capture ran on ${HEAD_SHA}`,
    );
  });

  it('refuses a manifest that lists no file', () => {
    expect(withManifest({ files: [] })).toThrow('manifest.json lists no files');
  });

  it('refuses a file entry with a key it does not document', () => {
    expect(withFile({ mode: '100755' })).toThrow(
      "a file's keys are not exactly bytes, path, pixels, sha256",
    );
  });

  for (const path of [
    'tests/e2e/__screenshots__/../../../.github/workflows/ci.yml',
    'src/pages/index.astro',
    'tests/e2e/__screenshots__/home-darwin.png',
    'tests/e2e/__screenshots__/nested/home-linux.png',
    'tests/e2e/__screenshots__/..-linux.png',
  ])
    it(`refuses the path ${path}`, () => {
      expect(withFile({ path })).toThrow(
        `${JSON.stringify(path)} is not a baseline path`,
      );
    });

  it('quotes an artifact-derived string, so a newline cannot start a workflow command', () => {
    expect(withFile({ path: 'x\n::add-mask::y' })).toThrow(
      '"x\\n::add-mask::y" is not a baseline path',
    );
  });

  it('refuses a path listed twice', () => {
    const manifest = manifestFor(STAGED);
    manifest.files[1] = { ...manifest.files[0] };
    expect(() =>
      validateArtifact({
        entries: entriesFor(manifest),
        run: RUN,
        headPaths: HEAD_PATHS,
      }),
    ).toThrow(`${PATH_A} is listed twice`);
  });

  it('refuses a baseline the head does not hold, so a rebaseline adds no file', () => {
    expect(() =>
      validateArtifact({
        entries: entriesFor(manifestFor(STAGED)),
        run: RUN,
        headPaths: new Set([PATH_A]),
      }),
    ).toThrow(
      `${PATH_B} is not a baseline at the head, and a rebaseline adds no file`,
    );
  });

  it('refuses a malformed sha256', () => {
    expect(withFile({ sha256: 'f'.repeat(63) })).toThrow(
      `${PATH_A} has no sha256`,
    );
  });

  it('refuses a size over 2 MB', () => {
    expect(withFile({ bytes: MAX_PNG_BYTES + 1 })).toThrow(
      `${PATH_A} declares ${MAX_PNG_BYTES + 1} bytes, outside 1 to ${MAX_PNG_BYTES}`,
    );
  });

  it('refuses a negative pixel count', () => {
    expect(withFile({ pixels: -1 })).toThrow(
      `${PATH_A} has a pixel count of -1`,
    );
  });

  it('refuses a symlink, or anything that is not a file, even one with bytes', () => {
    // With content attached, the entry's kind is the only thing that can
    // refuse it: a walker that read through a link would hand over bytes.
    const entries = entriesFor(manifestFor(STAGED)).map((entry) =>
      entry.name === PATH_A
        ? { name: PATH_A, kind: 'other' as const, content: STAGED[0].content }
        : entry,
    );
    expect(() =>
      validateArtifact({ entries, run: RUN, headPaths: HEAD_PATHS }),
    ).toThrow(
      `the artifact holds other ${JSON.stringify(PATH_A)}, which the manifest does not list`,
    );
  });

  it('refuses a file the manifest does not list', () => {
    const extra = baselineOf('extra');
    const entries = [
      ...entriesFor(manifestFor(STAGED)),
      { name: extra, kind: 'file' as const, content: png(9) },
    ];
    expect(() =>
      validateArtifact({ entries, run: RUN, headPaths: HEAD_PATHS }),
    ).toThrow(
      `the artifact holds file ${JSON.stringify(extra)}, which the manifest does not list`,
    );
  });

  it('refuses a directory no listed file needs', () => {
    const entries = [
      ...entriesFor(manifestFor(STAGED)),
      { name: '.github', kind: 'directory' as const },
    ];
    expect(() =>
      validateArtifact({ entries, run: RUN, headPaths: HEAD_PATHS }),
    ).toThrow(
      'the artifact holds directory ".github", which the manifest does not list',
    );
  });

  it('refuses a listed file the artifact lacks', () => {
    const entries = entriesFor(manifestFor(STAGED), [STAGED[0]]);
    expect(() =>
      validateArtifact({ entries, run: RUN, headPaths: HEAD_PATHS }),
    ).toThrow(`the artifact is missing ${PATH_B}`);
  });

  it('refuses a file without the PNG signature', () => {
    const gif = {
      path: PATH_A,
      content: new TextEncoder().encode('GIF89a....'),
    };
    const files = [gif, STAGED[1]];
    expect(() =>
      validateArtifact({
        entries: entriesFor(manifestFor(files), files),
        run: RUN,
        headPaths: HEAD_PATHS,
      }),
    ).toThrow(`${PATH_A} is not a PNG`);
  });

  it('refuses a file whose size differs from the manifest', () => {
    expect(withFile({ bytes: 11 })).toThrow(
      `${PATH_A} holds 10 bytes, and the manifest says 11`,
    );
  });

  it('refuses a file whose hash differs from the manifest', () => {
    expect(withFile({ sha256: 'f'.repeat(64) })).toThrow(
      `${PATH_A} does not hash to its manifest entry`,
    );
  });
});

describe('dispatchable: a commit there could start CI (#459)', () => {
  it('accepts a mapping that holds workflow_dispatch', () => {
    expect(
      dispatchable(parse('on:\n  pull_request:\n  workflow_dispatch:\n')),
    ).toBe(true);
  });

  it('refuses a mapping without it', () => {
    expect(
      dispatchable(parse('on:\n  pull_request:\n  workflow_call:\n')),
    ).toBe(false);
  });

  it('refuses a trigger that is only commented out', () => {
    expect(
      dispatchable(parse('on:\n  pull_request:\n  # workflow_dispatch:\n')),
    ).toBe(false);
  });

  it('accepts the string form', () => {
    expect(dispatchable(parse('on: workflow_dispatch\n'))).toBe(true);
  });

  it('accepts the list form', () => {
    expect(dispatchable(parse('on: [pull_request, workflow_dispatch]\n'))).toBe(
      true,
    );
  });
});

describe('what the commit writes (#459)', () => {
  const manifest = {
    ...manifestFor(STAGED),
    files: manifestFor(STAGED).files.map((file, index) => ({
      ...file,
      pixels: index === 0 ? 1234 : null,
    })),
  };

  it('comments with each baseline, its count, the version, the commit and the review ask', () => {
    expect(commentBody(manifest, 'e'.repeat(40))).toBe(
      [
        'Rebaselined automatically (#459). `operator-review` holds the merge until the operator approves the PNG diff at this head.',
        '',
        `Playwright 1.58.2, commit ${'e'.repeat(40)}.`,
        '',
        '| Baseline | Differing pixels at the gate |',
        '| --- | --- |',
        `| \`${PATH_A}\` | 1234 |`,
        `| \`${PATH_B}\` | not reported |`,
        '',
        `Labelled \`${LABEL}\`.`,
      ].join('\n'),
    );
  });

  it('commits with a message that references #459 and closes nothing', () => {
    const message = commitMessage(manifest);
    expect(message.split('\n')[0]).toBe(
      'Rebaseline 2 screenshot(s) for Playwright 1.58.2 (Refs #459)',
    );
    expect(message).toContain(`- ${PATH_A} (1234 px)`);
    expect(message).toContain(`- ${PATH_B} (count not reported)`);
    expect(closingKeywordOffences(message)).toEqual([]);
  });
});

/** `GET /branches/develop`, as a contents: read token read it (run 37112752013). */
const branchRequiring = (contexts: string[], checks: string[] = contexts) => ({
  name: 'develop',
  protected: true,
  protection: {
    enabled: true,
    required_status_checks: {
      enforcement_level: 'everyone',
      contexts,
      checks: checks.map((context) => ({ context, app_id: null })),
    },
  },
});

const MEASURED = ['build-and-test', 'visual', 'closing-keywords'];

describe('lockRequired: nothing commits until develop requires the lock (#459)', () => {
  it('reads it from contexts', () => {
    expect(
      lockRequired(branchRequiring([...MEASURED, 'operator-review'], MEASURED)),
    ).toBe(true);
  });

  it('reads it from checks alone', () => {
    expect(
      lockRequired(branchRequiring(MEASURED, [...MEASURED, 'operator-review'])),
    ).toBe(true);
  });

  it('refuses the branch as measured, which names it nowhere', () => {
    expect(lockRequired(branchRequiring(MEASURED))).toBe(false);
  });

  it('refuses a name that only begins like it', () => {
    expect(lockRequired(branchRequiring(['operator-review-old']))).toBe(false);
  });

  it('refuses a branch with protection off', () => {
    expect(
      lockRequired({
        name: 'develop',
        protected: false,
        protection: {
          enabled: false,
          required_status_checks: {
            enforcement_level: 'off',
            contexts: [],
            checks: [],
          },
        },
      }),
    ).toBe(false);
  });

  it('refuses a reply with no protection at all', () => {
    expect(lockRequired({ name: 'develop', protected: false })).toBe(false);
  });
});
