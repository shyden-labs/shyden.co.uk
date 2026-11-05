import ts from 'typescript';
import { parseSource } from './ast';
import { cssRules } from './css-rules';
import {
  astroFrontmatterView,
  astroScopedCss,
  astroScriptViews,
  astroTemplate,
} from './source-text';

/**
 * Which classes an `.astro` file's scoped rules name, and which of those its
 * own elements can carry (#331).
 *
 * Astro scopes a component's `<style>` by stamping `data-astro-cid-*` onto
 * every element the component builds and onto every selector, so a scoped
 * rule matches only those elements. A class reaches one of them in two ways:
 * written in the template, as a `class` or `class:list` value, or added by one
 * of the file's own scripts to an element the page built. A class a script
 * gives to an element it CREATED never counts, because a created element
 * carries no scope: that is how the dealt cards' reduced-motion rule came to
 * style nothing.
 *
 * The frontmatter is read only through a name a class expression uses. It is
 * never searched for spellings, because there `lang` is also a prop's name,
 * and a search would have found the `.lang` rule #329 removed a use.
 *
 * An expression this reader cannot evaluate is reported, never guessed at,
 * so a blind spot fails loudly instead of exempting a file.
 *
 * Residuals, named rather than chased:
 *  - a class added by an imported module is not seen, so a scoped rule it
 *    serves is reported as dead rather than silently allowed;
 *  - an element a script creates is recognised only through a variable bound
 *    to `document.createElement(...)`, so one reached another way (a callback
 *    parameter, a `children` lookup) counts as built;
 *  - names resolve by spelling, not by scope, so a class expression inside a
 *    `.map()` whose parameter shadows a frontmatter name reads the latter.
 */
export interface ScopedClassReport {
  /** Each class a selector in a scoped `<style>` names, once, in order. */
  readonly named: readonly string[];
  /** Of `named`, each class no element in the file can carry. */
  readonly dead: readonly string[];
  /** Each class value the file writes, template or script, as written. */
  readonly read: readonly string[];
  /** Of `read`, each expression this reader cannot evaluate. */
  readonly unreadable: readonly string[];
}

export function scopedClassReport(text: string): ScopedClassReport {
  const named = unique(astroScopedCss(text).flatMap(selectorClasses));
  const frontmatter = parseSource(astroFrontmatterView(text));
  const writes = [
    ...templateWrites(astroTemplate(text), scopeOf(frontmatter)),
    ...astroScriptViews(text).flatMap(scriptWrites),
  ];
  const carried = new Set(
    writes.flatMap(({ values }) => (values ?? []).flatMap(words)),
  );
  return {
    named,
    dead: named.filter((name) => !carried.has(name)),
    read: writes.map(({ source }) => source),
    unreadable: writes
      .filter(({ values }) => values === undefined)
      .map(({ source }) => source),
  };
}

/**
 * What an expression can evaluate to, as strings, or `undefined` when this
 * reader cannot tell.
 */
type Values = readonly string[] | undefined;

/** One class value a file writes: its text, and what it can evaluate to. */
interface Write {
  readonly source: string;
  readonly values: Values;
}

/** How a name in an expression resolves. */
type Scope = (name: string) => Values;

const unique = (items: readonly string[]): string[] => [...new Set(items)];

const words = (value: string): string[] =>
  value.split(/\s+/).filter((word) => word !== '');

// ---------------------------------------------------------------------------
// The CSS side: which classes the scoped selectors name.

/**
 * A CSS string. An attribute test's value, the one place a selector can hold
 * a dot that is not a class, must be quoted to hold one.
 */
const CSS_STRING = /(["'])(?:\\.|(?!\1)[^\\\n])*\1/g;

/** `selector` with every string's contents blanked, so a dot in one names nothing. */
const withoutStrings = (selector: string): string =>
  selector.replace(CSS_STRING, (s) => s[0] + ' '.repeat(s.length - 2) + s[0]);

/** A class in a selector. */
const CLASS_SELECTOR = /\.(-?[_a-zA-Z][\w-]*)/g;

/**
 * Each class the selectors in `css` name, in order.
 *
 * Read from the rule structure (`cssRules`, the repo's one CSS reader) rather
 * than by a pattern over the text, because a declaration holds dots too
 * (`url(icon.png)`): only a block's own header is a selector, and an at-rule's
 * header is a condition, which can name a class it applies to nothing
 * (`@supports selector(.probe)`). Every block counts, since rules nest inside
 * `@media` and inside each other.
 */
function selectorClasses(css: string): string[] {
  return cssRules(css)
    .flatMap(({ chain }) => chain.slice(-1))
    .filter((header) => !header.startsWith('@'))
    .flatMap((selector) => classesIn(withoutStrings(selector)));
}

/** The index of the parenthesis closing the one at `at`, or the end of `text`. */
function closer(text: string, at: number): number {
  let depth = 0;
  for (let i = at; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')' && (depth -= 1) === 0) return i;
  }
  return text.length;
}

/**
 * The classes a selector names for the component: none inside `:global(...)`,
 * which opts its contents out of the scope.
 */
function classesIn(selector: string): string[] {
  let scoped = '';
  for (let i = 0; i < selector.length; i += 1) {
    if (!selector.startsWith(':global(', i)) {
      scoped += selector[i];
      continue;
    }
    const end = closer(selector, i + ':global'.length);
    scoped += ' '.repeat(end + 1 - i);
    i = end;
  }
  return [...scoped.matchAll(CLASS_SELECTOR)].map((match) => match[1]);
}

// ---------------------------------------------------------------------------
// The template side: the class values the markup writes.

/** A `class` or `class:list` attribute, up to the start of its value. */
const CLASS_ATTRIBUTE = /(?<=\s)class(?::list)?\s*=\s*/g;

/** The index of the quote closing the string whose quote is at `at`. */
function stringEnd(text: string, at: number): number {
  for (let i = at + 1; i < text.length; i += 1) {
    if (text[i] === '\\') i += 1;
    else if (text[i] === text[at]) return i;
  }
  return text.length;
}

/** The index of the backtick closing the template literal opened at `at`. */
function templateEnd(text: string, at: number): number {
  for (let i = at + 1; i < text.length; i += 1) {
    if (text[i] === '\\') i += 1;
    else if (text[i] === '`') return i;
    else if (text.startsWith('${', i)) i = expressionEnd(text, i + 1);
  }
  return text.length;
}

/**
 * The index of the `}` closing the expression whose `{` is at `at`, with
 * strings and template literals stepped over whole, since either can hold a
 * brace.
 */
function expressionEnd(text: string, at: number): number {
  let depth = 0;
  for (let i = at; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'") i = stringEnd(text, i);
    else if (ch === '`') i = templateEnd(text, i);
    else if (ch === '{') depth += 1;
    else if (ch === '}' && (depth -= 1) === 0) return i;
  }
  return text.length;
}

/** Each class value the template writes, quoted or as an expression. */
function templateWrites(template: string, scope: Scope): Write[] {
  return [...template.matchAll(CLASS_ATTRIBUTE)].map((match) => {
    const at = match.index + match[0].length;
    const first = template[at];
    if (first === '"' || first === "'") {
      const source = template.slice(at + 1, stringEnd(template, at));
      return { source, values: [source] };
    }
    if (first === '{') {
      const source = template.slice(at + 1, expressionEnd(template, at)).trim();
      return { source, values: valuesOf(expressionIn(source), scope) };
    }
    const source = /^[^\s>]*/.exec(template.slice(at))?.[0] ?? '';
    return { source, values: [source] };
  });
}

/** `source` parsed as one expression. */
function expressionIn(source: string): ts.Expression | undefined {
  const [statement] = parseSource(`(${source});`).statements;
  return statement !== undefined && ts.isExpressionStatement(statement)
    ? statement.expression
    : undefined;
}

// ---------------------------------------------------------------------------
// The script side: the classes a page's own scripts add to its elements.

/** `node` without the wrappers that change its type but not its value. */
function bare(node: ts.Expression): ts.Expression {
  let out = node;
  while (
    ts.isParenthesizedExpression(out) ||
    ts.isNonNullExpression(out) ||
    ts.isAsExpression(out)
  )
    out = out.expression;
  return out;
}

/** True for `document.createElement(...)` and its namespaced form. */
function createsAnElement(node: ts.Expression): boolean {
  const call = bare(node);
  if (!ts.isCallExpression(call)) return false;
  const callee = call.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'document' &&
    /^createElement(?:NS)?$/.test(callee.name.text)
  );
}

/** The expression a chain of property reads and calls starts from. */
function rootOf(node: ts.Expression): ts.Expression {
  let out = bare(node);
  while (
    ts.isPropertyAccessExpression(out) ||
    ts.isElementAccessExpression(out) ||
    ts.isCallExpression(out)
  ) {
    if (ts.isCallExpression(out) && createsAnElement(out)) return out;
    out = bare(out.expression);
  }
  return out;
}

/** Each variable in `file` bound to an element a script creates. */
function createdElements(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      createsAnElement(node.initializer)
    )
      names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

/** A class value written to an element, and the element it is written to. */
interface ClassWrite {
  readonly element: ts.Expression;
  readonly value: ts.Expression;
}

/** What `method` of `classList` adds, by argument: `replace` adds its second. */
const ADDED: Readonly<
  Partial<
    Record<string, (args: readonly ts.Expression[]) => readonly ts.Expression[]>
  >
> = {
  add: (args) => args,
  toggle: (args) => args.slice(0, 1),
  replace: (args) => args.slice(1, 2),
};

/** The class writes `node` makes, when it makes any. */
function classWritesAt(node: ts.Node): ClassWrite[] {
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
      node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) &&
    ts.isPropertyAccessExpression(node.left) &&
    node.left.name.text === 'className'
  )
    return [{ element: node.left.expression, value: node.right }];
  if (!ts.isCallExpression(node)) return [];
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return [];
  const method = callee.name.text;
  const [name, value] = node.arguments;
  if (method === 'setAttribute' && name !== undefined && value !== undefined)
    return ts.isStringLiteralLike(name) && name.text === 'class'
      ? [{ element: callee.expression, value }]
      : [];
  const list = callee.expression;
  const added = ADDED[method];
  if (
    added === undefined ||
    !ts.isPropertyAccessExpression(list) ||
    list.name.text !== 'classList'
  )
    return [];
  return added(node.arguments).map((value) => ({
    element: list.expression,
    value,
  }));
}

/** Each class value a script writes to an element the page built. */
function scriptWrites(view: string): Write[] {
  const file = parseSource(view);
  const created = createdElements(file);
  const scope = scopeOf(file);
  const writes: Write[] = [];
  const visit = (node: ts.Node): void => {
    for (const { element, value } of classWritesAt(node)) {
      const root = rootOf(element);
      const built =
        !createsAnElement(root) &&
        !(ts.isIdentifier(root) && created.has(root.text));
      if (built)
        writes.push({
          source: value.getText(file),
          values: valuesOf(value, scope),
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return writes;
}

// ---------------------------------------------------------------------------
// Evaluation: what a class expression can produce.

/** Each string a union of string literal types admits, or `undefined`. */
function literalValues(type: ts.TypeNode | undefined): Values {
  if (type === undefined) return undefined;
  const members = ts.isUnionTypeNode(type) ? type.types : [type];
  const values: string[] = [];
  for (const member of members) {
    if (member.kind === ts.SyntaxKind.UndefinedKeyword) continue;
    if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal))
      return undefined;
    values.push(member.literal.text);
  }
  return values;
}

/** Each member of a component's `Props` type, by name. */
function propTypes(file: ts.SourceFile): Map<string, ts.TypeNode | undefined> {
  const types = new Map<string, ts.TypeNode | undefined>();
  for (const statement of file.statements) {
    const members =
      ts.isInterfaceDeclaration(statement) && statement.name.text === 'Props'
        ? statement.members
        : ts.isTypeAliasDeclaration(statement) &&
            statement.name.text === 'Props' &&
            ts.isTypeLiteralNode(statement.type)
          ? statement.type.members
          : [];
    for (const member of members)
      if (ts.isPropertySignature(member) && ts.isIdentifier(member.name))
        types.set(member.name.text, member.type);
  }
  return types;
}

/** True for `Astro.props`. */
function isAstroProps(node: ts.Expression | undefined): boolean {
  if (node === undefined) return false;
  const read = bare(node);
  return (
    ts.isPropertyAccessExpression(read) &&
    ts.isIdentifier(read.expression) &&
    read.expression.text === 'Astro' &&
    read.name.text === 'props'
  );
}

/**
 * How names resolve in `file`: a variable to what its initialiser evaluates
 * to, and a prop taken from `Astro.props` to the string literals its declared
 * type admits, together with its default.
 */
function scopeOf(file: ts.SourceFile): Scope {
  const props = propTypes(file);
  const bindings = new Map<string, () => Values>();
  const resolving = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      const { name, initializer } = node;
      if (ts.isIdentifier(name) && !bindings.has(name.text))
        bindings.set(name.text, () =>
          initializer === undefined
            ? undefined
            : valuesOf(initializer, resolve),
        );
      if (ts.isObjectBindingPattern(name) && isAstroProps(initializer))
        for (const element of name.elements) {
          if (!ts.isIdentifier(element.name) || bindings.has(element.name.text))
            continue;
          const prop =
            element.propertyName !== undefined &&
            ts.isIdentifier(element.propertyName)
              ? element.propertyName.text
              : element.name.text;
          const fallback = element.initializer;
          bindings.set(element.name.text, () =>
            either(
              literalValues(props.get(prop)),
              fallback === undefined ? [] : valuesOf(fallback, resolve),
            ),
          );
        }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  function resolve(name: string): Values {
    const binding = bindings.get(name);
    if (binding === undefined || resolving.has(name)) return undefined;
    resolving.add(name);
    try {
      return binding();
    } finally {
      resolving.delete(name);
    }
  }
  return resolve;
}

/** Both sets of values, or `undefined` when either is unknown. */
const either = (a: Values, b: Values): Values =>
  a === undefined || b === undefined ? undefined : [...a, ...b];

/**
 * Each string `node` can evaluate to as a class value, or `undefined` when
 * this reader cannot tell. A `class:list` array contributes each element, an
 * object each key, and a falsy branch nothing.
 */
function valuesOf(node: ts.Expression | undefined, scope: Scope): Values {
  if (node === undefined) return undefined;
  const value = bare(node);
  if (ts.isStringLiteralLike(value)) return [value.text];
  if (ts.isTemplateExpression(value)) {
    let out: Values = [value.head.text];
    for (const span of value.templateSpans) {
      const inner = valuesOf(span.expression, scope);
      if (inner === undefined) return undefined;
      out = out.flatMap((prefix) =>
        inner.map((part) => prefix + part + span.literal.text),
      );
    }
    return out;
  }
  if (ts.isConditionalExpression(value))
    return either(
      valuesOf(value.whenTrue, scope),
      valuesOf(value.whenFalse, scope),
    );
  if (ts.isBinaryExpression(value)) {
    const kind = value.operatorToken.kind;
    if (kind === ts.SyntaxKind.AmpersandAmpersandToken)
      return valuesOf(value.right, scope);
    if (
      kind === ts.SyntaxKind.BarBarToken ||
      kind === ts.SyntaxKind.QuestionQuestionToken
    )
      return either(valuesOf(value.left, scope), valuesOf(value.right, scope));
    return undefined;
  }
  if (ts.isArrayLiteralExpression(value))
    return value.elements.reduce<Values>(
      (out, element) => either(out, valuesOf(element, scope)),
      [],
    );
  if (ts.isObjectLiteralExpression(value))
    return value.properties.reduce<Values>((out, property) => {
      const key = property.name;
      const text =
        key !== undefined && (ts.isIdentifier(key) || ts.isStringLiteral(key))
          ? key.text
          : undefined;
      return either(out, text === undefined ? undefined : [text]);
    }, []);
  if (
    value.kind === ts.SyntaxKind.FalseKeyword ||
    value.kind === ts.SyntaxKind.NullKeyword
  )
    return [];
  if (ts.isIdentifier(value))
    return value.text === 'undefined' ? [] : scope(value.text);
  return undefined;
}
