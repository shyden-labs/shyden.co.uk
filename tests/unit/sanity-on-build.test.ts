import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { relative } from 'node:path';
import { searched, specFilesUnder } from '../source-files';

/**
 * A pull request runs the deployed-site suites against its own build (#335).
 *
 * `tests/dev` and `tests/prod` used to run only after a deploy, so a stale
 * fact in either went green on every pull request check and failed the
 * deploy after the merge: #330 left a BETA badge count behind in
 * `dev-sanity.spec.ts` (run 35948503612), and #338 found three in
 * `prod-sanity.spec.ts`. With `SANITY_ON_BUILD=1`, each sanity config builds
 * this tree and previews it (`tests/sanity-on-build.ts`), and leaves out the
 * tests tagged `@deployed-only`: the ones only the deployed site can answer.
 *
 * Everything here is read from `playwright test --list --reporter=json`,
 * which loads each config exactly as a run would and never starts its
 * `webServer` (measured in the plan's Task 1). Two shapes in that listing are
 * easy to get wrong, and either would leave the guard finding nothing: a
 * spec's `file` is relative to the config's `testDir`, and its tags carry no
 * `@`.
 */

const CONFIGS = [
  { config: 'playwright.dev.config.ts', testDir: 'tests/dev' },
  { config: 'playwright.prod.config.ts', testDir: 'tests/prod' },
] as const;

type SanityConfig = (typeof CONFIGS)[number]['config'];

interface ListedTest {
  config: SanityConfig;
  file: string;
  title: string;
  tags: string[];
  annotations: { type: string; description?: string }[];
}

interface Listing {
  webServer: { command?: string; url?: string } | null;
  tests: ListedTest[];
}

interface JsonSpec {
  title: string;
  file: string;
  tags: string[];
  tests: { annotations: ListedTest['annotations'] }[];
}

interface JsonSuite {
  title: string;
  specs: JsonSpec[];
  suites?: JsonSuite[];
}

function collect(
  config: SanityConfig,
  suite: JsonSuite,
  path: string[],
  into: ListedTest[],
): void {
  const here = [...path, suite.title];
  for (const spec of suite.specs)
    for (const test of spec.tests)
      into.push({
        config,
        file: spec.file,
        title: [...here, spec.title].join(' › '),
        tags: spec.tags,
        annotations: test.annotations,
      });
  for (const child of suite.suites ?? []) collect(config, child, here, into);
}

interface JsonListing {
  config: { webServer: Listing['webServer'] };
  suites: JsonSuite[];
  errors: { message: string }[];
}

/** The JSON reporter's output, or `undefined` when there is none to read. */
function parsed(stdout: string): JsonListing | undefined {
  try {
    return JSON.parse(stdout) as JsonListing;
  } catch {
    return undefined;
  }
}

const listings = new Map<string, Listing>();

/**
 * The config's test list, with the switch on or off. `PUBLIC_SHYTALK_URL`
 * and `PUBLIC_YAWELO_IDLE_URL` are removed so the answer does not depend on the
 * shell that runs the unit suite: the prod config refuses either when the
 * switch is on, by design.
 */
function listing(config: SanityConfig, onBuild: boolean): Listing {
  const key = `${config}:${onBuild}`;
  const cached = listings.get(key);
  if (cached) return cached;

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PUBLIC_SHYTALK_URL;
  delete env.PUBLIC_YAWELO_IDLE_URL;
  delete env.SANITY_ON_BUILD;
  if (onBuild) env.SANITY_ON_BUILD = '1';

  const run = spawnSync(
    'npx',
    ['playwright', 'test', '-c', config, '--list', '--reporter=json'],
    { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  // An empty selection exits 1 with "No tests found", and it is the likeliest
  // way for this guard to fail: each testDir holds one spec file, so a file
  // whose every test is tagged leaves nothing to list. Read as a listing of
  // no tests, it reaches the coverage assertion below, which names the file.
  // Any other error is thrown whole.
  const json = parsed(run.stdout);
  const emptySelection =
    json !== undefined &&
    json.errors.length > 0 &&
    json.errors.every((e) => /^Error: No tests found\b/.test(e.message));
  if (json === undefined || (run.status !== 0 && !emptySelection))
    throw new Error(
      `playwright --list -c ${config} (SANITY_ON_BUILD=${onBuild ? 1 : 0}) ` +
        `exited ${run.status}:\n${run.stderr}${run.stdout.slice(0, 2000)}`,
    );

  const tests: ListedTest[] = [];
  for (const suite of json.suites) collect(config, suite, [], tests);
  const result = { webServer: json.config.webServer, tests };
  listings.set(key, result);
  return result;
}

const idOf = (test: ListedTest): string =>
  `${test.config} › ${test.file} › ${test.title}`;

/** Every test tagged `@deployed-only`, from the runs a deploy makes. */
const deployedOnlyTests = (): ListedTest[] =>
  CONFIGS.flatMap(({ config }) => listing(config, false).tests).filter((t) =>
    t.tags.includes('deployed-only'),
  );

describe.each(CONFIGS)(
  '$config with SANITY_ON_BUILD=1',
  ({ config, testDir }) => {
    it('builds this tree and previews it, where a deploy run has no server', () => {
      expect(listing(config, false).webServer).toBeNull();

      const server = listing(config, true).webServer;
      expect(
        server,
        'the switch must give the config a webServer',
      ).not.toBeNull();
      expect(server?.command).toContain('npm run build');
      expect(server?.command).toContain('npm run preview');
      expect(server?.url).toMatch(/^http:\/\/localhost:\d+/);
    });

    it(`runs at least one test from every spec file in ${testDir}`, () => {
      // Anchor first: coverage read off a listing that is not the on-build run
      // would describe the deploy's run, which is not what this guards.
      expect(listing(config, true).webServer).not.toBeNull();

      const listed = new Set(listing(config, true).tests.map((t) => t.file));
      const specFiles = specFilesUnder(testDir).map((file) =>
        relative(testDir, file),
      );
      const silent = specFiles.filter((file) => !listed.has(file));

      expect(
        searched(silent, { of: specFiles, what: `spec files in ${testDir}` }),
        'these spec files contribute no test to the pull request run',
      ).toEqual([]);
    });
  },
);

describe('tests tagged @deployed-only', () => {
  it('each says, where it is written, why only the deployed site can answer it', () => {
    const tagged = deployedOnlyTests();
    const unexplained = tagged
      .filter(
        (t) =>
          !t.annotations.some(
            (a) =>
              a.type === 'deployed-only' && (a.description ?? '').trim() !== '',
          ),
      )
      .map(idOf);

    expect(
      searched(unexplained, { of: tagged, what: '@deployed-only tests' }),
      'a @deployed-only test must carry a deployed-only annotation with a reason',
    ).toEqual([]);
  });

  it('are left out of the on-build run, and nothing else is', () => {
    const tagged = deployedOnlyTests();
    const onBuild = new Set(
      CONFIGS.flatMap(({ config }) => listing(config, true).tests).map(idOf),
    );
    const leaked = tagged.map(idOf).filter((id) => onBuild.has(id));

    expect(
      searched(leaked, { of: tagged, what: '@deployed-only tests' }),
      'these tests need the deployed site and must not run against a preview',
    ).toEqual([]);

    const everyTest = CONFIGS.flatMap(
      ({ config }) => listing(config, false).tests,
    );
    expect(onBuild.size).toBe(everyTest.length - tagged.length);
  });
});
