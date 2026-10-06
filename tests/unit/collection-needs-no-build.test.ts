import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { bind, bindFiles, derivationOf, where, type Bound } from './ast';
import { searched, tsFilesUnder } from '../source-files';
import { floorBreach } from '../floors';

/**
 * Collecting the suite never reads the built site (#351).
 *
 * Playwright evaluates every spec's module scope, and every `describe` body,
 * while it COLLECTS -- which is also what `playwright test --list` does, and
 * `scripts/test-e2e.mjs` lists the suite before its web server has built
 * anything. `copy-reaches-a-page.spec.ts` walked `dist/` at module scope, so
 * on a checkout with no build (a fresh clone, a new worktree) a filtered run
 * passed every test it ran and still exited 1: the reconciliation `--list`
 * died on `ENOENT: scandir 'dist'`. CI never saw it, because CI builds before
 * it lists -- a warm tree hides a missing step.
 *
 * Derived, not listed: every TypeScript file under `tests/` is read, and a
 * read is found by what it is rather than by which file it is in. A read is a
 * CALL, run while collecting, with an argument made from a `dist` path. So:
 *
 * - `const page404 = 'dist/404.html'` in a `describe` body names a path and
 *   reads nothing; the test that passes it to `readFileSync` is where the
 *   read happens, and that body runs only when the test does.
 * - `const built = () => filesUnder('dist', …)` reads only when called, so it
 *   is judged by where it is CALLED from, followed through imports by the
 *   binder rather than by name (#184).
 * - `join('dist', …)` composes a path and touches no disk. Every other callee
 *   counts as a read, so a helper nobody has classified fails loud rather
 *   than passing in silence.
 */

const BUILT = /^(\.\/)?dist(\/|$)/;

/** Callees that compose a path and read nothing. */
const PATH_ONLY =
  /^(path\.)?(join|resolve|relative|dirname|basename|normalize)$/;

/** A body that runs when a TEST runs, never while the suite is collected. */
const DEFERRED =
  /^((test|it)(\.(only|skip|fixme|fail|slow|step|concurrent|sequential|todo))*(\.each\([\s\S]*\))?|((test|describe)\.)?(beforeAll|beforeEach|afterAll|afterEach))$/;

/** Calls whose arguments are a title and a body, never a path to read. */
const DECLARES =
  /^((test|it|describe)(\.[a-z]+)*(\.each\([\s\S]*\))?|test\.describe(\.[a-z]+)*|test\.use)$/;

/** A string naming something under `dist/`, a template's fixed head included. */
const isBuiltPath = (node: ts.Node): boolean => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return BUILT.test(node.text);
  if (ts.isTemplateExpression(node)) return BUILT.test(node.head.text);
  return false;
};

/**
 * Whether a dist path is written into `node` itself. A function inside it is
 * a body, not part of the value: it runs when it is called, and is judged
 * where it is called from.
 */
const holdsBuiltPath = (node: ts.Node): boolean =>
  isBuiltPath(node) ||
  (!ts.isFunctionLike(node) &&
    // `forEachChild` stops at the first truthy answer, which is the point
    // here; `undefined` lets it carry on past a child that holds none.
    (ts.forEachChild(node, (child) => holdsBuiltPath(child) || undefined) ??
      false));

/** Every node in `sf`, depth first. */
const nodesOf = (sf: ts.SourceFile): ts.Node[] => {
  const out: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    out.push(node);
    // Braces, not point-free: `forEachChild` stops at the first child whose
    // callback returns something truthy (ast.ts, `identifiersIn`).
    ts.forEachChild(node, (child) => {
      visit(child);
    });
  };
  visit(sf);
  return out;
};

const isFunctionBody = (node: ts.Node): boolean =>
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node);

/** Whether `fn` is the body handed to a test or a hook. */
const isDeferredBody = (fn: ts.Node): boolean =>
  ts.isCallExpression(fn.parent) &&
  fn.parent.arguments.some((arg) => arg === fn) &&
  DEFERRED.test(fn.parent.expression.getText());

/** The declaration a function is called by, when it has a name to call. */
const namedDeclaration = (
  fn: ts.Node,
): ts.FunctionDeclaration | ts.VariableDeclaration | undefined => {
  if (ts.isFunctionDeclaration(fn)) return fn;
  if (
    (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
    ts.isVariableDeclaration(fn.parent) &&
    fn.parent.initializer === fn
  )
    return fn.parent;
  return undefined;
};

/** An import or export names a binding; it runs nothing. */
const inModuleSyntax = (node: ts.Node): boolean => {
  for (let n: ts.Node | undefined = node; n; n = n.parent)
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return true;
  return false;
};

/** Every use of `decl`, in any bound file, resolved by the binder. */
const usesOf = (
  decl: ts.FunctionDeclaration | ts.VariableDeclaration,
  bound: Bound,
): ts.Identifier[] => {
  const name = decl.name;
  if (!name || !ts.isIdentifier(name)) return [];
  return [...bound.files.values()].flatMap((sf) =>
    nodesOf(sf).filter(
      (node): node is ts.Identifier =>
        ts.isIdentifier(node) &&
        node !== name &&
        node.text === name.text &&
        !inModuleSyntax(node) &&
        bound.declarationOf(node) === decl,
    ),
  );
};

/**
 * Whether `node` runs while the suite is collected.
 *
 * Climbs to the first function around it. A test or hook body defers it. A
 * named function runs when something that runs calls it, so each of its uses
 * is asked the same question. Any other function -- a `describe` body, a
 * `.map` callback -- runs when what it was handed to runs, so the climb goes
 * on. Reaching the file means module scope, which is collection.
 */
const runsWhileCollecting = (
  node: ts.Node,
  bound: Bound,
  seen: Set<ts.Node> = new Set(),
): boolean => {
  for (let n = node.parent; n; n = n.parent) {
    if (!isFunctionBody(n)) continue;
    if (isDeferredBody(n)) return false;
    const decl = namedDeclaration(n);
    if (!decl) continue;
    // A cycle, or a function already asked about on this path: it adds no
    // route to collection that the first asking did not.
    if (seen.has(decl)) return false;
    seen.add(decl);
    return usesOf(decl, bound).some((use) =>
      runsWhileCollecting(use, bound, seen),
    );
  }
  // Out of the file without meeting a function that defers it: module scope.
  return true;
};

/**
 * Every call that reads a `dist` path while the suite is collected, as
 * `file:line callee`.
 */
function collectionReads(bound: Bound): string[] {
  return [...bound.files.values()].flatMap((sf) =>
    nodesOf(sf)
      .filter((node): node is ts.CallExpression => ts.isCallExpression(node))
      .filter((call) => {
        const callee = call.expression.getText();
        return !PATH_ONLY.test(callee) && !DECLARES.test(callee);
      })
      .filter((call) =>
        call.arguments.some(
          (arg) =>
            // A function handed over is a body, judged where it runs, never
            // a value this call reads -- the rule `holdsBuiltPath` keeps for
            // functions nested deeper.
            !ts.isFunctionLike(arg) &&
            (holdsBuiltPath(arg) ||
              derivationOf(arg, bound).initializers.some(holdsBuiltPath)),
        ),
      )
      .filter((call) => runsWhileCollecting(call, bound))
      .map((call) => `${where(sf, call)} ${call.expression.getText()}`),
  );
}

/** Every `dist` path literal in `bound`, so the scan can prove it saw some. */
const builtLiterals = (bound: Bound): string[] =>
  [...bound.files.values()].flatMap((sf) =>
    nodesOf(sf)
      .filter(isBuiltPath)
      .map((node) => where(sf, node)),
  );

const readsIn = (sources: Record<string, string>) =>
  collectionReads(bind(new Map(Object.entries(sources))));

const SPEC = 'tests/e2e/fixture.spec.ts';
const HELPER = 'tests/e2e/fixture-helper.ts';
const HEAD = `import { test, expect } from '@playwright/test';\n`;

describe('what counts as reading the build while collecting', () => {
  it('a module-scope walk of dist/ is a read', () => {
    expect(
      readsIn({ [SPEC]: `${HEAD}const PAGES = filesUnder('dist', keep);` }),
    ).toEqual([`${SPEC}:2 filesUnder`]);
  });

  it('a ./dist path is the same path, and a name that merely starts with dist is not', () => {
    expect(
      readsIn({
        [SPEC]: `${HEAD}const RAW = readFileSync('./dist/404.html');\nconst NOTES = readFileSync('distance.txt');`,
      }),
    ).toEqual([`${SPEC}:2 readFileSync`]);
  });

  it('the same walk inside a test body is not', () => {
    expect(
      readsIn({
        [SPEC]: `${HEAD}test('t', () => { expect(filesUnder('dist', keep)).toBeTruthy(); });`,
      }),
    ).toEqual([]);
  });

  it('nor inside a hook, which also runs only when tests do', () => {
    expect(
      readsIn({
        [SPEC]: `${HEAD}test.beforeAll(() => { statSync('dist'); });`,
      }),
    ).toEqual([]);
  });

  it('a describe body runs while collecting, so a read there is one', () => {
    expect(
      readsIn({
        [SPEC]: `${HEAD}test.describe('d', () => {\n  const raw = readFileSync('dist/404.html', 'utf8');\n  test('t', () => expect(raw).toBeTruthy());\n});`,
      }),
    ).toEqual([`${SPEC}:3 readFileSync`]);
  });

  it('a path constant in a describe body is not a read; the test that reads it is deferred', () => {
    expect(
      readsIn({
        [SPEC]: `${HEAD}test.describe('d', () => {\n  const page404 = 'dist/404.html';\n  test('t', () => { readFileSync(page404, 'utf8'); });\n});`,
      }),
    ).toEqual([]);
  });

  it('a path constant read at module scope is a read, at the read', () => {
    expect(
      readsIn({
        [SPEC]: `${HEAD}const DIR = 'dist';\nconst PAGES = statSync(DIR);`,
      }),
    ).toEqual([`${SPEC}:3 statSync`]);
  });

  it('composing a path reads nothing', () => {
    expect(
      readsIn({
        [SPEC]: `${HEAD}const P = join('dist', '404.html');\ntest('t', () => { readFileSync(P); });`,
      }),
    ).toEqual([]);
  });

  it('...but reading the composed path at module scope does', () => {
    expect(
      readsIn({
        [SPEC]: `${HEAD}const P = join('dist', '404.html');\nconst RAW = readFileSync(P);`,
      }),
    ).toEqual([`${SPEC}:3 readFileSync`]);
  });

  it('a template path is a dist path too', () => {
    expect(
      readsIn({
        [SPEC]: `${HEAD}const f = 'x';\nconst RAW = readFileSync(\`dist/\${f}.html\`);`,
      }),
    ).toEqual([`${SPEC}:3 readFileSync`]);
  });

  it('a lazy helper called only from tests is not a read', () => {
    expect(
      readsIn({
        [SPEC]: `${HEAD}const built = () => filesUnder('dist', keep);\ntest('t', () => { expect(built()).toBeTruthy(); });`,
      }),
    ).toEqual([]);
  });

  it('the same helper called at module scope is, two hops away included', () => {
    expect(
      readsIn({
        [SPEC]: `${HEAD}const built = () => filesUnder('dist', keep);\nfunction pages() { return built(); }\nconst ALL = pages();`,
      }),
    ).toEqual([`${SPEC}:2 filesUnder`]);
  });

  it('follows an imported helper into the file that declares it', () => {
    expect(
      readsIn({
        [HELPER]: `export const built = () => filesUnder('dist', keep);`,
        [SPEC]: `${HEAD}import { built } from './fixture-helper';\nconst ALL = built();`,
      }),
    ).toEqual([`${HELPER}:1 filesUnder`]);
  });

  it('importing a helper is not calling it', () => {
    expect(
      readsIn({
        [HELPER]: `export const built = () => filesUnder('dist', keep);`,
        [SPEC]: `${HEAD}import { built } from './fixture-helper';\ntest('t', () => { built(); });`,
      }),
    ).toEqual([]);
  });

  it('a callback handed to a module-scope call runs with it, and is reported once, at the read', () => {
    // The outer call is handed a FUNCTION, not a path: what the callback does
    // is judged where it does it, so one read is one finding -- even when the
    // path reaches the read through a binding the callback declares.
    expect(
      readsIn({
        [SPEC]: `${HEAD}const ALL = ['a'].map(() => {\n  const p = 'dist/x.html';\n  return statSync(p);\n});`,
      }),
    ).toEqual([`${SPEC}:4 statSync`]);
  });

  it('a function inside an argument is judged where it runs, not as part of the argument', () => {
    expect(
      readsIn({
        [SPEC]: `${HEAD}register({ load: () => statSync('dist/x.html') });`,
      }),
    ).toEqual([`${SPEC}:2 statSync`]);
  });

  it('a helper that calls itself is judged, not followed forever', () => {
    expect(
      readsIn({
        [SPEC]: `${HEAD}function walk(n) { return n ? walk(n - 1) : statSync('dist'); }\ntest('t', () => { walk(2); });`,
      }),
    ).toEqual([]);
  });

  it('a title that starts with dist/ is a title, not a path', () => {
    expect(
      readsIn({
        [SPEC]: `${HEAD}test.describe('dist/404.html', () => {\n  test('dist/ is built', () => {});\n});`,
      }),
    ).toEqual([]);
  });

  it('a comment naming the read neither is one nor hides one', () => {
    expect(
      readsIn({
        [SPEC]: `${HEAD}// const PAGES = filesUnder('dist', keep);\nconst built = () => filesUnder('dist', keep);`,
      }),
    ).toEqual([]);
    expect(
      readsIn({
        [SPEC]: `${HEAD}// deliberately lazy: filesUnder('dist', keep)\nconst PAGES = filesUnder('dist', keep);`,
      }),
    ).toEqual([`${SPEC}:3 filesUnder`]);
  });
});

describe('collecting the suite never needs a build (#351)', () => {
  it('no file under tests/ reads dist/ while the suite is collected', () => {
    const bound = bindFiles(tsFilesUnder('tests'));
    const literals = builtLiterals(bound);
    expect(
      searched(collectionReads(bound), {
        of: literals,
        what: 'dist path literals under tests/',
      }),
      'a read of dist/ while collecting makes `playwright test --list` -- and ' +
        "so every filtered run's reconciliation -- fail on a checkout with no " +
        'build. Read it inside the test or hook that needs it.',
    ).toEqual([]);
    expect(
      floorBreach('collection-needs-no-build/dist-literals', literals.length),
    ).toBeUndefined();
  });
});
