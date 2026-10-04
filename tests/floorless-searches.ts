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
 * checks a floor (`floorBreach`, or `expectNothingFound`, which checks one),
 * or says in code why it need not: `behavioural: '<reason>'` in the
 * population, for a search over input the test writes itself (#118's
 * behavioural species). The reason is a property, never a comment, so a
 * file's documentation cannot satisfy the guard (#23).
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
  /** The scope also calls `floorBreach` or `expectNothingFound`. */
  readonly floored: boolean;
  /** The reason written as `behavioural: '…'` in the population, if any. */
  readonly behavioural?: string;
}

export interface SearchReading {
  readonly sites: readonly SearchSite[];
  /** Every test body read, by title as written. */
  readonly tests: readonly string[];
  /** Every site or use the reader could not classify, by line and why. */
  readonly refused: readonly string[];
}

const SEARCHED = 'searched';

/** The calls that check a recorded floor. */
const FLOORS = new Set(['floorBreach', 'expectNothingFound']);

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
function testBodiesIn(sf: ts.SourceFile): Map<ts.Node, string> {
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

/** True where `node` holds a call to a floor check, at any depth. */
function checksAFloor(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (
      ts.isCallExpression(child) &&
      ts.isIdentifier(child.expression) &&
      FLOORS.has(child.expression.text)
    )
      found = true;
    if (!found) ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/**
 * The reason a call's population gives, `undefined` where it gives none, or
 * a refusal where it gives one this reader cannot read as a reason.
 */
function reasonOf(call: ts.CallExpression): {
  reason?: string;
  refusal?: string;
} {
  const population = call.arguments[1];
  if (!population || !ts.isObjectLiteralExpression(population)) return {};
  const property = population.properties.find(
    (member) =>
      member.name !== undefined &&
      ts.isIdentifier(member.name) &&
      member.name.text === 'behavioural',
  );
  if (property === undefined) return {};
  if (!ts.isPropertyAssignment(property) || !isLiteral(property.initializer))
    return { refusal: 'a behavioural reason that is not a string literal' };
  const reason = property.initializer.text.trim();
  return reason === '' ? { refusal: 'a blank behavioural reason' } : { reason };
}

export function searchSitesIn(sf: ts.SourceFile): SearchReading {
  const bodies = testBodiesIn(sf);
  const sites: SearchSite[] = [];
  const refused: string[] = [];
  const refuse = (node: ts.Node, why: string): void => {
    refused.push(`${sf.fileName}:${lineOf(sf, node)}: ${why}`);
  };

  const site = (call: ts.CallExpression): void => {
    for (let at = call.parent; at !== undefined; at = at.parent) {
      const title = bodies.get(at);
      const name = title === undefined ? nameOf(at) : undefined;
      if (title === undefined && name === undefined) continue;
      const { reason, refusal } = reasonOf(call);
      if (refusal !== undefined) return refuse(call, refusal);
      sites.push({
        line: lineOf(sf, call),
        scope: title === undefined ? 'function' : 'test',
        label: title ?? (name as string),
        floored: checksAFloor(at),
        ...(reason === undefined ? {} : { behavioural: reason }),
      });
      return;
    }
    refuse(call, 'a search in no test and no named function');
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
