import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { searched, specFilesUnder } from '../source-files';
import { floorBreach } from '../floors';
import { parseFile, parseSource } from './ast';
import { withoutAstroComments, withoutTsComments } from './source-text';

/**
 * An expectation may not be satisfiable by the page's own shipped markup.
 *
 * `#cg-count` ships `value="30"`, so the box already reads `30` before a line
 * of script runs. Three assertions in `classroom-groups-roster.spec.ts` built
 * a roster of 30 and then expected `'30'`, and all three passed with
 * `updateStudentsBox`'s write removed (#193).
 *
 * The comment guarding them named this exact hazard -- it said the brief's
 * literal was avoided because the box "ships `value="24"`", so 30 "shares
 * nothing with that default". The shipped default later moved to 30 and
 * nothing connected the two. That is the whole reason this guard derives both
 * halves from the files instead of trusting a number written in prose: the
 * reasoning that protected those assertions is what now indicts them.
 *
 * Scope was DERIVED, not read. The ticket listed three sites, found with
 * `git grep "Number of students'"`; sweeping every `toHaveValue` literal found
 * seven, because four address the box as `#cg-count` or through a variable and
 * never by its label (#80).
 */

const PAGE = 'src/components/pages/ClassroomGroupsPage.astro';
const MESSAGES = 'src/lib/i18n/en.ts';
const HELPERS = 'tests/e2e/helpers.ts';

/** The click every roster in this suite is ultimately built from. */
const ROSTER_SEED = 'Add student';

/**
 * The same control named by its catalogue key, which is how helpers.ts names
 * it since #390 F113 (every label read from the page's own catalogue, so zh,
 * vi and th can be driven): `openRoster` holds this key and no English. Two
 * specs already clicked it this way and were invisible to the literal alone.
 */
const ROSTER_SEED_KEY = 'rosterAddStudent';

/** A field the page serves with a build-time value a test could collide with. */
interface ShippedField {
  id: string;
  /**
   * The `value=` content attribute.
   *
   * Assigning `.value` sets the IDL property and never rewrites this, so the
   * attribute is the page's own record of what it shipped -- which is also
   * what makes the e2e side of the fix derivable at runtime.
   */
  shipped: string;
  /** Rendered label text, resolved `<label for>` -> `{t.KEY}` -> `en.ts`. */
  label: string | null;
}

/** `name="..."` on an opening tag, or null. */
const attr = (tag: string, name: string): string | null =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

/**
 * Every `<input>` the page ships with both an `id` and a `value`.
 *
 * Comment-stripped first: a commented-out input is not served, and a guard
 * that reads a file's own documentation as configuration is this repo's most
 * repeated defect (#23, #21, #35, #49).
 */
function shippedFields(): ShippedField[] {
  const markup = withoutAstroComments(readFileSync(PAGE, 'utf8'));
  const messages = withoutTsComments(readFileSync(MESSAGES, 'utf8'));

  /** `<label for="x">{t.key}</label>` -> id -> message key. */
  const keyOf = new Map<string, string>();
  for (const [, id, key] of markup.matchAll(
    /<label\s+for="([^"]+)"\s*>\s*\{t\.([A-Za-z0-9_$]+)\}\s*<\/label>/g,
  ))
    keyOf.set(id, key);

  const fields: ShippedField[] = [];
  for (const [, tag] of markup.matchAll(/<input\b([^>]*)>/g)) {
    const id = attr(tag, 'id');
    const shipped = attr(tag, 'value');
    if (!id || shipped === null) continue;
    const key = keyOf.get(id);
    const label = key
      ? (new RegExp(`^\\s*${key}:\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'm').exec(
          messages,
        )?.[1] ?? null)
      : null;
    fields.push({ id, shipped, label });
  }
  return fields;
}

/**
 * Every string OR regex literal anywhere under `node`.
 *
 * The regex half is not defensive padding. After the i18n work every roster
 * helper matched its control bilingually -- `name: /Add student|Tambah siswa/`
 * -- so a seed search that collected only string literals found NOTHING in
 * `helpers.ts` and silently reported that this suite builds no rosters at all.
 * It did exactly that here, and the guard still named the right three sites,
 * by an accident described on `isTestBlock` below. The helpers now name the
 * control by its catalogue key, which `ROSTER_SEED_KEY` answers for.
 */
function literalsIn(node: ts.Node): string[] {
  const found: string[] = [];
  const visit = (current: ts.Node) => {
    if (
      ts.isStringLiteral(current) ||
      ts.isNoSubstitutionTemplateLiteral(current) ||
      ts.isRegularExpressionLiteral(current)
    )
      found.push(current.text);
    ts.forEachChild(current, (child) => {
      visit(child);
    });
  };
  visit(node);
  return found;
}

/** Every identifier name anywhere under `node`. */
function namesIn(node: ts.Node): string[] {
  const found: string[] = [];
  const visit = (current: ts.Node) => {
    if (ts.isIdentifier(current)) found.push(current.text);
    ts.forEachChild(current, (child) => {
      visit(child);
    });
  };
  visit(node);
  return found;
}

/**
 * Helper names that ultimately click "Add student", to a fixed point.
 *
 * Derived rather than listed. A hand-written "these build a roster" list is
 * the shape that missed four of this ticket's own seven sites, and a set that
 * stops at one hop misses `buildRoster` -> `openRoster` (#98).
 */
function rosterBuilders(): Set<string> {
  const source = parseFile(HELPERS);
  /** Declared name -> the names and literals its body mentions. */
  const body = new Map<string, { names: string[]; literals: string[] }>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    )
      body.set(node.name.text, {
        names: namesIn(node.initializer),
        literals: literalsIn(node.initializer),
      });
    else if (ts.isFunctionDeclaration(node) && node.name && node.body)
      body.set(node.name.text, {
        names: namesIn(node.body),
        literals: literalsIn(node.body),
      });
    ts.forEachChild(node, (child) => {
      visit(child);
    });
  };
  visit(source);

  const builders = new Set<string>();
  for (const [name, seen] of body)
    // `includes` on the array would demand the literal be the whole control.
    // The seed lives inside an alternation, so the containment is per literal.
    if (
      seen.literals.some((literal) => literal.includes(ROSTER_SEED)) ||
      seen.names.includes(ROSTER_SEED_KEY)
    )
      builders.add(name);

  // Fixed point: a caller of a builder is a builder. Iterating over a snapshot
  // of the set would stop one hop short of `buildRoster` -> `openRoster`.
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, seen] of body)
      if (!builders.has(name) && seen.names.some((n) => builders.has(n))) {
        builders.add(name);
        grew = true;
      }
  }
  return builders;
}

/**
 * Whether `node` is one test, as opposed to a group of them.
 *
 * `namesIn(callee)[0] === 'test'` reads `test.describe` as a test, and the
 * consequence is not a miscount: "has a roster been built BEFORE this
 * assertion?" then ranges over the whole group, so a roster built by a
 * SIBLING test earlier in the file answers for this one. That is how the
 * first run of this guard produced exactly the three sites predicted while
 * `rosterBuilders()` was returning nothing at all -- the right answer by a
 * mechanism that was not the one under test, which is the only kind of green
 * worth distrusting.
 */
function isTestBlock(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (ts.isIdentifier(callee))
    return callee.text === 'test' || callee.text === 'it';
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression)
  )
    return (
      ['test', 'it'].includes(callee.expression.text) &&
      ['only', 'skip', 'fixme', 'fail', 'slow'].includes(callee.name.text)
    );
  return false;
}

/** Whether `node` is a `beforeEach`, whose body runs before every test. */
function isBeforeEach(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'beforeEach';
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'test' &&
    callee.name.text === 'beforeEach'
  );
}

/** A `toHaveValue('literal')` whose literal is a field's shipped default. */
interface Collision {
  site: string;
  id: string;
  shipped: string;
  /** Whether the test had already built a roster when it asserted. */
  afterRoster: boolean;
}

/**
 * Every `toHaveValue` against a shipped default, across every spec on disk.
 *
 * The population is walked as constructs, never as text: TypeScript's AST has
 * no node for a comment, so "did a roster-building CALL precede this
 * assertion?" is comment-proof without stripping anything, and a commented-out
 * `addSeveral` cannot make a live assertion read as covered.
 */
function collisions(
  fields: readonly ShippedField[],
  // Injected so the scoping rules below can be proved against a source written
  // to exercise them, rather than against whichever shape the suite happens to
  // contain today. A guard whose own edge cases are only ever exercised by
  // accident is one refactor away from silently not applying.
  files: readonly string[] = specFilesUnder('tests'),
  parse: (file: string) => ts.SourceFile = parseFile,
): Collision[] {
  const builders = rosterBuilders();
  const found: Collision[] = [];

  for (const file of files) {
    const source = parse(file);
    const line = (node: ts.Node) =>
      `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;

    /**
     * Whether any `beforeEach` in this file builds a roster.
     *
     * Taken per FILE, which over-approximates: a hook in one describe answers
     * for a test in another. That is the honest direction for a guard that
     * refuses -- it can only ever refuse more -- and the alternative, ignoring
     * hooks, would let a roster built in `beforeEach` read as an untouched
     * page and turn a vacuous expectation back into a "deliberate pin". Three
     * specs here use one.
     */
    let hooksBuild = false;
    const findHooks = (node: ts.Node) => {
      if (ts.isCallExpression(node) && isBeforeEach(node)) {
        const called = namesIn(node);
        if (
          called.some((name) => builders.has(name)) ||
          literalsIn(node).some((literal) => literal.includes(ROSTER_SEED)) ||
          called.includes(ROSTER_SEED_KEY)
        )
          hooksBuild = true;
      }
      ts.forEachChild(node, (child) => {
        findHooks(child);
      });
    };
    findHooks(source);

    const inTest = (block: ts.Node) => {
      /** Locally declared name -> the literals its initialiser mentions. */
      const local = new Map<string, string[]>();
      const declare = (node: ts.Node) => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer
        )
          local.set(node.name.text, literalsIn(node.initializer));
        ts.forEachChild(node, (child) => {
          declare(child);
        });
      };
      declare(block);

      const assert = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'toHaveValue' &&
          node.arguments.length === 1 &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          const expected = node.arguments[0].text;
          const receiver = node.expression.expression;
          const said = new Set(literalsIn(receiver));
          for (const name of namesIn(receiver))
            for (const literal of local.get(name) ?? []) said.add(literal);

          const field = fields.find(
            (candidate) =>
              candidate.shipped === expected &&
              (said.has(`#${candidate.id}`) ||
                (candidate.label !== null && said.has(candidate.label))),
          );
          if (field) {
            // "Before" is positional, and a call is a node, so a mention of
            // `addSeveral` inside a comment cannot answer this.
            const start = node.getStart(source);
            let built = hooksBuild;
            const scan = (current: ts.Node) => {
              if (current.end <= start) {
                if (ts.isCallExpression(current)) {
                  const called = namesIn(current.expression);
                  if (
                    called.some((name) => builders.has(name)) ||
                    literalsIn(current).some((literal) =>
                      literal.includes(ROSTER_SEED),
                    ) ||
                    namesIn(current).includes(ROSTER_SEED_KEY)
                  )
                    built = true;
                }
              }
              ts.forEachChild(current, (child) => {
                scan(child);
              });
            };
            scan(block);
            found.push({
              site: line(node),
              id: field.id,
              shipped: field.shipped,
              afterRoster: built,
            });
          }
        }
        ts.forEachChild(node, (child) => {
          assert(child);
        });
      };
      assert(block);
    };

    const walk = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        isTestBlock(node) &&
        node.arguments.length >= 2
      ) {
        const body = node.arguments[node.arguments.length - 1];
        if (ts.isArrowFunction(body) || ts.isFunctionExpression(body))
          inTest(body);
      }
      ts.forEachChild(node, (child) => {
        walk(child);
      });
    };
    walk(source);
  }
  return found;
}

describe('a page-shipped default cannot stand in for an implementation', () => {
  const fields = shippedFields();

  it('derives what the page ships, label and all', () => {
    const count = fields.find((field) => field.id === 'cg-count');
    // The literal pin (#117): a level asserted only against something derived
    // from it moves whenever the source moves. This is the one place the
    // shipped defaults are stated against the design, so a silent change to
    // the markup -- the very move that rotted the comment above -- goes red.
    expect(count).toEqual({
      id: 'cg-count',
      shipped: '30',
      label: 'Number of students',
    });
    expect(
      fields.map((field) => `${field.id}=${field.shipped}`).sort(),
    ).toEqual(['cg-count=30', 'cg-groups=6', 'cg-size=4']);
  });

  it('finds every roster-building helper, to a fixed point', () => {
    // The SET is diffed, never counted (#80): a count that moves the way you
    // predicted can still be a different set, and the members that matter
    // here are the transitive ones a snapshot-iterating loop drops.
    expect([...rosterBuilders()].sort()).toEqual([
      // Transitive, all of them: only `openRoster` clicks the seed itself.
      'buildRoster',
      'buildRosterAtPath',
      'markAbsent',
      'openRoster',
      'rosterForSpillover',
      'rosterOf',
      'rosterWithAnAbsence',
      'withGroups',
    ]);
    // `addSeveral` is deliberately NOT here. It clicks "Add several", which
    // extends a roster that is already open, so on its own it opens nothing --
    // and every test that uses it calls `openRoster` first, which is what
    // actually answers "was a roster built before this assertion?".
    expect(rosterBuilders().has('addSeveral')).toBe(false);
  });

  // The LEVEL lives in the pin above and nowhere else. These two fixtures are
  // about SCOPING, so they take whatever the page ships rather than repeating
  // it: with '30' written in, moving the markup default reddened four tests
  // that have nothing to say about the level, and a failure that points at
  // four places points at none of them.
  const shipped = () => {
    const field = fields.find((candidate) => candidate.id === 'cg-count');
    if (!field)
      throw new Error('no cg-count field was derived from the markup');
    return field.shipped;
  };

  /** Judge `source` as if it were a spec on disk. */
  const judge = (source: string) => {
    const file = 'tests/e2e/synthetic.spec.ts';
    return collisions(fields, [file], () => parseSource(source, file)).map(
      (collision) => `${collision.id} afterRoster=${collision.afterRoster}`,
    );
  };

  it('does not let a roster built by a sibling test answer for this one', () => {
    // The first form of this guard read `test.describe` as a test, so "before
    // this assertion" ranged over the whole group. It still produced the three
    // sites predicted -- by reporting a roster the PREVIOUS test had built.
    expect(
      judge(`
        test.describe('the box', () => {
          test('builds a roster', async ({ page }) => {
            await openRoster(page);
          });

          test('asserts on an untouched page', async ({ page }) => {
            await expect(page.locator('#cg-count')).toHaveValue('${shipped()}');
          });
        });
      `),
      // Finding it at all is the liveness half: an empty result would satisfy
      // "not attributed to the sibling" without the walker doing anything.
    ).toEqual(['cg-count afterRoster=false']);
  });

  it('does let a roster built in beforeEach answer for the tests it precedes', () => {
    expect(
      judge(`
        test.describe('the box', () => {
          test.beforeEach(async ({ page }) => {
            await openRoster(page);
          });

          test('asserts after the hook', async ({ page }) => {
            await expect(page.locator('#cg-count')).toHaveValue('${shipped()}');
          });
        });
      `),
    ).toEqual(['cg-count afterRoster=true']);
  });

  it('refuses an expectation a roster-building test could not have written', () => {
    const all = collisions(fields);
    expect(
      // The population goes INSIDE the assertion (#118). An empty sweep --
      // a walker that stopped recursing, a spec glob that matched nothing --
      // satisfies "no offenders" perfectly, and `of: all` makes that state
      // throw instead: the pin below guarantees at least one collision exists
      // to be judged.
      // `searched` is the OUTERMOST call by design, not by style: the
      // meta-guard reads the subject of `expect` and a `.map` wrapped around
      // it hides the control from the only thing that checks controls exist.
      searched(
        all
          .filter((collision) => collision.afterRoster)
          .map(
            (collision) =>
              `${collision.site} expects '${collision.shipped}', which #${collision.id} already ships`,
          ),
        { of: all, what: 'expectations against a shipped default' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('shipped-defaults/judged-collisions', all.length),
    ).toBeUndefined();
  });

  it('keeps the deliberate pin, which asserts the default on an untouched page', () => {
    // A guard that only ever refuses is satisfied by deleting all coverage.
    // Some test must still assert the page serves what the markup declares.
    const pins = collisions(fields).filter(
      (collision) => !collision.afterRoster,
    );
    expect(pins.map((collision) => collision.id)).toContain('cg-count');
  });
});
