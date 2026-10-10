import { describe, it, expect } from 'vitest';
import { parseFile, parseSource, where } from '../unit/ast';
import { specDirs } from '../spec-dirs';
import { searched, tsFilesUnder } from '../source-files';
import { floorBreach } from '../floors';
import {
  callsIn,
  declarationsIn,
  enclosingDeclaration,
  testsWritten,
  useCallsIn,
} from '../playwright-declarations';

const source = (...lines: string[]) =>
  parseSource(lines.join('\n'), 'synthetic.spec.ts');

/** Every call in `sf` whose callee ends in `.setViewportSize`. */
const resizes = (sf: ReturnType<typeof source>) =>
  callsIn(sf).filter((call) =>
    call.expression.getText(sf).endsWith('.setViewportSize'),
  );

describe('declarationsIn() reads Playwright declarations from the parse tree', () => {
  it('finds a test and a describe in every form Playwright registers one', () => {
    const sf = source(
      "test('plain', async () => {});",
      "test.only('only', async () => {});",
      "test.skip('skipped', async () => {});",
      "test.fixme('parked', async () => {});",
      "test.fail('expected to fail', async () => {});",
      "test.describe('group', () => {});",
      "test.describe.only('only group', () => {});",
      "test.describe.skip('skipped group', () => {});",
      "test.describe.fixme('parked group', () => {});",
      "test.describe.serial('serial group', () => {});",
      "test.describe.parallel.only('parallel only group', () => {});",
      'test.describe(() => {});',
      // Playwright 1.49's focused expected failure, and the two group forms
      // no line above declared: each is an entry no test read (#390 F155).
      "test.fail.only('focused, expected to fail', async () => {});",
      "test.describe.serial.only('serial only group', () => {});",
      "test.describe.parallel('parallel group', () => {});",
    );

    expect(
      declarationsIn(sf).map(({ kind, modifier, title, line }) => [
        kind,
        modifier,
        title,
        line,
      ]),
    ).toEqual([
      ['test', '', 'plain', 1],
      ['test', 'only', 'only', 2],
      ['test', 'skip', 'skipped', 3],
      ['test', 'fixme', 'parked', 4],
      ['test', 'fail', 'expected to fail', 5],
      ['describe', '', 'group', 6],
      ['describe', 'only', 'only group', 7],
      ['describe', 'skip', 'skipped group', 8],
      ['describe', 'fixme', 'parked group', 9],
      ['describe', '', 'serial group', 10],
      ['describe', 'only', 'parallel only group', 11],
      ['describe', '', '', 12],
      ['test', 'only', 'focused, expected to fail', 13],
      ['describe', 'only', 'serial only group', 14],
      ['describe', '', 'parallel group', 15],
    ]);
  });

  it('does not count a runtime skip, fixme or fail, whatever its arguments', () => {
    // The overloads that share a declaration's spelling. The regex guards told
    // them apart by a quote after the parenthesis; a declaration is told apart
    // here by its shape: a title first, and a callback last.
    const sf = source(
      "test('outer', async ({ browserName }) => {",
      "  test.skip(browserName === 'webkit', 'not on WebKit');",
      "  test.fixme(true, 'parked at runtime');",
      '  test.skip();',
      "  test.fail(browserName === 'firefox', 'known on Firefox');",
      '  test.slow();',
      '});',
      "test.skip(({ browserName }) => browserName === 'webkit');",
      "test.fixme(({ isMobile }) => isMobile, 'no phone layout yet');",
    );

    expect(declarationsIn(sf).map(({ title }) => title)).toEqual(['outer']);
  });

  it('does not count a step, a hook, a configure call or a use call', () => {
    const sf = source(
      "test.describe('group', () => {",
      "  test.describe.configure({ mode: 'serial' });",
      "  test.use({ locale: 'en-GB' });",
      '  test.beforeEach(async () => {});',
      "  test.beforeAll('a named hook', async () => {});",
      "  test('inner', async () => {",
      "    await test.step('a step', async () => {});",
      '  });',
      '});',
    );

    expect(declarationsIn(sf).map(({ title }) => title)).toEqual([
      'group',
      'inner',
    ]);
  });

  it('reads a title however it is quoted, and when prettier wraps it onto its own line', () => {
    const sf = source(
      "test('single', async () => {});",
      'test("double", async () => {});',
      'test(`template`, async () => {});',
      'test(',
      "  'wrapped',",
      '  async () => {},',
      ');',
      'for (const w of [320]) {',
      '  test(`${w}px fits`, async () => {});',
      '}',
    );

    expect(declarationsIn(sf).map(({ title, line }) => [title, line])).toEqual([
      ['single', 1],
      ['double', 2],
      ['template', 3],
      ['wrapped', 4],
      ['`${w}px fits`', 9],
    ]);
  });

  it('reads the tags a details object names, as one string or a list', () => {
    const sf = source(
      "test('one', { tag: '@a' }, async () => {});",
      "test('two', { tag: ['@a', '@b'] }, async () => {});",
      "test('none', async () => {});",
      "test('other details', { annotation: { type: 'issue', description: '#1' } }, async () => {});",
      "test.describe('a tagged group', { tag: '@c' }, () => {});",
    );

    expect(
      declarationsIn(sf).map(({ title, tags, unreadable }) => [
        title,
        tags,
        unreadable,
      ]),
    ).toEqual([
      ['one', ['@a'], undefined],
      ['two', ['@a', '@b'], undefined],
      ['none', [], undefined],
      ['other details', [], undefined],
      ['a tagged group', ['@c'], undefined],
    ]);
  });

  it('names tags it cannot read, instead of reading them as no tags', () => {
    // A tag the reader cannot see, read as "no tags", would hide a stale tag
    // and invent a missing one. It is reported as unreadable instead.
    const sf = source(
      "test('by name', { tag: TAG }, async () => {});",
      "test('by spread', { ...shared }, async () => {});",
      "test('details by name', details, async () => {});",
      "test('an element by name', { tag: ['@a', TAG] }, async () => {});",
    );

    expect(
      declarationsIn(sf).map(({ title, unreadable }) => [title, unreadable]),
    ).toEqual([
      ['by name', 'a tag that is not a string literal'],
      ['by spread', 'a spread in its details'],
      ['details by name', 'details that are not an object literal'],
      ['an element by name', 'a tag that is not a string literal'],
    ]);
  });

  it('sees no declaration in a comment or a string, however it is spelled', () => {
    // A comment stripper handles the first two. A regex over stripped text
    // still reads the last two as declarations.
    const sf = source(
      "// test('in a line comment', async () => {});",
      "/* test.fixme('in a block comment', async () => {}); */",
      'const s = "test(\'in a string\', async () => {})";',
      "const t = `test.describe('in a template', () => {})`;",
      "test('real', async () => {});",
    );

    expect(declarationsIn(sf).map(({ title }) => title)).toEqual(['real']);
  });
});

describe('enclosingDeclaration() places a call by containment, not by line order', () => {
  it('places a call in the innermost declaration whose callback holds it', () => {
    const sf = source(
      "test.describe('group', () => {",
      "  test('first', async ({ page }) => {",
      "    await page.goto('/');",
      '  });',
      '  test.beforeEach(async ({ page }) => {',
      '    await page.setViewportSize({ width: 1, height: 1 });',
      '  });',
      "  test('second', async ({ page }) => {",
      '    await page.setViewportSize({ width: 2, height: 2 });',
      '  });',
      '});',
      'async function helper(page) {',
      '  await page.setViewportSize({ width: 3, height: 3 });',
      '}',
    );
    const declarations = declarationsIn(sf);

    // Line order puts line 6 in 'first' and line 13 in 'second'. Neither is
    // inside that test: the hook belongs to the group, the helper to nothing.
    expect(
      resizes(sf).map((call) => [
        sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1,
        enclosingDeclaration(call, declarations)?.title,
      ]),
    ).toEqual([
      [6, 'group'],
      [9, 'second'],
      [13, undefined],
    ]);
  });

  it('does not place a call in a declaration it only appears in the title or details of', () => {
    const sf = source(
      "test.describe('group', () => {",
      "  test(title('x'), { tag: tagFor('y') }, async () => {});",
      '});',
    );
    const declarations = declarationsIn(sf);
    const calls = callsIn(sf).filter((call) =>
      ['title', 'tagFor'].includes(call.expression.getText(sf)),
    );

    expect(
      calls.map((call) => enclosingDeclaration(call, declarations)?.title),
    ).toEqual(['group', 'group']);
  });
});

describe('useCallsIn() reads what a test.use() sets', () => {
  it('reads each option it names, including a shorthand one', () => {
    const sf = source(
      "test.describe('a', () => {",
      '  test.use({ javaScriptEnabled: false });',
      '});',
      'for (const { viewport } of WIDTHS) {',
      "  test.describe('b', () => {",
      '    test.use({ viewport });',
      '  });',
      '}',
    );

    expect(
      useCallsIn(sf).map(({ line, options, unreadable }) => [
        line,
        Object.fromEntries(
          [...options].map(([name, value]) => [name, value.getText(sf)]),
        ),
        unreadable,
      ]),
    ).toEqual([
      [2, { javaScriptEnabled: 'false' }, undefined],
      [6, { viewport: 'viewport' }, undefined],
    ]);
  });

  it('names options it cannot read, instead of reading them as none', () => {
    const sf = source('test.use({ ...options });', 'test.use(1);');

    expect(useCallsIn(sf).map(({ unreadable }) => unreadable)).toEqual([
      'a spread in its options',
      'options that are not an object literal',
    ]);
  });

  it('names a shared options object rather than calling it unreadable', () => {
    // `test.use(recorded)` DOES set options; this reader just cannot list
    // them. Reporting that as unreadable and reporting it as a named shared
    // object are different facts, and only the second lets a guard state a
    // policy about which shared objects are allowed.
    const sf = source('test.use(recorded);', 'test.use({ viewport });');

    expect(
      useCallsIn(sf).map(({ shared, unreadable }) => [shared, unreadable]),
    ).toEqual([
      ['recorded', undefined],
      [undefined, undefined],
    ]);
  });
});

describe('testsWritten() counts the tests a file writes, as text (#477)', () => {
  // The per-file cross-check on the parse tree's reader. Written out by
  // hand, never generated from a reader's list (#446).
  const counted = [
    "test('a', async ({ page }) => {});",
    'test("a", () => {});',
    'test(`a ${b}`, async () => {});',
    'test(title, async () => {});',
    "test('a', { tag: '@x' }, async () => {});",
    "test('a', function () {});",
    "test('a', page => {});",
    "test.only('a', async () => {});",
    "test.skip('a', async () => {});",
    "test.fixme('a', async () => {});",
    "test.fail.only('a', async () => {});",
    "test(\n  'a',\n  async () => {},\n);",
  ];
  const notCounted = [
    "test.skip(isMobile, 'a reason');",
    "test.describe('g', () => {});",
    'test.beforeEach(async ({ page }) => {});',
    'test.use({ viewport: { width: 320, height: 640 } });',
    "await test.step('s', async () => {});",
    'const s = "test(\'a\', async () => {})";',
    "// test('a', async () => {});",
    "it('a', () => {});",
    "latest('a', () => {});",
  ];

  it('counts every way a spec writes a test', () => {
    const missed = counted.filter((line) => testsWritten(source(line)) !== 1);
    expect(searched(missed, { of: counted, what: 'planted tests' })).toEqual(
      [],
    );
    // A planted form deleted from the table would go unread with this green.
    expect(
      floorBreach('playwright-declarations/planted-tests', counted.length),
    ).toBeUndefined();
  });

  it('counts nothing that is not a test', () => {
    const misread = notCounted.filter(
      (line) => testsWritten(source(line)) !== 0,
    );
    expect(
      searched(misread, { of: notCounted, what: 'planted non-tests' }),
    ).toEqual([]);
    expect(
      floorBreach(
        'playwright-declarations/planted-non-tests',
        notCounted.length,
      ),
    ).toBeUndefined();
  });
});

describe('every declaration and test.use() in the spec corpus can be read', () => {
  it('no tag or use option is written in a form the guards would misread', () => {
    const files = specDirs().flatMap(tsFilesUnder);
    const parsed = files.map((file) => parseFile(file));
    const declarations = parsed.flatMap((sf) => declarationsIn(sf));
    const uses = parsed.flatMap((sf) => useCallsIn(sf));

    const unreadable = [
      ...declarations.flatMap(({ call, unreadable }) =>
        unreadable
          ? [`${where(call.getSourceFile(), call)}: ${unreadable}`]
          : [],
      ),
      ...uses.flatMap(({ call, unreadable }) =>
        unreadable
          ? [`${where(call.getSourceFile(), call)}: ${unreadable}`]
          : [],
      ),
    ];
    const titles = declarations.map(({ title }) => title);
    expect(
      searched(unreadable, {
        of: titles,
        what: 'declarations',
      }),
      unreadable.join('\n'),
    ).toEqual([]);
    expect(
      floorBreach('playwright-declarations/declarations', titles.length),
    ).toBeUndefined();
  });

  it('the only shared options object is the recording opt-in, from its home', () => {
    // The exception to "options are an object literal" is exactly one, and it
    // is stated HERE rather than hidden in the reader. A spec may hand
    // `test.use()` a name only when that name is `recorded` and it came from
    // `./evidence` -- the single home `video:` is allowed to live in (#214).
    // Any other name reads as options this corpus cannot check, which is the
    // thing the guard above exists to prevent.
    const files = specDirs().flatMap(tsFilesUnder);
    const wrong: string[] = [];
    const sharedUses: string[] = [];
    for (const file of files) {
      const sf = parseFile(file);
      for (const use of useCallsIn(sf)) {
        if (use.shared === undefined) continue;
        sharedUses.push(`${where(sf, use.call)}: ${use.shared}`);
        const text = sf.getFullText();
        if (use.shared !== 'recorded')
          wrong.push(`${where(sf, use.call)}: shared options "${use.shared}"`);
        else if (
          !/import \{[^}]*\brecorded\b[^}]*\} from '\.\/evidence'/.test(text)
        )
          wrong.push(
            `${where(sf, use.call)}: recorded not imported from './evidence'`,
          );
      }
    }
    // The repo's idiom rather than a hand-rolled `toBeGreaterThan(0)`: it
    // counts the population by CONTENT, and its failure text carries the
    // lesson a bare comparison does not.
    expect(
      searched(wrong, { of: sharedUses, what: 'shared options objects' }),
      wrong.join('\n'),
    ).toEqual([]);
    expect(
      floorBreach('playwright-declarations/shared-uses', sharedUses.length),
    ).toBeUndefined();
  });
});
