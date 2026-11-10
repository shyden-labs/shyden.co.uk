import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { withoutTsComments } from './source-text';

/**
 * The TypeScript-AST machinery the suite's structural readers share (#118):
 * parse a file, bind it so a name resolves by scope, name what a node is
 * declared as, and read its comments and string texts. The two meta-guards it
 * was first written for, and their closure and derivation readers, were
 * removed with the 2026-10-30 simplification (#1137).
 *
 * A regex cannot do any of this. `expect(x).toEqual([])` inside a string, a
 * matcher reached through a `.not`, an assertion split over four lines by
 * prettier -- all of them are why `tests/unit/source-text.ts` exists for the
 * lexical questions and this exists for the structural ones.
 */

/**
 * Source text parsed with parent pointers, which `declaredName` needs. Takes
 * text rather than a path so a detector can be handed a fixture that is not
 * on disk.
 */
export const parseSource = (
  text: string,
  file = 'source.ts',
): ts.SourceFile => {
  // One parse per file name and text in a test file (#631): the meta-guards
  // parse the same spec corpus in every test of a file, and parsing it is the
  // cost (measured: 0.45-1.2 s CPU for the 310 files under tests/). Keyed by
  // the text as well as the name, so an edited fixture is parsed afresh; no
  // reader mutates the tree, so a shared one answers as a fresh one does.
  const key = `${file}\0${text}`;
  let parsed = parses.get(key);
  if (parsed === undefined) {
    parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    parses.set(key, parsed);
  }
  return parsed;
};

const parses = new Map<string, ts.SourceFile>();

/**
 * Every node in `sf`, at any depth, that `keep` accepts, in source order. The
 * walk returns nothing from its callback on purpose: `ts.forEachChild` stops
 * at the first truthy result, so a point-free visitor would read one child per
 * node (#118).
 */
export function nodesIn(
  sf: ts.SourceFile,
  keep: (node: ts.Node) => boolean,
): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (keep(node)) found.push(node);
    ts.forEachChild(node, (child) => {
      visit(child);
    });
  };
  visit(sf);
  return found;
}

/** A file parsed with parent pointers (`parseSource`). */
export const parseFile = (file: string): ts.SourceFile =>
  parseSource(readFileSync(file, 'utf8'), file);

/**
 * The name a function is known by, whether declared or assigned.
 *
 * `function walk() {}` and `const walk = () => {}` are the same thing to a
 * call graph and different things to the AST, and this repo writes both.
 */
export const declaredName = (node: ts.Node): string | null => {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  const parent = node.parent;
  if (
    parent &&
    ts.isVariableDeclaration(parent) &&
    ts.isIdentifier(parent.name)
  )
    return parent.name.text;
  return null;
};

/**
 * Source files bound into one TypeScript program, so a name resolves the way
 * the language resolves it (#184).
 *
 * Resolved by bare name, as this module once did it, the last `const` of a name
 * won in every scope of its file. `supply-chain.test.ts` declares
 * `const config` in four tests, and two stripped assertions read as raw
 * because the fourth test's `parseCleanYaml(...)` overwrote the
 * `configBody()` their own tests declare. Scoping is the binder's job, and a
 * hand-written scope walk is one more approximation to get wrong -- block
 * scope, `var` hoisting, parameters, catch clauses -- so the checker is asked
 * instead, the way `commentsIn` asks the scanner rather than the text.
 */
export interface Bound {
  /** Every file, keyed by the name it was bound under. */
  readonly files: ReadonlyMap<string, ts.SourceFile>;
  /**
   * The initializer of the variable `id` refers to. A parameter, an import, a
   * function, a class or a destructured binding binds the name with no
   * initializer of its own, so it answers `undefined` -- and ends the search
   * there, instead of letting an outer declaration of the same name answer in
   * its place. A destructured binding stops rather than following its whole
   * source, because that source builds every sibling too: `readings` would be
   * judged by the `.filter()` that builds `allowed` beside it.
   */
  initializerOf(id: ts.Identifier): ts.Expression | undefined;
  /**
   * The declaration `id` names, followed through an import -- renamed or
   * re-exported -- to the one the exporting file makes, where `initializerOf`
   * stops at the import on purpose. The import itself when the file it names
   * was not bound, so a caller can say which file it would have needed, and
   * `undefined` for a name no bound file declares.
   */
  declarationOf(id: ts.Identifier): ts.Declaration | undefined;
}

/**
 * Bind `sources`, each file's name to its text, into one program.
 *
 * Binding is all that is wanted: no lib, no file pulled in beyond `sources`,
 * no type checking. An import still resolves when the file it names was bound
 * beside it, which is what `declarationOf` follows; an import of anything else
 * resolves to nothing. `moduleDetection: Force` makes every file a module,
 * because a file with no import or export is otherwise a SCRIPT, and scripts
 * share one global scope -- two fixtures each declaring `config` would both
 * resolve to whichever was bound first.
 */
export function bind(sources: ReadonlyMap<string, string>): Bound {
  const options: ts.CompilerOptions = {
    noLib: true,
    noResolve: true,
    types: [],
    target: ts.ScriptTarget.Latest,
    moduleDetection: ts.ModuleDetectionKind.Force,
  };
  // Module resolution asks for an ABSOLUTE path (`/…/tests/e2e/harness.ts`),
  // and every caller keys `sources` relative to the repo, so every import
  // resolved to `unknown` until this met the two halfway (#215).
  const sourceText = (name: string): string | undefined =>
    sources.get(name) ?? sources.get(relative(process.cwd(), name));
  const parsed = new Map<string, ts.SourceFile>();
  const host: ts.CompilerHost = {
    // Parsed here, with the program's own options, rather than handed over
    // pre-parsed: those options are what carry `moduleDetection` to the file.
    getSourceFile: (name, languageVersionOrOptions) => {
      const text = sourceText(name);
      if (text === undefined) return undefined;
      const sf = ts.createSourceFile(
        name,
        text,
        languageVersionOrOptions,
        true,
      );
      parsed.set(name, sf);
      return sf;
    },
    fileExists: (name) => sourceText(name) !== undefined,
    readFile: sourceText,
    writeFile: () => {},
    getDefaultLibFileName: () => 'lib.d.ts',
    getCurrentDirectory: () => process.cwd(),
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const checker = ts
    .createProgram([...sources.keys()], options, host)
    .getTypeChecker();

  const files = new Map<string, ts.SourceFile>();
  for (const name of sources.keys()) {
    const sf = parsed.get(name);
    if (!sf) throw new Error(`${name} was not bound into the program`);
    files.set(name, sf);
  }

  // `{ config }` names a property AND a variable, and the property -- the one
  // `getSymbolAtLocation` answers with -- has no initializer.
  const symbolOf = (id: ts.Identifier): ts.Symbol | undefined =>
    ts.isShorthandPropertyAssignment(id.parent)
      ? checker.getShorthandAssignmentValueSymbol(id.parent)
      : checker.getSymbolAtLocation(id);

  return {
    files,
    initializerOf(id) {
      const declaration = symbolOf(id)?.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration))
        return declaration.initializer;
      // A destructured binding answers with ITS OWN property, never with the
      // whole source: the source builds every sibling too, so following it
      // would judge `readings` by the `.filter()` that builds `allowed`
      // beside it (#184, #185).
      if (declaration && ts.isBindingElement(declaration))
        return destructuredProperty(declaration);
      return undefined;
    },
    declarationOf(id) {
      const symbol = symbolOf(id);
      if (!symbol) return undefined;
      const [own] = symbol.declarations ?? [];
      if (!(symbol.flags & ts.SymbolFlags.Alias))
        return symbol.valueDeclaration ?? own;
      // An import of a file that was not bound resolves to the checker's
      // `unknown` symbol, which declares nothing.
      const target = checker.getAliasedSymbol(symbol);
      return target.valueDeclaration ?? target.declarations?.[0] ?? own;
    },
  };
}

/** `await x`, `(x)`, `x as T` and `x!` all answer with `x`. */
const unwrap = (node: ts.Expression): ts.Expression => {
  let at = node;
  for (;;) {
    if (ts.isAwaitExpression(at)) at = at.expression;
    else if (ts.isParenthesizedExpression(at)) at = at.expression;
    else if (ts.isAsExpression(at)) at = at.expression;
    else if (ts.isNonNullExpression(at)) at = at.expression;
    else return at;
  }
};

/**
 * Every `return` expression in `fn`'s own body, never a nested function's.
 *
 * Written as an explicit recursion rather than with `ts.forEachChild`, which
 * STOPS at the first child whose callback returns something truthy -- an
 * accumulator returns an array, which is always truthy, so it would visit one
 * child per node and quietly find a single return.
 */
const returnsOf = (fn: ts.FunctionLikeDeclaration): ts.Expression[] => {
  const body = fn.body;
  if (!body) return [];
  if (!ts.isBlock(body)) return [unwrap(body)];
  const found: ts.Expression[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node !== fn) return;
    if (ts.isReturnStatement(node) && node.expression)
      found.push(unwrap(node.expression));
    node.forEachChild(walk);
  };
  body.forEachChild(walk);
  return found;
};

/**
 * The object literal a destructuring source answers with, or undefined.
 *
 * Two shapes reach it: the literal itself (`const { a } = { a: x }`) and a
 * call whose own function returns one -- `await page.evaluate(() => ({ a }))`,
 * which is how every one of these sites is written. A call with more than one
 * `return` is refused rather than guessed at: two shapes mean the property is
 * built two ways, and answering with one of them would be an inference
 * dressed as a resolution.
 */
const objectSourceOf = (
  source: ts.Expression,
): ts.ObjectLiteralExpression | undefined => {
  const at = unwrap(source);
  if (ts.isObjectLiteralExpression(at)) return at;
  if (!ts.isCallExpression(at)) return undefined;
  const fn = at.arguments.find(
    (argument): argument is ts.ArrowFunction | ts.FunctionExpression =>
      ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
  );
  if (!fn) return undefined;
  const returned = returnsOf(fn);
  if (returned.length !== 1) return undefined;
  const only = returned[0];
  return only && ts.isObjectLiteralExpression(only) ? only : undefined;
};

/**
 * What a destructured binding is built from, WITHOUT its siblings.
 *
 * `const { readings, allowed } = await page.evaluate(...)` answers `readings`
 * with the `readings` property of the object that call returns, so an
 * assertion over `readings` is judged by how `readings` was built and by
 * nothing else. A shorthand property (`{ readings }`) answers with the
 * identifier, which the caller resolves onward exactly as it resolves any
 * other name.
 */
const destructuredProperty = (
  element: ts.BindingElement,
): ts.Expression | undefined => {
  if (ts.isArrayBindingPattern(element.parent)) return undefined;
  const wanted = element.propertyName ?? element.name;
  if (!ts.isIdentifier(wanted)) return undefined;
  let at: ts.Node = element.parent;
  while (at && !ts.isVariableDeclaration(at)) {
    // Only a nested pattern sits between; anything else is not a shape this
    // resolves, and guessing is what this function exists to avoid.
    if (!ts.isBindingElement(at) && !ts.isObjectBindingPattern(at))
      return undefined;
    at = at.parent;
  }
  const source = ts.isVariableDeclaration(at) ? at.initializer : undefined;
  if (!source) return undefined;
  const literal = objectSourceOf(source);
  // A source whose shape this cannot see into -- `const { specs, sites } =
  // scan()` -- answers with the WHOLE source rather than with nothing. Nothing
  // made the name opaque, and an opaque name is judged by no derivation at
  // all, so `expect(sites).toEqual([])` over a file walk passed absence-
  // liveness unproved (#446 AC6, probe AL3). The whole source may carry a
  // sibling's derivation too; over-judging a name fails closed, where under-
  // judging it failed open.
  if (!literal) return source;
  for (const property of literal.properties) {
    const name = property.name;
    if (!name || !ts.isIdentifier(name) || name.text !== wanted.text) continue;
    if (ts.isPropertyAssignment(property)) return property.initializer;
    if (ts.isShorthandPropertyAssignment(property)) return property.name;
    return undefined;
  }
  return undefined;
};

/** `bind` over files on disk, each keyed by the path it was read from. */
export const bindFiles = (paths: readonly string[]): Bound =>
  bind(new Map(paths.map((path) => [path, readFileSync(path, 'utf8')])));

/**
 * Every comment in a parsed file, in source order, each exactly once.
 *
 * Asked of the parser, never the text, because only the parser knows where a
 * comment can be: `/**` inside a string, a template or a regex literal is
 * content, and telling a regex from a division takes the grammar (#65).
 *
 * A comment is trivia before some token, so this asks at every token's full
 * start, and asks twice. `getLeadingCommentRanges` returns only the comments
 * after a line break; the ones still on the previous token's line come from
 * `getTrailingCommentRanges`, and either call alone silently drops the other
 * half. Tokens, not just nodes: the trivia before a closing `}` starts no
 * node, and `ts.forEachChild` never visits a token.
 *
 * Two places look like trivia and are not. A JSDoc node's own children sit
 * INSIDE a comment, and JSX text is content the scanner copies verbatim, so
 * asking at either reads a `/**` written just after a `{@link}`, or between
 * two JSX tags, as a comment that does not exist.
 */
export function commentsIn(sf: ts.SourceFile): ts.CommentRange[] {
  const text = sf.getFullText();
  const found = new Map<number, ts.CommentRange>();
  const jsxText: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJSDoc(node)) return;
    if (ts.isJsxText(node)) {
      jsxText.push(node);
      return;
    }
    const at = node.getFullStart();
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, at) ?? []),
      ...(ts.getTrailingCommentRanges(text, at) ?? []),
    ])
      found.set(range.pos, range);
    node.getChildren(sf).forEach(visit);
  };
  visit(sf);
  // A list's full start can fall where JSX text begins, so a range is dropped
  // by where it STARTS, not by which node it was asked for.
  return [...found.values()]
    .filter(
      (range) =>
        !jsxText.some((node) => range.pos >= node.pos && range.pos < node.end),
    )
    .sort((a, b) => a.pos - b.pos);
}

/** `path/to/file.ts:42`, repo-relative, for a finding a human has to open. */
export const where = (sf: ts.SourceFile, node: ts.Node): string =>
  `${relative(process.cwd(), sf.fileName)}:` +
  `${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

/**
 * The text of every string `sf` spells: string literals, templates with no
 * substitution, and the literal head, middles and tail of a template with
 * them. A comment is not a node, so nothing a comment says is here. This is
 * the parse tree's answer to "which strings does this file hold", independent
 * of any regex that tracks quotes for itself (#446).
 */
export function stringTextsIn(sf: ts.SourceFile): string[] {
  const texts: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    )
      texts.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return texts;
}

/**
 * `sf`'s code with every literal replaced by `""` and every comment removed:
 * what a text cross-check counts in, so that a fixture string, a template or
 * a regex spelling the construct it counts cannot satisfy it (#477). The
 * parse tree says what is a literal, outermost only, so a template is blanked
 * whole with its substitutions; `withoutTsComments` then removes comments
 * from text that holds no literal it could misread.
 *
 * The visitor returns nothing: `ts.forEachChild` stops at the first child
 * whose callback returns a truthy value.
 */
export function codeWithoutLiterals(sf: ts.SourceFile): string {
  const ranges: [number, number][] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node) ||
      ts.isRegularExpressionLiteral(node)
    ) {
      ranges.push([node.getStart(sf), node.end]);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  let code = sf.getFullText();
  // End first, so each replacement leaves the earlier ranges where they were.
  for (const [from, to] of ranges.reverse())
    code = code.slice(0, from) + '""' + code.slice(to);
  return withoutTsComments(code);
}
