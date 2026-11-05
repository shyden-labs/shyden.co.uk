import { describe, expect, it } from 'vitest';
import { parseSource } from './ast';
import { budgetsIn, budgetsSpelled } from '../playwright-budgets';

const source = (...lines: string[]) => parseSource(lines.join('\n'));

const read = (...lines: string[]) =>
  budgetsIn(source(...lines)).map(({ how, line, unreadable }) =>
    unreadable === undefined ? [how, line] : [how, line, unreadable],
  );

/**
 * Every way a Playwright test can leave its budget, each written out by hand
 * rather than generated from the reader's own list, which could not see that
 * list drop one. The budget sits on the fixture's last line, so the lines
 * before it are read and must add nothing. `spelled` is what the text count
 * sees: it cannot read a destructuring, and the parse tree can.
 */
const FORMS: readonly {
  form: string;
  lines: string[];
  how: 'setTimeout' | 'slow' | 'configure';
  unreadable?: string;
  spelled: number;
}[] = [
  {
    form: 'test.setTimeout(ms)',
    lines: ["test('a', async () => {", '  test.setTimeout(120_000);'],
    how: 'setTimeout',
    spelled: 1,
  },
  {
    form: 'testInfo.setTimeout(ms)',
    lines: [
      "test('a', async ({ page }, testInfo) => {",
      '  testInfo.setTimeout(45000);',
    ],
    how: 'setTimeout',
    spelled: 1,
  },
  {
    form: 'setTimeout on a TestInfo under any parameter name',
    lines: ["test('a', async ({}, info) => {", '  info.setTimeout(45000);'],
    how: 'setTimeout',
    spelled: 1,
  },
  {
    form: 'test.info().setTimeout(ms)',
    lines: ["test('a', async () => {", '  test.info().setTimeout(60_000);'],
    how: 'setTimeout',
    spelled: 1,
  },
  {
    form: 'a budget that is not a literal',
    lines: [
      'const LONG = 60_000;',
      "test('a', async () => {",
      '  test.setTimeout(2 * LONG);',
    ],
    how: 'setTimeout',
    spelled: 1,
  },
  {
    form: 'setTimeout in a fixture',
    lines: [
      'export const t = base.extend({',
      '  f: async ({}, use, testInfo) => {',
      '    testInfo.setTimeout(90_000);',
    ],
    how: 'setTimeout',
    spelled: 1,
  },
  {
    form: 'setTimeout in a hook',
    lines: [
      'test.beforeEach(async ({}, testInfo) => {',
      '  testInfo.setTimeout(90_000);',
    ],
    how: 'setTimeout',
    spelled: 1,
  },
  {
    form: 'test.slow()',
    lines: ["test('a', async () => {", '  test.slow();'],
    how: 'slow',
    spelled: 1,
  },
  {
    form: 'test.slow(condition, reason)',
    lines: [
      "test('a', async ({ browserName }) => {",
      "  test.slow(browserName === 'webkit', 'slow on WebKit');",
    ],
    how: 'slow',
    spelled: 1,
  },
  {
    form: 'test.slow at the top of a file',
    lines: ["test.slow(({ isMobile }) => isMobile, 'phones');"],
    how: 'slow',
    spelled: 1,
  },
  {
    form: 'testInfo.slow()',
    lines: ["test('a', async ({}, testInfo) => {", '  testInfo.slow();'],
    how: 'slow',
    spelled: 1,
  },
  {
    form: 'test.info().slow()',
    lines: ["test('a', async () => {", '  test.info().slow();'],
    how: 'slow',
    spelled: 1,
  },
  {
    form: 'test.describe.configure({ timeout })',
    lines: [
      "test.describe('e', () => {",
      '  test.describe.configure({ timeout: 90_000 });',
    ],
    how: 'configure',
    spelled: 1,
  },
  {
    form: 'configure with a timeout among other options',
    lines: ["test.describe.configure({ mode: 'serial', timeout: 90_000 });"],
    how: 'configure',
    spelled: 1,
  },
  {
    form: 'configure on an aliased test, the timeout in shorthand',
    lines: ['const timeout = 90_000;', 'base.describe.configure({ timeout });'],
    how: 'configure',
    spelled: 1,
  },
  {
    form: 'configure with options it cannot list',
    lines: ['test.describe.configure(SHARED);'],
    how: 'configure',
    unreadable: 'options that cannot be listed',
    spelled: 1,
  },
  {
    form: 'configure with a spread in its options',
    lines: ["test.describe.configure({ mode: 'serial', ...more });"],
    how: 'configure',
    unreadable: 'options that cannot be listed',
    spelled: 1,
  },
  {
    form: "test['setTimeout'](ms)",
    lines: ["test('a', async () => {", "  test['setTimeout'](5000);"],
    how: 'setTimeout',
    spelled: 1,
  },
  {
    form: "test['slow']()",
    lines: ["test('a', async () => {", "  test['slow']();"],
    how: 'slow',
    spelled: 1,
  },
  {
    form: "test.describe['configure']({ timeout })",
    lines: ["test.describe['configure']({ timeout: 90_000 });"],
    how: 'configure',
    spelled: 1,
  },
  {
    form: 'slow taken by reference',
    lines: ['const later = test.slow;'],
    how: 'slow',
    unreadable: 'a budget method taken by reference',
    spelled: 1,
  },
  {
    form: 'setTimeout passed by reference',
    lines: [
      "test('a', async ({}, testInfo) => {",
      '  [90_000].forEach(testInfo.setTimeout);',
    ],
    how: 'setTimeout',
    unreadable: 'a budget method taken by reference',
    spelled: 1,
  },
  {
    form: 'slow destructured',
    lines: ['const { slow } = test;'],
    how: 'slow',
    unreadable: 'a budget method taken by reference',
    spelled: 0,
  },
  {
    form: 'setTimeout destructured under another name',
    lines: [
      "test('a', async ({}, testInfo) => {",
      '  const { setTimeout: budget } = testInfo;',
    ],
    how: 'setTimeout',
    unreadable: 'a budget method taken by reference',
    spelled: 0,
  },
];

describe('budgetsIn() reads every way a test leaves its budget', () => {
  for (const { form, lines, how, unreadable, spelled } of FORMS) {
    it(`reads ${form}`, () => {
      const line = lines.length;
      expect(read(...lines)).toEqual([
        unreadable === undefined ? [how, line] : [how, line, unreadable],
      ]);
    });

    it(`counts ${form} from its text`, () => {
      expect(budgetsSpelled(lines.join('\n'))).toBe(spelled);
    });
  }
});

/**
 * Everything that only looks like a budget, then one budget on the last line:
 * the reader must read that one and nothing before it, which proves both that
 * it reads the file and that it passes over the rest.
 */
const LOOKALIKES = [
  'setTimeout(() => {}, 30_000);',
  'await new Promise((resolve) => setTimeout(resolve, 100));',
  'window.setTimeout(() => {}, 30_000);',
  'globalThis.setTimeout(() => {}, 30_000);',
  'self.setTimeout(() => {}, 30_000);',
  "test.describe.configure({ mode: 'serial' });",
  '// test.setTimeout(120_000);',
  '/* test.slow(); */',
  "const s = 'test.slow()';",
  'const t = `test.setTimeout(${n})`;',
  // An assertion's or an action's own wait, spent inside the test's budget:
  // it can never make a test run longer than the config allows.
  'await expect(page.locator("#a")).toBeVisible({ timeout: 5000 });',
  "await page.click('#a', { timeout: 5000 });",
  'page.setDefaultTimeout(5000);',
  'const slow = 3;',
  'test.setTimeout(1);',
];

describe('budgetsIn() passes over what only looks like a budget', () => {
  it('reads only the budget after the lookalikes', () => {
    expect(read(...LOOKALIKES)).toEqual([['setTimeout', LOOKALIKES.length]]);
  });

  it('counts that budget and the two spelled in strings from the text', () => {
    // The count reads comment-free text, and the shared stripper keeps
    // strings: `'test.slow()'` and the template count. Over, never under, so
    // a spec holding one is refused by the cross-check and named, not passed.
    expect(budgetsSpelled(LOOKALIKES.join('\n'))).toBe(3);
  });
});
