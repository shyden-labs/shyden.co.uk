import ts from 'typescript';

/**
 * Finds a press or focus a browser test makes without the real-input helpers
 * (#1034): `focus()`, `hover()`, `click()` or `dblclick()` called on a locator,
 * an element or the page. Playwright reaches a control for these by scrolling
 * it by protocol, and `focus()` moves focus with no key at all, so a control a
 * visitor cannot reach still passes (global rule, Shyden 2026-10-31: every UI
 * test drives the product through real input). Tests go through `tapOn`,
 * `doubleTapOn`, `scrollToOn` (`tests/real-touch.ts`) and `tabTo`
 * (`tests/tab-to.ts`) instead, which are the one place those calls live.
 *
 * `page.mouse.click()` and its siblings are the real mouse and are not
 * matched. The source is parsed, not pattern-matched, so a comment or a
 * string cannot trip or satisfy it.
 */

const PRESSES = new Set(['focus', 'hover', 'click', 'dblclick']);

/** Receivers whose methods are real input devices. */
const DEVICES = new Set(['mouse', 'keyboard', 'touchscreen']);

export interface DirectPress {
  /** 1-based line of the call. */
  line: number;
  /** The method called, e.g. `focus`. */
  call: string;
}

const receiverName = (expression: ts.Expression): string | null =>
  ts.isPropertyAccessExpression(expression)
    ? expression.name.text
    : ts.isIdentifier(expression)
      ? expression.text
      : null;

/** Every `focus()`, `hover()`, `click()` or `dblclick()` call in `source`. */
export function directPresses(
  source: string,
  fileName = 'spec.ts',
): DirectPress[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: DirectPress[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      PRESSES.has(node.expression.name.text) &&
      !DEVICES.has(receiverName(node.expression.expression) ?? '')
    )
      found.push({
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        call: node.expression.name.text,
      });
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
