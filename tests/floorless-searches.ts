import ts from 'typescript';
import {
  declarationsIn,
  isCallback,
  isLiteral,
  lineOf,
} from './playwright-declarations';
import { codeWithoutLiterals } from './unit/ast';

/**
 * Where each `searched` call sits, and whether a floor is checked beside it
 * (#515, F201).
 *
 * `searched` refuses an empty population, which catches a reader blind to
 * everything. It cannot catch a reader blind to PART of its population: one
 * unit still read keeps it green. A floor recorded in `tests/floors.json` and
 * checked for equality (#468) can, so a test that searches a population also
 * checks a floor on THAT population: `floorBreach(id, <of>.length)`, with
 * `<of>` the expression its `of:` names (#534). A floor on something else in
 * the same test is a token, not a check of this search.
 * There is no exemption: #515 let a search say `behavioural: '<why>'`, and a
 * label the guard could not verify could have emptied the list without a
 * floor recorded, so the operator retired it ("Floors everywhere", #534). A
 * floor on a table the test writes also catches a case quietly deleted from
 * it. Any `behavioural` property is refused by line.
 *
 * A call's scope is the innermost test body around it -- vitest's `it` and
 * `it.each(table)`, or a Playwright declaration read by `declarationsIn` --
 * else the innermost named function. Anywhere else (a hook, module level) is
 * refused by line, as is `searched` imported under another name or read as a
 * value: each is a site this reader would otherwise not see.
 */
export type ScopeKind = 'test' | 'function';

export interface SearchSite {
  /** 1-based line of the `searched(` call. */
  readonly line: number;
  readonly scope: ScopeKind;
  /** The test's title as written, or the function's name. */
  readonly label: string;
  /** The scope checks `floorBreach` on the population `of:` names (#534). */
  readonly floored: boolean;
}

export interface SearchReading {
  readonly sites: readonly SearchSite[];
  /** Every test body read, by title as written. */
  readonly tests: readonly string[];
  /** Every site or use the reader could not classify, by line and why. */
  readonly refused: readonly string[];
}

const SEARCHED = 'searched';

/** The call that checks a recorded floor, and the argument it counts. */
const FLOOR = 'floorBreach';

/** A title as written: a literal's text, anything else its source. */
const titleOf = (sf: ts.SourceFile, title: ts.Expression): string =>
  isLiteral(title) ? title.text : title.getText(sf);

/** `it` or `it.each(table)`: vitest's ways of declaring a test here. */
const isVitestTestCallee = (callee: ts.Expression): boolean =>
  (ts.isIdentifier(callee) && callee.text === 'it') ||
  (ts.isCallExpression(callee) &&
    ts.isPropertyAccessExpression(callee.expression) &&
    ts.isIdentifier(callee.expression.expression) &&
    callee.expression.expression.text === 'it' &&
    callee.expression.name.text === 'each');

/** Every test body in `sf` to its title, in source order. */
export function testBodiesIn(sf: ts.SourceFile): Map<ts.Node, string> {
  const playwright = new Map(
    declarationsIn(sf)
      .filter(({ kind }) => kind === 'test')
      .map((declaration) => [declaration.call, declaration]),
  );
  const bodies = new Map<ts.Node, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const declaration = playwright.get(node);
      if (declaration) bodies.set(declaration.body, declaration.title);
      else if (isVitestTestCallee(node.expression)) {
        // A title, then the body, with an options object before it or a
        // timeout after it: `it(title, fn, 60_000)` ends in a number.
        const [title, ...rest] = node.arguments;
        const callbacks = rest.filter(isCallback);
        if (title && !isCallback(title) && callbacks.length === 1)
          bodies.set(callbacks[0], titleOf(sf, title));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return bodies;
}

/** A function's own name, when it has one to be listed by. */
function nameOf(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node))
    return node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
  if (!isCallback(node)) return undefined;
  const holder = node.parent;
  if (
    (ts.isVariableDeclaration(holder) || ts.isPropertyAssignment(holder)) &&
    holder.initializer === node &&
    ts.isIdentifier(holder.name)
  )
    return holder.name.text;
  return undefined;
}

/**
 * The scope a node sits in: the innermost test body (by title as written), else
 * the innermost named function, else undefined. One home for "which test is
 * this in", shared by every guard that keys a burn-down list by it (#515, #609).
 */
export function scopeOf(
  bodies: ReadonlyMap<ts.Node, string>,
  node: ts.Node,
): { kind: ScopeKind; label: string; at: ts.Node } | undefined {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    const title = bodies.get(at);
    if (title !== undefined) return { kind: 'test', label: title, at };
    const name = nameOf(at);
    if (name !== undefined) return { kind: 'function', label: name, at };
  }
  return undefined;
}

/** The population a search names in `of:`, as written, or undefined. */
function populationOf(call: ts.CallExpression): ts.Expression | undefined {
  const population = call.arguments[1];
  if (!population || !ts.isObjectLiteralExpression(population))
    return undefined;
  const of = population.properties.find(
    (member) =>
      member.name !== undefined &&
      ts.isIdentifier(member.name) &&
      member.name.text === 'of',
  );
  if (of === undefined) return undefined;
  if (ts.isPropertyAssignment(of)) return of.initializer;
  if (ts.isShorthandPropertyAssignment(of)) return of.name;
  return undefined;
}

/** Source text with every space dropped: `a .b` and `a.b` are one name. */
const spelled = (sf: ts.SourceFile, node: ts.Node): string =>
  node.getText(sf).replace(/\s+/g, '');

/**
 * True where `scope` checks a floor on the very population `call` searches:
 * `floorBreach(id, <of>.length)`, `<of>.size`, or `<of>` itself for a count,
 * `<of>` spelled as the search spells it (#534). A floor on anything else,
 * and a wrapper that floors its own population, check nothing about this
 * search.
 */
function floorsPopulation(
  sf: ts.SourceFile,
  scope: ts.Node,
  call: ts.CallExpression,
): boolean {
  const population = populationOf(call);
  if (population === undefined) return false;
  const of = spelled(sf, population);
  const counts = new Set([of, `${of}.length`, `${of}.size`]);
  let found = false;
  const visit = (child: ts.Node): void => {
    if (
      ts.isCallExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === FLOOR &&
      child.arguments[1] !== undefined &&
      counts.has(spelled(sf, child.arguments[1]))
    )
      found = true;
    if (!found) ts.forEachChild(child, visit);
  };
  visit(scope);
  return found;
}

/**
 * True where a call's population carries a `behavioural` property, in any
 * form: the exemption #534 retired.
 */
function labelled(call: ts.CallExpression): boolean {
  const population = call.arguments[1];
  return (
    population !== undefined &&
    ts.isObjectLiteralExpression(population) &&
    population.properties.some(
      (member) =>
        member.name !== undefined &&
        ts.isIdentifier(member.name) &&
        member.name.text === 'behavioural',
    )
  );
}

export function searchSitesIn(sf: ts.SourceFile): SearchReading {
  const bodies = testBodiesIn(sf);
  const sites: SearchSite[] = [];
  const refused: string[] = [];
  const refuse = (node: ts.Node, why: string): void => {
    refused.push(`${sf.fileName}:${lineOf(sf, node)}: ${why}`);
  };

  const site = (call: ts.CallExpression): void => {
    const scope = scopeOf(bodies, call);
    if (scope === undefined)
      return refuse(call, 'a search in no test and no named function');
    if (labelled(call))
      return refuse(
        call,
        'a behavioural label, retired: every search checks a recorded floor (#534)',
      );
    sites.push({
      line: lineOf(sf, call),
      scope: scope.kind,
      label: scope.label,
      floored: floorsPopulation(sf, scope.at, call),
    });
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportSpecifier(node) &&
      node.propertyName?.text === SEARCHED &&
      node.name.text !== SEARCHED
    )
      refuse(node, `searched imported under another name, ${node.name.text}`);
    if (ts.isIdentifier(node) && node.text === SEARCHED) {
      const parent = node.parent;
      if (ts.isCallExpression(parent) && parent.expression === node)
        site(parent);
      else if (
        !ts.isImportSpecifier(parent) &&
        !ts.isExportSpecifier(parent) &&
        !(ts.isFunctionDeclaration(parent) && parent.name === node)
      )
        refuse(node, 'searched read as a value, not called');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { sites, tests: [...bodies.values()], refused };
}

/**
 * `it(` or `it.each(`, as text: one per test vitest declares here. A table
 * may be typed, `it.each<[string, number]>(`.
 */
const WRITES_A_VITEST_TEST = /(?<![\w.$])it(?:\.each\s*(?:<[^()]*>)?)?\s*\(/g;

/**
 * How many vitest tests `sf` writes, counted as text in its code with every
 * literal and comment removed: with `testsWritten`, the per-file cross-check
 * on the tests `searchSitesIn` read, independent of the parse tree.
 */
export const vitestTestsWritten = (sf: ts.SourceFile): number =>
  codeWithoutLiterals(sf).match(WRITES_A_VITEST_TEST)?.length ?? 0;

/**
 * `searched(` called as text: after anything but a name character or a
 * property dot, so a spread's `...searched(` counts and `obj.searched(` does
 * not. Type arguments may sit between the name and the call.
 */
const WRITES_A_SEARCH =
  /(?<![\w$])(?<!(?<!\.\.)\.)searched\s*(?:<[^()]*>)?\s*\(/g;

/**
 * How many `searched` calls `sf` writes, counted as text in its code with
 * every literal and comment removed: the per-file cross-check on the sites
 * and refusals `searchSitesIn` returned, independent of the parse tree. The
 * definition, `function searched<T>(`, is not a call: `function` precedes it.
 */
export const searchesWritten = (sf: ts.SourceFile): number =>
  codeWithoutLiterals(sf)
    .replace(/\bfunction\s+searched\b/g, 'function _')
    .match(WRITES_A_SEARCH)?.length ?? 0;
