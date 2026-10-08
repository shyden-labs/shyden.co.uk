import { describe, it, expect } from 'vitest';
import {
  declarationsRead,
  expectNothingFound,
  type Reading,
} from '../unit/spec-scan';
import ts from 'typescript';
import { parseSource } from '../unit/ast';
import { declarationsIn, type Declaration } from '../playwright-declarations';

/**
 * "Tracked, not hidden" has to be TRUE, not merely written.
 *
 * #32 was filed because `tests/e2e/classroom-groups.spec.ts` parked two real
 * viewport-fit failures as `test.fixme` under a comment that said they were
 * "tracked, not hidden" -- and no issue covering viewport fit existed in this
 * repo, open or closed. The product genuinely overflowed the fold at 320x568
 * and 375x667, no test failed, and the Playwright summary reported the two
 * rows as "skipped", which is indistinguishable from a legitimate conditional
 * skip. A claim nobody could fail is how that survived. This file is what
 * makes the claim falsifiable: a parked test must name an issue, or the suite
 * goes red.
 *
 * WHAT IS A DECLARATION, AND WHAT IS NOT. Playwright spells two entirely
 * different things the same way:
 *
 *   test.skip(browserName === 'webkit', 'Safari omits plain links...')  <- runtime
 *   test.fixme('the tool fits at 320x568', async ({ page }) => { ... })  <- declaration
 *
 * The first is a runtime guard INSIDE a running test: the assertion would be
 * invalid on that engine, the reason is stated at the call site, and it needs
 * no ticket because nothing is broken. The second parks a test that SHOULD
 * pass. Only the second is this guard's business. The parser tells them apart
 * by shape (`tests/playwright-declarations.ts`): a declaration passes a title
 * first and a callback last, and the runtime overload passes neither.
 *
 * WHERE THE REFERENCE MAY SIT. In the unbroken run of comments directly above
 * the declaration -- a blank line ends it, because a comment separated from
 * the test it documents is not that test's comment -- or in the declaration's
 * own header: its title, its details, and any comment written among them.
 * Until #218 this walked the text with regexes, and a reference was any `#`
 * and digits in the five lines after the declaration: a colour such as
 * `#0a7d66` in the body satisfied it, and a declaration spelled inside a
 * string was read as parked. The parser reads neither a comment nor a string
 * as code, so a history note quoting a deleted `test.fixme('...')` is not a
 * parked test, while its own words stay readable as the reference they are.
 *
 * What this CANNOT do is verify the issue exists, is open, or is about this
 * test; it forces a reference to be written, which is the step that was
 * skipped. That is a smaller claim than "tracked", and it is one this file
 * can actually keep.
 */

/** Any `#123`. Deliberately NOT a `/g/` regex: a global regex carries
 * `lastIndex` between `.test()` calls and would report alternating results
 * for identical input. */
const ISSUE_REFERENCE = /#\d+/;

/**
 * The unbroken run of comments directly above the statement that makes
 * `decl`. A blank line ends it.
 */
function commentBlockAbove(sf: ts.SourceFile, decl: Declaration): string[] {
  const statement = ts.isExpressionStatement(decl.call.parent)
    ? decl.call.parent
    : decl.call;
  const above =
    ts.getLeadingCommentRanges(sf.text, statement.getFullStart()) ?? [];
  const block: string[] = [];
  let below = statement.getStart(sf);
  for (const { pos, end } of [...above].reverse()) {
    if (/\n[ \t]*\n/.test(sf.text.slice(end, below))) break;
    block.unshift(sf.text.slice(pos, end));
    below = pos;
  }
  return block;
}

/** The declaration's own text up to its callback: callee, title, details,
 * and any comment written among them. */
const headerOf = (sf: ts.SourceFile, decl: Declaration): string =>
  sf.text.slice(decl.call.getStart(sf), decl.body.getStart(sf));

/** Every test and group read, each judged parked or not, and the parked ones naming no issue. */
function readParkedTests(file: string, source: string): Reading {
  const sf = parseSource(source, file);
  const declarations = declarationsIn(sf);
  const findings = declarations
    .filter(({ modifier }) => modifier === 'fixme' || modifier === 'skip')
    .filter(
      (decl) =>
        !ISSUE_REFERENCE.test(
          [...commentBlockAbove(sf, decl), headerOf(sf, decl)].join('\n'),
        ),
    )
    .map(
      (decl) =>
        `${file}:${decl.line} -- \`${decl.call.expression.getText(sf)}(\` parks a test without naming ` +
        'an issue. Put a `#<number>` in the comment block directly above it, ' +
        "or in the test's own title, or delete the test. #32 was filed " +
        'because a comment claimed "tracked, not hidden" and no such ticket ' +
        'existed, while the product really did overflow the fold.',
    );
  const judged = declarations.map((decl) => `${file}:${decl.line}`);
  return { judged, findings };
}

export const findUnreferencedParkedTests = (
  file: string,
  source: string,
): readonly string[] => readParkedTests(file, source).findings;

describe('parked tests must name an issue', () => {
  const scan = (source: string) =>
    findUnreferencedParkedTests('synthetic.spec.ts', source);

  it('flags a test.fixme that names no issue', () => {
    const source = [
      "test.fixme('the tool fits without scrolling at 320x568', async () => {",
      '  await measureFit(page);',
      '});',
    ].join('\n');
    expect(scan(source)).toHaveLength(1);
  });

  it('accepts a test.fixme whose preceding comment names an issue', () => {
    const source = [
      '// Parked until #32 lands -- the overflow is real and measured.',
      "test.fixme('the tool fits without scrolling at 320x568', async () => {",
      '  await measureFit(page);',
      '});',
    ].join('\n');
    expect(scan(source)).toEqual([]);
  });

  it('accepts a test.fixme whose own title names an issue', () => {
    const source = [
      "test.fixme('the tool fits at 320x568 (#32)', async () => {",
      '  await measureFit(page);',
      '});',
    ].join('\n');
    expect(scan(source)).toEqual([]);
  });

  it('accepts a reference on the wrapped title line', () => {
    const source = [
      'test.fixme(',
      "  'the tool fits without scrolling at 320x568, parked by #32',",
      "  { tag: '@emulated-viewport' },",
      '  async () => {},',
      ');',
    ].join('\n');
    expect(scan(source)).toEqual([]);
  });

  it('is blind to the runtime conditional overload, which needs no issue', () => {
    const source = [
      "test('it is the FIRST thing a Tab reaches', async ({ browserName }) => {",
      '  test.skip(',
      "    browserName === 'webkit',",
      "    'Safari omits plain links from the Tab sequence by visitor preference.',",
      '  );',
      '});',
    ].join('\n');
    expect(scan(source)).toEqual([]);
  });

  it('flags a bare test.describe.fixme, not just a single test', () => {
    const source = [
      "test.describe.fixme('the whole print panel', () => {",
      "  test('it prints', async () => {});",
      '});',
    ].join('\n');
    const findings = scan(source);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('`test.describe.fixme(`');
  });

  it('flags a test.skip declaration, which hides exactly as well', () => {
    const source = [
      "test.skip('the roster imports a CSV', async () => {});",
    ].join('\n');
    expect(scan(source)).toHaveLength(1);
  });

  it('does not accept a reference separated from the test by a blank line', () => {
    const source = [
      '// #32 is about something else entirely, and this blank line proves it.',
      '',
      "test.fixme('the tool fits without scrolling at 320x568', async () => {});",
    ].join('\n');
    expect(scan(source)).toHaveLength(1);
  });

  it('accepts a reference in a comment block above, however many comments it runs to', () => {
    const source = [
      '/**',
      ' * The tool overflows the fold at 320x568, measured.',
      ' */',
      '// Parked by #32.',
      "test.fixme('the tool fits without scrolling at 320x568', async () => {});",
    ].join('\n');
    expect(scan(source)).toEqual([]);
  });

  it('does not treat a test.fixme quoted inside a comment as a declaration', () => {
    const source = [
      "// Stage 2's `test.fixme('a separate-mode spillover warning renders,",
      "// naming who')` stood here. DELETED, whole -- its body was comments",
      '// only, so stripping the `.fixme` would have produced a real `test()`',
      '// with zero assertions.',
      "test('names who landed in a group of the other sex', async () => {});",
    ].join('\n');
    expect(scan(source)).toEqual([]);
  });

  it('names the file and line so a finding is actionable', () => {
    const source = ['', "test.fixme('a parked test', async () => {});"].join(
      '\n',
    );
    expect(scan(source)[0]).toContain('synthetic.spec.ts:2');
  });

  it('is not satisfied by a colour in the first lines of the body', () => {
    // `#\d+` anywhere in the five lines after the declaration counted as an
    // issue: `#0a7d66` begins with `#0`.
    const source = [
      "test.fixme('the accent stays readable', async ({ page }) => {",
      "  await expect(page.locator('a')).toHaveCSS('color', '#0a7d66');",
      '});',
    ].join('\n');
    expect(scan(source)).toHaveLength(1);
  });

  it('is not fooled by a parked declaration spelled inside a string', () => {
    const source = [
      "test('reads a fixture', async () => {",
      '  const example = "test.fixme(\'parked\', async () => {})";',
      '});',
    ].join('\n');
    expect(scan(source)).toEqual([]);
  });

  it('does not accept a reference only in a comment inside the body', () => {
    // The finding asks for the comment block directly above, or the title.
    const source = [
      "test.fixme('the tool fits at 320x568', async () => {",
      '  // #32',
      '  await measureFit(page);',
      '});',
    ].join('\n');
    expect(scan(source)).toHaveLength(1);
  });

  it('the e2e corpus parks nothing without naming an issue', () => {
    expectNothingFound(
      readParkedTests,
      declarationsRead('tests and groups read', 'parked-tests/declarations'),
    );
  });
});
