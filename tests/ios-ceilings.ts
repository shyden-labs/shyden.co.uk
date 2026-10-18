import { existsSync, readFileSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import ts from 'typescript';
import { filesUnder } from './source-files';
import { withoutTsComments } from './unit/source-text';

/**
 * No check is ever added to an iPhone-only test file (#858). A phone check is
 * one test that Android and the iPhone both run, from the same files (global
 * rule, 2026-10-16; #839 moves the iPhone's own journeys into the shared
 * suite). Comparing test TITLES between the phones (#812) cannot see an
 * assertion added inside an existing journey, which is how one was added to
 * Journey 14 on 2026-10-18 and ruled illegal. So each file under
 * `tests/device/ios/` is held to a ceiling on the tests and assertions it
 * writes, recorded in `tests/ios-ceilings.json` when this landed, that only
 * ever falls.
 *
 * Two readers, so a blind one cannot agree with itself: the comment-stripped
 * text (`countChecks`) and the parse tree (`countChecksParsed`). They differ
 * only where a check is spelled inside a string, and a difference is a
 * finding. A name that would hide a check from both (an aliased or namespace
 * import of vitest, a local bound to a check) is refused by `hiddenCheckNames`.
 *
 * A check need not be written as `expect` (Shyden, 2026-10-19: "count calls
 * to shared check helpers too"): `indirectChecksOf` counts each call, inside a
 * test or hook, to a function that asserts or throws, followed into every
 * module it reaches, and each `throw` written there, read through the text
 * and the parse as well.
 */

export interface CheckCounts {
  readonly tests: number;
  readonly assertions: number;
}

export type Ceilings = Readonly<Record<string, FileChecks>>;

export const KINDS = ['tests', 'assertions', 'indirectChecks'] as const;

export const CEILINGS_FILE = 'tests/ios-ceilings.json';

export const IOS_DIR = 'tests/device/ios';

/** The names a test is declared by, with any chain of modifiers after them. */
const TEST_NAMES = new Set(['test', 'it']);

/** `expect` alone or by these members; `assert` alone or by any method. */
const EXPECT_MEMBERS = new Set(['soft', 'poll']);

const CHECK_NAMES = new Set([...TEST_NAMES, 'expect', 'assert']);

const TEST_CALL = /(?<![\w$.])(?:test|it)(?:\s*\.\s*[A-Za-z]+)*\s*\(/g;
const ASSERTION_CALL =
  /(?<![\w$.])(?:expect(?:\s*\.\s*(?:soft|poll))?|assert(?:\s*\.\s*[A-Za-z]+)?)\s*\(/g;

/** The tests and assertions `source` writes, read from its comment-stripped text. */
export function countChecks(source: string): CheckCounts {
  const code = withoutTsComments(source);
  return {
    tests: code.match(TEST_CALL)?.length ?? 0,
    assertions: code.match(ASSERTION_CALL)?.length ?? 0,
  };
}

const parse = (source: string): ts.SourceFile =>
  ts.createSourceFile('checks.ts', source, ts.ScriptTarget.Latest, true);

/** `a.b.c` as `['a', 'b', 'c']`; null when the chain does not start at a bare name. */
function calleeChain(callee: ts.Expression): string[] | null {
  const names: string[] = [];
  let node = callee;
  while (ts.isPropertyAccessExpression(node)) {
    names.unshift(node.name.text);
    node = node.expression;
  }
  if (!ts.isIdentifier(node)) return null;
  return [node.text, ...names];
}

function isAssertion(chain: readonly string[]): boolean {
  if (chain[0] === 'expect')
    return (
      chain.length === 1 || (chain.length === 2 && EXPECT_MEMBERS.has(chain[1]))
    );
  return chain[0] === 'assert' && chain.length <= 2;
}

/** The same counts as `countChecks`, read from the parse tree instead. */
export function countChecksParsed(source: string): CheckCounts {
  let tests = 0;
  let assertions = 0;
  const visit = (node: ts.Node): void => {
    const chain = ts.isCallExpression(node)
      ? calleeChain(node.expression)
      : null;
    if (chain && TEST_NAMES.has(chain[0])) tests += 1;
    else if (chain && isAssertion(chain)) assertions += 1;
    ts.forEachChild(node, visit);
  };
  visit(parse(source));
  return { tests, assertions };
}

/** Every name in `source` that would carry a check past both counts. */
export function hiddenCheckNames(source: string): string[] {
  const hidden: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === 'vitest'
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings))
        hidden.push(`${bindings.name.text} (namespace import of vitest)`);
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          if (
            element.propertyName &&
            CHECK_NAMES.has(element.propertyName.text)
          )
            hidden.push(
              `${element.name.text} (imported as ${element.propertyName.text})`,
            );
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      CHECK_NAMES.has(node.initializer.text)
    )
      hidden.push(`${node.name.text} (bound to ${node.initializer.text})`);
    ts.forEachChild(node, visit);
  };
  visit(parse(source));
  return hidden;
}

/** The names a hook is declared by: its body runs around every test. */
const HOOK_NAMES = new Set([
  'beforeAll',
  'beforeEach',
  'afterAll',
  'afterEach',
]);

/** A module's text by its repo-relative path, or undefined when there is none. */
export type ModuleReader = (path: string) => string | undefined;

interface ModuleFacts {
  /** Each function the module declares at its top level, by name. */
  readonly functions: Map<string, ts.Node>;
  /** Each name bound by a relative import or re-export, to where it comes from. */
  readonly imports: Map<
    string,
    { specifier: string; module?: string; name: string }
  >;
  /** Each namespace import of a relative module. */
  readonly namespaces: Map<string, { specifier: string; module?: string }>;
  /** `export { local as exported }`, by exported name. */
  readonly aliases: Map<string, string>;
}

/** Where a relative import lands, tried as written, then with `.ts`, then as a folder. */
function resolveModule(
  from: string,
  specifier: string,
  read: ModuleReader,
): string | undefined {
  const base = posix.join(posix.dirname(from), specifier);
  return [base, `${base}.ts`, `${base}/index.ts`].find(
    (path) => read(path) !== undefined,
  );
}

const isFunction = (node: ts.Node | undefined): node is ts.Expression =>
  node !== undefined &&
  (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

function factsOf(
  path: string,
  source: string,
  read: ModuleReader,
): ModuleFacts {
  const functions = new Map<string, ts.Node>();
  const imports = new Map<
    string,
    { specifier: string; module?: string; name: string }
  >();
  const namespaces = new Map<string, { specifier: string; module?: string }>();
  const aliases = new Map<string, string>();
  for (const statement of parse(source).statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name)
      functions.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (
          ts.isIdentifier(declaration.name) &&
          isFunction(declaration.initializer)
        )
          functions.set(declaration.name.text, declaration.initializer);
    const specifier =
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined;
    const relative = specifier?.startsWith('.') ? specifier : undefined;
    const module = relative ? resolveModule(path, relative, read) : undefined;
    if (ts.isImportDeclaration(statement) && relative) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings))
        namespaces.set(bindings.name.text, { specifier: relative, module });
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          imports.set(element.name.text, {
            specifier: relative,
            module,
            name: (element.propertyName ?? element.name).text,
          });
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    )
      for (const element of statement.exportClause.elements) {
        const local = (element.propertyName ?? element.name).text;
        if (relative)
          imports.set(element.name.text, {
            specifier: relative,
            module,
            name: local,
          });
        else aliases.set(element.name.text, local);
      }
  }
  return { functions, imports, namespaces, aliases };
}

/**
 * Which functions check: those whose body asserts, throws, or calls a function
 * that does, followed through relative imports, re-exports and namespace
 * imports into every module they reach. A cycle is read as not checking until
 * it is shown to (a function that only checks through itself never runs one).
 */
class CheckingFunctions {
  private readonly facts = new Map<string, ModuleFacts>();
  private readonly verdicts = new Map<string, boolean | undefined>();

  constructor(private readonly read: ModuleReader) {}

  factsOf(path: string, source?: string): ModuleFacts | undefined {
    const known = this.facts.get(path);
    if (known) return known;
    const text = source ?? this.read(path);
    if (text === undefined) return undefined;
    const facts = factsOf(path, text, this.read);
    this.facts.set(path, facts);
    return facts;
  }

  /** Whether `name` in `path` names a checking function; undefined when it cannot be followed. */
  checks(path: string, name: string): boolean | undefined {
    const key = `${path}#${name}`;
    if (this.verdicts.has(key)) return this.verdicts.get(key) ?? false;
    this.verdicts.set(key, false);
    const verdict = this.decide(path, name);
    this.verdicts.set(key, verdict);
    return verdict;
  }

  private decide(path: string, name: string): boolean | undefined {
    const facts = this.factsOf(path);
    if (!facts) return undefined;
    const declared = facts.functions.get(name);
    if (declared) return this.bodyChecks(path, declared);
    const alias = facts.aliases.get(name);
    if (alias !== undefined && alias !== name) return this.checks(path, alias);
    const imported = facts.imports.get(name);
    if (imported)
      return imported.module
        ? this.checks(imported.module, imported.name)
        : undefined;
    return undefined;
  }

  /** Whether a call's callee, read in `path`, checks; null for a name this reader does not follow. */
  calleeChecks(
    path: string,
    callee: ts.Expression,
  ): boolean | null | undefined {
    const chain = calleeChain(callee);
    const facts = this.factsOf(path);
    if (!chain || !facts) return null;
    if (chain.length === 1) {
      const [name] = chain;
      if (
        facts.functions.has(name) ||
        facts.imports.has(name) ||
        facts.aliases.has(name)
      )
        return this.checks(path, name);
      return null;
    }
    const namespace =
      chain.length === 2 ? facts.namespaces.get(chain[0]) : undefined;
    if (namespace)
      return namespace.module
        ? this.checks(namespace.module, chain[1])
        : undefined;
    return null;
  }

  bodyChecks(path: string, body: ts.Node): boolean {
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (ts.isThrowStatement(node)) found = true;
      else if (ts.isCallExpression(node)) {
        const chain = calleeChain(node.expression);
        if (chain && isAssertion(chain)) found = true;
        else if (this.calleeChecks(path, node.expression) === true)
          found = true;
      }
      if (!found) ts.forEachChild(node, visit);
    };
    ts.forEachChild(body, visit);
    return found;
  }
}

export interface IndirectChecks {
  /** Calls to a checking helper, and throws, inside test and hook bodies: what the ceiling holds. */
  readonly inBodies: number;
  /** The same, over the whole file, read from the parse. */
  readonly parsedWhole: number;
  /** The same, over the whole file, read from the comment-stripped text. */
  readonly textWhole: number;
  /** What `inBodies` counted, one entry per site: the callee as written, or `throw`. */
  readonly counted: string[];
  /** Called names imported from a relative module this reader cannot follow. */
  readonly refusals: string[];
}

const escapeRegex = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The checks `source` (at `file`) makes other than by `expect` or `assert`
 * (#858, Shyden 2026-10-19: "count calls to shared check helpers too"): a
 * call to a function that asserts or throws, wherever it is declared, and a
 * `throw` written in a test or hook itself. A method called on an object
 * (`session.open(...)`) is not followed: the harness drives the page that way.
 */
export function indirectChecksOf(
  file: string,
  source: string,
  read: ModuleReader,
): IndirectChecks {
  const known = new CheckingFunctions(read);
  const facts = known.factsOf(file, source);
  if (!facts) throw new Error(`${file}: no facts`);
  const refusals = new Set<string>();
  let inBodies = 0;
  let parsedWhole = 0;
  const checkingNames = new Set<string>();
  const checkingNamespaced = new Set<string>();
  const countNode = (node: ts.Node): number => {
    if (ts.isThrowStatement(node)) return 1;
    if (
      ts.isIdentifier(node) &&
      ts.isCallExpression(node.parent) &&
      node.parent.arguments.some((argument) => argument === node) &&
      known.calleeChecks(file, node) === true
    )
      refusals.add(
        `${file}: ${node.text} is passed by reference, so neither reader can count its calls: call it directly`,
      );
    if (!ts.isCallExpression(node)) return 0;
    const chain = calleeChain(node.expression);
    if (chain && (isAssertion(chain) || TEST_NAMES.has(chain[0]))) return 0;
    const verdict = known.calleeChecks(file, node.expression);
    if (verdict === undefined && chain) {
      const origin =
        facts.imports.get(chain[0]) ??
        (chain.length === 2 ? facts.namespaces.get(chain[0]) : undefined);
      refusals.add(
        `${file}: ${chain.join('.')} is called, imported from '${origin?.specifier ?? '?'}', which cannot be followed`,
      );
    }
    if (verdict !== true || !chain) return 0;
    if (chain.length === 1) checkingNames.add(chain[0]);
    else checkingNamespaced.add(chain.join('.'));
    return 1;
  };
  const counted: string[] = [];
  const inBody = (node: ts.Node): void => {
    const found = countNode(node);
    inBodies += found;
    if (found > 0)
      counted.push(
        ts.isThrowStatement(node)
          ? 'throw'
          : (calleeChain((node as ts.CallExpression).expression) ?? []).join(
              '.',
            ),
      );
    ts.forEachChild(node, inBody);
  };
  const visit = (node: ts.Node): void => {
    parsedWhole += countNode(node);
    if (ts.isCallExpression(node)) {
      const chain = calleeChain(node.expression);
      if (chain && (TEST_NAMES.has(chain[0]) || HOOK_NAMES.has(chain[0])))
        for (const argument of node.arguments)
          if (isFunction(argument)) ts.forEachChild(argument, inBody);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(source));
  const code = withoutTsComments(source);
  const count = (pattern: string): number =>
    code.match(new RegExp(pattern, 'g'))?.length ?? 0;
  let textWhole = count('(?<![\\w$])throw\\b');
  for (const name of checkingNames)
    textWhole +=
      count(`(?<![\\w$.])${escapeRegex(name)}\\s*\\(`) -
      count(`\\bfunction\\s+${escapeRegex(name)}\\s*\\(`);
  for (const dotted of checkingNamespaced) {
    const [namespace, member] = dotted.split('.');
    textWhole += count(
      `(?<![\\w$.])${escapeRegex(namespace)}\\s*\\.\\s*${escapeRegex(member)}\\s*\\(`,
    );
  }
  return { inBodies, parsedWhole, textWhole, counted, refusals: [...refusals] };
}

export interface FileChecks extends CheckCounts {
  readonly indirectChecks: number;
}

export interface SourceReading {
  /** Each file's counts: tests and assertions from the text, indirect checks from the parse. */
  readonly counts: Map<string, FileChecks>;
  /** Files the two readers disagree on, names that would hide a check, and helpers not followed. */
  readonly refusals: string[];
}

/** Every file counted by both readers, with what neither can be trusted on. */
export function judgeSources(
  sources: ReadonlyMap<string, string>,
  read: ModuleReader,
): SourceReading {
  const counts = new Map<string, FileChecks>();
  const refusals: string[] = [];
  for (const [file, source] of sources) {
    const text = countChecks(source);
    const parsed = countChecksParsed(source);
    const indirect = indirectChecksOf(file, source, read);
    counts.set(file, { ...text, indirectChecks: indirect.inBodies });
    if (text.tests !== parsed.tests || text.assertions !== parsed.assertions)
      refusals.push(
        `${file}: the text counts ${text.tests} tests and ${text.assertions} assertions, the parse ${parsed.tests} and ${parsed.assertions}: a check is spelled where only one reader sees it`,
      );
    if (indirect.textWhole !== indirect.parsedWhole)
      refusals.push(
        `${file}: the text counts ${indirect.textWhole} helper checks and throws, the parse ${indirect.parsedWhole}: a check is spelled where only one reader sees it`,
      );
    for (const name of hiddenCheckNames(source))
      refusals.push(`${file}: ${name} would carry a check past both counts`);
    refusals.push(...indirect.refusals);
  }
  return { counts, refusals };
}

const ROSE =
  'A phone check is one test both phones run: put it in the shared spec under tests/e2e/ that Android and the iPhone both run (#839), never in an iPhone-only file.';
const FELL = 'Lower it: npm run ceilings:record (it only ever lowers).';

const ceilingOf = (ceilings: Ceilings, file: string): FileChecks | undefined =>
  Object.hasOwn(ceilings, file) ? ceilings[file] : undefined;

/**
 * Every file and kind whose count is not its ceiling: above is a check added
 * where it does not belong; below is a ceiling left standing, which would let
 * a check back in up to the old figure. A file with no ceiling has 0.
 */
export function ceilingBreaches(
  now: ReadonlyMap<string, FileChecks>,
  ceilings: Ceilings,
): string[] {
  const files = [...new Set([...now.keys(), ...Object.keys(ceilings)])].sort();
  return files.flatMap((file) =>
    KINDS.flatMap((kind) => {
      const read = now.get(file)?.[kind] ?? 0;
      const ceiling = ceilingOf(ceilings, file)?.[kind] ?? 0;
      if (read === ceiling) return [];
      return [
        `${file}: ${read} ${kind}, ceiling ${ceiling}. ${read > ceiling ? ROSE : FELL}`,
      ];
    }),
  );
}

export interface CeilingDecision {
  /** What to write, or undefined when anything rose. */
  readonly next: Ceilings | undefined;
  readonly refusals: string[];
  /** Every figure that moved, as `file: kind old -> new`. */
  readonly deltas: string[];
}

/**
 * The record a measurement makes. The first record (none yet) takes every
 * figure; after that a fall is written and a rise refuses the whole record,
 * since the only way a count rises is a check added to an iPhone-only file.
 */
export function decideCeilings(
  now: ReadonlyMap<string, FileChecks>,
  recorded: Ceilings | undefined,
): CeilingDecision {
  const files = [
    ...new Set([...now.keys(), ...Object.keys(recorded ?? {})]),
  ].sort();
  const refusals: string[] = [];
  const deltas: string[] = [];
  const next: Record<string, FileChecks> = {};
  for (const file of files) {
    const counts = now.get(file);
    const listed = recorded ? ceilingOf(recorded, file) : undefined;
    for (const kind of KINDS) {
      const before = listed ? String(listed[kind]) : recorded ? '0' : 'none';
      const after = counts ? String(counts[kind]) : 'none';
      if (before === after) continue;
      deltas.push(`${file}: ${kind} ${before} -> ${after}`);
      if (recorded && counts && counts[kind] > (listed?.[kind] ?? 0))
        refusals.push(
          `${file}: ${kind} ${before} -> ${after} is a rise; a ceiling only falls`,
        );
    }
    if (counts)
      next[file] = {
        tests: counts.tests,
        assertions: counts.assertions,
        indirectChecks: counts.indirectChecks,
      };
  }
  return { next: refusals.length > 0 ? undefined : next, refusals, deltas };
}

/** Every `.ts` file under the iPhone's own directory, from the filesystem. */
export const iosFiles = (): string[] =>
  filesUnder(IOS_DIR, (path) => path.endsWith('.ts'));

/** A repo file's text, or undefined when there is no such file. */
export const readModule: ModuleReader = (path) =>
  existsSync(path) && statSync(path).isFile()
    ? readFileSync(path, 'utf8')
    : undefined;

/** Each iPhone file's text, read once. */
export const readIosSources = (): Map<string, string> =>
  new Map(iosFiles().map((file) => [file, readFileSync(file, 'utf8')]));

/** The recorded ceilings, refusing a file that is not a mapping of whole counts. */
export function readCeilings(file: string = CEILINGS_FILE): Ceilings {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error(`${file}: not a mapping of file to counts`);
  for (const [key, value] of Object.entries(parsed))
    if (
      typeof value !== 'object' ||
      value === null ||
      KINDS.some(
        (kind) => !Number.isInteger((value as Record<string, unknown>)[kind]),
      )
    )
      throw new Error(
        `${file}: ${key} does not hold a whole count of each kind (${KINDS.join(', ')})`,
      );
  return parsed as Ceilings;
}
