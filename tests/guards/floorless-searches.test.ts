import { describe, it, expect } from 'vitest';
import { floorBreach } from '../floors';
import { FLOORLESS } from '../floorless-searches.burn-down';
import {
  searchesWritten,
  searchSitesIn,
  vitestTestsWritten,
} from '../floorless-searches';
import { testsWritten } from '../playwright-declarations';
import {
  committableFiles,
  searched,
  tsFilesUnder,
  walkDisagreements,
} from '../source-files';
import { parseFile, parseSource } from '../unit/ast';

/**
 * Every discovery guard that asserts absence through `searched` checks a
 * recorded floor in the same test, or says why it need not (#515, F201).
 * `searched` refuses an EMPTY population, so a reader blind to everything
 * fails; a reader blind to part of its population passes as long as one unit
 * is still read. Only a floor checked for equality (#468) sees that.
 */
const read = (source: string) =>
  searchSitesIn(parseSource(source, 'fixture.test.ts'));

const SEARCH = "expect(searched(f, { of: p, what: 'w' })).toEqual([]);";
const FLOOR = "expect(floorBreach('x/y', p.length)).toBeUndefined();";

describe('searchSitesIn', () => {
  // Planted by hand, one per way this repository declares a test. Generated
  // from the reader's own list, a dropped form would vanish from both sides
  // (#446 Group 2b, PW6).
  it.each([
    ['vitest it', `it('t', () => {\n${SEARCH}\n});`],
    ['vitest it.each', `it.each([[1]])('t', (n) => {\n${SEARCH}\n});`],
    ['test', `test('t', async ({ page }) => {\n${SEARCH}\n});`],
    ['test.fixme', `test.fixme('t', async () => {\n${SEARCH}\n});`],
    ['test.skip', `test.skip('t', async () => {\n${SEARCH}\n});`],
    ['test.only', `test.only('t', async () => {\n${SEARCH}\n});`],
    ['test.fail', `test.fail('t', async () => {\n${SEARCH}\n});`],
    [
      'a test inside a group',
      `test.describe('g', () => {\n  test('t', async () => {\n${SEARCH}\n});\n});`,
    ],
    [
      'a test inside describe.each',
      `describe.each([1])('g %s', () => {\n  it('t', () => {\n${SEARCH}\n});\n});`,
    ],
    [
      "a callback inside a test's body",
      `it('t', () => {\n  rows.map(() =>\n${SEARCH}\n  );\n});`,
    ],
    // A test that spawns a process passes a timeout after its body
    // (git-env.test.ts); taking the last argument as the body missed it.
    ['vitest it with a timeout', `it('t', () => {\n${SEARCH}\n}, 60_000);`],
    [
      'vitest it with options',
      `it('t', { timeout: 1 }, () => {\n${SEARCH}\n});`,
    ],
  ])('reads a site in %s as floorless in its test', (_, source) => {
    const { sites, refused } = read(source);
    // The searches the reader met in the source: each is read as a site or
    // refused, so the two together are what a refusal count is judged over.
    const met = [...sites, ...refused];
    expect(
      searched(refused, { of: met, what: 'searches the reader met' }),
    ).toEqual([]);
    expect(
      floorBreach('floorless-searches/test-form-searches', met.length),
    ).toBeUndefined();
    expect(sites).toEqual([
      expect.objectContaining({ scope: 'test', label: 't', floored: false }),
    ]);
  });

  // The floor counts THE SAME population the search names in `of:` (#534,
  // operator: "do what the agent says"): a floor on anything else is a
  // token, not a check of this search.
  it.each([
    ['a floor on its length', `it('t', () => {\n${SEARCH}\n${FLOOR}\n});`],
    [
      'a floor on its size',
      "it('t', () => {\n  searched(f, { of: s, what: 'w' });\n  floorBreach('x/y', s.size);\n});",
    ],
    [
      'a floor on a count it searched',
      "it('t', () => {\n  searched(f, { of: n, what: 'w' });\n  floorBreach('x/y', n);\n});",
    ],
    [
      'a floor on a property path, spaced differently',
      "it('t', () => {\n  searched(f, { of: a.b, what: 'w' });\n  floorBreach('x/y', a .b.length);\n});",
    ],
    [
      'a floor on a population written in shorthand',
      "it('t', () => {\n  searched(f, { of, what: 'w' });\n  floorBreach('x/y', of.length);\n});",
    ],
    [
      'a floor in a callback of the same test',
      `test('t', async () => {\n${SEARCH}\nawait test.step('s', () => {\n${FLOOR}\n});\n});`,
    ],
  ])('reads a site whose test checks %s as floored', (_, source) => {
    expect(read(source).sites).toEqual([
      expect.objectContaining({ scope: 'test', label: 't', floored: true }),
    ]);
  });

  it.each([
    [
      'a floor on another population',
      "it('t', () => {\n  searched(f, { of: files, what: 'w' });\n  floorBreach('x/y', tests.length);\n});",
    ],
    [
      'a floor on a population that only starts with the same name',
      "it('t', () => {\n  searched(f, { of: files, what: 'w' });\n  floorBreach('x/y', files.flat().length);\n});",
    ],
    [
      'a wrapper that floors its own population',
      `it('t', () => {\n${SEARCH}\nexpectNothingFound(analyze, liveness);\n});`,
    ],
    [
      'a search with no `of:`',
      "it('t', () => {\n  searched(f, { what: 'w' });\n  floorBreach('x/y', of.length);\n});",
    ],
  ])('reads a site whose test checks %s as floorless', (_, source) => {
    expect(read(source).sites).toEqual([
      expect.objectContaining({ scope: 'test', label: 't', floored: false }),
    ]);
  });

  it('reads a floor in another test as no floor for this one', () => {
    const { sites } = read(
      `it('a', () => {\n${SEARCH}\n});\nit('b', () => {\n${FLOOR}\n});`,
    );
    expect(sites).toEqual([
      expect.objectContaining({ label: 'a', floored: false }),
    ]);
  });

  it.each([
    ['a function declaration', `function check() {\n${SEARCH}\n}`],
    ['an arrow held by a const', `const check = () => {\n${SEARCH}\n};`],
    [
      'a function expression held by a const',
      `const check = function () {\n${SEARCH}\n};`,
    ],
    ['a method', `const o = {\n  check() {\n${SEARCH}\n  },\n};`],
    [
      'a property holding an arrow',
      `const o = {\n  check: () => {\n${SEARCH}\n  },\n};`,
    ],
    [
      'a named function inside a test',
      `it('t', () => {\n  const check = () => {\n${SEARCH}\n  };\n});`,
    ],
  ])('reads a site in %s by the function name', (_, source) => {
    const { sites, refused } = read(source);
    const met = [...sites, ...refused];
    expect(
      searched(refused, { of: met, what: 'searches the reader met' }),
    ).toEqual([]);
    expect(
      floorBreach('floorless-searches/function-form-searches', met.length),
    ).toBeUndefined();
    expect(sites).toEqual([
      expect.objectContaining({
        scope: 'function',
        label: 'check',
        floored: false,
      }),
    ]);
  });

  it('reads a function that checks a floor as floored', () => {
    expect(read(`function check() {\n${SEARCH}\n${FLOOR}\n}`).sites).toEqual([
      expect.objectContaining({ label: 'check', floored: true }),
    ]);
  });

  it('reads a title written as a template as written', () => {
    expect(read(`it(\`\${locale}: t\`, () => {\n${SEARCH}\n});`).sites).toEqual(
      [expect.objectContaining({ label: '`${locale}: t`' })],
    );
  });

  it('reads the line of the call', () => {
    expect(read(`it('t', () => {\n\n${SEARCH}\n});`).sites).toEqual([
      expect.objectContaining({ line: 3 }),
    ]);
  });

  it('reads every test body, with or without a site', () => {
    expect(
      read(
        `it('a', () => {});\nit.each([1])('b %s', () => {});\ntest('c', async () => {});\ntest.describe('g', () => {});`,
      ).tests,
    ).toEqual(['a', 'b %s', 'c']);
  });

  it.each([
    // The behavioural route is retired (#534, operator: "Floors
    // everywhere"): a label is refused whatever it says, even over a
    // population the test writes itself, which is what it once excused.
    [
      'with a behavioural label over a population written in the test',
      "it('t', () => {\n  searched(f, { of: ['x'], what: 'w', behavioural: 'written here' });\n});",
      'a behavioural label',
    ],
    [
      'with a blank behavioural label',
      "it('t', () => {\n  searched(f, { of: ['x'], what: 'w', behavioural: '  ' });\n});",
      'a behavioural label',
    ],
    [
      'with a behavioural label held in a name',
      "it('t', () => {\n  searched(f, { of: ['x'], what: 'w', behavioural });\n});",
      'a behavioural label',
    ],
    ['in a hook', `beforeAll(() => {\n${SEARCH}\n});`, 'no test'],
    ['at module level', `const x = 1;\n${SEARCH}`, 'no test'],
    [
      'in an anonymous callback outside a test',
      `rows.map(() => {\n${SEARCH}\n});`,
      'no test',
    ],
    [
      'imported under another name',
      "const x = 1;\nimport { searched as s } from './source-files';",
      'another name',
    ],
    ['read as a value', 'const x = 1;\nrows.map(searched);', 'not called'],
  ])('refuses a search %s by line, never skips it', (_, source, why) => {
    // One refusal, on the line that writes it, saying why; and no site.
    expect(read(source)).toEqual({
      sites: [],
      tests: expect.any(Array),
      refused: [
        expect.stringMatching(new RegExp(`^fixture\\.test\\.ts:2: .*${why}`)),
      ],
    });
  });

  it('reads nothing a comment or a string spells', () => {
    expect(
      read(
        `// it('t', () => { ${SEARCH} });\nconst s = "searched(f, { of: p })";`,
      ),
    ).toEqual({ sites: [], tests: [], refused: [] });
  });

  it('reads the definition and its import as no site', () => {
    expect(
      read(
        "import { searched } from './source-files';\nexport function searched<T>(f: T[]) { return f; }",
      ),
    ).toEqual({ sites: [], tests: [], refused: [] });
  });
});

describe('vitestTestsWritten', () => {
  it.each([
    ['it', "it('t', () => {});", 1],
    ['it.each', "it.each([[1, 2]])('t %s', (a, b) => {});", 1],
    [
      'both, with a comment and a string spelling one',
      "it('a', () => {});\n// it('x', () => {})\nit.each([1])('b', () => {});\nconst s = \"it('y', f)\";",
      2,
    ],
    ['a method called it', "obj.it('t', () => {});", 0],
    ['describe and test', "describe('g', () => {});\ntest('t', () => {});", 0],
    // feature-terms.test.ts and lockdown.test.ts type their tables.
    [
      'it.each with type arguments',
      "it.each<[string, Array<number>]>([['a', [1]]])('t', (a, b) => {});",
      1,
    ],
  ])('counts %s as text', (_, source, count) => {
    expect(vitestTestsWritten(parseSource(source, 'fixture.test.ts'))).toBe(
      count,
    );
  });
});

describe('searchesWritten', () => {
  it.each([
    ['a call', 'searched(f, { of: p });', 1],
    // classroom-groups-print.spec.ts and verified-labels.test.ts spread one.
    ['a spread call', '[...searched(f, { of: p })];', 1],
    ['a call with type arguments', 'searched<string>(f, { of: p });', 1],
    ['a method of the same name', 'obj.searched(f);', 0],
    ['the definition', 'export function searched<T>(f: T[]) {}', 0],
    [
      'a comment and a string spelling one',
      "// searched(f)\nconst s = 'searched(f)';",
      0,
    ],
  ])('counts %s as text', (_, source, count) => {
    expect(searchesWritten(parseSource(source, 'fixture.test.ts'))).toBe(count);
  });
});

/** Every TypeScript file either runner reads: unit tests, specs and helpers. */
const FILES = tsFilesUnder('tests');
const READINGS = FILES.map((file) => {
  const sf = parseFile(file);
  return { file, sf, ...searchSitesIn(sf) };
});
const SITES = READINGS.flatMap(({ file, sites }) =>
  sites.map((site) => ({ file, ...site })),
);
const TESTS = READINGS.flatMap(({ file, tests }) =>
  tests.map((title) => `${file} › ${title}`),
);

/** How many floorless sites each scope holds today, by `file › label`. */
const floorlessNow = (): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const site of SITES)
    if (!site.floored) {
      const key = `${site.file} › ${site.label}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  return counts;
};

describe('every search checks a floor, or is listed (#515, #534)', () => {
  it('finds every scope holding exactly the floorless searches listed', () => {
    const now = floorlessNow();
    const keys = new Set([...now.keys(), ...Object.keys(FLOORLESS)]);
    const findings = [...keys]
      .filter((key) => (now.get(key) ?? 0) !== (FLOORLESS[key] ?? 0))
      .map((key) => {
        const [listed, read] = [FLOORLESS[key] ?? 0, now.get(key) ?? 0];
        return read > listed
          ? `${key}: ${read} searched with no floor, ${listed} listed. Check a recorded floor in the same test.`
          : `${key}: ${read} floorless, ${listed} listed. Lower the entry in tests/floorless-searches.burn-down.ts: the list only shrinks.`;
      });
    const refused = READINGS.flatMap(({ refused }) => refused);
    expect(
      searched(refused, { of: SITES, what: 'searched sites under tests/' }),
      refused.join('\n'),
    ).toEqual([]);
    expect(
      searched(findings, { of: SITES, what: 'searched sites under tests/' }),
      findings.join('\n'),
    ).toEqual([]);
    expect(
      floorBreach('floorless-searches/sites', SITES.length),
    ).toBeUndefined();
  });

  it('only shrinks the burn-down list', () => {
    // Measured when the meta-guard landed (274, 263), and raised once, by
    // the operator's own rule change, when #534 bound each floor to its
    // search's population (17 token-floored sites in 12 scopes). A
    // conversion lowers these with the list; nothing else raises them.
    const counts = Object.values(FLOORLESS);
    expect(counts.reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(48);
    expect(counts.length).toBeLessThanOrEqual(45);
    // The entries judged are the list's own: the floor falls with it, by hand,
    // in the conversion that removes an entry.
    expect(
      searched(
        counts.filter((n) => !Number.isInteger(n) || n < 1),
        {
          of: counts,
          what: 'burn-down entries',
        },
      ),
    ).toEqual([]);
    expect(
      floorBreach('floorless-searches/burn-down-entries', counts.length),
    ).toBeUndefined();
  });
});

describe('the search reader proves what it read (#515)', () => {
  it('reads as many searches in each file as its text writes, over every file git has', () => {
    // Independent of the parse tree (control c): `searched(` counted in each
    // file's code with literals and comments removed, against the sites and
    // refusals the reader returned for that file. The walk is checked against
    // git's own list, since both sides of the count are computed over it.
    const misread = READINGS.filter(
      ({ sf, sites, refused }) =>
        searchesWritten(sf) !== sites.length + refused.length,
    ).map(
      ({ file, sf, sites, refused }) =>
        `${file}: ${searchesWritten(sf)} written, ${sites.length + refused.length} read`,
    );
    expect(
      searched(misread, { of: FILES, what: 'TypeScript files under tests/' }),
      misread.join('\n'),
    ).toEqual([]);
    const known = committableFiles(
      (path) => path.startsWith('tests/') && /\.tsx?$/.test(path),
    );
    expect(
      searched(walkDisagreements(FILES, known), {
        of: FILES,
        what: 'files under tests/',
      }),
    ).toEqual([]);
    expect(
      floorBreach('floorless-searches/files', FILES.length),
    ).toBeUndefined();
  });

  it('reads as many tests in each file as its text writes', () => {
    // A site's scope is the test around it, so a test form the reader cannot
    // see sends its sites elsewhere: counted as text per file, vitest's and
    // Playwright's forms both (#477).
    const misread = READINGS.filter(
      ({ sf, tests }) =>
        testsWritten(sf) + vitestTestsWritten(sf) !== tests.length,
    ).map(
      ({ file, sf, tests }) =>
        `${file}: ${testsWritten(sf) + vitestTestsWritten(sf)} written, ${tests.length} read`,
    );
    // Judged over the tests read, which is what the floor below counts: a
    // floor on one population and a search over another check nothing
    // together (#534).
    expect(
      searched(misread, { of: TESTS, what: 'tests read under tests/' }),
      misread.join('\n'),
    ).toEqual([]);
    expect(
      floorBreach('floorless-searches/tests', TESTS.length),
    ).toBeUndefined();
  });
});
