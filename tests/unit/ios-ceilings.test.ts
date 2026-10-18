import { describe, expect, it } from 'vitest';
import {
  ceilingBreaches,
  countChecks,
  countChecksParsed,
  decideCeilings,
  hiddenCheckNames,
  judgeSources,
  type CheckCounts,
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
      ),
    ).toEqual({
      counts: new Map([
        ['a.ts', { tests: 1, assertions: 1 }],
        ['b.ts', { tests: 0, assertions: 1 }],
        ['c.ts', { tests: 0, assertions: 0 }],
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
          [FILE, { tests: 15, assertions: 55 }],
          ['tests/device/ios/session.ts', { tests: 0, assertions: 0 }],
        ]),
        {
          [FILE]: { tests: 15, assertions: 54 },
          'tests/device/ios/session.ts': { tests: 0, assertions: 0 },
        },
      ),
    ).toEqual([
      `${FILE}: 55 assertions, ceiling 54. A phone check is one test both phones run: put it in the shared spec under tests/e2e/ that Android and the iPhone both run (#839), never in an iPhone-only file.`,
    ]);
  });
  it('a file below its ceiling, which is lowered by the recorder', () => {
    expect(
      ceilingBreaches(new Map([[FILE, { tests: 14, assertions: 54 }]]), {
        [FILE]: { tests: 15, assertions: 54 },
      }),
    ).toEqual([
      `${FILE}: 14 tests, ceiling 15. Lower it: npm run ceilings:record (it only ever lowers).`,
    ]);
  });
  it('a new file holding a test, whose ceiling is 0', () => {
    expect(
      ceilingBreaches(
        new Map([
          ['tests/device/ios/x.journey.ts', { tests: 1, assertions: 0 }],
        ]),
        {},
      ),
    ).toEqual([
      'tests/device/ios/x.journey.ts: 1 tests, ceiling 0. A phone check is one test both phones run: put it in the shared spec under tests/e2e/ that Android and the iPhone both run (#839), never in an iPhone-only file.',
    ]);
  });
  it('a file gone from the tree, whose ceiling still stands', () => {
    expect(
      ceilingBreaches(new Map(), { [FILE]: { tests: 1, assertions: 0 } }),
    ).toEqual([
      `${FILE}: 0 tests, ceiling 1. Lower it: npm run ceilings:record (it only ever lowers).`,
    ]);
  });
});

describe('the recorder only ever lowers', () => {
  it('the first record takes the figures as measured', () => {
    expect(
      decideCeilings(
        new Map([[FILE, { tests: 15, assertions: 54 }]]),
        undefined,
      ),
    ).toEqual({
      next: { [FILE]: { tests: 15, assertions: 54 } },
      refusals: [],
      deltas: [`${FILE}: tests none -> 15`, `${FILE}: assertions none -> 54`],
    });
  });
  it('lowers a fall and names it', () => {
    expect(
      decideCeilings(new Map([[FILE, { tests: 13, assertions: 54 }]]), {
        [FILE]: { tests: 15, assertions: 54 },
      }),
    ).toEqual({
      next: { [FILE]: { tests: 13, assertions: 54 } },
      refusals: [],
      deltas: [`${FILE}: tests 15 -> 13`],
    });
  });
  it('refuses a rise, writing nothing', () => {
    expect(
      decideCeilings(new Map([[FILE, { tests: 15, assertions: 55 }]]), {
        [FILE]: { tests: 15, assertions: 54 },
      }),
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
          ['tests/device/ios/x.journey.ts', { tests: 1, assertions: 0 }],
        ]),
        {},
      ).refusals,
    ).toEqual([
      'tests/device/ios/x.journey.ts: tests 0 -> 1 is a rise; a ceiling only falls',
    ]);
  });
  it('drops a file gone from the tree', () => {
    expect(
      decideCeilings(new Map(), { [FILE]: { tests: 1, assertions: 0 } }),
    ).toEqual({
      next: {},
      refusals: [],
      deltas: [`${FILE}: tests 1 -> none`, `${FILE}: assertions 0 -> none`],
    });
  });
});
