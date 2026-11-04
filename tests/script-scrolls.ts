import ts from 'typescript';

/**
 * Finds a scroll made by script or by protocol (#1004): Playwright's
 * `scrollIntoViewIfNeeded()`, or `scrollIntoView`, `scrollTo`, `scrollBy`,
 * `scroll`, or a `scrollTop`/`scrollLeft` assignment run in the page. None of
 * them is what a visitor does, so a page whose wheel or finger scrolling is
 * broken still passes (global rule, Shyden 2026-10-31: every UI test drives
 * the product through real input, real wheel or finger scrolling included).
 * Browser tests scroll through `scrollToOn`/`scrollByOn` in
 * `tests/real-touch.ts` instead.
 *
 * The source is parsed, not pattern-matched, so a comment or a string cannot
 * trip or satisfy it, and a read of the position (`el.scrollTop === 0`) is not
 * a scroll.
 */

const CALLS = new Set([
  'scrollIntoView',
  'scrollIntoViewIfNeeded',
  'scrollTo',
  'scrollBy',
  'scroll',
]);
const POSITIONS = new Set(['scrollTop', 'scrollLeft']);
const ASSIGNMENTS = new Map<ts.SyntaxKind, string>([
  [ts.SyntaxKind.EqualsToken, '='],
  [ts.SyntaxKind.PlusEqualsToken, '+='],
  [ts.SyntaxKind.MinusEqualsToken, '-='],
]);

export interface ScriptScroll {
  /** 1-based line of the scroll. */
  line: number;
  /** The call or assignment, e.g. `scrollTo` or `scrollTop =`. */
  how: string;
}

/** Every scroll in the source made by script or protocol. */
export function scriptScrolls(
  source: string,
  fileName = 'spec.ts',
): ScriptScroll[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: ScriptScroll[] = [];
  const lineOf = (node: ts.Node) =>
    file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      CALLS.has(node.expression.name.text)
    )
      found.push({ line: lineOf(node), how: node.expression.name.text });
    if (
      ts.isBinaryExpression(node) &&
      ts.isPropertyAccessExpression(node.left) &&
      POSITIONS.has(node.left.name.text) &&
      ASSIGNMENTS.has(node.operatorToken.kind)
    )
      found.push({
        line: lineOf(node),
        how: `${node.left.name.text} ${ASSIGNMENTS.get(node.operatorToken.kind)}`,
      });
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
