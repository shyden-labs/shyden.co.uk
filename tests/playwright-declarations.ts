import ts from 'typescript';
import { codeWithoutLiterals } from './unit/ast';
import { withoutTsComments } from './unit/source-text';

/**
 * Playwright's declarations, read from the parse tree (#218).
 *
 * Five guards read calls from here: viewport-tagging, isolated-context-tagging
 * and parked-tests, to read what the test a call sits in is tagged or parked
 * as; event-collectors, to read whether a locator list was proved non-empty in
 * the test that loops over it; and download-readers, which replaced
 * download-tagging in #308, to find every read of a download's bytes. Each
 * used to find `test(` in spec text with a regex, on the
 * premise that no parser was available -- false since #115 made `typescript`
 * a devDependency. The regexes approximated each construct from its
 * spelling: a declaration was `test(` followed by a quote, a test's extent
 * was every line up to the next declaration (or the `});` at its own
 * indentation), and a `test.use()` was the text up to the next `);`. Each
 * rule held for the shapes prettier emitted when it was written, and none
 * could see a shape it had not been written for: declaration-shaped text
 * inside a string, a hook or a helper sitting between two tests,
 * `test.use({ viewport })` written in shorthand.
 *
 * This asks the parser instead. A declaration is a call to a callee that
 * Playwright registers a test or a group through, with a title first and a
 * callback last. A call belongs to the innermost declaration whose callback
 * contains it. What cannot be read -- a tag or a `test.use()` option written
 * as anything but a literal -- is named as exactly that, never read as
 * absent: a tag read as missing would hide a stale one and invent a missing
 * one. `playwright-declarations.test.ts` holds the spec corpus to readable.
 *
 * A declaration reached through a variable (`const run = test; run(...)`)
 * is not followed: it declares through a name this reader does not look up.
 * The guards report what that leaves behind -- a call no test contains --
 * rather than passing over it.
 */

export type Kind = 'test' | 'describe';
export type Modifier = '' | 'only' | 'skip' | 'fixme' | 'fail';

/** A test or a group of tests, as Playwright registers it. */
export interface Declaration {
  /** `test` registers one test; `describe` registers a group. */
  readonly kind: Kind;
  /** Focused, skipped, parked, expected to fail, or none of those. */
  readonly modifier: Modifier;
  /**
   * The title's text when it is a literal, else the source of the
   * expression that builds it; `''` for an anonymous group.
   */
  readonly title: string;
  /** The tags its details object names; empty when it names none. */
  readonly tags: readonly string[];
  /** The 1-based line its declaring call starts on. */
  readonly line: number;
  /** The declaring call. */
  readonly call: ts.CallExpression;
  /** The callback: the test's body, or the group's. */
  readonly body: ts.ArrowFunction | ts.FunctionExpression;
  /** Why its tags cannot be read, when they cannot. */
  readonly unreadable?: string;
}

/** A `test.use()` call and the options it sets. */
export interface UseCall {
  readonly call: ts.CallExpression;
  /** The 1-based line the call starts on. */
  readonly line: number;
  /**
   * Each option its object literal names, to the expression that gives it.
   * A shorthand `{ viewport }` gives the identifier.
   */
  readonly options: ReadonlyMap<string, ts.Expression>;
  /** Why its options cannot be read, when they cannot. */
  readonly unreadable?: string;
  /**
   * The name of a SHARED options object passed by identifier, when one is.
   *
   * `test.use(recorded)` sets its options from one exported value rather than
   * from a literal here, so this reader cannot see the keys -- and reporting
   * that as no options at all is the vacuous-guard pattern. It is reported by
   * NAME instead, and which names are allowed is a policy the guard states,
   * not something this reader decides.
   */
  readonly shared?: string;
}

/**
 * Each callee that declares, by its chain after `test`, to the kind it
 * declares and the modifier it carries. `test.step`, the hooks, `test.use`
 * and `test.describe.configure` share the prefix and declare nothing, so
 * they are absent: a call to one of them never opens a scope.
 */
const DECLARING: ReadonlyMap<string, readonly [Kind, Modifier]> = new Map([
  ['', ['test', '']],
  ['only', ['test', 'only']],
  ['skip', ['test', 'skip']],
  ['fixme', ['test', 'fixme']],
  ['fail', ['test', 'fail']],
  // Focused AND expected to fail (Playwright 1.49); focus is what a run
  // narrows to, so it is the modifier this one carries (#390 F155).
  ['fail.only', ['test', 'only']],
  ['describe', ['describe', '']],
  ['describe.only', ['describe', 'only']],
  ['describe.skip', ['describe', 'skip']],
  ['describe.fixme', ['describe', 'fixme']],
  ['describe.serial', ['describe', '']],
  ['describe.serial.only', ['describe', 'only']],
  ['describe.parallel', ['describe', '']],
  ['describe.parallel.only', ['describe', 'only']],
]);

export type Callback = ts.ArrowFunction | ts.FunctionExpression;

/** A function written in place: what a test, hook or group runs. */
export const isCallback = (node: ts.Node | undefined): node is Callback =>
  node !== undefined &&
  (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

/** A string with no substitution: a title or tag read as written. */
export const isLiteral = (
  node: ts.Node | undefined,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  node !== undefined &&
  (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));

/** The 1-based line `node` starts on in `sf`. */
export const lineOf = (sf: ts.SourceFile, node: ts.Node): number =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

/**
 * A callee's names, root first -- `page.setViewportSize` is
 * `['page', 'setViewportSize']` -- or undefined when it is not a plain
 * chain of names (`fixtures[0]()`, `make()()`).
 */
const chainOf = (callee: ts.Expression): string[] | undefined => {
  const names: string[] = [];
  let node = callee;
  while (ts.isPropertyAccessExpression(node)) {
    names.unshift(node.name.text);
    node = node.expression;
  }
  return ts.isIdentifier(node) ? [node.text, ...names] : undefined;
};

/** The name a property is written with, or undefined when it is computed. */
const propertyName = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) ||
  ts.isStringLiteral(name) ||
  ts.isNoSubstitutionTemplateLiteral(name)
    ? name.text
    : undefined;

/** Every call in `sf`, in source order. */
export function callsIn(sf: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  // A block body, so `visit` returns nothing: `ts.forEachChild` stops at the
  // first callback that returns something truthy (tests/unit/ast.ts).
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return calls;
}

/** The tags a details object names, or why they cannot be read. */
function tagsOf(details: ts.Expression | undefined): {
  tags: string[];
  unreadable?: string;
} {
  if (details === undefined) return { tags: [] };
  if (!ts.isObjectLiteralExpression(details))
    return { tags: [], unreadable: 'details that are not an object literal' };
  if (details.properties.some(ts.isSpreadAssignment))
    return { tags: [], unreadable: 'a spread in its details' };
  const tag = details.properties.find(
    ({ name }) => name !== undefined && propertyName(name) === 'tag',
  );
  if (tag === undefined) return { tags: [] };
  const value = ts.isPropertyAssignment(tag) ? tag.initializer : undefined;
  const written =
    value !== undefined && ts.isArrayLiteralExpression(value)
      ? [...value.elements]
      : [value];
  const tags = written.filter(isLiteral).map(({ text }) => text);
  return tags.length === written.length
    ? { tags }
    : { tags: [], unreadable: 'a tag that is not a string literal' };
}

/** The declaration `call` makes, or undefined when it makes none. */
function declarationOf(
  call: ts.CallExpression,
  sf: ts.SourceFile,
): Declaration | undefined {
  const chain = chainOf(call.expression);
  if (chain === undefined || chain[0] !== 'test') return undefined;
  const declaring = DECLARING.get(chain.slice(1).join('.'));
  if (declaring === undefined) return undefined;
  const [kind, modifier] = declaring;

  const args = call.arguments;
  const body = args[args.length - 1];
  if (!isCallback(body)) return undefined;
  // A title first and a callback last, with at most a details object
  // between. A runtime skip passes a condition and a reason instead, and
  // `test.skip(({ browserName }) => ...)` passes a callback alone -- which
  // declares only when the callee is a group's (an anonymous group).
  const anonymousGroup = kind === 'describe' && args.length === 1;
  if (
    !anonymousGroup &&
    (args.length < 2 || args.length > 3 || isCallback(args[0]))
  )
    return undefined;

  const title = anonymousGroup
    ? ''
    : isLiteral(args[0])
      ? args[0].text
      : args[0].getText(sf);
  const { tags, unreadable } = tagsOf(args.length === 3 ? args[1] : undefined);
  return {
    kind,
    modifier,
    title,
    tags,
    line: lineOf(sf, call),
    call,
    body,
    ...(unreadable === undefined ? {} : { unreadable }),
  };
}

/** `test(`, or a `test.<modifier>(` form, as text. */
const DECLARES_TESTS = /(?<![\w.])test(?:\.(?:only|skip|fixme|fail))*\s*\(/;

/**
 * True where `text`, comments stripped, calls `test(` or a `test.<modifier>(`
 * form. Read as text, independently of the parse tree, so a guard can
 * cross-check its reader: a file this holds for, and the reader found no test
 * in, is a form the reader has gone blind to (#390, #446).
 */
export const declaresTests = (text: string): boolean =>
  DECLARES_TESTS.test(withoutTsComments(text));

/**
 * A test as text: `test(` or a `test.<modifier>(` form, then a title (blanked
 * to `""`, or a name) and a body or details. A runtime `test.skip(cond, why)`
 * passes no body, so it is not one.
 */
const WRITES_A_TEST =
  /(?<![\w.$])test(?:\.(?:only|skip|fixme|fail))*\s*\(\s*(?:""|[A-Za-z_$][\w$.]*)\s*,\s*(?:async\b|function\b|\(|\{|[A-Za-z_$][\w$]*\s*=>)/g;

/**
 * How many tests `sf` writes, counted as text in its code with every literal
 * and comment removed: the per-file cross-check on `declarationsIn`'s tests
 * (#477), independent of the parse tree's reading of calls.
 */
export const testsWritten = (sf: ts.SourceFile): number =>
  codeWithoutLiterals(sf).match(WRITES_A_TEST)?.length ?? 0;

/** Every test and group `sf` declares, in source order. */
export function declarationsIn(sf: ts.SourceFile): Declaration[] {
  return callsIn(sf).flatMap((call) => {
    const declaration = declarationOf(call, sf);
    return declaration === undefined ? [] : [declaration];
  });
}

/** What a `test.use()` argument sets, or why it cannot be read. */
function optionsOf(argument: ts.Expression | undefined): {
  options: Map<string, ts.Expression>;
  unreadable?: string;
  shared?: string;
} {
  const options = new Map<string, ts.Expression>();
  // A bare identifier is a SHARED options object. Named rather than called
  // unreadable: the difference between "this sets options I cannot list" and
  // "this sets nothing" is the whole point of reporting it.
  if (argument !== undefined && ts.isIdentifier(argument))
    return { options, shared: argument.text };
  if (argument === undefined || !ts.isObjectLiteralExpression(argument))
    return { options, unreadable: 'options that are not an object literal' };
  for (const property of argument.properties) {
    if (ts.isSpreadAssignment(property))
      return { options, unreadable: 'a spread in its options' };
    const name = propertyName(property.name);
    if (name === undefined)
      return { options, unreadable: 'an option whose name is computed' };
    if (ts.isPropertyAssignment(property))
      options.set(name, property.initializer);
    else if (ts.isShorthandPropertyAssignment(property))
      options.set(name, property.name);
    else return { options, unreadable: 'an option that is not a property' };
  }
  return { options };
}

/** Every `test.use()` call in `sf`, in source order. */
export function useCallsIn(sf: ts.SourceFile): UseCall[] {
  return callsIn(sf)
    .filter((call) => chainOf(call.expression)?.join('.') === 'test.use')
    .map((call) => {
      const { options, unreadable, shared } = optionsOf(call.arguments[0]);
      return {
        call,
        line: lineOf(sf, call),
        options,
        ...(unreadable === undefined ? {} : { unreadable }),
        ...(shared === undefined ? {} : { shared }),
      };
    });
}

/**
 * The innermost of `declarations` whose callback contains `node`, or
 * undefined when none does. A call in a title or a details object is
 * outside that declaration's callback, and so belongs to the one around it.
 */
export function enclosingDeclaration(
  node: ts.Node,
  declarations: readonly Declaration[],
): Declaration | undefined {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    const owner = declarations.find(({ body }) => body === at);
    if (owner !== undefined) return owner;
  }
  return undefined;
}
