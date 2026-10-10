import { describe, it, expect } from 'vitest';
import {
  declarationsRead,
  expectNothingFound,
  type Reading,
} from '../unit/spec-scan';
import ts from 'typescript';
import { parseSource } from '../unit/ast';
import {
  callsIn,
  declarationsIn,
  enclosingDeclaration,
  lineOf,
  useCallsIn,
  type Declaration,
} from '../playwright-declarations';

/**
 * A real phone has one screen. `page.setViewportSize(...)` and
 * `test.use({ viewport })` both measure an emulator -- on a real device CDP will
 * happily "resize" a 411px phone to 1280x800 and report numbers describing nothing
 * physical (see playwright.device.config.ts). Every test that manipulates the
 * viewport must carry the `@emulated-viewport` tag so `android-chrome`'s
 * `grepInvert` can exclude it, and this file is what keeps that true: an exclusion
 * list nobody checks rots the moment someone adds a test.
 *
 * This scans SOURCE rather than importing and introspecting the specs:
 * Playwright specs can only run under the Playwright test runner, so a Vitest
 * file that wants to check them has no way to load them as modules and ask
 * "what tag does this test carry".
 *
 * It reads that source with the parser (`tests/playwright-declarations.ts`).
 * Until #218 it walked the text with regexes, on the premise that no parser
 * was available -- false since #115 -- and the approximation missed what it
 * had not been written for. `tests/e2e/visual.spec.ts` sets its viewport with
 * the shorthand `test.use({ viewport })`, the regex looked for `viewport:`,
 * and android-chrome collected all eight of those tests for a real phone
 * (#194). The regexes also read a declaration spelled inside a string as a
 * real one, credited a hook's resize to whichever test sat above the hook,
 * and reported lines counted in comment-stripped text.
 *
 * THE RULE. A viewport call belongs to the innermost declaration whose
 * callback contains it, and that declaration carries the tag:
 * - a `setViewportSize` in a test's body belongs to that test;
 * - a `test.use({ viewport })`, or a `setViewportSize` in a hook or a helper
 *   written inside a group, belongs to the group, whose tag Playwright gives
 *   every test in it -- which is right, because it resizes for each of them;
 * - a `test.use()` inside a test's body is a Playwright error, and is
 *   reported as that;
 * - a call that no declaration contains (a helper outside every test, a
 *   file-level `test.use()`) has no declaration to carry the tag, and is
 *   reported rather than passed over.
 * A tag on a declaration that owns no viewport call is stale, and silently
 * costs real-device coverage.
 *
 * A READ is the same fact seen from the other side. `page.viewportSize()` asks
 * Playwright what it emulates, and on a real device it emulates nothing, so the
 * call returns `null` there: the touching-words test sized its population by it
 * and searched nothing on the phone (#198), after the projector spec had been
 * caught the same way. A read belongs to its innermost declaration just as a
 * resize does, and is reported unless that declaration is tagged -- but a read
 * never justifies a tag, because tagging a test that only reads buys the read
 * back by dropping the test from the phone. Read the width from the page.
 */

const EMULATED_VIEWPORT_TAG = '@emulated-viewport';

type Api = 'page.setViewportSize(...)' | 'test.use({ viewport })';

interface ViewportHit {
  readonly call: ts.CallExpression;
  readonly line: number;
  readonly api: Api;
}

/** Every call in `sf` that sets the viewport, in source order. */
function viewportHits(sf: ts.SourceFile): ViewportHit[] {
  const resizes = callsIn(sf)
    .filter(
      ({ expression }) =>
        ts.isPropertyAccessExpression(expression) &&
        expression.name.text === 'setViewportSize',
    )
    .map((call) => ({
      call,
      line: lineOf(sf, call),
      api: 'page.setViewportSize(...)' as const,
    }));
  const uses = useCallsIn(sf)
    .filter(({ options }) => options.has('viewport'))
    .map(({ call, line }) => ({
      call,
      line,
      api: 'test.use({ viewport })' as const,
    }));
  return [...resizes, ...uses].sort((a, b) => a.call.pos - b.call.pos);
}

/** Every `page.viewportSize()` read in `sf`, whatever the receiver is called. */
function viewportReads(
  sf: ts.SourceFile,
): { call: ts.CallExpression; line: number }[] {
  return callsIn(sf)
    .filter(
      ({ expression }) =>
        ts.isPropertyAccessExpression(expression) &&
        expression.name.text === 'viewportSize',
    )
    .map((call) => ({ call, line: lineOf(sf, call) }));
}

/** How a finding names a declaration: a template title keeps its backticks. */
function describeWhat({ kind, title }: Declaration): string {
  const written = title.startsWith('`') ? title : `'${title}'`;
  return kind === 'test' ? `test(${written})` : `test.describe(${written})`;
}

function orphanMessage(file: string, hit: ViewportHit): string {
  return (
    `${file}:${hit.line} calls ${hit.api}, but no test(...) or test.describe(...) ` +
    'contains it -- a helper outside every declaration, or a file-level test.use(), ' +
    'leaves no declaration to carry the tag. Move it into the test, or the ' +
    'test.describe(...), whose viewport it sets.'
  );
}

function useInTestMessage(
  file: string,
  hit: ViewportHit,
  owner: Declaration,
): string {
  return (
    `${file}:${hit.line} calls test.use({ viewport }) inside ${describeWhat(owner)} ` +
    `(line ${owner.line}) -- test.use() configures every test in its enclosing ` +
    'describe, and Playwright does not support calling it inside a running test body. ' +
    'Fix: move it to the top of the enclosing describe.'
  );
}

function untaggedMessage(
  file: string,
  decl: Declaration,
  lines: number[],
): string {
  const plural = lines.length > 1 ? 's' : '';
  return (
    `${file}:${decl.line} -- ${describeWhat(decl)} manipulates the viewport (line${plural} ` +
    `${lines.join(', ')}) but is not tagged \`${EMULATED_VIEWPORT_TAG}\` -- tag it ` +
    `\`${EMULATED_VIEWPORT_TAG}\`: a real device cannot resize its screen.`
  );
}

function readMessage(
  file: string,
  line: number,
  owner: Declaration | undefined,
): string {
  const where =
    owner === undefined
      ? 'but no test(...) or test.describe(...) contains it, so no tag can keep it off the phone'
      : `in ${describeWhat(owner)} (line ${owner.line}), which is not tagged \`${EMULATED_VIEWPORT_TAG}\``;
  return (
    `${file}:${line} reads page.viewportSize() ${where} -- on a real device that is null, ` +
    "because the device project adopts the phone's own context, which emulates no viewport. " +
    'Read the width the page was laid out at from the page ' +
    '(document.documentElement.clientWidth, after goto), which is right on every target.'
  );
}

function staleTagMessage(file: string, decl: Declaration): string {
  return (
    `${file}:${decl.line} -- ${describeWhat(decl)} is tagged \`${EMULATED_VIEWPORT_TAG}\` but ` +
    'its own body never calls page.setViewportSize(...) or test.use({ viewport }) -- stale ' +
    'tag, silently costing real-device coverage. Remove the tag, or add the viewport call the ' +
    'tag is supposed to describe.'
  );
}

/** The whole guard, as one pure function of (path, source text) -> finding
 * messages -- kept separate from the filesystem walk below so the "self-test"
 * describe block can prove every branch of it red and green on tiny synthetic
 * input, not just trust the real corpus to happen to exercise all of them. The
 * text is the file as it is on disk: the parser skips comments itself, and a
 * line counted in stripped text is not the line a reader opens. Every test
 * and group it read is judged, for a tag it lacks or one gone stale, so each
 * is named in `judged`. */
function read(file: string, text: string): Reading {
  const sf = parseSource(text, file);
  const declarations = declarationsIn(sf);

  const findings: string[] = [];
  // Two collections on purpose. `owned` drives the "needs a tag" check and
  // holds only calls a declaration can carry the tag for; `touched` drives
  // stale-tag suppression and also holds a test.use() misplaced inside a test,
  // whose root cause is the misplacement -- one root cause, one message.
  const owned = new Map<Declaration, number[]>();
  const touched = new Set<Declaration>();

  for (const hit of viewportHits(sf)) {
    const owner = enclosingDeclaration(hit.call, declarations);
    if (owner === undefined) {
      findings.push(orphanMessage(file, hit));
      continue;
    }
    touched.add(owner);
    if (owner.kind === 'test' && hit.api === 'test.use({ viewport })') {
      findings.push(useInTestMessage(file, hit, owner));
      continue;
    }
    owned.set(owner, [...(owned.get(owner) ?? []), hit.line]);
  }

  // A read never joins `touched`: a tag that only a read justified would buy
  // the read back by dropping the test from the phone, so that tag stays stale.
  for (const read of viewportReads(sf)) {
    const owner = enclosingDeclaration(read.call, declarations);
    if (owner === undefined || !owner.tags.includes(EMULATED_VIEWPORT_TAG))
      findings.push(readMessage(file, read.line, owner));
  }

  for (const [decl, lines] of owned) {
    if (!decl.tags.includes(EMULATED_VIEWPORT_TAG))
      findings.push(untaggedMessage(file, decl, lines));
  }
  for (const decl of declarations) {
    if (decl.tags.includes(EMULATED_VIEWPORT_TAG) && !touched.has(decl))
      findings.push(staleTagMessage(file, decl));
  }

  const judged = declarations.map((decl) => `${file}:${decl.line}`);
  return { judged, findings };
}

/** The findings alone, which is all the synthetic cases below ask about. */
const analyze = (file: string, text: string): readonly string[] =>
  read(file, text).findings;

describe('a real phone cannot resize its own screen', () => {
  it('every test that resizes the viewport is tagged @emulated-viewport, none the phone runs reads it, and no tag is stale', () => {
    expectNothingFound(
      read,
      declarationsRead(
        'tests and groups read',
        'viewport-tagging/declarations',
      ),
    );
  });
});

// Proof the mechanism itself works, red and green, independent of whatever the
// real corpus happens to contain today -- "a guard nobody has watched fail is
// decoration" applies to the guard's own building blocks too, not only to the
// tags it is checking for.
describe('analyze() -- the scanner proven on synthetic input, not just trusted', () => {
  // What the corpus loop reports for a file, read the way it reads one.
  const scanned = (src: string[]) =>
    analyze('synthetic.spec.ts', src.join('\n'));

  it('flags an untagged test that resizes the viewport, naming file, line and title', () => {
    const src = [
      "import { test, expect } from './fixtures';",
      '',
      "test('shrinks to a phone width', async ({ page }) => {",
      '  await page.setViewportSize({ width: 320, height: 800 });',
      "  await page.goto('/');",
      '});',
      '',
    ].join('\n');

    const findings = analyze('synthetic.spec.ts', src);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:3'); // the `test(` line
    expect(findings[0]).toContain('shrinks to a phone width');
    expect(findings[0]).toContain(EMULATED_VIEWPORT_TAG);
  });

  it('accepts the identical test once the tag is added', () => {
    const src = [
      "import { test, expect } from './fixtures';",
      '',
      "test('shrinks to a phone width', { tag: '@emulated-viewport' }, async ({ page }) => {",
      '  await page.setViewportSize({ width: 320, height: 800 });',
      "  await page.goto('/');",
      '});',
      '',
    ].join('\n');

    expect(analyze('synthetic.spec.ts', src)).toEqual([]);
  });

  it('flags a tag on a test whose body never touches the viewport as stale', () => {
    const src = [
      "import { test, expect } from './fixtures';",
      '',
      "test('does nothing viewport-related', { tag: '@emulated-viewport' }, async ({ page }) => {",
      "  await page.goto('/');",
      '});',
      '',
    ].join('\n');

    const findings = analyze('synthetic.spec.ts', src);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('stale');
    expect(findings[0]).toContain('does nothing viewport-related');
  });

  // A READ of the viewport is the same fact from the other side: on a real
  // device there is no emulated viewport, so `page.viewportSize()` is null
  // there, and a test that sized its population by it searched nothing (#198).
  it('flags an untagged test that reads page.viewportSize(), naming file, line and title', () => {
    const findings = scanned([
      "import { test, expect } from './fixtures';",
      '',
      "test('measures the page', async ({ page }) => {",
      "  await page.goto('/');",
      '  const width = page.viewportSize()?.width;',
      '  expect(width).toBeGreaterThan(0);',
      '});',
      '',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:5'); // the read's line
    expect(findings[0]).toContain('measures the page');
    expect(findings[0]).toContain('page.viewportSize()');
    expect(findings[0]).toContain('document.documentElement.clientWidth');
  });

  it('flags a page.viewportSize() read in a helper that no declaration contains', () => {
    const findings = scanned([
      "import { test, expect } from './fixtures';",
      '',
      'const widthOf = (page) => page.viewportSize()?.width;',
      '',
      "test('uses the helper', async ({ page }) => {",
      '  expect(widthOf(page)).toBeGreaterThan(0);',
      '});',
      '',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:3');
    expect(findings[0]).toContain('page.viewportSize()');
    expect(findings[0]).toContain(
      'no test(...) or test.describe(...) contains it',
    );
  });

  it('accepts a page.viewportSize() read in a tagged test that resizes', () => {
    expect(
      scanned([
        "import { test, expect } from './fixtures';",
        '',
        "test('reads back its own size', { tag: '@emulated-viewport' }, async ({ page }) => {",
        '  await page.setViewportSize({ width: 320, height: 800 });',
        '  expect(page.viewportSize()?.width).toBe(320);',
        '});',
        '',
      ]),
    ).toEqual([]);
  });

  it('still calls a tag stale when a page.viewportSize() read is all that justifies it', () => {
    // Tagging a test that only reads would buy the read back by dropping the
    // test from the phone -- the coverage the tag exists to spend sparingly.
    const findings = scanned([
      "import { test, expect } from './fixtures';",
      '',
      "test('only reads', { tag: '@emulated-viewport' }, async ({ page }) => {",
      "  await page.goto('/');",
      '  expect(page.viewportSize()?.width).toBeGreaterThan(0);',
      '});',
      '',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('stale');
    expect(findings[0]).toContain('only reads');
  });

  it('does not mistake a runtime test.skip(condition, reason) call for a new declaration', () => {
    // The exact shape of chrome.spec.ts:122 and head-and-sitemap.spec.ts:85: a
    // *runtime* conditional skip, called INSIDE an already-open test body. If this
    // were misread as a second declaration, the setViewportSize below it would be
    // orphaned (attributed to nothing) rather than correctly attributed to the
    // outer, already-tagged test.
    const src = [
      "import { test, expect } from './fixtures';",
      '',
      "test('desktop nav', { tag: '@emulated-viewport' }, async ({ page, browserName }) => {",
      "  test.skip(browserName === 'webkit', 'not relevant on WebKit');",
      '  await page.setViewportSize({ width: 1280, height: 800 });',
      '});',
      '',
    ].join('\n');

    expect(analyze('synthetic.spec.ts', src)).toEqual([]);
  });

  it('attributes test.use({ viewport }) to its enclosing describe, both directions', () => {
    const untagged = [
      "import { test, expect } from './fixtures';",
      '',
      "test.describe('narrow screens', () => {",
      '  test.use({ viewport: { width: 320, height: 568 } });',
      '',
      "  test('fits', async ({ page }) => {",
      "    await page.goto('/');",
      '  });',
      '});',
      '',
    ].join('\n');

    const untaggedFindings = analyze('synthetic.spec.ts', untagged);
    expect(untaggedFindings).toHaveLength(1);
    expect(untaggedFindings[0]).toContain('narrow screens');
    expect(untaggedFindings[0]).toContain(EMULATED_VIEWPORT_TAG);

    const tagged = untagged.replace(
      "test.describe('narrow screens', () => {",
      "test.describe('narrow screens', { tag: '@emulated-viewport' }, () => {",
    );
    expect(analyze('synthetic.spec.ts', tagged)).toEqual([]);
  });

  it('asks the group to carry the tag for a resize reached through an aliased callee, rather than passing over it', () => {
    // The shape classroom-groups.spec.ts's own first draft used:
    // `const run = fits ? test : test.fixme; run(...)`. `run(` is not a callee
    // this reader follows, so the resize sits in no test -- but it does sit in
    // the group, and the group's tag reaches every test in it, the aliased one
    // included. Silence is the one outcome this must never produce.
    const src = [
      "import { test, expect } from './fixtures';",
      '',
      "test.describe('generated', () => {",
      '  const run = test;',
      "  run('generated title', async ({ page }) => {",
      '    await page.setViewportSize({ width: 320, height: 800 });',
      '  });',
      '});',
      '',
    ].join('\n');

    const findings = analyze('synthetic.spec.ts', src);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:3');
    expect(findings[0]).toContain("test.describe('generated')");
    expect(findings[0]).toContain(EMULATED_VIEWPORT_TAG);
  });

  it('reports test.use({ viewport }) inside a test body, which Playwright rejects', () => {
    const findings = scanned([
      "import { test } from './fixtures';",
      "test('configures itself', { tag: '@emulated-viewport' }, async () => {",
      '  test.use({ viewport: { width: 320, height: 568 } });',
      '});',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:3');
    expect(findings[0]).toContain('inside a running test body');
  });

  it('ignores setViewportSize and a declaration-shaped call when they appear only in a comment', () => {
    // The two real near-misses the regex version's header named:
    // classroom-groups.spec.ts ("/id/*" inside a `//` line) and
    // classroom-groups-controls.spec.ts (`test.fixme(title, body)` inside a
    // `//` line, describing the API rather than calling it).
    const src = [
      "import { test, expect } from './fixtures';",
      '',
      '// Example: await page.setViewportSize({ width: 320, height: 800 });',
      '// See also `test.fixme(title, body)` for the declaration form.',
      '// Cloudflare serves /id/* too, so this is not stranded in English.',
      '/* await page.setViewportSize({ width: 375, height: 667 }); */',
      "test('does not actually touch the viewport', async ({ page }) => {",
      "  await page.goto('/');",
      '});',
      '',
    ].join('\n');

    expect(analyze('synthetic.spec.ts', src)).toEqual([]);
  });

  it('tolerates a wrapped title (test( on one line, the quoted title on the next)', () => {
    // Prettier wraps a call onto one argument per line once it stops fitting the
    // configured print width -- several real titles in this corpus are long
    // enough on their own to force this once the tag argument is added.
    const src = [
      "import { test, expect } from './fixtures';",
      '',
      'test(',
      "  'a title long enough that prettier wraps every argument onto its own line',",
      "  { tag: '@emulated-viewport' },",
      '  async ({ page }) => {',
      '    await page.setViewportSize({ width: 320, height: 900 });',
      "    await page.goto('/');",
      '  },',
      ');',
      '',
    ].join('\n');

    expect(analyze('synthetic.spec.ts', src)).toEqual([]);
  });

  it('sees test.use({ viewport }) written in shorthand', () => {
    // tests/e2e/visual.spec.ts writes exactly this, and android-chrome
    // collected all eight of its tests: `viewport:` was the only spelling seen.
    const findings = scanned([
      "import { test } from './fixtures';",
      'for (const { label, viewport } of WIDTHS) {',
      '  test.describe(`${label} wide`, () => {',
      '    test.use({ viewport });',
      "    test('renders', async ({ page }) => {});",
      '  });',
      '}',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:3');
    expect(findings[0]).toContain(EMULATED_VIEWPORT_TAG);
  });

  it('is not fooled by a declaration spelled inside a string', () => {
    expect(
      scanned([
        "import { test } from './fixtures';",
        "test('resizes', { tag: '@emulated-viewport' }, async ({ page }) => {",
        '  const example = "test(\'not a test\', async () => {})";',
        '  await page.setViewportSize({ width: 320, height: 800 });',
        '});',
      ]),
    ).toEqual([]);
  });

  it('gives a resize in a hook to the group the hook runs for, not to the test above it', () => {
    const findings = scanned([
      "import { test } from './fixtures';",
      "test.describe('phones', () => {",
      "  test('first', { tag: '@emulated-viewport' }, async ({ page }) => {",
      '    await page.setViewportSize({ width: 320, height: 800 });',
      '  });',
      '  test.beforeEach(async ({ page }) => {',
      '    await page.setViewportSize({ width: 375, height: 667 });',
      '  });',
      '});',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:2');
    expect(findings[0]).toContain('phones');
  });

  it('reports the line a finding is on in the file, below a block comment', () => {
    const findings = scanned([
      "import { test } from './fixtures';",
      '/**',
      ' * A docblock above the test.',
      ' */',
      "test('shrinks', async ({ page }) => {",
      '  await page.setViewportSize({ width: 320, height: 800 });',
      '});',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:5');
  });

  it('reports a resize no declaration contains, instead of crediting the test above it', () => {
    const findings = scanned([
      "import { test } from './fixtures';",
      "test('first', { tag: '@emulated-viewport' }, async ({ page }) => {",
      '  await page.setViewportSize({ width: 320, height: 800 });',
      '});',
      'async function toPhone(page) {',
      '  await page.setViewportSize({ width: 375, height: 667 });',
      '}',
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('synthetic.spec.ts:6');
  });
});
