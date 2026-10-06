import { beforeAll, describe, it, expect, vi } from 'vitest';
import type { PlaywrightTestConfig } from '@playwright/test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import config, {
  CONTENT_ONLY_SPECS,
  VISUAL_PROJECT,
  VISUAL_MEASURE_PROJECT,
} from '../../playwright.config';
import {
  ignoredByGit,
  nonEmpty,
  searched,
  specFilesUnder,
  trackedFiles,
} from '../source-files';
import { floorBreach } from '../floors';
import { withoutCommentLines, withoutTsComments } from './source-text';
import { workflowJobs } from '../workflow-jobs';
import { engineDependence } from './engine-dependence';

/**
 * Five browser projects × every spec is not five times the signal.
 *
 * The suite runs 431 unique tests on chromium, firefox, webkit, mobile-chrome
 * and mobile-safari. For anything that renders, that is the point: a collapsed
 * nav wrapper once pushed the header links off-screen on every engine, and only
 * a real engine could have caught it.
 *
 * But some specs assert HTTP responses and DOM text — a sitemap's URLs, a
 * canonical tag, whether two words render touching. `textContent` is
 * spec-defined; those bytes are identical on every engine, so four of the five
 * runs cost time and return nothing the first run did not already prove.
 *
 * The line between the two is not a matter of taste, which is why it can be
 * tested: a spec is content-only exactly when it neither drives the viewport
 * nor reads layout (`engine-dependence.ts`, #198). The moment one does, it is
 * engine-dependent and belongs on all five.
 */

/**
 * A project as Playwright itself resolves it.
 *
 * Asked of Playwright rather than re-derived here: `FullConfigInternal` fills
 * in what a project inherits (its `testDir`, and the default `testMatch` when
 * it names none), and `createFileMatcher` is the function a run applies to
 * every file. Both are internal, so an upgrade that moves them fails this file
 * loudly, where a copy of their rules would drift in silence.
 */
type ResolvedProject = {
  name: string;
  testDir: string;
  testMatch: unknown;
  testIgnore: unknown;
  use: { colorScheme?: unknown };
};

const requireCjs = createRequire(import.meta.url);
const { FullConfigInternal } = requireCjs('playwright/lib/common') as {
  FullConfigInternal: new (
    location: { resolvedConfigFile: string; configDir: string },
    userConfig: PlaywrightTestConfig,
    cliOverrides: Record<string, never>,
    metadata: undefined,
  ) => { projects: Array<{ project: ResolvedProject }> };
};
const { createFileMatcher } = requireCjs('playwright/lib/util') as {
  createFileMatcher: (patterns: unknown) => (file: string) => boolean;
};

const resolvedProjects = (
  userConfig: PlaywrightTestConfig,
  configFile: string,
): ResolvedProject[] => {
  const resolvedConfigFile = resolve(configFile);
  return new FullConfigInternal(
    { resolvedConfigFile, configDir: dirname(resolvedConfigFile) },
    userConfig,
    {},
    undefined,
  ).projects.map(({ project }) => project);
};

/** Whether a run of `project` collects the repo-relative file at `path`. */
const claims = (project: ResolvedProject, path: string): boolean => {
  const file = resolve(path);
  return (
    file.startsWith(project.testDir + sep) &&
    createFileMatcher(project.testMatch)(file) &&
    !createFileMatcher(project.testIgnore)(file)
  );
};

const E2E = 'tests/e2e';
const VISUAL_SPEC = join(E2E, 'visual.spec.ts');
const read = (spec: string) => readFileSync(join(E2E, spec), 'utf8');
describe('the content-only project', () => {
  it('names specs that actually exist', () => {
    const contentOnly = CONTENT_ONLY_SPECS;
    const missing = contentOnly.filter((s) => !existsSync(join(E2E, s)));
    expect(
      searched(missing, {
        of: contentOnly,
        what: 'content-only specs',
      }),
      'a renamed spec would silently stop being scoped',
    ).toEqual([]);
    expect(
      floorBreach(
        'browser-matrix/named-content-only-specs',
        contentOnly.length,
      ),
    ).toBeUndefined();
  });

  it('does not simply list every spec, which would assert nothing', () => {
    // Without this, the rule below is satisfiable by scoping the whole suite
    // to one engine — the opposite of what it is for.
    const all = config.projects?.length ?? 0;
    expect(all).toBeGreaterThan(1);
    expect(
      CONTENT_ONLY_SPECS.length,
      'scoping every spec to one engine would delete the cross-engine gate',
    ).toBeLessThan(10);
  });

  it('holds only specs whose verdict cannot depend on the engine or viewport', () => {
    // #198: this once asked only whether a spec DRIVES the viewport, by
    // substring. `rendered-text.spec.ts` READ layout instead, through
    // `getClientRects`, so it ran at 1280px on one engine and failed on every
    // page of a real phone.
    const contentOnly = CONTENT_ONLY_SPECS;
    const engineDependent = contentOnly.flatMap((spec) => {
      const signals = engineDependence(read(spec));
      return signals.length > 0 ? [`${spec}: ${signals.join(', ')}`] : [];
    });

    expect(
      searched(engineDependent, {
        of: contentOnly,
        what: 'content-only specs',
      }),
      'a spec that drives the viewport or reads layout is engine-dependent ' +
        'and must run on all five',
    ).toEqual([]);
    expect(
      floorBreach(
        'browser-matrix/engine-checked-content-only-specs',
        contentOnly.length,
      ),
    ).toBeUndefined();
  });

  it('is judged by a detector that sees layout reads in the real suite', () => {
    // The positive control for the absence above: the spec #198 moved out
    // reads layout, and a detector gone blind would find nothing anywhere.
    // Exact, so a detector that starts reporting prose shows up here too.
    expect(engineDependence(read('rendered-text.spec.ts'))).toEqual([
      'checkVisibility',
      'clientWidth',
      'getBoundingClientRect',
      'getClientRects',
      'getComputedStyle',
      'innerText',
    ]);
  });

  it('runs those specs on exactly one project', () => {
    // Ask what a project actually MATCHES, not what its `testIgnore` spells.
    // Reading `testIgnore` alone made a project scoped the OTHER way -- by
    // `testMatch`, which is how `visual` is scoped -- look like it ran
    // everything (#33). The hand-written matcher that replaced it still
    // searched each pattern's text for the spec's NAME, so an engine ignoring
    // a pattern that spelled every content-only name and matched none read as
    // an exclusion, with the whole unit suite green (#194). Playwright's own
    // resolution answers instead.
    const runners = resolvedProjects(config, 'playwright.config.ts').filter(
      (p) => CONTENT_ONLY_SPECS.some((spec) => claims(p, join(E2E, spec))),
    );

    expect(runners.map((p) => p.name)).toEqual(['content']);
  });

  it('is the one project excused from proving the navigation collector alive (#355)', () => {
    // `scripts/test-e2e.mjs` reads this mark back out of the json report and
    // leaves the project out of the count its liveness verdict judges. Marking
    // a rendering engine would let a dead collector pass on that engine's run,
    // so the marked set must be exactly the set that runs content-only specs.
    const runners = resolvedProjects(config, 'playwright.config.ts')
      .filter((p) =>
        CONTENT_ONLY_SPECS.some((spec) => claims(p, join(E2E, spec))),
      )
      .map((p) => p.name);
    const excused = (config.projects ?? [])
      .filter((p) => p.metadata?.requiresNavigation === false)
      .map((p) => p.name);

    expect(runners).toHaveLength(1);
    expect(excused).toEqual(runners);
  });

  it('leaves every rendering engine still covering the rest of the suite', () => {
    const engines = (config.projects ?? [])
      .map((p) => p.name)
      .filter((n) => n !== 'content' && n !== 'visual');

    expect(engines).toEqual([
      'chromium',
      'firefox',
      'webkit',
      'mobile-chrome',
      'mobile-safari',
    ]);
  });
});

/**
 * The visual-regression wiring (#33).
 *
 * A screenshot suite fails in two directions and only one of them is loud.
 * It can go red on a font-rendering difference nobody caused -- which gets it
 * switched off within a week -- or it can quietly stop asserting, which is
 * this repo's recurring defect in a new medium. Both are wiring, so both are
 * pinned here rather than left to whoever next edits the config.
 */
describe('the visual-regression project', () => {
  it('matches its own spec and nothing else', () => {
    expect(VISUAL_PROJECT.testMatch.test('visual.spec.ts')).toBe(true);
    expect(VISUAL_PROJECT.testMatch.test('tests/e2e/visual.spec.ts')).toBe(
      true,
    );
    // Not a spec that merely CONTAINS the word, and not the whole corpus.
    expect(VISUAL_PROJECT.testMatch.test('audiovisual.spec.ts')).toBe(false);
    expect(VISUAL_PROJECT.testMatch.test('seo.spec.ts')).toBe(false);
  });

  it('runs on exactly one engine, so one set of baselines exists', () => {
    expect(VISUAL_PROJECT.name).toBe('visual');
    expect(VISUAL_PROJECT.use.defaultBrowserType).toBe('chromium');
  });

  it('is excluded from every OTHER project', () => {
    // Measured, not assumed: with the spec present and this exclusion absent,
    // `playwright test --list` grows by 40 tests -- the same 8 claimed by all
    // five engines, demanding five sets of baselines for a question about our
    // CSS rather than about WebKit's.
    //
    // Resolved by Playwright, not re-derived. The hand-written check this
    // replaced looked for `visual` inside the stringified `testIgnore`, which
    // an `audiovisual` pattern also satisfies, and read a `testMatch` ARRAY as
    // claiming nothing. Both let the five engines claim the suite with the
    // whole unit suite green (#194).
    const others = resolvedProjects(config, 'playwright.config.ts').filter(
      (p) => p.name !== 'visual',
    );
    expect(existsSync(VISUAL_SPEC), `${VISUAL_SPEC} has moved`).toBe(true);
    const claimants = others
      .filter((p) => claims(p, VISUAL_SPEC))
      .map((p) => p.name);

    const otherNames = others.map((p) => p.name);
    expect(
      searched(claimants, {
        of: otherNames,
        what: 'projects other than visual',
      }),
      'each would demand its own set of baselines',
    ).toEqual([]);
    expect(
      floorBreach(
        'browser-matrix/projects-other-than-visual',
        otherNames.length,
      ),
    ).toBeUndefined();
  });

  it('states its flake policy rather than discovering it', () => {
    const shot = config.expect?.toHaveScreenshot;
    expect(shot, 'no screenshot policy at all').toBeDefined();
    // ZERO, and pinned exactly rather than to a range (#134).
    //
    // A range was the original shape here, guarding against the value being
    // left unset -- "a policy nobody chose". The range itself then became the
    // policy nobody chose: 0.002 is a fraction of the IMAGE, and on a
    // full-page 390x2250 screenshot it permitted 1,755 differing pixels,
    // while a 1px border around a button is ~456. #133 recoloured THIRTEEN
    // control borders and seven of eight screenshots reported green.
    //
    // Zero is safe because the render is deterministic, and that was
    // measured: two consecutive `--update-snapshots=all` runs in the pinned
    // container rewrote all eight baselines byte-identically. Proven in both
    // directions on one 1px border -- red on exactly the four screenshots
    // containing it at 0, entirely green on the same mutation at 0.002.
    //
    // `toBe(0)` and not `toBeLessThan`: `undefined` is not 0, and an absent
    // ratio applies no limit at all.
    expect(shot?.maxDiffPixelRatio).toBe(0);
    // The per-pixel half. Without it the ratio bounds how many pixels may
    // differ while each one differs almost arbitrarily -- measured: at the
    // default 0.2, recolouring the accent green-to-blue changed NO screenshot.
    expect(shot?.threshold).toBeGreaterThan(0);
    expect(shot?.threshold).toBeLessThanOrEqual(0.1);
    expect(shot?.animations).toBe('disabled');
    expect(shot?.caret).toBe('hide');
    // Pins the device-pixel ratio, so a HiDPI runner and a normal one produce
    // comparable images rather than a doubled one.
    expect(shot?.scale).toBe('css');
  });

  it('keeps the platform in the baseline filename', () => {
    // macOS and Linux rasterise text differently, so a laptop-made baseline
    // is not the one CI compares against. Spelling the platform into the path
    // makes that visible in a diff instead of surfacing as a missing snapshot
    // on a runner nobody was watching.
    expect(config.snapshotPathTemplate).toContain('{platform}');
  });

  it('regenerates with `all`, never Playwright’s `changed` preset', () => {
    // `--update-snapshots` BARE is not "update everything": Playwright 1.63
    // documents `preset: "changed"`, which rewrites only baselines whose
    // comparison FAILED and leaves a stale-but-passing one in place -- exactly
    // the drift #134 exists to stop. Every ticket that regenerates asks for
    // `all`, and the zero-allowance evidence above was gathered with `all` by
    // hand, through a flag the repo's own command did not pass (#152).
    //
    // Comment-stripped: visual.mjs's prose names this flag repeatedly, so a
    // raw read is satisfied by the documentation describing the bug.
    const runner = withoutTsComments(
      readFileSync('scripts/visual.mjs', 'utf8'),
    );

    expect(runner, 'the update path must name its mode').toContain(
      "'--update-snapshots=all'",
    );
    expect(runner, 'a bare flag silently means `changed`').not.toMatch(
      /'--update-snapshots'/,
    );
  });

  it('refuses to write a baseline nobody asked for', () => {
    // Playwright 1.63 defaults `updateSnapshots` to 'missing'
    // (`runner/index.js:583`). Under that default a run whose baseline is
    // absent WRITES the PNG first and only then fails on a soft error, so
    // nothing is silently accepted -- but CI produces a baseline no one
    // reviewed, and the only guard on that behaviour watches the
    // `--update-snapshots` FLAG in the workflow. The config default is a
    // second door into the same room, and it was unwatched.
    //
    // 'none' refuses outright and writes nothing, and it is the only value
    // for which `applySuggestedRebaselines` returns early rather than being
    // willing to rewrite expectations during an ordinary run.
    expect(config.updateSnapshots).toBe('none');
  });
});

/**
 * The real-device config (#194).
 *
 * `playwright.device.config.ts` is one more place a spec can be claimed, and
 * it claimed the visual suite. Eight of the nine failures in #189's Android
 * run were `visual.spec.ts` asking for an `-android-chrome-darwin` baseline
 * that cannot exist: a baseline belongs to one project on one platform, and
 * CI never reads a phone's. Under Playwright's default `updateSnapshots:
 * 'missing'` the run then WROTE eight of them into the working tree.
 *
 * The ninth failure is why only the visual suite comes out. `rendered-text`'s
 * touching-words test reads layout, and the phone is the only run that has
 * ever measured it at phone width (#198). Taking the engines' whole ignore
 * list would have turned the device leg green by deleting that measurement.
 */
describe('the real-device config (#194)', () => {
  let device: PlaywrightTestConfig;
  let projects: ResolvedProject[];

  beforeAll(async () => {
    // The config sets PW_REAL_DEVICE as it loads: its job in a run, and a
    // leak into everything after it in a unit suite.
    const before = process.env.PW_REAL_DEVICE;
    try {
      device = (await import('../../playwright.device.config')).default;
    } finally {
      if (before === undefined) delete process.env.PW_REAL_DEVICE;
      else process.env.PW_REAL_DEVICE = before;
    }
    projects = resolvedProjects(device, 'playwright.device.config.ts');
  });

  const phone = (): ResolvedProject => {
    const found = projects.filter((p) => p.name === 'android-chrome');
    expect(found.map((p) => p.name)).toEqual(['android-chrome']);
    return found[0];
  };

  it('lets no device project claim the visual suite', () => {
    expect(existsSync(VISUAL_SPEC), `${VISUAL_SPEC} has moved`).toBe(true);
    const claimants = projects
      .filter((p) => claims(p, VISUAL_SPEC))
      .map((p) => p.name);

    const deviceNames = projects.map((p) => p.name);
    expect(
      searched(claimants, {
        of: deviceNames,
        what: 'device projects',
      }),
      'a phone has no baseline CI would read, so it must never be asked for one',
    ).toEqual([]);
    expect(
      floorBreach('browser-matrix/device-projects', deviceNames.length),
    ).toBeUndefined();
  });

  it('still runs every other e2e spec on the phone, content-only ones included', () => {
    const android = phone();
    // The invariant first, so it is judged even when the exact set below is
    // not: an expectation ordered after a failing one never runs.
    const contentOnly = CONTENT_ONLY_SPECS;
    const dropped = contentOnly.filter(
      (spec) => !claims(android, join(E2E, spec)),
    );
    expect(
      searched(dropped, { of: contentOnly, what: 'content-only specs' }),
      'the phone is the only run that measures touching words at phone width (#198)',
    ).toEqual([]);
    expect(
      floorBreach(
        'browser-matrix/phone-content-only-specs',
        contentOnly.length,
      ),
    ).toBeUndefined();

    const specs = specFilesUnder(E2E);
    expect(specs.filter((spec) => claims(android, spec))).toEqual(
      specs.filter((spec) => spec !== VISUAL_SPEC),
    );
  });

  it('excludes the visual project’s own pattern rather than a copy of it', () => {
    // Identity, not equality: a second regex with the same source passes an
    // equality check and drifts the day one of the two is edited.
    const declared = device.projects?.find((p) => p.name === 'android-chrome');
    expect([declared?.testIgnore].flat()).toContain(VISUAL_PROJECT.testMatch);
  });

  it('writes no baseline a phone run was never asked for', () => {
    // The second door the main config closed (`refuses to write a baseline
    // nobody asked for`, above), still open here: Playwright's default
    // 'missing' is what wrote the eight.
    expect(device.updateSnapshots).toBe('none');
  });

  it('claims no spec that compares against a stored snapshot', () => {
    // The rule the visual exclusion is one case of, so a snapshot assertion
    // added to any other spec the phone runs is caught the day it lands.
    const claimed = specFilesUnder('tests').filter((spec) =>
      projects.some((p) => claims(p, spec)),
    );
    const comparing = claimed.filter((spec) =>
      /\.(?:toHaveScreenshot|toMatchSnapshot|toMatchAriaSnapshot)\(/.test(
        withoutTsComments(readFileSync(spec, 'utf8')),
      ),
    );

    expect(
      searched(comparing, {
        of: claimed,
        what: 'specs a device project claims',
      }),
    ).toEqual([]);
    expect(
      floorBreach('browser-matrix/device-claimed-specs', claimed.length),
    ).toBeUndefined();
  });

  it('leaves git ignoring a snapshot a stray run writes beside a spec', () => {
    // Neither path is tracked, so git answers from its rules alone (see
    // `ignoredByGit`). The second is where a REAL new baseline would land.
    const stray =
      'tests/e2e/visual.spec.ts-snapshots/home-id-mobile-android-chrome-darwin.png';
    const baseline = 'tests/e2e/__screenshots__/a-new-page-desktop-linux.png';
    const ignored = ignoredByGit([stray, baseline]);

    expect(
      ignored.has(stray),
      'an untracked stray baseline is one `git add -A` from becoming a real one',
    ).toBe(true);
    expect(ignored.has(baseline), 'real baselines must stay committable').toBe(
      false,
    );
  });
});

describe('the measuring twin cannot become a gate (#224)', () => {
  it('is absent from the config an ordinary run builds', () => {
    // The whole safety of a zero-tolerance project is that it is opt-in. If
    // it were declared by default, a font rasterised a shade differently
    // would fail every PR in the repository.
    const names = (config.projects ?? []).map((p) => p.name);
    expect(names).not.toContain('visual-measure');
  });

  it('reads the SAME baselines as the project it measures', () => {
    // `snapshotPathTemplate` carries no `{projectName}`, so both projects
    // resolve the same committed files -- which is the only reason the
    // measurement says anything about what the gate compares. A different
    // testMatch would measure a different set of pictures.
    expect(VISUAL_MEASURE_PROJECT.testMatch).toBe(VISUAL_PROJECT.testMatch);
    expect(config.snapshotPathTemplate ?? '').not.toContain('{projectName}');
  });

  it('is STRICTER than the gate, never looser', () => {
    const gate = config.expect?.toHaveScreenshot;
    expect(VISUAL_MEASURE_PROJECT.expect.toHaveScreenshot.threshold).toBe(0);
    // The direction is the assertion. A measuring project that relaxed the
    // tolerance could report a clean sheet while the gate was failing, and
    // the number it printed would be worse than no number at all.
    expect(
      VISUAL_MEASURE_PROJECT.expect.toHaveScreenshot.threshold,
    ).toBeLessThan(gate?.threshold ?? 0);
  });
});

/**
 * Every project in every Playwright config declares its colour scheme (#142
 * spec §6.2).
 *
 * No config set one, so every project ran under Playwright's default, light.
 * The day the site gains a light palette, every existing test would silently
 * start testing it. The configs are derived from the repository root, so a
 * fifth config cannot slip past. The main config declares its visual projects
 * only under an environment flag, so they are appended here, where no flag can
 * hide one.
 */
const CONFIG = /^playwright.*\.config\.[cm]?[jt]s$/;

/**
 * A config's module, freshly evaluated under `env` added to the environment,
 * with every variable put back afterwards, including any its import sets. The
 * module cache is reset first, because a config reads the environment once,
 * as it loads.
 */
const importConfig = async (
  file: string,
  env: Record<string, string> = {},
): Promise<PlaywrightTestConfig> => {
  const before = { ...process.env };
  try {
    Object.assign(process.env, env);
    vi.resetModules();
    return (await import(resolve(file))).default as PlaywrightTestConfig;
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
};

/** Every Playwright config at the repository root, by the name Playwright gives one. */
const rootConfigs = (): string[] =>
  nonEmpty(readdirSync('.'), 'entries at the repository root')
    .filter((name) => CONFIG.test(name))
    .sort();

describe('every project declares its colour scheme (#142)', () => {
  it('finds a config by the name Playwright gives one', () => {
    const names = [
      'playwright.config.ts',
      'playwright.dev.config.ts',
      'playwright-ct.config.ts',
      'playwright.x.config.mjs',
      'playwright.config.ts.bak',
      'my.playwright.config.ts',
      'playwright.ts',
    ];
    expect(names.filter((name) => CONFIG.test(name))).toEqual([
      'playwright.config.ts',
      'playwright.dev.config.ts',
      'playwright-ct.config.ts',
      'playwright.x.config.mjs',
    ]);
  });

  it('runs every resolved project light or dark, never the default', async () => {
    const configs = rootConfigs();
    const projects: string[] = [];
    const undeclared: string[] = [];
    for (const file of configs) {
      const loaded = await importConfig(file);
      const extra =
        file === 'playwright.config.ts'
          ? [VISUAL_PROJECT, VISUAL_MEASURE_PROJECT]
          : [];
      for (const project of resolvedProjects(
        { ...loaded, projects: [...(loaded.projects ?? []), ...extra] },
        file,
      )) {
        projects.push(`${file} › ${project.name}`);
        const scheme = project.use.colorScheme;
        if (scheme !== 'light' && scheme !== 'dark')
          undeclared.push(`${file} › ${project.name}: ${String(scheme)}`);
      }
    }
    expect(
      searched(undeclared, { of: projects, what: 'Playwright projects' }),
    ).toEqual([]);
    expect(
      floorBreach('browser-matrix/colour-scheme-projects', projects.length),
    ).toBeUndefined();
  });
});

describe('no CI run can be narrowed to the tests someone focused (#390)', () => {
  it('refuses test.only under CI, in every Playwright config', async () => {
    // `--list` ignores `.only` (measured 2026-10-01: 4,159 listed with one
    // test focused), so in the e2e suite a focused run no longer adds up to
    // the shards' accounting and fails. tests/dev and tests/prod keep no such
    // account: a stray `.only` let `sanity-on-build`, and the run that posts
    // `prod-verified`, run one test and pass. Only the functions config set
    // `forbidOnly`.
    const configs = rootConfigs();
    const lax: string[] = [];
    for (const file of configs) {
      const loaded = await importConfig(file, { CI: 'true' });
      if (loaded.forbidOnly !== true) lax.push(file);
    }
    expect(searched(lax, { of: configs, what: 'Playwright configs' })).toEqual(
      [],
    );
    expect(
      floorBreach('browser-matrix/forbid-only-configs', configs.length),
    ).toBeUndefined();
  });
});

describe('the functions suite renders on every engine (#350)', () => {
  it('declares the same engines as the e2e suite, each the same device', async () => {
    // A form posted by a real browser is the functions suite's claim, and each
    // engine posts it its own way. Both configs map one list (tests/engines.ts),
    // and only the e2e config's engines were pinned: a functions config cut
    // to Chromium alone kept every suite green (#390 F153).
    const devicesOf = (projects: PlaywrightTestConfig['projects']) =>
      (projects ?? [])
        .filter((p) => p.name !== 'content' && p.name !== 'visual')
        .map(({ name, use }) => [name, use]);
    const functions = await importConfig('playwright.functions.config.ts');

    expect(devicesOf(functions.projects)).toEqual(devicesOf(config.projects));
  });
});

describe('no test run retries (#445)', () => {
  // The operator's rule, 2026-10-02: "retries are not acceptable. if retries
  // are required that means it's flaky, adding a retry is NOT a fix". A retry
  // turns a failure into a pass: playwright.prod.config.ts's one let a check
  // that failed once verify a release.
  it('resolves retries to 0 in every Playwright config and project, under CI', async () => {
    const configs = rootConfigs();
    const retrying: string[] = [];
    for (const file of configs) {
      const loaded = await importConfig(file, { CI: 'true' });
      if ((loaded.retries ?? 0) !== 0)
        retrying.push(`${file}: retries ${String(loaded.retries)}`);
      for (const project of loaded.projects ?? [])
        if ((project.retries ?? 0) !== 0)
          retrying.push(
            `${file} › ${project.name}: retries ${String(project.retries)}`,
          );
    }
    expect(
      searched(retrying, { of: configs, what: 'Playwright configs' }),
    ).toEqual([]);
    expect(
      floorBreach('browser-matrix/retry-configs', configs.length),
    ).toBeUndefined();
  });

  it('passes no --retries but 0 in any workflow step or package script', () => {
    // `trackedFiles`, the walk's home for dot-directories, which proves its
    // list non-empty before anything is judged over it.
    const workflows = trackedFiles(
      (path) => path.startsWith('.github/workflows/') && path.endsWith('.yml'),
    );
    const steps = workflows.flatMap((path) =>
      workflowJobs(readFileSync(path, 'utf8'), path).flatMap(({ id, runs }) =>
        runs.map((run) => `${path} › ${id}: ${withoutCommentLines(run)}`),
      ),
    );
    const scripts = Object.entries(
      (
        JSON.parse(readFileSync('package.json', 'utf8')) as {
          scripts: Record<string, string>;
        }
      ).scripts,
    ).map(([name, script]) => `package.json › ${name}: ${script}`);
    const commands = [...steps, ...scripts];
    const retrying = commands.filter((command) =>
      /--retries(?:=|\s+)(?!0(?![\w.]))\S/.test(command),
    );
    expect(
      searched(retrying, {
        of: commands,
        what: 'workflow steps and package scripts',
      }),
    ).toEqual([]);
    expect(
      floorBreach('browser-matrix/retry-commands', commands.length),
    ).toBeUndefined();
  });
});
