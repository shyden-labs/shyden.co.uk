import ts from 'typescript';

/**
 * Finds a scroll a browser test makes by protocol or page script (#1004):
 * Playwright's `scrollIntoViewIfNeeded()`, or `scrollIntoView()`,
 * `scrollTo()` or `scrollBy()` run inside the page. None of them is how a
 * visitor scrolls, so a page whose scrolling breaks for real input still
 * passes (global rule, Shyden 2026-10-31: every UI test drives the product
 * through real input, real wheel or finger scrolling included). Tests go
 * through `scrollToOn`, `scrollOver` and `tapOn` (`tests/real-touch.ts`),
 * which turn the real mouse wheel on a desktop engine and drag a real finger
 * on the phone.
 *
 * The source is parsed, not pattern-matched, so a comment or a string cannot
 * trip or satisfy it.
 */

const SCROLLS = new Set([
  'scrollIntoView',
  'scrollIntoViewIfNeeded',
  'scrollTo',
  'scrollBy',
]);

export interface ScriptScroll {
  /** 1-based line of the call. */
  line: number;
  /** The method called, e.g. `scrollTo`. */
  call: string;
}

const calledName = (expression: ts.Expression): string | null =>
  ts.isPropertyAccessExpression(expression)
    ? expression.name.text
    : ts.isIdentifier(expression)
      ? expression.text
      : null;

/** Every scroll call in `source` that is not real input. */
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
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const call = calledName(node.expression);
      if (call !== null && SCROLLS.has(call))
        found.push({
          line:
            file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
          call,
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
