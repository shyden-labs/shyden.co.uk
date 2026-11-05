import ts from 'typescript';
import { isLiteral, lineOf, optionsOf } from './playwright-declarations';
import { withoutTsComments } from './unit/source-text';

/**
 * A place where a test, a hook or a group of tests would leave the budget the
 * config gives every test. None may exist outside the unit suite: each suite
 * keeps ONE limit, at its CI step, and no test inside it raises its own
 * (operator 2026-10-07, #380). This module reads them, so a guard can refuse
 * every one.
 */
export interface Budget {
  /** The 1-based line it starts on. */
  readonly line: number;
  /**
   * `setTimeout` for `test.setTimeout(ms)` and `testInfo.setTimeout(ms)`,
   * `slow` for `test.slow()`, which triples the budget, and `configure` for
   * `test.describe.configure({ timeout })`.
   */
  readonly how: 'setTimeout' | 'slow' | 'configure';
  /** Why it cannot be read as a plain call, when it cannot. */
  readonly unreadable?: string;
}

/**
 * The methods that move a budget, on `test` and on a `TestInfo` alike.
 * `testInfo` is whatever a test names its parameter, so every receiver counts
 * but the globals a timer is scheduled on.
 */
const METHODS: ReadonlySet<string> = new Set(['setTimeout', 'slow']);
const TIMER_OWNERS: ReadonlySet<string> = new Set([
  'window',
  'globalThis',
  'self',
]);

const REFERENCE = 'a budget method taken by reference';
const UNLISTED = 'options that cannot be listed';

/** `a.b` or `a['b']`, as its receiver and the name it reads. */
const memberOf = (
  node: ts.Node,
): { receiver: ts.Expression; name: string } | undefined => {
  if (ts.isPropertyAccessExpression(node))
    return { receiver: node.expression, name: node.name.text };
  if (ts.isElementAccessExpression(node) && isLiteral(node.argumentExpression))
    return { receiver: node.expression, name: node.argumentExpression.text };
  return undefined;
};

const isTimerOwner = (node: ts.Expression): boolean =>
  ts.isIdentifier(node) && TIMER_OWNERS.has(node.text);

/** Every budget in `sf`, in source order. */
export function budgetsIn(sf: ts.SourceFile): Budget[] {
  const budgets: Budget[] = [];
  const add = (node: ts.Node, how: Budget['how'], unreadable?: string) =>
    budgets.push({
      line: lineOf(sf, node),
      how,
      ...(unreadable === undefined ? {} : { unreadable }),
    });
  // A block body, so `visit` returns nothing: `ts.forEachChild` stops at the
  // first callback that returns something truthy.
  const visit = (node: ts.Node): void => {
    const member = memberOf(node);
    const call =
      node.parent !== undefined &&
      ts.isCallExpression(node.parent) &&
      node.parent.expression === node
        ? node.parent
        : undefined;
    if (
      member !== undefined &&
      METHODS.has(member.name) &&
      !isTimerOwner(member.receiver)
    )
      add(node, member.name as Budget['how'], call ? undefined : REFERENCE);
    if (member?.name === 'configure' && call !== undefined) {
      // Judged by its name, whatever `test` is called in the file: an
      // aliased `base.describe.configure` sets a budget all the same.
      const { options, unreadable, shared } = optionsOf(call.arguments[0]);
      if (unreadable !== undefined || shared !== undefined)
        add(node, 'configure', UNLISTED);
      else if (options.has('timeout')) add(node, 'configure');
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      if (
        (ts.isIdentifier(key) || ts.isStringLiteral(key)) &&
        METHODS.has(key.text)
      )
        add(node, key.text as Budget['how'], REFERENCE);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return budgets;
}

/** `.setTimeout` or `.slow` on a receiver, or the same read by `['…']`. */
const MEMBER =
  /([A-Za-z_$][\w$]*)?\s*(?:\??\.\s*(setTimeout|slow)\b|\[\s*(['"`])(setTimeout|slow)\3\s*\])/g;
/** A `configure(…)` call, its first argument's text up to a parenthesis. */
const CONFIGURE =
  /(?:\??\.\s*configure|\[\s*(['"`])configure\1\s*\])\s*\(\s*([^)]*)/g;

/**
 * How many budgets `text` spells, counted from its comment-free text rather
 * than its parse tree: the independent count a guard checks `budgetsIn`
 * against. Strings are kept by the shared stripper, so a budget spelled in
 * one is counted: over, never under.
 */
export function budgetsSpelled(text: string): number {
  const code = withoutTsComments(text);
  const members = [...code.matchAll(MEMBER)].filter(
    ([, receiver]) => receiver === undefined || !TIMER_OWNERS.has(receiver),
  ).length;
  const configures = [...code.matchAll(CONFIGURE)].filter(
    ([, , args = '']) =>
      !args.startsWith('{') || /\btimeout\b/.test(args) || args.includes('...'),
  ).length;
  return members + configures;
}
