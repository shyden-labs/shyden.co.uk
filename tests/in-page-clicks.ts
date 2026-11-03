import ts from 'typescript';

/**
 * Finds a press made by script inside the page (#1003): an `el.click()`
 * written in a function the test hands to the browser to run. Such a press
 * fires a `click` with no pointer, touch or key behind it, so a control that
 * a finger cannot work still passes (global rule, Shyden 2026-10-31: every
 * UI test drives the product through real input).
 *
 * Playwright's own `locator.click()` is a real press and is not matched: only
 * a `.click()` lexically inside a function passed to one of the calls below
 * runs in the page. The source is parsed, not pattern-matched, so a comment
 * or a string cannot trip or satisfy it.
 */

/** Calls whose function argument runs inside the page. */
const IN_PAGE = new Set([
  'evaluate',
  'evaluateAll',
  'evaluateHandle',
  'waitForFunction',
  'addInitScript',
]);

export interface InPageClick {
  /** 1-based line of the `.click(` call. */
  line: number;
  /** The in-page call it sits inside, e.g. `evaluate`. */
  within: string;
}

const isFunction = (
  node: ts.Node,
): node is ts.ArrowFunction | ts.FunctionExpression =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node);

const calledName = (call: ts.CallExpression): string | null =>
  ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : null;

/** Every `.click()` inside a function that runs in the page. */
export function inPageClicks(
  source: string,
  fileName = 'spec.ts',
): InPageClick[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: InPageClick[] = [];
  const visit = (node: ts.Node, within: string | null): void => {
    if (ts.isCallExpression(node)) {
      const name = calledName(node);
      if (within !== null && name === 'click')
        found.push({
          line:
            file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
          within,
        });
      if (name !== null && IN_PAGE.has(name)) {
        ts.forEachChild(node.expression, (child) => visit(child, within));
        for (const argument of node.arguments)
          visit(argument, isFunction(argument) ? name : within);
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, within));
  };
  visit(file, null);
  return found;
}
