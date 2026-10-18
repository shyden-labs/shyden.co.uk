import { readFileSync } from 'node:fs';
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
 */

export interface CheckCounts {
  readonly tests: number;
  readonly assertions: number;
}

export type Ceilings = Readonly<Record<string, CheckCounts>>;

export const KINDS = ['tests', 'assertions'] as const;

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

export interface SourceReading {
  /** Each file's counts, as the stripped text reads them. */
  readonly counts: Map<string, CheckCounts>;
  /** Files the two readers disagree on, and names that would hide a check. */
  readonly refusals: string[];
}

/** Every file counted by both readers, with what neither can be trusted on. */
export function judgeSources(
  sources: ReadonlyMap<string, string>,
): SourceReading {
  const counts = new Map<string, CheckCounts>();
  const refusals: string[] = [];
  for (const [file, source] of sources) {
    const text = countChecks(source);
    const parsed = countChecksParsed(source);
    counts.set(file, text);
    if (text.tests !== parsed.tests || text.assertions !== parsed.assertions)
      refusals.push(
        `${file}: the text counts ${text.tests} tests and ${text.assertions} assertions, the parse ${parsed.tests} and ${parsed.assertions}: a check is spelled where only one reader sees it`,
      );
    for (const name of hiddenCheckNames(source))
      refusals.push(`${file}: ${name} would carry a check past both counts`);
  }
  return { counts, refusals };
}

const ROSE =
  'A phone check is one test both phones run: put it in the shared spec under tests/e2e/ that Android and the iPhone both run (#839), never in an iPhone-only file.';
const FELL = 'Lower it: npm run ceilings:record (it only ever lowers).';

const ceilingOf = (
  ceilings: Ceilings,
  file: string,
): CheckCounts | undefined =>
  Object.hasOwn(ceilings, file) ? ceilings[file] : undefined;

/**
 * Every file and kind whose count is not its ceiling: above is a check added
 * where it does not belong; below is a ceiling left standing, which would let
 * a check back in up to the old figure. A file with no ceiling has 0.
 */
export function ceilingBreaches(
  now: ReadonlyMap<string, CheckCounts>,
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
  now: ReadonlyMap<string, CheckCounts>,
  recorded: Ceilings | undefined,
): CeilingDecision {
  const files = [
    ...new Set([...now.keys(), ...Object.keys(recorded ?? {})]),
  ].sort();
  const refusals: string[] = [];
  const deltas: string[] = [];
  const next: Record<string, CheckCounts> = {};
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
      next[file] = { tests: counts.tests, assertions: counts.assertions };
  }
  return { next: refusals.length > 0 ? undefined : next, refusals, deltas };
}

/** Every `.ts` file under the iPhone's own directory, from the filesystem. */
export const iosFiles = (): string[] =>
  filesUnder(IOS_DIR, (path) => path.endsWith('.ts'));

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
        `${file}: ${key} does not hold whole tests and assertions`,
      );
  return parsed as Ceilings;
}
