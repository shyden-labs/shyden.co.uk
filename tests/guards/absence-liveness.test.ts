import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { floorBreach } from '../floors';
import { scopeOf, testBodiesIn } from '../floorless-searches';
import { ABSENCE_BURN_DOWN } from '../absence-liveness.burn-down';
import {
  committableFiles,
  filesUnder,
  isTsUnderTests,
  searched,
  walkDisagreements,
} from '../source-files';
import {
  bindFiles,
  callGraph,
  codeWithoutLiterals,
  derivationOf,
  parseFile,
  parseSource,
  where,
} from '../unit/ast';

/**
 * An absence assertion must prove its POPULATION was live (#118).
 *
 * `expect(findings).toEqual([])` is green in two different worlds: the guard
 * ran over a real subject and found nothing, and the guard was handed nothing
 * to run over. #84 measured what that costs -- twelve tests passed while
 * scanning zero files -- and put the control inside the file walk. #79 did
 * the same for browser events, inside the recorder. Neither generalised to
 * the third and largest case: a guard that BUILDS a list, from a file walk, a
 * match set, or a table read, and then asserts the list is empty.
 *
 * The control now lives inside the assertion's own expression:
 *
 *     expect(searched(findings, { of: files, what: 'files' })).toEqual([]);
 *
 * Every absence is judged, whatever its shape (#609, the operator's rule
 * from #534: no exceptions). Two structural shapes name their reason:
 *
 *  - **A collector** — a variable initialised empty and accumulated into, or
 *    produced by `.filter()` / `.flatMap()`, whether the call is in the
 *    binding's initialiser or written inline in the subject. Its emptiness
 *    says nothing until you know the thing it accumulated FROM was not empty.
 *  - **A discovery** — a subject whose derivation transitively reaches the
 *    filesystem. `const result = scan()` three hops above a `readFileSync` is
 *    the shape `anchored-presence.test.ts` uses on itself.
 *
 * Anything else not routed through `searched(` is "self-contained", and that
 * is a finding too. This guard used to put it out of scope --
 * `expect(rosterWarnings([], en)).toEqual([])`, "its population is the literal
 * written beside it" -- and 185 of 470 sites in 60 files went unjudged, with
 * neither a population in the verdict nor a floor, while the floor guard
 * judged only `searched(` calls and saw nothing either. A category the guard
 * cannot see is an exemption by another name.
 *
 * Today's unjudged sites are DEBT, listed in `absence-liveness.burn-down.ts`
 * by `file › test title as written`, and checked for equality both ways: a
 * converted site is red until the list is lowered, and a new unjudged site is
 * red by name. The list only shrinks, and nothing exempts a site by shape,
 * label or reason; the conversions (#610-#617) empty it.
 *
 * `.not.toEqual([])` is a PRESENCE assertion and is skipped: it fails, loudly,
 * on an empty population, so it cannot hide one.
 *
 * The scan covers EVERY `.ts` under `tests/`, not just `*.test.ts` and
 * `*.spec.ts`. That filter looked like a definition and was really a
 * hand-drawn boundary -- the kind #24's sweep was built on and #60 and #65
 * then found survivors outside. It excluded `tests/e2e/recorders.ts`, which
 * is where #79's collector-liveness lesson was learned and which carries
 * three absence assertions of its own. Derive the scope from the filesystem,
 * including for your own guard.
 */

/** Reaching any of these means the subject came from outside the test. */
const DISCOVERY = new Set([
  'readFileSync',
  'readdirSync',
  'filesUnder',
  'listSourceFiles',
]);

/** Shapes that accumulate: emptiness is meaningless without the source. */
const DERIVING = new Set(['filter', 'flatMap']);

const tsFiles = filesUnder('tests', (path) => path.endsWith('.ts'));
const discoverers = callGraph(tsFiles).close(DISCOVERY);

/** Bound once: each name resolves in its own scope, not by name (#184). */
const bound = bindFiles(tsFiles);

const EQUALITY = new Set(['toEqual', 'toStrictEqual', 'toBe']);

const isZero = (arg: ts.Expression | undefined): boolean =>
  arg !== undefined && ts.isNumericLiteral(arg) && arg.text === '0';

/**
 * The call an absence matcher hangs off -- `expect(x)` in
 * `expect(x).toEqual([])` -- for every spelling of "this is empty":
 * `.toEqual([])`, `.toStrictEqual([])`, `.toHaveLength(0)`, and anything held
 * equal to 0. Null for any other matcher, and for a `.not` inverse.
 */
function absenceRoot(
  node: ts.CallExpression,
): { root: ts.Expression; zeroCount: boolean } | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  const matcher = node.expression.name.text;
  const arg = node.arguments[0];
  const emptyList =
    (matcher === 'toEqual' || matcher === 'toStrictEqual') &&
    arg !== undefined &&
    ts.isArrayLiteralExpression(arg) &&
    arg.elements.length === 0;
  const noLength = matcher === 'toHaveLength' && isZero(arg);
  const zeroCount = EQUALITY.has(matcher) && isZero(arg);
  if (!emptyList && !noLength && !zeroCount) return null;

  // Walk back through any modifier chain (`.not`, `.resolves`). A `.not`
  // anywhere in it inverts the claim, so the assertion is not an absence one.
  let target: ts.Expression = node.expression.expression;
  while (ts.isPropertyAccessExpression(target)) {
    if (target.name.text === 'not') return null;
    target = target.expression;
  }
  return { root: target, zeroCount };
}

/** `expect(x)` or `expect.soft(x)`: both assert, so both are read. */
function isExpectCall(root: ts.Expression): root is ts.CallExpression {
  if (!ts.isCallExpression(root)) return false;
  const callee = root.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'expect';
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'expect' &&
    callee.name.text === 'soft'
  );
}

/**
 * What an absence assertion asserts empty. For a count held to 0 the subject
 * is what the count is OF: `expect(found.length).toBe(0)` asserts `found`
 * empty (#390 F159).
 */
function absenceSubject(node: ts.CallExpression): ts.Expression | null {
  const shape = absenceRoot(node);
  if (!shape || !isExpectCall(shape.root)) return null;
  const subject = shape.root.arguments[0];
  if (subject === undefined) return null;
  if (!shape.zeroCount) return subject;
  // A bare number held to 0 is a value, not a population.
  return ts.isPropertyAccessExpression(subject) &&
    (subject.name.text === 'length' || subject.name.text === 'size')
    ? subject.expression
    : null;
}

/** Why this subject needs a control, or null if it carries its own. */
function unproved(subject: ts.Expression, file: string): string | null {
  // Already routed through the helper: the population is in the expression.
  if (
    ts.isCallExpression(subject) &&
    ts.isIdentifier(subject.expression) &&
    subject.expression.text === 'searched'
  )
    return null;

  // A derivation written in the subject itself: `expect(xs.filter(...))`.
  // `derivationOf` reads the initialisers of the names a subject uses, never
  // the subject's own receiver chain, so this was read as self-contained (#609).
  for (let at: ts.Expression = subject; ;) {
    if (ts.isParenthesizedExpression(at) || ts.isAwaitExpression(at)) {
      at = at.expression;
    } else if (ts.isCallExpression(at)) {
      at = at.expression;
    } else if (ts.isPropertyAccessExpression(at)) {
      if (
        DERIVING.has(at.name.text) &&
        ts.isCallExpression(at.parent) &&
        at.parent.expression === at
      )
        return `derived by .${at.name.text}() over a population`;
      at = at.expression;
    } else break;
  }

  const { names, initializers } = derivationOf(subject, bound);
  if (names.some((name) => discoverers.reaches(file, name)))
    return 'derives from the filesystem';

  // No filesystem question inside the loop: every identifier in a followed
  // initializer is already one of `names`, which the check above has asked.
  for (const init of initializers) {
    if (ts.isArrayLiteralExpression(init) && init.elements.length === 0)
      return 'a collector: initialised empty and accumulated into';
    if (
      ts.isNewExpression(init) &&
      ts.isIdentifier(init.expression) &&
      (init.expression.text === 'Set' || init.expression.text === 'Map') &&
      (init.arguments?.length ?? 0) === 0
    )
      return `a collector: an empty ${init.expression.text}`;
    if (
      ts.isCallExpression(init) &&
      ts.isPropertyAccessExpression(init.expression) &&
      DERIVING.has(init.expression.name.text)
    )
      return `derived by .${init.expression.name.text}() over a population`;
  }
  // Anything else is a finding too (#609, #534: no exceptions). An assertion
  // over a call whose input is written beside it has no population in the
  // verdict and no floor, so nothing would notice a reader that stopped
  // reading part of it.
  return 'self-contained: no population in the verdict';
}

/**
 * An absence matcher on a root the reader cannot classify -- `expect.poll`,
 * an aliased `expect`, a helper returning a matcher -- named, so the scan
 * refuses it rather than skipping it: skipped, it is an absence nobody judges
 * (#446, control d).
 */
function unclassified(node: ts.CallExpression): string | null {
  const shape = absenceRoot(node);
  if (!shape || isExpectCall(shape.root)) return null;
  if (shape.zeroCount && !countsAPopulation(shape.root)) return null;
  return shape.root.getText().replace(/\s+/g, ' ').slice(0, 70);
}

/**
 * Whether a count held to 0 on an unread root is a population's size. A bare
 * value held to 0 is not an absence, as `absenceSubject` says of
 * `expect(k).toBe(0)`. A polled function is judged by what it returns
 * (`evidence-page.spec.ts` polls an in-flight counter to 0), and one whose
 * return cannot be read from here counts as a population, so it is refused.
 */
function countsAPopulation(root: ts.Expression): boolean {
  if (!ts.isCallExpression(root)) return true;
  let counted: ts.Expression | undefined = root.arguments[0];
  const callee = root.expression;
  const polled =
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'expect' &&
    callee.name.text === 'poll';
  if (polled) {
    if (
      counted === undefined ||
      !ts.isArrowFunction(counted) ||
      ts.isBlock(counted.body)
    )
      return true;
    counted = counted.body;
  }
  while (counted !== undefined && ts.isParenthesizedExpression(counted))
    counted = counted.expression;
  return (
    counted === undefined ||
    (ts.isPropertyAccessExpression(counted) &&
      (counted.name.text === 'length' || counted.name.text === 'size'))
  );
}

/**
 * An absence matcher as text, for the cross-check: no AST walk, so a reader
 * blind to one file or one spelling disagrees with it. Matched in code with
 * its literals and comments removed (`codeWithoutLiterals`), then with all
 * whitespace and every trailing comma gone, so a matcher prettier split over
 * lines reads as one. A count held to 0 is read only on a `.length` or
 * `.size` written inside `expect(`, as `absenceSubject` reads it: on a bare
 * value, or on arithmetic, it is plainly not an absence. A `.not` directly
 * before the matcher inverts it.
 */
const ABSENCE_TEXT = new RegExp(
  [
    String.raw`(?<!\.not)\.(?:toEqual|toStrictEqual)\(\[\]\)`,
    String.raw`(?<!\.not)\.toHaveLength\(0\)`,
    String.raw`expect(?:\.soft)?\([\w$.()[\]]+?\.(?:length|size)(?:,"")?\)\.(?:toBe|toEqual|toStrictEqual)\(0\)`,
  ].join('|'),
  'g',
);

/** How many absence matchers `sf` writes, counted as text (#477). */
function absencesWritten(sf: ts.SourceFile): number {
  const code = codeWithoutLiterals(sf)
    .replace(/\s+/g, '')
    .replace(/,\)/g, ')')
    .replace(/,\]/g, ']');
  return code.match(ABSENCE_TEXT)?.length ?? 0;
}

function scan() {
  const findings: string[] = [];
  const sites: string[] = [];
  const perFile = new Map<string, number>();
  /** Unjudged absences by `file › test title as written` (#609). */
  const unjudged = new Map<string, number>();
  let proved = 0;
  for (const [file, sf] of bound.files) {
    const bodies = testBodiesIn(sf);
    const check = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const root = unclassified(node);
        if (root)
          findings.push(
            `${where(sf, node)} — an absence on a root the reader cannot classify: ${root}`,
          );
        const subject = absenceSubject(node);
        if (subject) {
          sites.push(where(sf, node));
          perFile.set(file, (perFile.get(file) ?? 0) + 1);
          const why = unproved(subject, file);
          if (why === null) proved += 1;
          else {
            const scope = scopeOf(bodies, node);
            // Fail closed: a site the reader cannot place cannot be listed.
            if (scope === undefined)
              findings.push(
                `${where(sf, node)} — an absence in no test and no named function`,
              );
            else {
              const key = `${file} › ${scope.label}`;
              unjudged.set(key, (unjudged.get(key) ?? 0) + 1);
            }
          }
        }
      }
      ts.forEachChild(node, check);
    };
    check(sf);
  }
  return { sites, perFile, proved, findings, unjudged };
}

const result = scan();

const CEILING_SITES = 63;
const CEILING_SCOPES = 61;

describe('absence assertions prove the population they searched', () => {
  // Separate from the verdict, and load-bearing: the verdict below is itself
  // an absence assertion, so a detector whose AST walk quietly stopped
  // matching would report zero findings over zero absences -- and only one of
  // those is good news. This is the shape `event-collectors.test.ts` settled.
  it('finds the absence assertions it is meant to be judging', () => {
    // Ratcheted (#468): exact against tests/floors.json, so one file short
    // fails, and so does one more until it is recorded.
    expect(
      floorBreach('absence-liveness/ts-files', tsFiles.length),
    ).toBeUndefined();
    // The figure is recorded exactly rather than left comfortably low, for
    // the reason `anchored-presence` records: a control with slack in it is
    // most of the way back to no control at all. #184 found it at 100 over a
    // real 154, and showed what that slack costs: with the `toHaveLength(0)` branch of
    // `absenceSubject` dead, this test stayed green. #390 F161 found it
    // there again, at 153 over a real 391, with the same branch dead and
    // the same test green; F159's spellings brought the figure to 394,
    // and #446 measured 399 on 2026-10-03. Groups 2a and 2b added 22 the
    // same day and left it 22 slack, which is how a floor drifts: growth
    // never fails it. Re-measured 421 at Group 3 (#446), and 424 an hour
    // after that merged: so it is ratcheted now (#468), exact both ways.
    expect(
      floorBreach('absence-liveness/sites', result.sites.length),
    ).toBeUndefined();
    expect(result.proved).toBeGreaterThan(0);
  });

  it('walks every .ts file git has under tests/', () => {
    // Independent of the walk (#477): git's list, not the disk, so a walk
    // that narrows (skips a directory, a suffix) names what it dropped.
    expect(
      searched(walkDisagreements(tsFiles, committableFiles(isTsUnderTests)), {
        of: tsFiles,
        what: 'files under tests/',
      }),
    ).toEqual([]);
    // The walk and git's list can narrow together, and agree over less (#522).
    expect(
      floorBreach('absence-liveness/walked-files', tsFiles.length),
    ).toBeUndefined();
  });

  it('reads an absence however it is spelled, and never its inverse', () => {
    // Only `toEqual([])` and `toHaveLength(0)` were read, so an absence
    // written `expect(found.length).toBe(0)` over a file walk was never
    // judged (#390 F159).
    const sf = ts.createSourceFile(
      'fixture.test.ts',
      [
        'expect(a).toEqual([]);',
        'expect(b).toStrictEqual([]);',
        'expect(c).toHaveLength(0);',
        'expect(d.length).toBe(0);',
        'expect(e.size).toBe(0);',
        'expect(f.length).toEqual(0);',
        'expect(g.length).toStrictEqual(0);',
        'expect.soft(l).toEqual([]);',
        'expect.soft(m.length).toBe(0);',
        'expect(h).not.toEqual([]);',
        'expect(i.length).not.toBe(0);',
        'expect(j.length).toBe(1);',
        'expect(k).toBe(0);',
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
    );
    const subjects: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const subject = absenceSubject(node);
        if (subject) subjects.push(subject.getText(sf));
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(subjects).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'l', 'm']);
  });

  it('judges a subject that is not routed through searched, whatever its shape', () => {
    // Planted (#609). Written out, never generated from `unproved`'s own
    // branches: a plant built from the reader's list cannot see it drop one.
    const reasonFor = (subject: string): string | null => {
      const sf = ts.createSourceFile(
        'fixture.test.ts',
        `expect(${subject}).toEqual([]);`,
        ts.ScriptTarget.Latest,
        true,
      );
      let why: string | null = 'no absence read';
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const read = absenceSubject(node);
          if (read) why = unproved(read, 'fixture.test.ts');
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return why;
    };
    // The exempt shape: a call over input written beside it.
    expect(reasonFor('rosterWarnings([], en)')).toMatch(/^self-contained/);
    expect(reasonFor('plantedNameNothingDeclares')).toMatch(/^self-contained/);
    // An inline derivation, read on the subject itself, in every position of
    // the receiver chain.
    expect(reasonFor('LOCALES.filter((l) => l !== "en")')).toMatch(
      /^derived by \.filter\(\)/,
    );
    expect(reasonFor('rows.flatMap((r) => r.cells)')).toMatch(
      /^derived by \.flatMap\(\)/,
    );
    expect(reasonFor('rows.filter((r) => r.bad).map((r) => r.id)')).toMatch(
      /^derived by \.filter\(\)/,
    );
    // Routed through the helper: the population is in the verdict.
    expect(reasonFor("searched(f, { of: p, what: 'w' })")).toBeNull();
  });

  it('refuses an absence on a root it cannot classify, rather than skipping it', () => {
    // `expect.soft(x)` asserts like `expect(x)` and is read above. Any other
    // root -- `expect.poll(fn)`, an alias, a helper returning a matcher -- was
    // silently not an absence at all, so nothing judged it (#446, control d).
    const sf = ts.createSourceFile(
      'fixture.test.ts',
      [
        'expect.poll(n).toEqual([]);',
        'assertThat(o).toHaveLength(0);',
        'expect.poll(() => p.length).toBe(0);',
        'expect.poll(t).toBe(0);',
        'expect.poll(async () => { return u.size; }).toBe(0);',
        'assertThat(v.length).toBe(0);',
        // Not refused: a value held to 0, a polled value, the two roots that
        // are read, and an inverse.
        'assertThat(w).toBe(0);',
        'expect\n  .poll(async () => (await counters(x)).inflight)\n  .toBe(0);',
        'expect.soft(q).toEqual([]);',
        'expect(r).toEqual([]);',
        'expect.poll(s).not.toEqual([]);',
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
    );
    const refused: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const root = unclassified(node);
        if (root) refused.push(root);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(refused).toEqual([
      'expect.poll(n)',
      'assertThat(o)',
      'expect.poll(() => p.length)',
      'expect.poll(t)',
      'expect.poll(async () => { return u.size; })',
      'assertThat(v.length)',
    ]);
  });

  it('reads as text every spelling the reader reads, and no inverse', () => {
    // The cross-check below is only independent if it knows the same forms.
    // Written out, never generated from either reader's list: a plant built
    // from the list a reader uses cannot see that list drop a form (#446).
    const read = [
      'expect(a).toEqual([]);',
      'expect(b).toStrictEqual([]);',
      'expect(c).toHaveLength(0);',
      'expect(d.length).toBe(0);',
      'expect(e.size).toBe(0);',
      'expect(f.length).toEqual(0);',
      'expect(g.length).toStrictEqual(0);',
      'expect.soft(l).toEqual([]);',
      'expect.soft(m.length).toBe(0);',
      // Split by prettier, and with a message: the forms a line-by-line
      // reading of raw text could not see (#477).
      'expect(\n  n,\n).toEqual(\n  [],\n);',
      'expect(o.length, "why").toBe(0);',
      'expect(\n  p.size,\n  `why`,\n).toBe(0);',
      'expect(q)\n  .toHaveLength(0);',
    ];
    const inverse = [
      'expect(h).not.toEqual([]);',
      'expect(i.length).not.toBe(0);',
      'expect(j.length).toBe(1);',
      'expect(k).toBe(0);',
      'expect(r)\n  .not\n  .toHaveLength(0);',
      // A value, not a population: the AST reads no subject here either.
      'expect(s.length - t.length, "why").toBe(0);',
      // A fixture that spells an absence holds none (#477).
      "const u = 'expect(a).toEqual([])';",
      'const v = `expect(${w}).toHaveLength(0)`;',
      String.raw`const x = /expect\(y\)\.toEqual\(\[\]\)/;`,
      '// expect(z).toEqual([]);',
    ];
    const missed = read.filter(
      (line) => absencesWritten(parseSource(line)) !== 1,
    );
    expect(searched(missed, { of: read, what: 'planted absences' })).toEqual(
      [],
    );
    const misread = inverse.filter(
      (line) => absencesWritten(parseSource(line)) !== 0,
    );
    expect(
      searched(misread, { of: inverse, what: 'planted non-absences' }),
    ).toEqual([]);
    // A spelling quietly deleted from either table drops its check (#522).
    expect(
      floorBreach('absence-liveness/planted-absences', read.length),
    ).toBeUndefined();
    expect(
      floorBreach('absence-liveness/planted-non-absences', inverse.length),
    ).toBeUndefined();
  });

  it('reads as many absences in each file as its text writes', () => {
    // Independent of the AST walk (#446, control c), and per unit (#477): a
    // reader blind to one spelling in a file that writes two others was
    // invisible to a file-level check. Counted in code with every literal
    // and comment removed, so neither a fixture string nor a comment naming
    // the matcher can satisfy it.
    const written = new Map(
      tsFiles.map((file) => [file, absencesWritten(parseFile(file))]),
    );
    const disagree = tsFiles
      .filter((file) => (result.perFile.get(file) ?? 0) !== written.get(file))
      .map(
        (file) =>
          `${file}: the reader found ${result.perFile.get(file) ?? 0}, ` +
          `its text writes ${written.get(file)}`,
      );
    expect(searched(disagree, { of: tsFiles, what: 'files' })).toEqual([]);
    // Ratcheted after the verdict (#468), so growth never hides a finding:
    // the files compared (#522), then those that write an absence.
    expect(
      floorBreach('absence-liveness/compared-files', tsFiles.length),
    ).toBeUndefined();
    expect(
      floorBreach(
        'absence-liveness/plain-files',
        tsFiles.filter((file) => (written.get(file) ?? 0) > 0).length,
      ),
    ).toBeUndefined();
  });

  it('finds every scope holding exactly the unjudged absences listed', () => {
    // The listed sites are today's debt (#609), keyed by the test that holds
    // them. Equality both ways: a converted site leaves its key too high and
    // is red until the list is lowered, and a new unjudged site is red by
    // name. Nothing is exempt by shape, label or reason.
    const keys = new Set([
      ...result.unjudged.keys(),
      ...Object.keys(ABSENCE_BURN_DOWN),
    ]);
    const mismatched = [...keys]
      .filter(
        (key) =>
          (result.unjudged.get(key) ?? 0) !== (ABSENCE_BURN_DOWN[key] ?? 0),
      )
      .map((key) => {
        const [listed, read] = [
          ABSENCE_BURN_DOWN[key] ?? 0,
          result.unjudged.get(key) ?? 0,
        ];
        return read > listed
          ? `${key}: ${read} absences with no population in the verdict, ${listed} listed. Route each through searched() and check a floor.`
          : `${key}: ${read} unjudged, ${listed} listed. Lower the entry in tests/absence-liveness.burn-down.ts: the list only shrinks.`;
      });
    expect(
      searched(result.findings, {
        of: result.sites,
        what: 'absence assertions',
      }),
      result.findings.join('\n'),
    ).toEqual([]);
    expect(
      searched(mismatched, { of: result.sites, what: 'absence assertions' }),
      mismatched.join('\n'),
    ).toEqual([]);
    expect(
      floorBreach('absence-liveness/judged-sites', result.sites.length),
    ).toBeUndefined();
  });

  it('only shrinks the burn-down list', () => {
    // Measured when the list landed (#609); a conversion lowers these with
    // the list and nothing else raises them. The recorded floor holds the
    // list's own size, so a key quietly deleted from it is seen.
    const counts = Object.values(ABSENCE_BURN_DOWN);
    expect(counts.reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(
      CEILING_SITES,
    );
    expect(counts.length).toBeLessThanOrEqual(CEILING_SCOPES);
    expect(counts.every((n) => Number.isInteger(n) && n >= 1)).toBe(true);
    expect(
      floorBreach('absence-liveness/burn-down-scopes', counts.length),
    ).toBeUndefined();
  });
});
