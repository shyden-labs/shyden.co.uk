import { convert } from 'ast-v8-to-istanbul';
import { describe, expect, it } from 'vitest';
import {
  addStatements,
  isImportedDeclarator,
  programOf,
  withImportedDeclarators,
} from '../coverage-declarators.mjs';

/**
 * A declarator a file writes from an imported binding's property,
 * `const home = env.HOME` with `env` imported, is counted (#928).
 * Vite's SSR transform writes it `__vite_ssr_import_0__.env.HOME`, and
 * coverage-v8 ignores every declarator of that shape as one of Vite's own
 * import bindings, so no report ever counted it.
 */

/** The declarator ESTree node for `const <id> = <init>`. */
const declarator = (id: string, init: unknown) => ({
  type: 'VariableDeclarator',
  id: { type: 'Identifier', name: id },
  init,
});
const name = (n: string) => ({ type: 'Identifier', name: n });
const member = (object: unknown, property: string) => ({
  type: 'MemberExpression',
  object,
  property: name(property),
});

describe('isImportedDeclarator: the shape coverage-v8 drops (#928)', () => {
  it('holds for a declarator read from an imported binding’s property', () => {
    expect(
      isImportedDeclarator(
        declarator(
          'home',
          member(member(name('__vite_ssr_import_0__'), 'env'), 'HOME'),
        ),
      ),
    ).toBe(true);
  });

  it('leaves out Vite’s own import binding', () => {
    expect(
      isImportedDeclarator(
        declarator(
          '__vite_ssr_import_1__',
          member(member(name('__vite_ssr_import_0__'), 'a'), 'b'),
        ),
      ),
    ).toBe(false);
  });

  it('leaves out a read of a local binding, which coverage-v8 counts', () => {
    expect(
      isImportedDeclarator(
        declarator('home', member(member(name('local'), 'env'), 'HOME')),
      ),
    ).toBe(false);
  });

  it('leaves out a binding read whole, which coverage-v8 counts', () => {
    expect(
      isImportedDeclarator(
        declarator('env', member(name('__vite_ssr_import_0__'), 'env')),
      ),
    ).toBe(false);
  });

  it('leaves out a declarator with no initialiser, and any other node', () => {
    expect([
      isImportedDeclarator(declarator('x', null)),
      isImportedDeclarator({ type: 'ExpressionStatement' }),
    ]).toEqual([false, false]);
  });
});

/** One file's coverage, as remapCoverage returns it. */
const fileCoverage = (
  statements: Record<string, { line: number; count: number }>,
) => ({
  path: '/repo/src/k.ts',
  statementMap: Object.fromEntries(
    Object.entries(statements).map(([id, { line }]) => [
      id,
      { start: { line, column: 0 }, end: { line, column: 9 } },
    ]),
  ),
  s: Object.fromEntries(
    Object.entries(statements).map(([id, { count }]) => [id, count]),
  ),
  fnMap: {},
  f: {},
  branchMap: {},
  b: {},
});

describe('addStatements: the dropped declarators join the report (#928)', () => {
  it('appends each after the file’s own statements, keeping theirs', () => {
    const into = {
      '/repo/src/k.ts': fileCoverage({ 0: { line: 1, count: 1 } }),
    };
    const from = {
      '/repo/src/k.ts': fileCoverage({ 0: { line: 3, count: 0 } }),
    };
    const merged = addStatements(into, from)['/repo/src/k.ts'];
    expect([merged?.statementMap, merged?.s]).toEqual([
      {
        0: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } },
        1: { start: { line: 3, column: 0 }, end: { line: 3, column: 9 } },
      },
      { 0: 1, 1: 0 },
    ]);
  });

  it('refuses statements for a file the report does not hold, naming it', () => {
    expect(() =>
      addStatements(
        {},
        { '/repo/src/k.ts': fileCoverage({ 0: { line: 3, count: 0 } }) },
      ),
    ).toThrow(
      'coverage-declarators: /repo/src/k.ts has declarators to count but no coverage of its own',
    );
  });
});

/**
 * Vitest's own transform of a planted file (captured 2026-10-30 with vite
 * 8.3.4 and vitest 5.0.5, `.superpowers/sdd/928/probe.mjs`):
 *
 *   import { env } from 'node:process';
 *   export function never() { const home = env.HOME; return home; }
 *   export function called() { const path = env.PATH; return path; }
 *   called();
 *
 * on seven lines of its own, `const home` on line 3, `const path` on line 7.
 */
const TRANSFORMED = {
  code: [
    '__vite_ssr_exportName__("never", () => { try { return never } catch {} });',
    '__vite_ssr_exportName__("called", () => { try { return called } catch {} });',
    'const __vite_ssr_import_0__ = await __vite_ssr_import__("node:process", {"importedNames":["env"]});',
    '',
    'function never() {',
    '\tconst home = __vite_ssr_import_0__.env.HOME;',
    '\treturn home;',
    '};',
    'function called() {',
    '\tconst path = __vite_ssr_import_0__.env.PATH;',
    '\treturn path;',
    '};',
    'called();',
    '',
  ].join('\n'),
  map: {
    version: 3,
    sources: ['k.ts'],
    names: [],
    mappings:
      ';;AAAA;;AACO,SAAS,QAAQ;CACtB,MAAM,OAAO,0BAAI;CACjB,OAAO;AACT;AACO,SAAS,SAAS;CACvB,MAAM,OAAO,0BAAI;CACjB,OAAO;AACT;AACA,OAAO',
  },
};

/** V8's counts on the transform: the script once, `never` never, `called` once. */
const functionsCounted = () => {
  const { code } = TRANSFORMED;
  const range = (start: string, count: number) => {
    const startOffset = code.indexOf(start);
    return {
      startOffset,
      endOffset: code.indexOf('};', startOffset) + 2,
      count,
    };
  };
  return [
    {
      functionName: '',
      isBlockCoverage: true,
      ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
    },
    {
      functionName: 'never',
      isBlockCoverage: true,
      ranges: [range('function never', 0)],
    },
    {
      functionName: 'called',
      isBlockCoverage: true,
      ranges: [range('function called', 1)],
    },
  ];
};

describe('withImportedDeclarators: a provider whose report counts them (#928)', () => {
  it('counts the never-run declarator unrun and the run one run, on their own lines', async () => {
    const provider = withImportedDeclarators(
      {
        // coverage-v8's own conversion, which drops both declarators.
        remapCoverage: async (..._args: unknown[]) => ({
          '/repo/src/k.ts': fileCoverage({ 0: { line: 10, count: 1 } }),
        }),
      },
      { parse: programOf, convert },
    );
    const report = await provider.remapCoverage(
      'file:///repo/src/k.ts',
      0,
      TRANSFORMED,
      functionsCounted(),
    );
    const k = report['/repo/src/k.ts'];
    expect(
      Object.entries(k?.statementMap ?? {})
        .map(
          ([id, location]) =>
            `${(location as { start: { line: number } }).start.line}=${k?.s[id]}`,
        )
        .toSorted(),
    ).toEqual(['10=1', '3=0', '7=1']);
  });

  it('refuses a provider with no remapCoverage, naming it', () => {
    expect(() =>
      withImportedDeclarators({}, { parse: programOf, convert }),
    ).toThrow(
      'coverage-declarators: the V8 provider has no remapCoverage; a Vitest upgrade changed it, so re-check tests/coverage-declarators.mjs',
    );
  });

  it('leaves a file coverage-v8 could not parse as it reported it', async () => {
    const provider = withImportedDeclarators(
      { remapCoverage: async (..._args: unknown[]) => ({}) },
      { parse: programOf, convert },
    );
    expect(
      await provider.remapCoverage(
        'file:///repo/src/k.ts',
        0,
        TRANSFORMED,
        functionsCounted(),
      ),
    ).toEqual({});
  });
});
