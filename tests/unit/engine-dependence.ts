import ts from 'typescript';
import { parseSource } from './ast';

/**
 * Whether a spec's verdict can depend on the engine or the viewport (#198).
 *
 * The content-only project runs its specs once, on one engine at 1280px,
 * because a spec that asserts HTTP responses and DOM text gets the same bytes
 * everywhere. That holds only while the spec neither DRIVES the viewport nor
 * READS anything the engine computes from it. The boundary used to check the
 * first half alone, with `src.includes('setViewportSize')`, so
 * `rendered-text.spec.ts`, which read `getClientRects`, sat on the content-only
 * side, was measured at one width only, and failed on all 16 pages of a real
 * phone.
 *
 * The answer comes from the parse tree, not the text: a name in a comment or a
 * test title is prose, and a call prettier splits over three lines is still
 * one call. Code handed to a page function as a STRING is parsed as code too,
 * because `page.evaluate('document.body.offsetWidth')` reads layout exactly as
 * the arrow-function form does.
 *
 * KNOWN LIMIT: a string reaches the parser only as the direct argument of a
 * page function. Code built in a variable first (`const js = '...';
 * page.evaluate(js)`) is not followed, because that means resolving the
 * binding, and no spec in the suite passes code that way.
 */

/** The tag a test carries when it emulates a device viewport. */
export const EMULATED_VIEWPORT_TAG = '@emulated-viewport';

/**
 * Every identifier whose presence in a spec's code means its verdict can
 * differ by engine or by viewport width.
 */
export const ENGINE_DEPENDENT_NAMES: ReadonlySet<string> = new Set([
  // Drives the viewport.
  'setViewportSize',
  'viewport',
  'isMobile',
  'hasTouch',
  'deviceScaleFactor',
  // Reads layout through the DOM, #198's list first.
  'getClientRects',
  'getBoundingClientRect',
  'offsetWidth',
  'offsetHeight',
  'elementFromPoint',
  'innerText',
  'elementsFromPoint',
  'offsetTop',
  'offsetLeft',
  'clientWidth',
  'clientHeight',
  'scrollWidth',
  'scrollHeight',
  'checkVisibility',
  'getComputedStyle',
  'matchMedia',
  'innerWidth',
  'innerHeight',
  // Reads layout through Playwright, which needs no DOM call at all.
  'boundingBox',
  'toBeInViewport',
  'isVisible',
  'toBeVisible',
  'isHidden',
  'toBeHidden',
  'scrollIntoViewIfNeeded',
  'viewportSize',
  'useInnerText',
  'toHaveScreenshot',
  // Asks which engine it is on.
  'browserName',
  // Reads layout through a reader shipped into the page as text (#619): the
  // DOM calls live in the shared module, so the spec names only the reader.
  // `tests/guards/browser-matrix.test.ts` derives these from the guards that
  // ship them, so the next one cannot be left off.
  'measureBoard',
  'measureBoardScript',
  'measureTypedFields',
  'measureTypedFieldsScript',
  'visibleLinesReader',
  'visibleLinesReaderScript',
]);

/**
 * The page-function APIs, each with the position of the argument that holds
 * the code. `$eval` and `$$eval` take a selector first, and a selector is not
 * code.
 */
const PAGE_FUNCTION_ARGUMENT: ReadonlyMap<string, number> = new Map([
  ['evaluate', 0],
  ['evaluateAll', 0],
  ['evaluateHandle', 0],
  ['waitForFunction', 0],
  ['$eval', 1],
  ['$$eval', 1],
]);

/** The name a call is made through: `page.evaluate(...)` gives `evaluate`. */
function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isIdentifier(callee)) return callee.text;
  return undefined;
}

/**
 * The code a string argument carries. A substitution becomes a placeholder
 * identifier, so the text around it still parses as the expression it is.
 */
function codeIn(argument: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(argument)) return argument.text;
  if (ts.isTemplateExpression(argument)) {
    const spans = argument.templateSpans.map((span) => `_${span.literal.text}`);
    return argument.head.text + spans.join('');
  }
  return undefined;
}

/** The text of a string, or of one literal piece of a template. */
function literalText(node: ts.Node): string | undefined {
  if (
    ts.isStringLiteralLike(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  )
    return node.text;
  return undefined;
}

/**
 * Every signal in `source` that its verdict can depend on the engine or the
 * viewport, each named once and sorted so a failure reads the same on every
 * run: a name from `names` used anywhere in the code, the emulated-viewport tag
 * in any string, and either of those inside code a page function receives as
 * a string.
 */
export function engineDependence(
  source: string,
  names: ReadonlySet<string> = ENGINE_DEPENDENT_NAMES,
): string[] {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && names.has(node.text)) found.add(node.text);
    if (literalText(node)?.includes(EMULATED_VIEWPORT_TAG))
      found.add(EMULATED_VIEWPORT_TAG);
    if (ts.isCallExpression(node)) {
      const position = PAGE_FUNCTION_ARGUMENT.get(calleeName(node) ?? '');
      const argument =
        position === undefined ? undefined : node.arguments[position];
      const code = argument && codeIn(argument);
      if (code)
        for (const signal of engineDependence(code, names)) found.add(signal);
    }
    ts.forEachChild(node, visit);
  };
  visit(parseSource(source));
  return [...found].sort();
}
