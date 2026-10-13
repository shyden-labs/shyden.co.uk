import ts from 'typescript';
import { scopeOf, testBodiesIn } from './floorless-searches';
import {
  codeWithoutLiterals,
  derivationOf,
  where,
  type Bound,
  type Closure,
} from './unit/ast';

/**
 * The absence-liveness finder (#118, #609): which absence assertions carry no
 * population in their verdict. One home for the guard that judges the whole
 * tree (`tests/guards/absence-liveness.test.ts`, where the rule is explained)
 * and for the pre-push lint that judges the test files a branch changed
 * (`scripts/lint-changed-tests.mjs`, #662).
 */

/** What `scanAbsences` read and what it found. */
export interface AbsenceScan {
  /** Every absence assertion read, as `file:line`. */
  readonly sites: string[];
  readonly perFile: Map<string, number>;
  readonly proved: number;
  /** Assertions the reader refuses outright, as `file:line — why`. */
  readonly findings: string[];
  /** Unjudged absences by `file › test title as written` (#609). */
  readonly unjudged: Map<string, number>;
  /** Each unjudged absence where it is written, with its scope's key and why. */
  readonly unjudgedSites: { key: string; at: string; why: string }[];
}

/** Reaching any of these means the subject came from outside the test. */
export const DISCOVERY = new Set([
  'readFileSync',
  'readdirSync',
  'filesUnder',
  'listSourceFiles',
]);

/** Shapes that accumulate: emptiness is meaningless without the source. */
const DERIVING = new Set(['filter', 'flatMap']);

const EQUALITY = new Set(['toEqual', 'toStrictEqual', 'toBe']);

const isZero = (arg: ts.Expression | undefined): boolean =>
  arg !== undefined && ts.isNumericLiteral(arg) && arg.text === '0';

/**
 * The call an absence matcher hangs off -- `expect(x)` in
 * `expect(x).toEqual([])` -- for every spelling of "this is empty":
 * `.toEqual([])`, `.toStrictEqual([])`, `.toHaveLength(0)`, and anything held
 * equal to 0. Null for any other matcher, and for a `.not` inverse.
 */
function absenceRoot(
  node: ts.CallExpression,
): { root: ts.Expression; zeroCount: boolean } | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  const matcher = node.expression.name.text;
  const arg = node.arguments[0];
  const emptyList =
    (matcher === 'toEqual' || matcher === 'toStrictEqual') &&
    arg !== undefined &&
    ts.isArrayLiteralExpression(arg) &&
    arg.elements.length === 0;
  const noLength = matcher === 'toHaveLength' && isZero(arg);
  const zeroCount = EQUALITY.has(matcher) && isZero(arg);
  if (!emptyList && !noLength && !zeroCount) return null;

  // Walk back through any modifier chain (`.not`, `.resolves`). A `.not`
  // anywhere in it inverts the claim, so the assertion is not an absence one.
  let target: ts.Expression = node.expression.expression;
  while (ts.isPropertyAccessExpression(target)) {
    if (target.name.text === 'not') return null;
    target = target.expression;
  }
  return { root: target, zeroCount };
}

/** `expect(x)` or `expect.soft(x)`: both assert, so both are read. */
function isExpectCall(root: ts.Expression): root is ts.CallExpression {
  if (!ts.isCallExpression(root)) return false;
  const callee = root.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'expect';
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'expect' &&
    callee.name.text === 'soft'
  );
}

/**
 * What an absence assertion asserts empty. For a count held to 0 the subject
 * is what the count is OF: `expect(found.length).toBe(0)` asserts `found`
 * empty (#390 F159).
 */
export function absenceSubject(node: ts.CallExpression): ts.Expression | null {
  const shape = absenceRoot(node);
  if (!shape || !isExpectCall(shape.root)) return null;
  const subject = shape.root.arguments[0];
  if (subject === undefined) return null;
  if (!shape.zeroCount) return subject;
  // A bare number held to 0 is a value, not a population.
  return ts.isPropertyAccessExpression(subject) &&
    (subject.name.text === 'length' || subject.name.text === 'size')
    ? subject.expression
    : null;
}

/** Why this subject needs a control, or null if it carries its own. */
export function unproved(
  subject: ts.Expression,
  file: string,
  bound: Bound,
  discoverers: Closure,
): string | null {
  // Already routed through the helper: the population is in the expression.
  if (
    ts.isCallExpression(subject) &&
    ts.isIdentifier(subject.expression) &&
    subject.expression.text === 'searched'
  )
    return null;

  // A derivation written in the subject itself: `expect(xs.filter(...))`.
  // `derivationOf` reads the initialisers of the names a subject uses, never
  // the subject's own receiver chain, so this was read as self-contained (#609).
  for (let at: ts.Expression = subject; ;) {
    if (ts.isParenthesizedExpression(at) || ts.isAwaitExpression(at)) {
      at = at.expression;
    } else if (ts.isCallExpression(at)) {
      at = at.expression;
    } else if (ts.isPropertyAccessExpression(at)) {
      if (
        DERIVING.has(at.name.text) &&
        ts.isCallExpression(at.parent) &&
        at.parent.expression === at
      )
        return `derived by .${at.name.text}() over a population`;
      at = at.expression;
    } else break;
  }

  const { names, initializers } = derivationOf(subject, bound);
  if (names.some((name) => discoverers.reaches(file, name)))
    return 'derives from the filesystem';

  // No filesystem question inside the loop: every identifier in a followed
  // initializer is already one of `names`, which the check above has asked.
  for (const init of initializers) {
    if (ts.isArrayLiteralExpression(init) && init.elements.length === 0)
      return 'a collector: initialised empty and accumulated into';
    if (
      ts.isNewExpression(init) &&
      ts.isIdentifier(init.expression) &&
      (init.expression.text === 'Set' || init.expression.text === 'Map') &&
      (init.arguments?.length ?? 0) === 0
    )
      return `a collector: an empty ${init.expression.text}`;
    if (
      ts.isCallExpression(init) &&
      ts.isPropertyAccessExpression(init.expression) &&
      DERIVING.has(init.expression.name.text)
    )
      return `derived by .${init.expression.name.text}() over a population`;
  }
  // Anything else is a finding too (#609, #534: no exceptions). An assertion
  // over a call whose input is written beside it has no population in the
  // verdict and no floor, so nothing would notice a reader that stopped
  // reading part of it.
  return 'self-contained: no population in the verdict';
}

/**
 * An absence matcher on a root the reader cannot classify -- `expect.poll`,
 * an aliased `expect`, a helper returning a matcher -- named, so the scan
 * refuses it rather than skipping it: skipped, it is an absence nobody judges
 * (#446, control d).
 */
export function unclassified(node: ts.CallExpression): string | null {
  const shape = absenceRoot(node);
  if (!shape || isExpectCall(shape.root)) return null;
  if (shape.zeroCount && !countsAPopulation(shape.root)) return null;
  return shape.root.getText().replace(/\s+/g, ' ').slice(0, 70);
}

/**
 * Whether a count held to 0 on an unread root is a population's size. A bare
 * value held to 0 is not an absence, as `absenceSubject` says of
 * `expect(k).toBe(0)`. A polled function is judged by what it returns
 * (`evidence-page.spec.ts` polls an in-flight counter to 0), and one whose
 * return cannot be read from here counts as a population, so it is refused.
 */
function countsAPopulation(root: ts.Expression): boolean {
  if (!ts.isCallExpression(root)) return true;
  let counted: ts.Expression | undefined = root.arguments[0];
  const callee = root.expression;
  const polled =
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'expect' &&
    callee.name.text === 'poll';
  if (polled) {
    if (
      counted === undefined ||
      !ts.isArrowFunction(counted) ||
      ts.isBlock(counted.body)
    )
      return true;
    counted = counted.body;
  }
  while (counted !== undefined && ts.isParenthesizedExpression(counted))
    counted = counted.expression;
  return (
    counted === undefined ||
    (ts.isPropertyAccessExpression(counted) &&
      (counted.name.text === 'length' || counted.name.text === 'size'))
  );
}

/**
 * An absence matcher as text, for the cross-check: no AST walk, so a reader
 * blind to one file or one spelling disagrees with it. Matched in code with
 * its literals and comments removed (`codeWithoutLiterals`), then with all
 * whitespace and every trailing comma gone, so a matcher prettier split over
 * lines reads as one. A count held to 0 is read only on a `.length` or
 * `.size` written inside `expect(`, as `absenceSubject` reads it: on a bare
 * value, or on arithmetic, it is plainly not an absence. A `.not` directly
 * before the matcher inverts it.
 */
const ABSENCE_TEXT = new RegExp(
  [
    String.raw`(?<!\.not)\.(?:toEqual|toStrictEqual)\(\[\]\)`,
    String.raw`(?<!\.not)\.toHaveLength\(0\)`,
    String.raw`expect(?:\.soft)?\([\w$.()[\]]+?\.(?:length|size)(?:,"")?\)\.(?:toBe|toEqual|toStrictEqual)\(0\)`,
  ].join('|'),
  'g',
);

/** How many absence matchers `sf` writes, counted as text (#477). */
export function absencesWritten(sf: ts.SourceFile): number {
  const code = codeWithoutLiterals(sf)
    .replace(/\s+/g, '')
    .replace(/,\)/g, ')')
    .replace(/,\]/g, ']');
  return code.match(ABSENCE_TEXT)?.length ?? 0;
}

/** Every absence assertion in `bound`, judged; `discoverers` reach the filesystem. */
export function scanAbsences(bound: Bound, discoverers: Closure): AbsenceScan {
  const findings: string[] = [];
  const sites: string[] = [];
  const perFile = new Map<string, number>();
  /** Unjudged absences by `file › test title as written` (#609). */
  const unjudged = new Map<string, number>();
  const unjudgedSites: AbsenceScan['unjudgedSites'] = [];
  let proved = 0;
  for (const [file, sf] of bound.files) {
    const bodies = testBodiesIn(sf);
    const check = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const root = unclassified(node);
        if (root)
          findings.push(
            `${where(sf, node)} — an absence on a root the reader cannot classify: ${root}`,
          );
        const subject = absenceSubject(node);
        if (subject) {
          sites.push(where(sf, node));
          perFile.set(file, (perFile.get(file) ?? 0) + 1);
          const why = unproved(subject, file, bound, discoverers);
          if (why === null) proved += 1;
          else {
            const scope = scopeOf(bodies, node);
            // Fail closed: a site the reader cannot place cannot be listed.
            if (scope === undefined)
              findings.push(
                `${where(sf, node)} — an absence in no test and no named function`,
              );
            else {
              const key = `${file} › ${scope.label}`;
              unjudged.set(key, (unjudged.get(key) ?? 0) + 1);
              unjudgedSites.push({ key, at: where(sf, node), why });
            }
          }
        }
      }
      ts.forEachChild(node, check);
    };
    check(sf);
  }
  return { sites, perFile, proved, findings, unjudged, unjudgedSites };
}
