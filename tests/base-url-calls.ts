import ts from 'typescript';
import { type Bound, where } from './unit/ast';

/**
 * Every call to a baseURL-aware API, and what its URL resolves to (#215).
 *
 * `tests/e2e/baseurl-guard.spec.ts` used to find these with a regex over raw
 * source text, which could not see through a constant --
 * `page.route(`${ORIGIN}/framed`)` read as relative although ORIGIN is
 * `'https://evidence.test'` -- and could not tell a call from a comment
 * quoting one, so the guard excluded its own file to survive its own prose.
 * This asks the parser what a call is and the binder what a name refers to
 * (`tests/unit/ast.ts`), and judges only what it can resolve. What it cannot
 * resolve is reported as exactly that, never as relative.
 */

/** One baseURL-aware API, known by the shape of its call. */
export interface BaseUrlAwareApi {
  /**
   * The callee, dotted. A call matches when its own callee ENDS with these
   * names: `page.route` is also `this.page.route`, and `toHaveURL` is
   * `expect(page).toHaveURL` and `expect(page).not.toHaveURL`.
   */
  readonly callee: string;
  /**
   * The callee must be `callee` exactly, from a bare name: the `request`
   * fixture's `request.get`, never `page.request.get`, which is its own row.
   */
  readonly bare?: boolean;
  /**
   * A glob opening with `*` never meets baseURL -- `resolveGlobBase` in
   * playwright-core returns it untouched -- so that shape is not relative.
   */
  readonly glob?: boolean;
  /** Whether a relative URL is safe here on the real-device path. */
  readonly resolved: boolean;
  /** Why `resolved` holds, or does not. */
  readonly reason: string;
}

/** How a finding names an API, the bare fixture marked as such. */
export const apiName = ({ callee, bare }: BaseUrlAwareApi): string =>
  bare ? `${callee} (bare fixture)` : callee;

/** What a call's URL was judged to be. */
export type Verdict =
  | { readonly kind: 'absolute' }
  | { readonly kind: 'glob' }
  | { readonly kind: 'matcher'; readonly what: string }
  | { readonly kind: 'relative'; readonly resolvesTo: string }
  | {
      readonly kind: 'unresolved';
      readonly name: string;
      readonly why: string;
    };

/** One call to a baseURL-aware API: where it is, and what its URL is. */
export interface BaseUrlCall {
  /** `path:line`, repo-relative. */
  readonly where: string;
  readonly api: BaseUrlAwareApi;
  /** The URL argument as written, on one line. */
  readonly argument: string;
  readonly verdict: Verdict;
}

/** A piece of a URL the guard could not read, and why. */
interface Hole {
  readonly name: string;
  readonly why: string;
}

/**
 * A string as far as it is known: its text up to the first piece the guard
 * cannot read. Only the leading text decides whether a URL is absolute, so
 * nothing after a hole is ever needed.
 */
interface Text {
  readonly known: string;
  readonly hole?: Hole;
}

/** A regular expression or a predicate: matched, never joined to baseURL. */
interface Matcher {
  readonly what: string;
}

type Value = Text | Matcher;

const isMatcher = (value: Value): value is Matcher => 'what' in value;

const oneLine = (source: string): string => source.replace(/\s+/g, ' ');

const unreadable = (node: ts.Node, why: string): Text => ({
  known: '',
  hole: { name: oneLine(node.getText()), why },
});

/**
 * A URL that needs nothing from baseURL: one that opens with a scheme
 * (`https:`, `about:`).
 *
 * Every API in the table joins with `new URL(given, baseURL)` and, when that
 * throws, keeps `given` exactly as written (`constructURLBasedOnBaseURL` in
 * playwright-core). On the device baseURL is empty, and `new URL(given)`
 * throws for everything without a scheme -- a path, a bare word, and a
 * protocol-relative `//host/x` alike, measured. The regex this replaced
 * counted `//` as absolute; it borrows its scheme from baseURL, so it fails
 * on the device like any path.
 */
const ABSOLUTE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

/** Known text that more text could still turn into a scheme. */
const UNDECIDED = /^[a-zA-Z][a-zA-Z\d+.-]*$|^$/;

/** `parts` joined in order, each read only while all before it was known. */
function joined(parts: ReadonlyArray<() => Text>): Text {
  let known = '';
  for (const part of parts) {
    const text = part();
    known += text.known;
    if (text.hole) return { known, hole: text.hole };
  }
  return { known };
}

/** `node` read as text; a matcher standing where text belongs is unreadable. */
function textOf(
  node: ts.Expression,
  bound: Bound,
  seen: ReadonlySet<ts.Node>,
): Text {
  const value = valueOf(node, bound, seen);
  return isMatcher(value) ? unreadable(node, value.what) : value;
}

/** The module an import names, as written; `undefined` for anything else. */
function importedFrom(declaration: ts.Declaration): string | undefined {
  for (
    let node: ts.Node = declaration;
    !ts.isSourceFile(node);
    node = node.parent
  )
    if (ts.isImportDeclaration(node)) return node.moduleSpecifier.getText();
  return undefined;
}

/**
 * What a name holds, read from its declaration in the scope that binds it --
 * across files, through `declarationOf` -- and only when that declaration
 * cannot change: a `const` with a value.
 */
function valueOfName(
  id: ts.Identifier,
  bound: Bound,
  seen: ReadonlySet<ts.Node>,
): Value {
  const declaration = bound.declarationOf(id);
  if (!declaration) return unreadable(id, 'declared nowhere the scan can see');
  if (seen.has(declaration))
    return unreadable(id, 'defined in terms of itself');
  if (ts.isVariableDeclaration(declaration)) {
    if (!(ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const))
      return unreadable(id, 'not a const, so it can be reassigned');
    const loop = declaration.parent.parent;
    if (ts.isForOfStatement(loop) || ts.isForInStatement(loop))
      return unreadable(id, 'a loop variable');
    if (!declaration.initializer)
      return unreadable(id, 'declared without a value');
    return valueOf(
      declaration.initializer,
      bound,
      new Set([...seen, declaration]),
    );
  }
  if (ts.isFunctionDeclaration(declaration)) return { what: 'a function' };
  if (ts.isParameter(declaration)) return unreadable(id, 'a parameter');
  if (ts.isBindingElement(declaration))
    return unreadable(id, 'a destructured binding');
  const from = importedFrom(declaration);
  if (from)
    return unreadable(
      id,
      `imported from ${from}, a file the scan did not bind`,
    );
  return unreadable(id, 'declared as something other than a const');
}

/** What `node` evaluates to, as far as the source alone can say. */
function valueOf(
  node: ts.Expression,
  bound: Bound,
  seen: ReadonlySet<ts.Node>,
): Value {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  )
    return valueOf(node.expression, bound, seen);
  if (ts.isStringLiteralLike(node)) return { known: node.text };
  if (
    ts.isRegularExpressionLiteral(node) ||
    (ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'RegExp')
  )
    return { what: 'a regular expression' };
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
    return { what: 'a function' };
  if (ts.isTemplateExpression(node))
    return joined([
      () => ({ known: node.head.text }),
      ...node.templateSpans.flatMap((span) => [
        () => textOf(span.expression, bound, seen),
        () => ({ known: span.literal.text }),
      ]),
    ]);
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  )
    return joined([
      () => textOf(node.left, bound, seen),
      () => textOf(node.right, bound, seen),
    ]);
  if (ts.isIdentifier(node)) return valueOfName(node, bound, seen);
  if (ts.isCallExpression(node)) return unreadable(node, 'a call');
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    return unreadable(node, 'a property');
  return unreadable(node, 'an expression the guard does not evaluate');
}

function verdictOf(value: Value, api: BaseUrlAwareApi): Verdict {
  if (isMatcher(value)) return { kind: 'matcher', what: value.what };
  const { known, hole } = value;
  if (ABSOLUTE.test(known)) return { kind: 'absolute' };
  if (api.glob && known.startsWith('*')) return { kind: 'glob' };
  if (hole && UNDECIDED.test(known)) return { kind: 'unresolved', ...hole };
  return { kind: 'relative', resolvesTo: hole ? `${known}…` : known };
}

/** The API `call` is to: the first row its own callee ends with. */
function apiOf(
  call: ts.CallExpression,
  apis: readonly BaseUrlAwareApi[],
): BaseUrlAwareApi | undefined {
  const names: string[] = [];
  let node: ts.Expression = call.expression;
  while (ts.isPropertyAccessExpression(node)) {
    names.unshift(node.name.text);
    node = node.expression;
  }
  const rooted = ts.isIdentifier(node);
  if (ts.isIdentifier(node)) names.unshift(node.text);
  return apis.find((api) => {
    const want = api.callee.split('.');
    if (
      api.bare
        ? !rooted || names.length !== want.length
        : names.length < want.length
    )
      return false;
    return names.slice(-want.length).join('.') === api.callee;
  });
}

/**
 * Every call in `bound` to an API in `apis`, in source order, each with what
 * its URL -- the first argument -- was judged to be.
 *
 * Every row is examined, patched or not, so the result is the whole
 * population: a guard can prove it looked at something before it reports
 * finding nothing, and a sweep can list every call site of every row.
 */
export function baseUrlCalls(
  bound: Bound,
  apis: readonly BaseUrlAwareApi[],
): BaseUrlCall[] {
  const calls: BaseUrlCall[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const api = apiOf(node, apis);
      const [url] = node.arguments;
      if (api && url)
        calls.push({
          where: where(node.getSourceFile(), node),
          api,
          argument: oneLine(url.getText()),
          verdict: verdictOf(valueOf(url, bound, new Set()), api),
        });
    }
    ts.forEachChild(node, visit);
  };
  for (const sf of bound.files.values()) visit(sf);
  return calls;
}

/**
 * The calls a guard fails on, one message each: a relative URL, or one it
 * could not resolve, reaching an API the device fixtures do not patch.
 *
 * The two read differently on purpose. A relative URL is a defect at the
 * call. An unresolved one is the limit of this guard, and says so -- it still
 * fails, because a URL nobody can read is a URL nobody has checked.
 */
export function baseUrlFindings(calls: readonly BaseUrlCall[]): string[] {
  return calls.flatMap(({ where, api, argument, verdict }) => {
    if (api.resolved) return [];
    const name = apiName(api);
    const unpatched =
      `${name} is not patched to resolve baseURL on the real-device path ` +
      `(${api.reason})`;
    const patch =
      `patch ${name} in tests/e2e/fixtures.ts's page/context fixture the ` +
      'same way page.goto and page.request.* are patched, then flip its ' +
      'BASE_URL_AWARE_APIS row to resolved: true.';
    if (verdict.kind === 'relative')
      return [
        `${where} calls \`${name}(...)\` with a relative URL, ${argument}, ` +
          `which resolves to ${verdict.resolvesTo}; ${unpatched}. Fix: pass an ` +
          `absolute URL, or ${patch}`,
      ];
    if (verdict.kind === 'unresolved')
      return [
        `${where} calls \`${name}(...)\` with ${argument}, and could not ` +
          `resolve \`${verdict.name}\` (${verdict.why}). That is a limit of ` +
          'this guard, not a finding that the URL is relative -- but ' +
          `${unpatched}, so a URL the guard cannot read is one nobody has ` +
          'checked. Fix: pass a literal, a const, a regular expression or a ' +
          `predicate, or ${patch}`,
      ];
    return [];
  });
}
