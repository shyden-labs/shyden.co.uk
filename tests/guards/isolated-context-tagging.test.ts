import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { searched } from '../source-files';
import {
  declarationsRead,
  expectNothingFound,
  type Reading,
} from '../unit/spec-scan';
import ts from 'typescript';
import { parseSource } from '../unit/ast';
import {
  declarationsIn,
  enclosingDeclaration,
  useCallsIn,
  type Declaration,
  type UseCall,
} from '../playwright-declarations';
import { CLOCK_TAG } from '../device/clock-declaration';

/**
 * A real device has exactly ONE adopted browser context for the whole run
 * (`browser.newContext()` measured to fail against it -- "Protocol error
 * (Target.createBrowserContext): Failed to create browser context.", see
 * tests/e2e/fixtures.ts's own `context` fixture comment). `test.use({
 * javaScriptEnabled: false })` -- and any future per-test context option
 * like it -- only takes effect on a context Playwright creates fresh, so
 * on the real device it is silently inert: JavaScript keeps running. Every
 * test that such a `test.use()` covers must carry the
 * `@requires-isolated-context` tag so `android-chrome`'s own `grepInvert`
 * (playwright.device.config.ts) excludes it, the same "physically
 * impossible on one real device" treatment `@emulated-viewport` already
 * gets for the screen (tests/guards/viewport-tagging.test.ts). This file is
 * what keeps that true: an exclusion list nobody checks rots the moment
 * someone adds a test.
 *
 * It reads the specs with the parser (`tests/playwright-declarations.ts`).
 * Until #218 it walked the text with regexes, on the premise that no parser
 * was available -- false since #115. A group's extent was the lines down to
 * the `});` at its opener's indentation, and an opener was a line ending in
 * `=> {` -- so a group whose opening prettier wrapped across lines could not
 * be found at all. The regexes also read a declaration spelled in a string
 * as a real test, and reported lines counted in comment-stripped text.
 *
 * THE RULE. A `test.use()` that sets `javaScriptEnabled: false` covers the
 * tests Playwright applies it to: every test in its group, nested groups
 * included, or every test in the file when it is called at file level. Each
 * covered test carries the tag. So does a test whose own body calls
 * `newContext()`, since that is the call the real device refuses (#142: a
 * choice carried into a new session). A tagged test that is neither is
 * stale. A
 * `test.use()` inside a test body is a Playwright error, and a
 * `javaScriptEnabled` not written as `true` or `false` cannot be judged --
 * both are reported, never read as "JavaScript stays on".
 */

const REQUIRES_ISOLATED_CONTEXT_TAG = '@requires-isolated-context';

/**
 * THE CLOCK RULE (#854). The phone cannot take a clock back out of its one context either:
 * `clock.install()` registers its script on the context and the protocol has no uninstall, so a
 * clock one test installed ran every later page on fake time. A test whose own body calls a
 * method of `.clock` carries `@installs-a-clock`, which runs it in the phone's
 * `android-chrome-clock` project (playwright.device.config.ts), and a tagged test that calls
 * none is stale. On the phone an untagged call is also refused at run time
 * (tests/device/clock-declaration.ts); this catches it at the pull request instead.
 *
 * ONE EXCEPTION, granted by the operator on 2026-10-18: the real-device test that proves that
 * refusal makes an untagged call on purpose. It is named by file and title, and the corpus test
 * below pins the list to exactly this one entry and checks it still names such a test.
 */
const CLOCK_EXCEPTIONS: readonly string[] = [
  'tests/device/real-device.spec.ts > a clock installed by an untagged test is refused, naming why (#854)',
];

function useInTestMessage(
  file: string,
  use: UseCall,
  owner: Declaration,
): string {
  return (
    `${file}:${use.line} calls test.use({ javaScriptEnabled: false }) inside ` +
    `test('${owner.title}') (line ${owner.line}) -- test.use() configures every test in ` +
    'its enclosing describe, and Playwright does not support calling it inside a ' +
    'running test body. Fix: move it to the top of the enclosing describe.'
  );
}

function unreadableMessage(file: string, use: UseCall): string {
  return (
    `${file}:${use.line} calls test.use() with a javaScriptEnabled that is not written ` +
    'as true or false, so this guard cannot tell which tests run without JavaScript -- ' +
    'write the value as a literal where the option is set.'
  );
}

function untaggedMessage(file: string, decl: Declaration): string {
  return (
    `${file}:${decl.line} -- test('${decl.title}') is covered by a ` +
    'test.use({ javaScriptEnabled: false }), which is inert on the real-device harness (JavaScript ' +
    `keeps running -- see tests/e2e/fixtures.ts) but is not tagged \`${REQUIRES_ISOLATED_CONTEXT_TAG}\` ` +
    `-- tag it \`${REQUIRES_ISOLATED_CONTEXT_TAG}\` so android-chrome excludes it by design ` +
    'instead of failing (or passing for the wrong reason).'
  );
}

function newContextMessage(file: string, decl: Declaration): string {
  return (
    `${file}:${decl.line} -- test('${decl.title}') calls newContext(), and the real device ` +
    'refuses a second browser context (see tests/e2e/fixtures.ts) -- tag it ' +
    `\`${REQUIRES_ISOLATED_CONTEXT_TAG}\` so android-chrome excludes it by design instead of failing.`
  );
}

function staleTagMessage(file: string, decl: Declaration): string {
  return (
    `${file}:${decl.line} -- test('${decl.title}') is tagged \`${REQUIRES_ISOLATED_CONTEXT_TAG}\` ` +
    'but no test.use({ javaScriptEnabled: false }) covers it and it calls no newContext() -- ' +
    'stale tag, silently costing ' +
    'real-device coverage for a test that no longer needs excluding. Remove the tag, or ' +
    'restore the javaScriptEnabled: false use it is supposed to describe.'
  );
}

function untaggedClockMessage(file: string, decl: Declaration): string {
  return (
    `${file}:${decl.line} -- test('${decl.title}') calls a clock method, and the real device ` +
    'cannot remove a clock from its one context, so it would run every later test on fake time ' +
    `(#854) -- tag it \`${CLOCK_TAG}\` so it runs in android-chrome-clock, a worker of its own.`
  );
}

function staleClockTagMessage(file: string, decl: Declaration): string {
  return (
    `${file}:${decl.line} -- test('${decl.title}') is tagged \`${CLOCK_TAG}\` but calls no ` +
    'clock method -- stale tag, running the test in the clock project for nothing. Remove it.'
  );
}

/** Whether a test's own body calls a method of `.clock` (`page.clock.install()`, `context.clock.runFor()`), read by the parser, so a comment or a string naming one calls nothing. */
function usesAClock(decl: Declaration): boolean {
  let uses = false;
  // A block body, so `visit` returns nothing: `ts.forEachChild` stops at the
  // first callback that returns something truthy (tests/unit/ast.ts).
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === 'clock'
    )
      uses = true;
    ts.forEachChild(node, visit);
  };
  visit(decl.body);
  return uses;
}

function tagInTitleMessage(
  file: string,
  decl: Declaration,
  tag: string,
): string {
  return (
    `${file}:${decl.line} -- ${decl.kind}('${decl.title}') has \`${tag}\` in its title. The ` +
    "phone's projects select by grep, which reads every title as well as the tags, so the " +
    'title alone decides where its tests run (#854). Name it without the tag text.'
  );
}

/** Whether `decl` in `file` is the operator's one granted clock exception. */
const excepted = (file: string, decl: Declaration): boolean =>
  CLOCK_EXCEPTIONS.includes(`${file} > ${decl.title}`);

/** Whether a test's own body calls `newContext()`: a call, read by the parser, so a comment or a string naming it opens nothing. */
function opensAContext(decl: Declaration): boolean {
  let opens = false;
  // A block body, so `visit` returns nothing: `ts.forEachChild` stops at the
  // first callback that returns something truthy (tests/unit/ast.ts).
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'newContext'
    )
      opens = true;
    ts.forEachChild(node, visit);
  };
  visit(decl.body);
  return opens;
}

/** Every group `decl` sits in, innermost first. */
function groupsAround(
  decl: Declaration,
  declarations: readonly Declaration[],
): Declaration[] {
  const groups: Declaration[] = [];
  for (
    let around = enclosingDeclaration(decl.call, declarations);
    around !== undefined;
    around = enclosingDeclaration(around.call, declarations)
  )
    groups.push(around);
  return groups;
}

/** The whole guard, as one pure function of (path, source text) -> finding messages -- kept
 * separate from the filesystem walk so the self-test block below can prove every branch red
 * and green on tiny synthetic input, not just trust the real corpus to exercise all of them.
 * The text is the file as it is on disk: a line counted in stripped text is not the line a
 * reader opens. Every test it read is judged, so each is named in `judged`. */
function read(file: string, text: string): Reading {
  const sf = parseSource(text, file);
  const declarations = declarationsIn(sf);
  const findings: string[] = [];

  // What each JavaScript-disabling test.use() covers: a group, or the file.
  const coveringGroups = new Set<Declaration>();
  let coversFile = false;
  for (const use of useCallsIn(sf)) {
    const value = use.options.get('javaScriptEnabled');
    if (value === undefined || value.kind === ts.SyntaxKind.TrueKeyword)
      continue;
    if (value.kind !== ts.SyntaxKind.FalseKeyword) {
      findings.push(unreadableMessage(file, use));
      continue;
    }
    const owner = enclosingDeclaration(use.call, declarations);
    if (owner === undefined) coversFile = true;
    else if (owner.kind === 'test')
      findings.push(useInTestMessage(file, use, owner));
    else coveringGroups.add(owner);
  }

  for (const decl of declarations) {
    // A group's title is read by grep too, and routes every test in it.
    for (const tag of [REQUIRES_ISOLATED_CONTEXT_TAG, CLOCK_TAG])
      if (decl.title.includes(tag))
        findings.push(tagInTitleMessage(file, decl, tag));
    if (decl.kind !== 'test') continue;
    const covered =
      coversFile ||
      groupsAround(decl, declarations).some((group) =>
        coveringGroups.has(group),
      );
    const opens = opensAContext(decl);
    const tagged = decl.tags.includes(REQUIRES_ISOLATED_CONTEXT_TAG);
    if (covered && !tagged) findings.push(untaggedMessage(file, decl));
    else if (opens && !tagged) findings.push(newContextMessage(file, decl));
    else if (!covered && !opens && tagged)
      findings.push(staleTagMessage(file, decl));
    const clocked = usesAClock(decl);
    const clockTagged = decl.tags.includes(CLOCK_TAG);
    if (clocked && !clockTagged && !excepted(file, decl))
      findings.push(untaggedClockMessage(file, decl));
    else if (!clocked && clockTagged)
      findings.push(staleClockTagMessage(file, decl));
  }

  const judged = declarations
    .filter((decl) => decl.kind === 'test')
    .map((decl) => `${file}:${decl.line}`);
  return { judged, findings };
}

/** The findings alone, which is all the synthetic cases below ask about. */
const analyze = (file: string, text: string): readonly string[] =>
  read(file, text).findings;

describe('a real device has one browser context', () => {
  it('every test run without JavaScript, or calling newContext(), is tagged @requires-isolated-context, and no tag is stale', () => {
    expectNothingFound(read, declarationsRead('tests read'));
  });

  it("allows the operator's one clock exception, and no other (#854)", () => {
    expect(CLOCK_EXCEPTIONS).toEqual([
      'tests/device/real-device.spec.ts > a clock installed by an untagged test is refused, naming why (#854)',
    ]);
  });

  it('the clock exception still names a test that makes an untagged clock call (#854)', () => {
    const [file, title] = CLOCK_EXCEPTIONS[0].split(' > ');
    const named = declarationsIn(
      parseSource(readFileSync(file, 'utf8'), file),
    ).filter((decl) => decl.kind === 'test' && decl.title === title);
    expect(named.map((decl) => decl.title)).toEqual([title]);
    expect(usesAClock(named[0])).toBe(true);
    expect(named[0].tags).not.toContain(CLOCK_TAG);
  });
});

// Proof the mechanism itself works, red and green, independent of whatever the real corpus
// happens to contain today -- "a guard nobody has watched fail is decoration" applies to the
// guard's own building blocks too, not only to the tags it is checking for.
describe('analyze() -- the scanner proven on synthetic input, not just trusted', () => {
  // What the corpus loop reports for a file, read the way it reads one.
  const scanned = (src: string[]) =>
    analyze('synthetic.spec.ts', src.join('\n'));
  // The same read, with the tests it judged beside what it found.
  const judgedBy = (src: string[]) => read('synthetic.spec.ts', src.join('\n'));

  it('flags an untagged test inside a javaScriptEnabled:false describe, naming file, line and title', () => {
    const src = [
      "import { test, expect } from './fixtures';",
      '',
      "test.describe('no script', () => {",
      '  test.use({ javaScriptEnabled: false });',
      '',
      "  test('shows the fallback notice', async ({ page }) => {",
      "    await page.goto('/');",
      '  });',
      '});',
      '',
    ].join('\n');

    const findings = analyze('synthetic.spec.ts', src);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:6');
    expect(findings[0]).toContain('shows the fallback notice');
    expect(findings[0]).toContain(REQUIRES_ISOLATED_CONTEXT_TAG);
  });

  it('accepts the identical test once tagged', () => {
    const src = [
      "import { test, expect } from './fixtures';",
      '',
      "test.describe('no script', () => {",
      '  test.use({ javaScriptEnabled: false });',
      '',
      "  test('shows the fallback notice', { tag: '@requires-isolated-context' }, async ({ page }) => {",
      "    await page.goto('/');",
      '  });',
      '});',
      '',
    ].join('\n');

    const { judged, findings } = read('synthetic.spec.ts', src);
    expect(
      searched(findings, { of: judged, what: 'tests the scanner judged' }),
    ).toEqual([]);
  });

  it('flags a tag on a test with no enclosing javaScriptEnabled:false describe as stale', () => {
    const src = [
      "import { test, expect } from './fixtures';",
      '',
      "test.describe('normal', () => {",
      "  test('does nothing special', { tag: '@requires-isolated-context' }, async ({ page }) => {",
      "    await page.goto('/');",
      '  });',
      '});',
      '',
    ].join('\n');

    const findings = analyze('synthetic.spec.ts', src);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('stale');
    expect(findings[0]).toContain('does nothing special');
  });

  it('does not reach into an unrelated sibling describe that happens to share a file', () => {
    // The real shape this corpus has today: "with JavaScript blocked" and "when storage is
    // unavailable" are SIBLING describes in the same file -- a test in the second must never be
    // flagged just because the first, earlier one, disables JavaScript.
    const src = [
      "import { test, expect } from './fixtures';",
      '',
      "test.describe('with JavaScript blocked', () => {",
      '  test.use({ javaScriptEnabled: false });',
      '',
      "  test('shows the notice', { tag: '@requires-isolated-context' }, async ({ page }) => {",
      "    await page.goto('/');",
      '  });',
      '});',
      '',
      "test.describe('when storage is unavailable', () => {",
      "  test('still works', async ({ page }) => {",
      "    await page.goto('/');",
      '  });',
      '});',
      '',
    ].join('\n');

    const { judged, findings } = read('synthetic.spec.ts', src);
    expect(
      searched(findings, { of: judged, what: 'tests the scanner judged' }),
    ).toEqual([]);
  });

  it('holds a nested group to the tag too, since test.use() reaches it', () => {
    const findings = scanned([
      "import { test } from './fixtures';",
      "test.describe('no script', () => {",
      '  test.use({ javaScriptEnabled: false });',
      "  test.describe('on the roster', () => {",
      "    test('shows the notice', async () => {});",
      '  });',
      '});',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:5');
  });

  it('does not mistake a runtime test.use(...) call for one disabling JavaScript', () => {
    const src = [
      "import { test, expect } from './fixtures';",
      '',
      "test.describe('viewport only', () => {",
      '  test.use({ viewport: { width: 320, height: 800 } });',
      '',
      "  test('fits', { tag: '@emulated-viewport' }, async ({ page }) => {",
      "    await page.goto('/');",
      '  });',
      '});',
      '',
    ].join('\n');

    const { judged, findings } = read('synthetic.spec.ts', src);
    expect(
      searched(findings, { of: judged, what: 'tests the scanner judged' }),
    ).toEqual([]);
  });

  it('reports test.use({ javaScriptEnabled: false }) inside a test body, which Playwright rejects', () => {
    const findings = scanned([
      "import { test } from './fixtures';",
      "test('turns scripts off itself', async () => {",
      '  test.use({ javaScriptEnabled: false });',
      '});',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:3');
    expect(findings[0]).toContain('inside a running test body');
  });

  it('is not confused by a template-literal title containing brace-like interpolation', () => {
    // The exact shape classroom-groups-privacy.spec.ts's own corpus uses --
    // `${path}` inside a title is not a code-structural brace. The indentation
    // rule the regex version relied on was chosen to survive this; the parser
    // never reads a literal's contents as structure at all.
    const src = [
      "import { test, expect } from './fixtures';",
      '',
      "test.describe('no script', () => {",
      '  test.use({ javaScriptEnabled: false });',
      '',
      "  for (const path of ['/a', '/b']) {",
      '    test(',
      '      `${path}: says so`,',
      "      { tag: '@requires-isolated-context' },",
      '      async ({ page }) => {',
      '        await page.goto(path);',
      '      },',
      '    );',
      '  }',
      '});',
      '',
    ].join('\n');

    const { judged, findings } = read('synthetic.spec.ts', src);
    expect(
      searched(findings, { of: judged, what: 'tests the scanner judged' }),
    ).toEqual([]);
  });

  it('ignores a javaScriptEnabled:false-shaped call when it appears only in a comment', () => {
    const src = [
      "import { test, expect } from './fixtures';",
      '',
      '// Example: test.use({ javaScriptEnabled: false }); -- do not do this here.',
      "test.describe('normal', () => {",
      "  test('does nothing special', async ({ page }) => {",
      "    await page.goto('/');",
      '  });',
      '});',
      '',
    ].join('\n');

    const { judged, findings } = read('synthetic.spec.ts', src);
    expect(
      searched(findings, { of: judged, what: 'tests the scanner judged' }),
    ).toEqual([]);
  });

  it('finds the group when prettier wraps its opening across lines', () => {
    const findings = scanned([
      "import { test } from './fixtures';",
      'test.describe(',
      "  'a title long enough that prettier puts every argument on its own line',",
      '  () => {',
      '    test.use({ javaScriptEnabled: false });',
      "    test('shows the notice', async ({ page }) => {});",
      '  },',
      ');',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:6');
    expect(findings[0]).toContain('shows the notice');
  });

  it('is not fooled by a declaration spelled inside a string', () => {
    const { judged, findings } = judgedBy([
      "import { test } from './fixtures';",
      "test.describe('no script', () => {",
      '  test.use({ javaScriptEnabled: false });',
      "  test('real', { tag: '@requires-isolated-context' }, async () => {",
      '    const example = "test(\'not a test\', async () => {})";',
      '  });',
      '});',
    ]);
    expect(
      searched(findings, { of: judged, what: 'tests the scanner judged' }),
    ).toEqual([]);
  });

  it('reports a javaScriptEnabled it cannot read, instead of reading it as enabled', () => {
    const findings = scanned([
      "import { test } from './fixtures';",
      'const javaScriptEnabled = false;',
      "test.describe('no script', () => {",
      '  test.use({ javaScriptEnabled });',
      "  test('shows the notice', async () => {});",
      '});',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:4');
    expect(findings[0]).toContain('javaScriptEnabled');
  });

  it('reports the line a finding is on in the file, below a block comment', () => {
    const findings = scanned([
      "import { test } from './fixtures';",
      '/**',
      ' * A docblock above the group.',
      ' */',
      "test.describe('no script', () => {",
      '  test.use({ javaScriptEnabled: false });',
      "  test('shows the notice', async () => {});",
      '});',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:7');
  });

  it('holds every test in the file to the tag when test.use() disables JavaScript at file level', () => {
    // Playwright applies a file-level test.use() to every test in the file.
    const findings = scanned([
      "import { test } from './fixtures';",
      'test.use({ javaScriptEnabled: false });',
      "test('shows the notice', async () => {});",
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:3');
    expect(findings[0]).toContain('shows the notice');
  });

  it('flags an untagged test that opens its own browser context, which the real device refuses', () => {
    const findings = scanned([
      "import { test, expect } from './fixtures';",
      '',
      "test('a new session', async ({ browser }) => {",
      '  const session = await browser.newContext();',
      '  await session.close();',
      '});',
      '',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:3');
    expect(findings[0]).toContain('newContext()');
    expect(findings[0]).toContain(REQUIRES_ISOLATED_CONTEXT_TAG);
  });

  it('accepts that test once tagged', () => {
    const { judged, findings } = judgedBy([
      "import { test, expect } from './fixtures';",
      '',
      "test('a new session', { tag: '@requires-isolated-context' }, async ({ browser }) => {",
      '  const session = await browser.newContext();',
      '  await session.close();',
      '});',
      '',
    ]);
    expect(
      searched(findings, { of: judged, what: 'tests the scanner judged' }),
    ).toEqual([]);
  });

  it('opens no context for a newContext() written only in a comment or a string', () => {
    const findings = scanned([
      "import { test, expect } from './fixtures';",
      '',
      "test('a note', { tag: '@requires-isolated-context' }, async ({ page }) => {",
      '  // browser.newContext() is not called here',
      "  await page.goto('/browser.newContext()');",
      '});',
      '',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('stale');
  });

  it('flags an untagged test that calls a clock method, which the real device cannot undo (#854)', () => {
    const findings = scanned([
      "import { test, expect } from './fixtures';",
      '',
      "test('a timed save', async ({ page }) => {",
      '  await page.clock.install();',
      '});',
      '',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:3');
    expect(findings[0]).toContain('clock method');
    expect(findings[0]).toContain(CLOCK_TAG);
  });

  it('accepts that test once tagged @installs-a-clock (#854)', () => {
    const { judged, findings } = judgedBy([
      "import { test, expect } from './fixtures';",
      '',
      "test('a timed save', { tag: '@installs-a-clock' }, async ({ context }) => {",
      '  await context.clock.runFor(1_000);',
      '});',
      '',
    ]);
    expect(
      searched(findings, { of: judged, what: 'tests the scanner judged' }),
    ).toEqual([]);
  });

  it('flags @installs-a-clock on a test that calls no clock method as stale (#854)', () => {
    const findings = scanned([
      "import { test, expect } from './fixtures';",
      '',
      "test('a plain page', { tag: '@installs-a-clock' }, async ({ page }) => {",
      "  await page.goto('/');",
      '});',
      '',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:3');
    expect(findings[0]).toContain('stale');
  });

  it('calls no clock for one written only in a comment or a string (#854)', () => {
    const findings = scanned([
      "import { test, expect } from './fixtures';",
      '',
      "test('a note', { tag: '@installs-a-clock' }, async ({ page }) => {",
      '  // page.clock.install() is not called here',
      "  await page.goto('/page.clock.install()');",
      '});',
      '',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('stale');
  });

  it("excepts the operator's granted test by its file and title (#854)", () => {
    const [file, title] = CLOCK_EXCEPTIONS[0].split(' > ');
    const { judged, findings } = read(
      file,
      [
        "import { test, expect } from '../e2e/fixtures';",
        '',
        `test('${title}', async ({ page }) => {`,
        '  await expect(page.clock.install()).rejects.toThrow();',
        '});',
        '',
      ].join('\n'),
    );
    expect(
      searched(findings, { of: judged, what: 'tests the scanner judged' }),
    ).toEqual([]);
  });

  it('excepts that title nowhere else (#854)', () => {
    const [, title] = CLOCK_EXCEPTIONS[0].split(' > ');
    const findings = scanned([
      "import { test, expect } from './fixtures';",
      '',
      `test('${title}', async ({ page }) => {`,
      '  await page.clock.install();',
      '});',
      '',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('clock method');
  });

  it("flags @installs-a-clock written in a test's title, which the phone's grep reads as the tag (#854)", () => {
    const findings = scanned([
      "import { test, expect } from './fixtures';",
      '',
      "test('a page not tagged @installs-a-clock', async ({ page }) => {",
      "  await page.goto('/');",
      '});',
      '',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:3');
    expect(findings[0]).toContain('in its title');
  });

  it("flags @requires-isolated-context written in a test's title too (#854)", () => {
    const findings = scanned([
      "import { test, expect } from './fixtures';",
      '',
      "test('runs without @requires-isolated-context', async ({ page }) => {",
      "  await page.goto('/');",
      '});',
      '',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('in its title');
  });

  it("flags the tag written in a group's title, which routes every test in it (#854)", () => {
    const findings = scanned([
      "import { test, expect } from './fixtures';",
      '',
      "test.describe('pages without @installs-a-clock', () => {",
      "  test('a page', async ({ page }) => {",
      "    await page.goto('/');",
      '  });',
      '});',
      '',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:3');
    expect(findings[0]).toContain('in its title');
  });
});
