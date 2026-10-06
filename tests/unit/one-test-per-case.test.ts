import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSource } from './ast';
import {
  filesUnder,
  searched,
  tsFilesUnder,
  walkDisagreements,
} from '../source-files';
import { specDirFilesGitHas, specDirs } from '../spec-dirs';
import {
  loopedCases,
  statefulHelpers,
  testsRead,
  type LoopedCase,
} from '../one-test-per-case';
import { declaresTests, testsWritten } from '../playwright-declarations';
import { floorBreach } from '../floors';

/**
 * One test per case (operator, 2026-10-02; #417).
 *
 * A population known before the run -- locales, pages, widths, themes -- is
 * covered by generating one test per case, never by looping it inside one
 * test body. A loop inside shares one 30 s budget across every case (this
 * repo measured that going red on Firefox and WebKit under load, #380),
 * stops at the first failing case, and names none in its title.
 *
 * The question asked is STRUCTURAL: does a loop inside a test navigate or
 * change the viewport, theme or media on each pass? Whether its iterable was
 * "known before the run" is a dataflow question, and a detector asking one
 * here before flagged 54 of 103 sites and was useless (#118). A loop over a
 * population only the page knows (the disclosures it rendered) cannot be
 * split at collection time, and says so in a `// runtime population:`
 * comment, found by position, so the same words in a string do not count.
 */
const found = (source: string): readonly LoopedCase[] =>
  loopedCases(parseSource(source, 'fixture.spec.ts'));

describe('the detector', () => {
  it('refuses a loop inside a test that navigates on each pass', () => {
    expect(
      found(`
        test('every locale', async ({ page }) => {
          for (const locale of LOCALES) {
            await page.goto(localisePath('/', locale));
          }
        });`),
    ).toEqual([
      {
        test: 'every locale',
        loop: 'for (const locale of LOCALES)',
        line: 3,
      },
    ]);
  });

  it('passes the same cases generated as one test each', () => {
    expect(
      found(`
        for (const locale of LOCALES)
          test(\`\${locale}: one case\`, async ({ page }) => {
            await page.goto(localisePath('/', locale));
          });`),
    ).toEqual([]);
  });

  it('refuses a loop that navigates through a WebDriver session helper', () => {
    // The iOS journeys load pages with `session.navigateToPath`, a method on
    // the session object over WebDriver's `navigate`. Neither was a name the
    // detector knew, and it read no method, so a looped journey passed while
    // the test counter counted it (#446).
    expect(
      found(`
        const session = {
          driver,
          async navigateToPath(path) { await driver.navigate(base + path); },
          visit: async (path) => { await session.navigateToPath(path); },
        };
        test('every locale', async () => {
          for (const locale of LOCALES) await session.navigateToPath(path(locale));
        });
        test('every page', async () => {
          for (const page of PAGES) await session.visit(page);
        });`).map(({ test }) => test),
    ).toEqual(['every locale', 'every page']);
  });

  it('reads a test however Playwright declares it, focused and failing too', () => {
    // This file kept its own list of test callees, which had no
    // `test.fail.only`, so a looped body under one was never read (#390 F155).
    expect(
      found(`
        test.fail.only('focused and failing', async ({ page }) => {
          for (const path of ['/', '/id/']) await page.goto(path);
        });`).map(({ test }) => test),
    ).toEqual(['focused and failing']);
  });

  it('refuses each state change the budget pays for, not only goto', () => {
    const titles = found(`
      test('widths', async ({ page }) => {
        for (const width of [320, 1280]) await page.setViewportSize({ width, height: 900 });
      });
      test('themes', async ({ page }) => {
        for (const theme of THEMES) { await emulateTheme(page, theme); }
      });
      test('media', async ({ page }) => {
        ['print', 'screen'].forEach(async (media) => page.emulateMedia({ media }));
      });
      test('saved', async ({ page }) => {
        for (let i = 0; i < 2; i += 1) await saveTheme(page, 'dark');
      });`).map((site) => site.test);
    expect(titles).toEqual(['widths', 'themes', 'media', 'saved']);
  });

  it('refuses a loop whose navigation sits in a helper this file declares (#390 F152)', () => {
    expect(
      found(`
        const measure = async (page, path) => visit(page, path);
        const visit = async (page, path) => {
          await page.goto(path);
        };
        test('every page', async ({ page }) => {
          for (const path of PATHS) await measure(page, path);
        });`).map((site) => site.test),
    ).toEqual(['every page']);
  });

  it('refuses a loop whose navigation sits in a shared helper (#390 F152)', () => {
    const shared = statefulHelpers([
      parseSource(
        'export const openRoster = async (page, path) => { await page.goto(path); };',
        'helpers.ts',
      ),
    ]);
    const spec = parseSource(
      `test('both', async ({ page }) => {
        for (const path of PATHS) await openRoster(page, path);
      });`,
      'fixture.spec.ts',
    );
    expect(loopedCases(spec).map((site) => site.test)).toEqual([]);
    expect(loopedCases(spec, shared).map((site) => site.test)).toEqual([
      'both',
    ]);
  });

  it('refuses a navigation by any of its names, not only goto (#390 F150)', () => {
    const titles = found(`
      test('reloaded', async ({ page }) => {
        for (const stale of ['Dark', 'auto']) await page.reload();
      });
      test('back', async ({ page }) => {
        for (const step of STEPS) await page.goBack();
      });
      test('forward', async ({ page }) => {
        for (const step of STEPS) await page.goForward();
      });
      test('content', async ({ page }) => {
        for (const html of PAGES) await page.setContent(html);
      });`).map((site) => site.test);
    expect(titles).toEqual(['reloaded', 'back', 'forward', 'content']);
  });

  it('passes a loop that changes no page state', () => {
    expect(
      found(`
        test('links', async ({ page }) => {
          await page.goto('/');
          for (const a of await page.locator('a').all()) await atLeast44(a);
        });`),
    ).toEqual([]);
  });

  it('passes a runtime population that says so in a comment', () => {
    expect(
      found(`
        test('disclosures', async ({ page }) => {
          // runtime population: the toggles this page rendered
          for (const id of ids) await page.goto(path);
        });`),
    ).toEqual([]);
  });

  // An ordinary comment sits above the loop on purpose. Without one, a
  // detector that read the words from anywhere in the file still saw no
  // comment to read them in, and this passed against it (DM5, #417).
  it('does not take the words from a string as the comment', () => {
    expect(
      found(`
        test('disclosures', async ({ page }) => {
          const note = '// runtime population: not a comment';
          // every toggle, one at a time
          for (const id of ids) await page.goto(path);
        });`),
    ).toHaveLength(1);
  });

  it('reads a test inside a describe, and a test.describe callback is not a test', () => {
    expect(
      found(`
        test.describe('group', () => {
          for (const width of WIDTHS)
            test(\`\${width}\`, async ({ page }) => {
              await page.setViewportSize({ width, height: 9 });
            });
          test('inner', async ({ page }) => {
            for (const p of PATHS) await page.goto(p);
          });
        });`).map((site) => site.test),
    ).toEqual(['inner']);
  });

  it('names a template title by its source, so a finding names its test', () => {
    expect(
      found(`
        test(\`\${path}: every control\`, async ({ page }) => {
          for (const theme of THEMES) await emulateTheme(page, theme);
        });`)[0].test,
    ).toBe('${path}: every control');
  });
});

/**
 * Every looped site in the suite, scanned inside each test, never at collection.
 *
 * #417 landed this guard with a burn-down list of the 46 sites that existed
 * that day; #418-#422 split them all, and #422 retired the list rather than
 * keep it empty. An empty allowance is somewhere to park the next site instead
 * of splitting it, and its own staleness check would assert over nothing.
 */
const parsed = (file: string) => parseSource(readFileSync(file, 'utf8'), file);

/** What the suite's shared modules make stateful: every non-spec file the specs import from. */
const sharedStateful = () =>
  statefulHelpers(
    filesUnder(
      'tests',
      (path) =>
        path.endsWith('.ts') &&
        !path.endsWith('.spec.ts') &&
        !path.startsWith('tests/unit/'),
    ).map(parsed),
  );

const scan = (): {
  specs: string[];
  tests: string[];
  sites: string[];
  unread: string[];
  miscounted: string[];
} => {
  // Every TypeScript file in a directory that holds specs, not only the
  // `*.spec.ts` ones: the Android preflight (`*.setup.ts`) and the iOS
  // journeys (`*.journey.ts`) declare 21 tests between them, and a walk of
  // `*.spec.ts` alone never read one (#390).
  const specs = specDirs().flatMap(tsFilesUnder);
  const shared = sharedStateful();
  const tests = specs.flatMap((file) =>
    testsRead(parsed(file)).map((title) => `${file} :: ${title}`),
  );
  const sites = specs.flatMap((file) =>
    loopedCases(parsed(file), shared).map(
      (site) => `${file} :: ${site.test} :: ${site.loop}`,
    ),
  );
  const unread = specs.filter(
    (file) =>
      declaresTests(readFileSync(file, 'utf8')) &&
      testsRead(parsed(file)).length === 0,
  );
  // Per file (#477): the reader's count against the text's, so a reader
  // blind to one form in a file that writes two others is caught.
  const miscounted = specs.flatMap((file) => {
    const sf = parsed(file);
    const read = testsRead(sf).length;
    const written = testsWritten(sf);
    return read === written
      ? []
      : [`${file}: read ${read} tests, its text writes ${written}`];
  });
  return { specs, tests, sites, unread, miscounted };
};

describe('the suite', () => {
  it('loops no known population inside a test', () => {
    // The population is the TESTS read, not the files opened: a reader that
    // went blind to every declaration would open every file, find no loop,
    // and pass. `searched` refuses an empty population (#390).
    const { tests, sites } = scan();
    expect(searched(sites, { of: tests, what: 'tests read' })).toEqual([]);
    expect(
      floorBreach('one-test-per-case/loop-checked-tests', tests.length),
    ).toBeUndefined();
  });

  it('reads the tests every spec declares, and as many as there are', () => {
    // Liveness at the level the detector works at, first measured against
    // the reader this replaced (both found the same 638 bodies, #390 F155),
    // and ratcheted (#468), because a floor with slack is how
    // absence-liveness sat at 153 under a real 391 (#390 F161). And no spec
    // whose text declares a test may read as none: a reader blind to one
    // form (`test.fail.only` was) is caught by the file it missed.
    const { specs, tests, unread, miscounted } = scan();
    expect(
      searched(unread, { of: specs, what: 'files in spec directories' }),
    ).toEqual([]);
    expect(
      searched(miscounted, { of: specs, what: 'files in spec directories' }),
    ).toEqual([]);
    // Both checks above count over the walk, so it is checked against git's
    // own list too (#477): a walk that drops a file drops it from both sides.
    expect(
      searched(walkDisagreements(specs, specDirFilesGitHas()), {
        of: specs,
        what: 'files in spec directories',
      }),
    ).toEqual([]);
    // After the verdict, so a population that grew never hides a finding.
    expect(
      floorBreach('one-test-per-case/tests', tests.length),
    ).toBeUndefined();
  });

  it('resolves the shared helpers that navigate', () => {
    // Liveness for the scan above: openRoster's goto is one call away from
    // every loop that uses it, so it must be among the names the scan treats
    // as navigating, or the shared half of the detector is not running.
    expect(sharedStateful().has('openRoster')).toBe(true);
    // And the iOS session's, a method over WebDriver's `navigate` (#446):
    // without it the 15 iOS journeys are counted and never checked.
    expect(sharedStateful().has('navigateToPath')).toBe(true);
  });
});
