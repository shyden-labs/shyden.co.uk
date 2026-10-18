import { describe, expect, it } from 'vitest';
import {
  ceilingBreaches,
  countChecks,
  countChecksParsed,
  decideCeilings,
  hiddenCheckNames,
  harnessCallsOf,
  indirectChecksOf,
  judgeSources,
  type CheckCounts,
  type ModuleReader,
} from '../ios-ceilings';

/**
 * The counts that hold every iPhone-only test file to a shrinking ceiling
 * (#858): a phone check is one test both phones run, so none is ever added
 * under `tests/device/ios/`. Every source below is written out by hand.
 */
const COUNTED: ReadonlyArray<{
  name: string;
  source: string;
  counts: CheckCounts;
}> = [
  {
    name: 'a test and its assertion',
    source: "test('a', () => { expect(1).toBe(1); });",
    counts: { tests: 1, assertions: 1 },
  },
  {
    name: 'it, and a soft and a polled assertion',
    source:
      "it('a', async () => { expect.soft(1).toBe(1); await expect.poll(() => 1).toBe(1); });",
    counts: { tests: 1, assertions: 2 },
  },
  {
    name: 'every modifier, and a table',
    source: [
      "test.only('a', () => {});",
      "test.skip('b', () => {});",
      "it.fails('c', () => {});",
      "test.each([1, 2])('d %i', () => {});",
      "test.skipIf(true)('e', () => {});",
      "test.concurrent('f', () => {});",
    ].join('\n'),
    counts: { tests: 6, assertions: 0 },
  },
  {
    name: "vitest's assert, bare and by method",
    source: "test('a', () => { assert(true); assert.equal(1, 1); });",
    counts: { tests: 1, assertions: 2 },
  },
  {
    name: 'a call split over lines',
    source:
      "test(\n  'a',\n  () => {\n    expect(\n      1,\n    ).toBe(1);\n  },\n);",
    counts: { tests: 1, assertions: 1 },
  },
  {
    name: 'an assertion with type arguments',
    source: "test('a', () => { expect<number>(1).toBe(1); });",
    counts: { tests: 1, assertions: 1 },
  },
  {
    name: 'a check inside a comment, which is not one',
    source:
      "// expect(1).toBe(1)\n/* test('b', () => {}) */\ntest('a', () => {});",
    counts: { tests: 1, assertions: 0 },
  },
  {
    name: 'names that only end in test, it or expect',
    source:
      '/re/.test(x); latest(1); hit(2); unexpect(3); suite.it(4); obj.expect(5);',
    counts: { tests: 0, assertions: 0 },
  },
  {
    name: "expect's other members, which assert nothing",
    source: 'expect.getState(); expect.extend({});',
    counts: { tests: 0, assertions: 0 },
  },
];

describe('counts the tests and assertions a file writes', () => {
  for (const { name, source, counts } of COUNTED) {
    it(name, () => {
      expect(countChecks(source)).toEqual(counts);
    });
  }
});

describe('the parse counts what the stripped text counts', () => {
  for (const { name, source, counts } of COUNTED) {
    it(name, () => {
      expect(countChecksParsed(source)).toEqual(counts);
    });
  }
  it('but not a check written inside a string, so the two disagree', () => {
    const source = "const s = 'expect(1)'; test('a', () => {});";
    expect([countChecks(source), countChecksParsed(source)]).toEqual([
      { tests: 1, assertions: 1 },
      { tests: 1, assertions: 0 },
    ]);
  });
});

describe('refuses a name that would hide a check from both counts', () => {
  it('an aliased import from vitest', () => {
    expect(
      hiddenCheckNames("import { expect as check, test } from 'vitest';"),
    ).toEqual(['check (imported as expect)']);
  });
  it('a namespace import of vitest', () => {
    expect(hiddenCheckNames("import * as v from 'vitest';")).toEqual([
      'v (namespace import of vitest)',
    ]);
  });
  it('a local name bound to a check', () => {
    expect(hiddenCheckNames('const check = expect;')).toEqual([
      'check (bound to expect)',
    ]);
  });
  it('and lets the ordinary import through, beside a refused one', () => {
    expect(
      hiddenCheckNames(
        "import { expect, test } from 'vitest';\nconst t = test;",
      ),
    ).toEqual(['t (bound to test)']);
  });
});

const FILE = 'tests/device/ios/journeys.journey.ts';

describe('reads every file both ways, refusing what it cannot count', () => {
  it('counts each file, and names a disagreement and a hidden name', () => {
    expect(
      judgeSources(
        new Map([
          ['a.ts', "test('a', () => { expect(1).toBe(1); });"],
          ['b.ts', "const s = 'expect(';"],
          ['c.ts', 'const check = expect;'],
        ]),
        reader({}),
      ),
    ).toEqual({
      counts: new Map([
        [
          'a.ts',
          { tests: 1, assertions: 1, indirectChecks: 0, harnessCalls: 0 },
        ],
        [
          'b.ts',
          { tests: 0, assertions: 1, indirectChecks: 0, harnessCalls: 0 },
        ],
        [
          'c.ts',
          { tests: 0, assertions: 0, indirectChecks: 0, harnessCalls: 0 },
        ],
      ]),
      refusals: [
        'b.ts: the text counts 0 tests and 1 assertions, the parse 0 and 0: a check is spelled where only one reader sees it',
        'c.ts: check (bound to expect) would carry a check past both counts',
      ],
    });
  });
});

describe('judges each file against its ceiling', () => {
  it('a file at its ceiling is no finding, beside one that rose', () => {
    expect(
      ceilingBreaches(
        new Map([
          [
            FILE,
            { tests: 15, assertions: 55, indirectChecks: 0, harnessCalls: 0 },
          ],
          [
            'tests/device/ios/session.ts',
            { tests: 0, assertions: 0, indirectChecks: 0, harnessCalls: 0 },
          ],
        ]),
        {
          [FILE]: {
            tests: 15,
            assertions: 54,
            indirectChecks: 0,
            harnessCalls: 0,
          },
          'tests/device/ios/session.ts': {
            tests: 0,
            assertions: 0,
            indirectChecks: 0,
            harnessCalls: 0,
          },
        },
      ),
    ).toEqual([
      `${FILE}: 55 assertions, ceiling 54. A phone check is one test both phones run: put it in the shared spec under tests/e2e/ that Android and the iPhone both run (#839), never in an iPhone-only file.`,
    ]);
  });
  it('a file below its ceiling, which is lowered by the recorder', () => {
    expect(
      ceilingBreaches(
        new Map([
          [
            FILE,
            { tests: 14, assertions: 54, indirectChecks: 0, harnessCalls: 0 },
          ],
        ]),
        {
          [FILE]: {
            tests: 15,
            assertions: 54,
            indirectChecks: 0,
            harnessCalls: 0,
          },
        },
      ),
    ).toEqual([
      `${FILE}: 14 tests, ceiling 15. Lower it: npm run ceilings:record (it only ever lowers).`,
    ]);
  });
  it('a new file holding a test, whose ceiling is 0', () => {
    expect(
      ceilingBreaches(
        new Map([
          [
            'tests/device/ios/x.journey.ts',
            { tests: 1, assertions: 0, indirectChecks: 0, harnessCalls: 0 },
          ],
        ]),
        {},
      ),
    ).toEqual([
      'tests/device/ios/x.journey.ts: 1 tests, ceiling 0. A phone check is one test both phones run: put it in the shared spec under tests/e2e/ that Android and the iPhone both run (#839), never in an iPhone-only file.',
    ]);
  });
  it('a file gone from the tree, whose ceiling still stands', () => {
    expect(
      ceilingBreaches(new Map(), {
        [FILE]: { tests: 1, assertions: 0, indirectChecks: 0, harnessCalls: 0 },
      }),
    ).toEqual([
      `${FILE}: 0 tests, ceiling 1. Lower it: npm run ceilings:record (it only ever lowers).`,
    ]);
  });
});

describe('the recorder only ever lowers', () => {
  it('the first record takes the figures as measured', () => {
    expect(
      decideCeilings(
        new Map([
          [
            FILE,
            { tests: 15, assertions: 54, indirectChecks: 0, harnessCalls: 0 },
          ],
        ]),
        undefined,
      ),
    ).toEqual({
      next: {
        [FILE]: {
          tests: 15,
          assertions: 54,
          indirectChecks: 0,
          harnessCalls: 0,
        },
      },
      refusals: [],
      deltas: [
        `${FILE}: tests none -> 15`,
        `${FILE}: assertions none -> 54`,
        `${FILE}: indirectChecks none -> 0`,
        `${FILE}: harnessCalls none -> 0`,
      ],
    });
  });
  it('lowers a fall and names it', () => {
    expect(
      decideCeilings(
        new Map([
          [
            FILE,
            { tests: 13, assertions: 54, indirectChecks: 0, harnessCalls: 0 },
          ],
        ]),
        {
          [FILE]: {
            tests: 15,
            assertions: 54,
            indirectChecks: 0,
            harnessCalls: 0,
          },
        },
      ),
    ).toEqual({
      next: {
        [FILE]: {
          tests: 13,
          assertions: 54,
          indirectChecks: 0,
          harnessCalls: 0,
        },
      },
      refusals: [],
      deltas: [`${FILE}: tests 15 -> 13`],
    });
  });
  it('refuses a rise, writing nothing', () => {
    expect(
      decideCeilings(
        new Map([
          [
            FILE,
            { tests: 15, assertions: 55, indirectChecks: 0, harnessCalls: 0 },
          ],
        ]),
        {
          [FILE]: {
            tests: 15,
            assertions: 54,
            indirectChecks: 0,
            harnessCalls: 0,
          },
        },
      ),
    ).toEqual({
      next: undefined,
      refusals: [
        `${FILE}: assertions 54 -> 55 is a rise; a ceiling only falls`,
      ],
      deltas: [`${FILE}: assertions 54 -> 55`],
    });
  });
  it('refuses a new file that holds a check', () => {
    expect(
      decideCeilings(
        new Map([
          [
            'tests/device/ios/x.journey.ts',
            { tests: 1, assertions: 0, indirectChecks: 0, harnessCalls: 0 },
          ],
        ]),
        {},
      ).refusals,
    ).toEqual([
      'tests/device/ios/x.journey.ts: tests 0 -> 1 is a rise; a ceiling only falls',
    ]);
  });
  it('drops a file gone from the tree', () => {
    expect(
      decideCeilings(new Map(), {
        [FILE]: { tests: 1, assertions: 0, indirectChecks: 0, harnessCalls: 0 },
      }),
    ).toEqual({
      next: {},
      refusals: [],
      deltas: [
        `${FILE}: tests 1 -> none`,
        `${FILE}: assertions 0 -> none`,
        `${FILE}: indirectChecks 0 -> none`,
        `${FILE}: harnessCalls 0 -> none`,
      ],
    });
  });
});

/** In-memory modules, so no unit test reads the tree. */
const reader =
  (modules: Readonly<Record<string, string>>): ModuleReader =>
  (path) =>
    Object.hasOwn(modules, path) ? modules[path] : undefined;

const JOURNEY = 'tests/device/ios/j.journey.ts';
const THROWS =
  "export function check(x: number): void { if (!x) throw new Error('no'); }";

const INDIRECT: ReadonlyArray<{
  name: string;
  modules: Record<string, string>;
  source: string;
  inBodies: number;
}> = [
  {
    name: 'a bare call to a shared helper that throws',
    modules: { 'tests/h.ts': THROWS },
    source: "import { check } from '../../h';\ntest('a', () => { check(1); });",
    inBodies: 1,
  },
  {
    name: 'a bare call to a shared helper that asserts',
    modules: {
      'tests/h.ts':
        "import { expect } from 'vitest';\nexport const sure = (x: number) => { expect(x).toBe(1); };",
    },
    source: "import { sure } from '../../h';\ntest('a', () => { sure(1); });",
    inBodies: 1,
  },
  {
    name: 'a helper that checks through another in its module',
    modules: {
      'tests/h.ts': `${THROWS}\nexport function outer(x: number) { check(x); }`,
    },
    source: "import { outer } from '../../h';\ntest('a', () => { outer(1); });",
    inBodies: 1,
  },
  {
    name: 'a helper that only returns, as coverGaps does, which is no check',
    modules: {
      'tests/h.ts': 'export const gaps = (x: number): number[] => [x];',
    },
    source:
      "import { gaps } from '../../h';\ntest('a', () => { expect(gaps(1)).toEqual([1]); });",
    inBodies: 0,
  },
  {
    name: 'a throw written in the test itself',
    modules: {},
    source:
      "test('a', () => { if (Math.random() > 2) throw new Error('x'); });",
    inBodies: 1,
  },
  {
    name: 'a hook body',
    modules: { 'tests/h.ts': THROWS },
    source: "import { check } from '../../h';\nbeforeAll(() => { check(1); });",
    inBodies: 1,
  },
  {
    name: 'a namespace import',
    modules: { 'tests/h.ts': THROWS },
    source: "import * as h from '../../h';\ntest('a', () => { h.check(1); });",
    inBodies: 1,
  },
  {
    name: 'a helper re-exported from another module',
    modules: {
      'tests/h.ts': THROWS,
      'tests/r.ts': "export { check } from './h';",
    },
    source: "import { check } from '../../r';\ntest('a', () => { check(1); });",
    inBodies: 1,
  },
  {
    name: 'a local helper that throws, called twice',
    modules: {},
    source:
      "function must(x: number) { if (!x) throw new Error('no'); }\ntest('a', () => { must(1); must(2); });",
    inBodies: 2,
  },
  {
    name: 'a call outside every test and hook, which no test runs as a check',
    modules: { 'tests/h.ts': THROWS },
    source: "import { check } from '../../h';\ncheck(1);\ntest('a', () => {});",
    inBodies: 0,
  },
  {
    name: 'a helper called with type arguments',
    modules: { 'tests/h.ts': THROWS },
    source:
      "import { check } from '../../h';\ntest('a', () => { check<number>(1); });",
    inBodies: 1,
  },
  {
    name: 'a library call, which is not a shared helper',
    modules: {},
    source:
      "import { readFileSync } from 'node:fs';\ntest('a', () => { readFileSync('x'); });",
    inBodies: 0,
  },
];

describe('counts the checks a test makes through a helper or a throw', () => {
  for (const { name, modules, source, inBodies } of INDIRECT) {
    it(name, () => {
      expect(indirectChecksOf(JOURNEY, source, reader(modules)).inBodies).toBe(
        inBodies,
      );
    });
  }
});

describe('reads the indirect checks twice, through the text and the parse', () => {
  for (const { name, modules, source } of INDIRECT) {
    it(name, () => {
      const read = indirectChecksOf(JOURNEY, source, reader(modules));
      expect(read.textWhole).toBe(read.parsedWhole);
    });
  }
  it('but not a helper call spelled inside a string, so the two disagree', () => {
    const read = indirectChecksOf(
      JOURNEY,
      "import { check } from '../../h';\nconst s = 'check(';\ntest('a', () => { check(1); });",
      reader({ 'tests/h.ts': THROWS }),
    );
    expect([read.textWhole, read.parsedWhole]).toEqual([2, 1]);
  });
});

describe('refuses a called helper it cannot follow', () => {
  it('a check helper passed by reference, which neither reader counts', () => {
    expect(
      indirectChecksOf(
        JOURNEY,
        "import { check } from '../../h';\ntest('a', () => { [1, 2].forEach(check); });",
        reader({ 'tests/h.ts': THROWS }),
      ).refusals,
    ).toEqual([
      `${JOURNEY}: check is passed by reference, so neither reader can count its calls: call it directly`,
    ]);
  });
  it('an import from a module that is not there', () => {
    expect(
      indirectChecksOf(
        JOURNEY,
        "import { gone } from '../../gone';\ntest('a', () => { gone(); });",
        reader({}),
      ).refusals,
    ).toEqual([
      `${JOURNEY}: gone is called, imported from '../../gone', which cannot be followed`,
    ]);
  });
  it('a name its module does not declare', () => {
    expect(
      indirectChecksOf(
        JOURNEY,
        "import { missing } from '../../h';\ntest('a', () => { missing(); });",
        reader({ 'tests/h.ts': THROWS }),
      ).refusals,
    ).toEqual([
      `${JOURNEY}: missing is called, imported from '../../h', which cannot be followed`,
    ]);
  });
});

const START = 'export async function start() { return {}; }';
const OPENS =
  "import { start } from '../../s';\nlet session;\nbeforeAll(async () => { session = await start(); });\n";

const HARNESS: ReadonlyArray<{
  name: string;
  source: string;
  inBodies: number;
}> = [
  {
    name: 'a method on the session a harness function returned',
    source: `${OPENS}test('a', async () => { await session.tap(1); });`,
    inBodies: 1,
  },
  {
    name: 'a method reached through the session’s properties',
    source: `${OPENS}test('a', async () => { await session.driver.find(1); });`,
    inBodies: 1,
  },
  {
    name: 'a method on a value a harness call returned',
    source: `${OPENS}test('a', async () => { const el = await session.find(1); await el.text(); });`,
    inBodies: 2,
  },
  {
    name: 'a method on a name destructured from the session',
    source: `${OPENS}test('a', async () => { const { driver } = session; await driver.find(1); });`,
    inBodies: 1,
  },
  {
    name: 'a local helper handed the session',
    source: `${OPENS}async function helper(s) { await s.tap(); }\ntest('a', async () => { await helper(session); });`,
    inBodies: 1,
  },
  {
    name: 'a local helper that reads the session itself',
    source: `${OPENS}async function helper() { await session.tap(); }\ntest('a', async () => { await helper(); });`,
    inBodies: 1,
  },
  {
    name: 'a method with type arguments, as executeScript is called',
    source: `${OPENS}test('a', async () => { await session.driver.run<Record<string, string>>(1); });`,
    inBodies: 1,
  },
  {
    name: 'built-ins, which are not the harness',
    source: `${OPENS}test('a', () => { console.log(1); JSON.stringify(1); Math.round(1); });`,
    inBodies: 0,
  },
  {
    name: 'a harness call outside every test and hook',
    source: `${OPENS}void session?.tap;\ntest('a', () => {});`,
    inBodies: 0,
  },
];

describe('counts every call into the harness a test makes', () => {
  for (const { name, source, inBodies } of HARNESS) {
    it(name, () => {
      expect(
        harnessCallsOf(JOURNEY, source, reader({ 'tests/s.ts': START }))
          .inBodies,
      ).toBe(inBodies);
    });
  }
});

describe('reads the harness calls twice, through the text and the parse', () => {
  for (const { name, source } of HARNESS) {
    it(name, () => {
      const read = harnessCallsOf(
        JOURNEY,
        source,
        reader({ 'tests/s.ts': START }),
      );
      expect(read.textWhole).toBe(read.parsedWhole);
    });
  }
  it('but not a session call spelled inside a string, so the two disagree', () => {
    const read = harnessCallsOf(
      JOURNEY,
      `${OPENS}const s = 'session.tap(';\ntest('a', async () => { await session.tap(1); });`,
      reader({ 'tests/s.ts': START }),
    );
    expect([read.textWhole, read.parsedWhole]).toEqual([2, 1]);
  });
});

describe('refuses a harness call it cannot read', () => {
  it('a method named in brackets', () => {
    expect(
      harnessCallsOf(
        JOURNEY,
        `${OPENS}test('a', async () => { await session['tap'](1); });`,
        reader({ 'tests/s.ts': START }),
      ).refusals,
    ).toEqual([
      `${JOURNEY}: session is called through brackets, which neither reader can count: name the method`,
    ]);
  });
});
