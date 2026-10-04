import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { withoutTsComments } from './source-text';

/**
 * The TypeScript-AST machinery the meta-guards share (#118).
 *
 * Two guards in this suite reason about the suite itself.
 * `anchored-presence.test.ts` (#98) asks whether a presence assertion reads
 * stripped text; `absence-liveness.test.ts` (#118) asks whether an absence
 * assertion proves its population was live. Both need the same five things:
 * parse a file, bind it so a name resolves by scope, name what a node is
 * declared as, follow an expression back to what it is made of, and close a
 * call graph transitively.
 *
 * They live here rather than in either guard because #80's lesson is that a
 * "one home" rule which only sees the function it was written for accumulates
 * the duplication it forbids -- `stripper-homes.test.ts` enforced one home for
 * comment strippers while carrying its own private copy of the file walker,
 * one of nine. A second AST indexer copied into a second meta-guard is that
 * same mistake, one layer up. Generalise the machinery; keep the RULES apart,
 * because they answer different questions and a merged guard would report a
 * single verdict for two unrelated defects.
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
export const parseSource = (text: string, file = 'source.ts'): ts.SourceFile =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

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
 * What an expression is made of, following the bindings its own scope sees to
 * a fixed point. Bindings, never names: a name followed through a file-wide
 * map reaches whichever same-named declaration the file holds last (#184).
 */
export interface Derivation {
  /** Every identifier name the expression is built from. */
  readonly names: readonly string[];
  /**
   * The names among them the walk could not see into, because each binds no
   * initializer to follow: an import, a parameter, a function declaration, a
   * destructured binding, or a name nothing here declares. What those are
   * made of lies outside the walk, so a caller that needs it asks the call
   * graph about these, and judges every other name by what the walk found
   * inside it (#225).
   */
  readonly opaque: readonly string[];
  /** Every variable initializer followed on the way, in the order reached. */
  readonly initializers: readonly ts.Expression[];
}

export interface DerivationOptions {
  /**
   * A call whose result carries nothing its arguments were made of, such as
   * a parse. The walk enters neither its callee nor its arguments, so what
   * reaches the expression only through one is no part of the derivation
   * (#225). Left out, the walk enters every call.
   */
  readonly stopAt?: (call: ts.CallExpression) => boolean;
}

const enterEveryCall = (): boolean => false;

/**
 * Every identifier feeding an expression, innermost callee first, as nodes so
 * each one can be resolved from where it stands. `withoutTsComments(
 * readFileSync(p))` yields both callees, so a caller can ask what an expression
 * is made of rather than what its outermost call happens to be.
 *
 * A type position contributes nothing, for the reason a key or a parameter
 * name does not: a type is not a reference. The one type-shaped node that
 * holds a value is a heritage clause -- `class extends Base` evaluates `Base`.
 */
function identifiersIn(
  node: ts.Node | undefined,
  stopAt: (call: ts.CallExpression) => boolean,
  acc: ts.Identifier[] = [],
): ts.Identifier[] {
  if (!node) return acc;
  if (ts.isCallExpression(node)) {
    if (stopAt(node)) return acc;
    if (ts.isIdentifier(node.expression)) acc.push(node.expression);
    else if (ts.isPropertyAccessExpression(node.expression))
      identifiersIn(node.expression.expression, stopAt, acc);
    node.arguments.forEach((arg) => identifiersIn(arg, stopAt, acc));
    return acc;
  }
  if (ts.isPropertyAccessExpression(node))
    return identifiersIn(node.expression, stopAt, acc);
  // A key is a BINDING, not a reference. `{ config: {} }` in a test factory
  // was resolving its key to a `config` helper that reads a file, which made
  // a deliberately-empty boundary case read as a filesystem scan. Parameter
  // names leak the same way, so only a default value counts there.
  if (ts.isPropertyAssignment(node))
    return identifiersIn(node.initializer, stopAt, acc);
  if (ts.isParameter(node)) return identifiersIn(node.initializer, stopAt, acc);
  if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node))
    return acc;
  if (ts.isIdentifier(node)) {
    acc.push(node);
    return acc;
  }
  // The braces are load-bearing. `ts.forEachChild` STOPS at the first child
  // whose callback returns something truthy, and this returns `acc` -- an
  // array, always truthy. Written point-free it visited exactly one child per
  // node, so an arrow function yielded its parameter and never its body.
  // Inherited from #98, where it quietly narrowed that guard too.
  ts.forEachChild(node, (child) => {
    identifiersIn(child, stopAt, acc);
  });
  return acc;
}

/**
 * What `node` is made of, each identifier resolved in its own scope.
 *
 * To a fixed point, because one hop hides exactly the guards that matter.
 * `locale-beta.test.ts` writes `const source = withoutTsComments(
 * readFileSync(INDEX))` and then asserts over `source.match(...)`, so the
 * `readFileSync` is two hops from the assertion. #98's derivation stopped at
 * one and reached it only by accident, resolving the local string to an
 * unrelated `source()` function three files away -- the right answer for the
 * wrong reason, which stopped being right the moment that accident was fixed.
 */
export function derivationOf(
  node: ts.Expression,
  bound: Bound,
  { stopAt = enterEveryCall }: DerivationOptions = {},
): Derivation {
  const names = new Set<string>();
  const opaque = new Set<string>();
  const initializers: ts.Expression[] = [];
  const queue = identifiersIn(node, stopAt);
  while (queue.length > 0) {
    const id = queue.shift() as ts.Identifier;
    names.add(id.text);
    const init = bound.initializerOf(id);
    if (init === undefined) {
      opaque.add(id.text);
      continue;
    }
    if (initializers.includes(init)) continue;
    initializers.push(init);
    queue.push(...identifiersIn(init, stopAt));
  }
  return { names: [...names], opaque: [...opaque], initializers };
}

export interface Closure {
  /**
   * Whether `name`, resolved from inside `file`, reaches the seed.
   *
   * The file matters. Three different `scan` functions live in this suite --
   * two read the filesystem and `parked-tests.test.ts`'s takes a string --
   * and a graph keyed by bare name gave the pure one the impure one's
   * property, flagging five behavioural assertions as unproved. A local
   * declaration shadows every same-named one elsewhere, exactly as the
   * module system does. A name NOT declared locally is an import, and there
   * the union of same-named declarations is the honest over-approximation.
   */
  reaches(file: string, name: string): boolean;
}

export interface CallGraph {
  /**
   * Every function reaching any of `seed`, at any depth.
   *
   * A property like "reads file content" or "refuses an empty result" is
   * inherited by callers, and this repo reaches those primitives through
   * three and four hops of helper -- #98's first derivation looked only a few
   * lines around a `readFileSync` and missed six sites for exactly that.
   */
  close(seed: Iterable<string>): Closure;
}

/** Index every named function across `files` and how they call each other. */
export function callGraph(files: readonly string[]): CallGraph {
  const keyOf = (file: string, name: string) => `${file}::${name}`;
  /** `file::name` to the bare names it calls. */
  const calls = new Map<string, Set<string>>();
  const fileOf = new Map<string, string>();
  const keysByName = new Map<string, string[]>();
  /**
   * Every name bound at all in a file: functions, variables and PARAMETERS.
   *
   * A local binding shadows an import whatever its shape.
   * `parked-tests.test.ts` builds a `const source` string; three files away,
   * `locale-switcher.test.ts` declares a `source()` that reads a file. Take
   * only functions into account and the string inherits the reader's
   * property, which flagged five behavioural assertions as unproved.
   *
   * Parameters were the shape this missed, and it cost two false alarms
   * (#277). `workflow-jobs.test.ts` has `onlyJob = (lines: string) => ...`,
   * which builds YAML in memory and touches no disk; `dashboard-jsonl.
   * test.ts` declares `const lines = (file) => readFileSync(...)`. The
   * PARAMETER fell through to the by-bare-name fallback and inherited the
   * reader, so two behavioural absence assertions -- input written beside
   * them -- were reported as needing a discovery control they have no use
   * for. A false alarm is how a working control gets deleted, and adding a
   * ritual control to satisfy one is how a guard acquires the escape hatch
   * #118 exists about.
   */
  const bound = new Map<string, Set<string>>();
  /**
   * Every name a file imports, by local name: the graph file it comes from
   * (null when the module lies outside the graph) and the name it has there
   * (null for a default or namespace import, which stands for the module).
   * Resolved through this, an import reaches what its own module declares,
   * never a same-named function elsewhere (#477): `browser-matrix.test.ts`'s
   * `config`, imported from `playwright.config.ts`, inherited
   * `dependabot-labels.test.ts`'s, which reads a file.
   */
  const imports = new Map<
    string,
    Map<string, { from: string | null; name: string | null }>
  >();
  const inGraph = new Set(files);
  const moduleFile = (file: string, specifier: string): string | null => {
    if (!specifier.startsWith('.')) return null;
    const base = join(dirname(file), specifier);
    return (
      [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((path) =>
        inGraph.has(path),
      ) ?? null
    );
  };

  for (const file of files) {
    const visit = (node: ts.Node, owner: string | null) => {
      let mine = owner;
      const isFn =
        ts.isFunctionDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node);
      if (isFn) {
        const name = declaredName(node);
        if (name) {
          mine = keyOf(file, name);
          if (!calls.has(mine)) {
            calls.set(mine, new Set());
            fileOf.set(mine, file);
            keysByName.set(name, [...(keysByName.get(name) ?? []), mine]);
          }
        }
      }
      // A destructured name binds like any other (#477): `source` in
      // `for (const [source] of ...)` is a string, not a reader elsewhere.
      if (
        (ts.isVariableDeclaration(node) ||
          ts.isParameter(node) ||
          ts.isBindingElement(node)) &&
        ts.isIdentifier(node.name)
      )
        bound.set(file, (bound.get(file) ?? new Set()).add(node.name.text));
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.importClause
      ) {
        const from = moduleFile(file, node.moduleSpecifier.text);
        const own = imports.get(file) ?? new Map();
        const clause = node.importClause;
        if (clause.name) own.set(clause.name.text, { from, name: null });
        const named = clause.namedBindings;
        if (named && ts.isNamespaceImport(named))
          own.set(named.name.text, { from, name: null });
        if (named && ts.isNamedImports(named))
          for (const element of named.elements)
            own.set(element.name.text, {
              from,
              name: (element.propertyName ?? element.name).text,
            });
        imports.set(file, own);
      }
      if (mine && ts.isCallExpression(node) && ts.isIdentifier(node.expression))
        calls.get(mine)?.add(node.expression.text);
      ts.forEachChild(node, (child) => visit(child, mine));
    };
    visit(parseFile(file), null);
  }

  const resolve = (
    file: string,
    name: string,
    seen = new Set<string>(),
  ): string[] => {
    const local = keyOf(file, name);
    if (calls.has(local)) return [local];
    if (bound.get(file)?.has(name)) return [];
    const imported = imports.get(file)?.get(name);
    if (imported) {
      // Outside the graph, nothing in it is what was imported.
      if (imported.from === null) return [];
      // A default or namespace import stands for the whole module.
      if (imported.name === null)
        return [...calls.keys()].filter(
          (key) => fileOf.get(key) === imported.from,
        );
      if (seen.has(local)) return [];
      return resolve(imported.from, imported.name, seen.add(local));
    }
    // Declared nowhere this file can see: a global, or a re-export.
    return keysByName.get(name) ?? [];
  };

  return {
    close(seed) {
      const seeds = new Set(seed);
      const reached = new Set<string>();
      // Fixed point rather than a fixed pass count: a chain longer than the
      // passes would silently truncate, and a truncated closure reports a
      // guard as unproved when it is fine -- a false alarm that gets a real
      // control deleted.
      let grew = true;
      while (grew) {
        grew = false;
        for (const [key, callees] of calls) {
          if (reached.has(key)) continue;
          const file = fileOf.get(key) ?? '';
          for (const callee of callees)
            if (
              seeds.has(callee) ||
              resolve(file, callee).some((k) => reached.has(k))
            ) {
              reached.add(key);
              grew = true;
              break;
            }
        }
      }
      return {
        reaches: (file, name) =>
          seeds.has(name) ||
          resolve(file, name).some((key) => reached.has(key)),
      };
    },
  };
}

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
