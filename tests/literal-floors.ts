import ts from 'typescript';

/**
 * How a `toBeGreaterThan(OrEqual)` bound is written (#468).
 *
 * A liveness floor written as a literal is tight only on the day it is
 * measured: growth never fails it, so `absence-liveness` sat 22 under its real
 * count within a day, and 3 under it an hour after it was re-measured. Every
 * floor that demands two or more therefore goes through the ratchet in
 * `tests/floors.ts`, or is a product value with its reason written down
 * (`literal-floors.test.ts`). This reader finds them however they are written:
 *
 * - `presence`: the bound demands at most one (`> 0`, `>= 1`), which is what
 *   `searched()` already demands of every population;
 * - `counted`: a whole-number literal demanding two or more, the shape every
 *   drifted floor had;
 * - `forwarded`: the bound is a parameter of an enclosing function, or a
 *   property of one, so the number lives at the call site (`spec-scan.ts`'s
 *   `liveness.moreThan` was this, and no literal search could see it);
 * - `compared`: a value computed in place (`prod > dev`, an index order);
 * - `threshold`: a fractional literal, a bound on a measure (a contrast of
 *   4.5), which is never a count;
 * - `ceiling`: negated, so it bounds from above and is no floor.
 */
export type FloorKind =
  'presence' | 'counted' | 'forwarded' | 'compared' | 'threshold' | 'ceiling';

export interface FloorSite {
  /** 1-based line of the `expect`, for a human to open. */
  readonly line: number;
  readonly kind: FloorKind;
  /** The least value a `counted` or `presence` floor accepts. */
  readonly demands?: number;
  /** The `expect(...)` argument, whitespace collapsed. */
  readonly subject: string;
  /**
   * Set when the floor is a comparison written inside the `expect(...)`
   * argument (`expect(n > 25).toBe(true)`) rather than a matcher.
   */
  readonly form?: 'comparison' | 'reversed';
}

export interface FloorReading {
  readonly sites: readonly FloorSite[];
  /** Every matcher the reader could not classify, by line and why. */
  readonly refused: readonly string[];
}

const MATCHERS = new Set(['toBeGreaterThan', 'toBeGreaterThanOrEqual']);

/** Read only with a literal SUBJECT: `expect(5).toBeLessThan(n)` is `n > 5`. */
const REVERSED = new Set(['toBeLessThan', 'toBeLessThanOrEqual']);

/** `expect`, `expect.soft` and `expect.poll`: the roots this repo asserts from. */
const isExpectRoot = (callee: ts.Expression): boolean =>
  (ts.isIdentifier(callee) && callee.text === 'expect') ||
  (ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'expect' &&
    (callee.name.text === 'soft' || callee.name.text === 'poll'));

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * The `expect(...)` call a matcher hangs from, through `.not`, `.resolves`
 * and `.rejects`, and whether an odd number of `.not`s negate it. `root` is
 * the call that is not an expect root, when the chain ends somewhere else.
 */
function chainOf(target: ts.Expression): {
  readonly expectCall?: ts.CallExpression;
  readonly negated: boolean;
  readonly root: string;
} {
  let node = target;
  let negated = false;
  for (;;) {
    if (ts.isPropertyAccessExpression(node)) {
      if (node.name.text === 'not') negated = !negated;
      node = node.expression;
    } else if (
      ts.isParenthesizedExpression(node) ||
      ts.isAwaitExpression(node)
    ) {
      node = node.expression;
    } else if (ts.isCallExpression(node) && isExpectRoot(node.expression)) {
      return { expectCall: node, negated, root: node.expression.getText() };
    } else {
      const root = ts.isCallExpression(node) ? node.expression : node;
      return { negated, root: collapse(root.getText()) };
    }
  }
}

/** The names a parameter binds, through destructuring. */
export function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : boundNames(element.name),
  );
}

/** The identifier a bound is read from: `liveness` in `liveness.moreThan`. */
function rootIdentifier(node: ts.Expression): ts.Identifier | undefined {
  let current = node;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current) ||
    ts.isParenthesizedExpression(current)
  )
    current = current.expression;
  return ts.isIdentifier(current) ? current : undefined;
}

/** True when `name` is a parameter of a function enclosing `node`. */
function isParameter(node: ts.Node, name: string): boolean {
  for (let scope = node.parent; scope; scope = scope.parent)
    if (
      ts.isFunctionLike(scope) &&
      scope.parameters.some((parameter) =>
        boundNames(parameter.name).includes(name),
      )
    )
      return true;
  return false;
}

/** The number a literal bound spells, signed, or undefined if it is none. */
function literalValue(bound: ts.Expression): number | undefined {
  if (ts.isParenthesizedExpression(bound))
    return literalValue(bound.expression);
  // `text` is TypeScript's normalised value: `5_197` reads `5197`, and
  // `0x1F` reads `31`. The source as written (`getText()`) would not parse.
  if (ts.isNumericLiteral(bound)) return Number(bound.text);
  if (
    ts.isPrefixUnaryExpression(bound) &&
    bound.operator === ts.SyntaxKind.MinusToken
  ) {
    const value = literalValue(bound.operand);
    return value === undefined ? undefined : -value;
  }
  return undefined;
}

const COMPARISONS = new Map([
  [ts.SyntaxKind.GreaterThanToken, '>'],
  [ts.SyntaxKind.GreaterThanEqualsToken, '>='],
  [ts.SyntaxKind.LessThanToken, '<'],
  [ts.SyntaxKind.LessThanEqualsToken, '<='],
]);

/** The same comparison read from the other side: `25 < n` is `n > 25`. */
const FLIPPED: Readonly<Record<string, string>> = {
  '>': '<',
  '>=': '<=',
  '<': '>',
  '<=': '>=',
};

/**
 * The floors written as a comparison with a literal inside an `expect(...)`
 * argument, `n > 25` or `25 < n`, outside any callback the argument holds:
 * a `filter((r) => r.length > 3)` is a predicate, not a floor.
 */
function comparisonsIn(
  sf: ts.SourceFile,
  argument: ts.Expression,
): FloorSite[] {
  const found: FloorSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    const operator = ts.isBinaryExpression(node)
      ? COMPARISONS.get(node.operatorToken.kind)
      : undefined;
    if (operator && ts.isBinaryExpression(node)) {
      const right = literalValue(node.right);
      const left = literalValue(node.left);
      // Normalised to `subject op bound`: `25 < n` is `n > 25`.
      const [subject, bound, op] =
        right !== undefined
          ? [node.left, right, operator]
          : left !== undefined
            ? [node.right, left, FLIPPED[operator]]
            : [undefined, undefined, operator];
      if (subject && bound !== undefined) {
        const line =
          sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const text = collapse(subject.getText(sf));
        if (op.startsWith('<'))
          found.push({
            line,
            kind: 'ceiling',
            subject: text,
            form: 'comparison',
          });
        else if (!Number.isInteger(bound))
          found.push({
            line,
            kind: 'threshold',
            subject: text,
            form: 'comparison',
          });
        else {
          const demands = op === '>' ? bound + 1 : bound;
          found.push({
            line,
            kind: demands >= 2 ? 'counted' : 'presence',
            demands,
            subject: text,
            form: 'comparison',
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(argument);
  return found;
}

export function floorSitesIn(sf: ts.SourceFile): FloorReading {
  const sites: FloorSite[] = [];
  const refused: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isExpectRoot(node.expression))
      for (const argument of node.arguments)
        sites.push(...comparisonsIn(sf, argument));
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      MATCHERS.has(node.expression.name.text)
    ) {
      const matcher = node.expression.name.text;
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const at = `${sf.fileName}:${line}`;
      const chain = chainOf(node.expression.expression);
      const [bound, ...rest] = node.arguments;
      if (!chain.expectCall)
        refused.push(
          `${at}: ${matcher} on ${chain.root}, a root it cannot read`,
        );
      else if (!bound || rest.length > 0 || ts.isSpreadElement(bound))
        refused.push(
          `${at}: ${matcher} takes one bound, not ${node.arguments.length}`,
        );
      else {
        const [first] = chain.expectCall.arguments;
        const subject = first ? collapse(first.getText(sf)) : '';
        const value = literalValue(bound);
        const root = rootIdentifier(bound);
        if (chain.negated) sites.push({ line, kind: 'ceiling', subject });
        else if (value !== undefined && !Number.isInteger(value))
          sites.push({ line, kind: 'threshold', subject });
        else if (value !== undefined) {
          const demands = matcher === 'toBeGreaterThan' ? value + 1 : value;
          sites.push({
            line,
            kind: demands >= 2 ? 'counted' : 'presence',
            demands,
            subject,
          });
        } else if (root && isParameter(node, root.text))
          sites.push({ line, kind: 'forwarded', subject });
        else sites.push({ line, kind: 'compared', subject });
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      REVERSED.has(node.expression.name.text) &&
      node.arguments.length === 1
    ) {
      const chain = chainOf(node.expression.expression);
      const [first] = chain.expectCall?.arguments ?? [];
      const value = first ? literalValue(first) : undefined;
      if (chain.expectCall && !chain.negated && value !== undefined) {
        const line =
          sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const subject = collapse(node.arguments[0].getText(sf));
        if (!Number.isInteger(value))
          sites.push({ line, kind: 'threshold', subject, form: 'reversed' });
        else {
          const demands =
            node.expression.name.text === 'toBeLessThan' ? value + 1 : value;
          sites.push({
            line,
            kind: demands >= 2 ? 'counted' : 'presence',
            demands,
            subject,
            form: 'reversed',
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { sites, refused };
}
