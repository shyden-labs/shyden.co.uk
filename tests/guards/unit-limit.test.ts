import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { floorBreach } from '../floors';
import { filesUnder, nonEmpty, searched } from '../source-files';
import { nodesIn, parseSource, where } from '../unit/ast';
import { withoutTsComments } from '../unit/source-text';

/**
 * Nothing raises the unit suite's 1 s limit (#632, #629 AC4).
 *
 * The limit is `testTimeout: 1_000` and `hookTimeout: 1_000` in
 * `vitest.config.ts`, and nowhere else. Vitest lets a test lift its own limit
 * in a dozen ways, and a hook refuses only one of them in an edit. This guard
 * reads the PARSE TREE of every file under `tests/unit` and of every vitest
 * config, never their text, and refuses each:
 *
 *   - a third argument to `it` / `test` / `describe` (and `.only`, `.skip`,
 *     `.concurrent`, `.each(...)(…)`, `.each\`…\`(…)`, `.for`, `.runIf(…)`,
 *     `.extend(…)` results), or a second to `beforeEach` / `afterEach` /
 *     `beforeAll` / `afterAll`, whatever it is and whatever it resolves to;
 *   - an options object with `timeout` in any argument of those calls, or one
 *     that cannot be read (a spread, a computed key);
 *   - `testTimeout` or `hookTimeout` as a property anywhere, whose value is
 *     not the literal 1_000 (a named constant is resolved, and one that
 *     cannot be is refused), or at all outside `vitest.config.ts`;
 *   - `vi.setConfig(…)` / `vitest.setConfig(…)` with anything but an object
 *     literal of readable keys.
 *
 * A test-like call is found through an alias too: an import renamed from
 * `vitest`, and a `const` initialised from one (`const check = it`,
 * `const base = test.extend({...})`), resolved to a fixed point.
 *
 * Not judged here: the guards and integration suites' limits, which live on
 * their package.json commands (`guards-budget` and `integration-budget` pin
 * them), and the unit command itself (`unit-budget` pins it).
 */

const TEST_ROOTS = new Set(['it', 'test', 'describe', 'suite']);
const HOOK_ROOTS = new Set([
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
]);
const LIMIT_KEYS = new Set(['testTimeout', 'hookTimeout']);
/** The one place a limit is written, and the one value it may take. */
const CONFIG = 'vitest.config.ts';
const THE_LIMIT = 1_000;

/** The identifier a callee chain starts from: `it.each([…]).only` -> `it`. */
function rootName(node: ts.Expression): string | undefined {
  let current: ts.Expression = node;
  for (;;) {
    if (ts.isIdentifier(current)) return current.text;
    if (ts.isPropertyAccessExpression(current)) current = current.expression;
    else if (ts.isElementAccessExpression(current))
      current = current.expression;
    else if (ts.isCallExpression(current)) current = current.expression;
    else if (ts.isTaggedTemplateExpression(current)) current = current.tag;
    else if (ts.isParenthesizedExpression(current))
      current = current.expression;
    else if (ts.isNonNullExpression(current)) current = current.expression;
    else if (ts.isAsExpression(current)) current = current.expression;
    else return undefined;
  }
}

/** Every local name that stands for a test, group or hook function. */
function aliases(sf: ts.SourceFile): {
  tests: Set<string>;
  hooks: Set<string>;
  vi: Set<string>;
} {
  const tests = new Set(TEST_ROOTS);
  const hooks = new Set(HOOK_ROOTS);
  const vi = new Set(['vi', 'vitest']);
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (TEST_ROOTS.has(imported)) tests.add(element.name.text);
      if (HOOK_ROOTS.has(imported)) hooks.add(element.name.text);
      if (imported === 'vi' || imported === 'vitest') vi.add(element.name.text);
    }
  }
  const declarations = nodesIn(sf, ts.isVariableDeclaration).filter(
    (node): node is ts.VariableDeclaration =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined,
  );
  for (let grew = true; grew;) {
    grew = false;
    for (const declaration of declarations) {
      const name = (declaration.name as ts.Identifier).text;
      const root = rootName(declaration.initializer as ts.Expression);
      if (root === undefined) continue;
      const into =
        tests.has(root) && !tests.has(name)
          ? tests
          : hooks.has(root) && !hooks.has(name)
            ? hooks
            : undefined;
      if (into !== undefined) {
        into.add(name);
        grew = true;
      }
    }
  }
  return { tests, hooks, vi };
}

/** The number a `const NAME = 1_000` at the top level of the file spells. */
function constantValue(sf: ts.SourceFile, name: string): number | undefined {
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer !== undefined &&
        ts.isNumericLiteral(declaration.initializer)
      )
        return Number(declaration.initializer.text.replace(/_/g, ''));
    }
  }
  return undefined;
}

/** What a limit's value is, if it is a number or a constant that is one. */
function valueOf(sf: ts.SourceFile, node: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(node)) return Number(node.text.replace(/_/g, ''));
  if (ts.isIdentifier(node)) return constantValue(sf, node.text);
  return undefined;
}

const keyOf = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;

export interface Reading {
  /** Every unit judged: a test-like call, a limit property, a setConfig call. */
  readonly judged: readonly string[];
  readonly findings: readonly string[];
  /** The test-like calls among the units, for the cross-check. */
  readonly calls: number;
}

/**
 * Read one file. `isConfig` is true only for `vitest.config.ts`, the one home
 * of the limit.
 */
export function readLimits(
  file: string,
  source: string,
  isConfig: boolean,
): Reading {
  const sf = parseSource(source, file);
  const { tests, hooks, vi } = aliases(sf);
  const judged: string[] = [];
  const findings: string[] = [];
  const refuse = (node: ts.Node, what: string): void => {
    findings.push(
      `${where(sf, node)} -- ${what}. The unit limit is 1 s, written once in ` +
        `${CONFIG}; a unit test is never given more time (#632).`,
    );
  };
  let calls = 0;

  /** A property of an object argument/config that names or hides a limit. */
  const judgeProperties = (
    object: ts.ObjectLiteralExpression,
    options: { timeoutKey: boolean; strict: boolean },
  ): void => {
    for (const property of object.properties) {
      if (ts.isSpreadAssignment(property)) {
        if (options.strict)
          refuse(property, 'a spread in an options object hides its limit');
        continue;
      }
      const name = property.name;
      if (name === undefined) continue;
      const key = keyOf(name);
      if (key === undefined) {
        if (options.strict)
          refuse(
            property,
            'a computed key in an options object hides its limit',
          );
        continue;
      }
      if (key === 'timeout' && options.timeoutKey)
        refuse(property, 'a `timeout` option on a test or hook');
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const root = rootName(node.expression);
      const isTest = root !== undefined && tests.has(root);
      const isHook = root !== undefined && hooks.has(root);
      if (isTest || isHook) {
        // `it.each(table)` is the inner call: its callee is `it.each` and its
        // arguments are the table. Only the call that takes the callback, the
        // outer one, is a test.
        const callee = node.expression;
        const takesTable =
          ts.isPropertyAccessExpression(callee) &&
          ['each', 'for', 'runIf', 'skipIf', 'extend'].includes(
            callee.name.text,
          );
        if (!takesTable) {
          calls += 1;
          judged.push(`${where(sf, node)} ${isHook ? 'hook' : 'test'} call`);
          // `it(name, { timeout }, fn)` is the options-first form: its third
          // argument is the callback, and the options are judged below.
          const optionsFirst =
            !isHook &&
            node.arguments[1] !== undefined &&
            ts.isObjectLiteralExpression(node.arguments[1]);
          const extra = node.arguments
            .slice(isHook ? 1 : 2)
            .filter(
              (argument, index) =>
                !(
                  optionsFirst &&
                  index === 0 &&
                  (ts.isArrowFunction(argument) ||
                    ts.isFunctionExpression(argument))
                ),
            );
          for (const argument of extra)
            refuse(
              argument,
              `a ${isHook ? 'second' : 'third'} argument to \`${node.expression.getText(sf)}\`, ` +
                'which is a limit',
            );
          for (const argument of node.arguments)
            if (ts.isObjectLiteralExpression(argument))
              judgeProperties(argument, { timeoutKey: true, strict: true });
        } else if (callee.name.text === 'extend') {
          for (const argument of node.arguments)
            if (ts.isObjectLiteralExpression(argument))
              judgeProperties(argument, { timeoutKey: false, strict: false });
        }
      }
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'setConfig' &&
        ts.isIdentifier(callee.expression) &&
        vi.has(callee.expression.text)
      ) {
        judged.push(`${where(sf, node)} setConfig call`);
        const [argument] = node.arguments;
        if (argument === undefined || !ts.isObjectLiteralExpression(argument))
          refuse(
            node,
            '`setConfig` with an argument that is not an object literal',
          );
        else judgeProperties(argument, { timeoutKey: false, strict: true });
      }
    }
    if (
      ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node)
    ) {
      const key = keyOf(node.name);
      if (key !== undefined && LIMIT_KEYS.has(key)) {
        judged.push(`${where(sf, node)} ${key}`);
        const value = ts.isPropertyAssignment(node)
          ? valueOf(sf, node.initializer)
          : constantValue(sf, key);
        if (!isConfig) refuse(node, `\`${key}\` set outside ${CONFIG}`);
        else if (value !== THE_LIMIT)
          refuse(
            node,
            `\`${key}\` is ${value === undefined ? 'a value that cannot be resolved to a number' : value}, not ${THE_LIMIT}`,
          );
      }
    }
    ts.forEachChild(node, (child) => {
      visit(child);
    });
  };
  visit(sf);
  return { judged, findings, calls };
}

/**
 * The vitest configs that can set the unit suite's limit: the unit config
 * itself, and every config that extends it (the guards and integration
 * configs import it, so a limit written there is the unit limit's neighbour).
 * A config that does neither is another suite's (`vitest.ios.config.ts` runs
 * the real phone, over WebDriver, with its own limits), derived from the
 * imports, not named.
 */
const configFiles = (): string[] =>
  nonEmpty(
    readdirSync('.').filter((name) =>
      /^vitest(?:\..+)?\.config\.[cm]?[jt]s$/.test(name),
    ),
    'vitest configs at the repository root',
  )
    .filter(
      (name) =>
        name === CONFIG ||
        nodesIn(
          parseSource(readFileSync(name, 'utf8'), name),
          ts.isImportDeclaration,
        ).some(
          (node) =>
            ts.isImportDeclaration(node) &&
            ts.isStringLiteral(node.moduleSpecifier) &&
            /^\.\/vitest\.config(?:\.[cm]?[jt]s)?$/.test(
              node.moduleSpecifier.text,
            ),
        ),
    )
    .sort();

/** The unit population: every `.ts` file under `tests/unit` and every vitest config. */
const population = (): string[] => [
  ...filesUnder('tests/unit', (path) => /\.[cm]?tsx?$/.test(path)),
  ...configFiles(),
];

const readAll = () =>
  population().map((file) => {
    const source = readFileSync(file, 'utf8');
    return { file, source, ...readLimits(file, source, file === CONFIG) };
  });

const found = (source: string, file = 'tests/unit/case.test.ts') =>
  readLimits(file, source, file === CONFIG).findings;

describe('every form of a raised unit limit is read from the parse tree', () => {
  it('refuses a third argument to it', () => {
    expect(found("it('a', () => {}, 5000);")).toHaveLength(1);
  });

  it('refuses a third argument to test', () => {
    expect(found("test('a', () => {}, 5000);")).toHaveLength(1);
  });

  it('refuses a third argument to describe', () => {
    expect(found("describe('a', () => {}, 5000);")).toHaveLength(1);
  });

  it('refuses a second argument to beforeEach', () => {
    expect(found('beforeEach(() => {}, 5000);')).toHaveLength(1);
  });

  it('refuses a second argument to afterEach', () => {
    expect(found('afterEach(() => {}, 5000);')).toHaveLength(1);
  });

  it('refuses a second argument to beforeAll', () => {
    expect(found('beforeAll(() => {}, 5000);')).toHaveLength(1);
  });

  it('refuses a second argument to afterAll', () => {
    expect(found('afterAll(() => {}, 5000);')).toHaveLength(1);
  });

  it('refuses a third argument through .only', () => {
    expect(found("it.only('a', () => {}, 5000);")).toHaveLength(1);
  });

  it('refuses a third argument through .skip', () => {
    expect(found("it.skip('a', () => {}, 5000);")).toHaveLength(1);
  });

  it('refuses a third argument through .concurrent', () => {
    expect(found("it.concurrent('a', () => {}, 5000);")).toHaveLength(1);
  });

  it('refuses a third argument through .each(table)', () => {
    expect(found("it.each([1, 2])('a %s', () => {}, 5000);")).toHaveLength(1);
  });

  it('refuses a third argument through a tagged-template .each', () => {
    expect(found("it.each`a\n${1}`('a', () => {}, 5000);")).toHaveLength(1);
  });

  it('refuses a third argument through .for', () => {
    expect(found("it.for([1, 2])('a', () => {}, 5000);")).toHaveLength(1);
  });

  it('refuses a { timeout } options object as the second argument', () => {
    expect(found("it('a', { timeout: 5000 }, () => {});")).toHaveLength(1);
  });

  it('refuses a { timeout } options object as the last argument', () => {
    expect(found("it('a', () => {}, { timeout: 5000 });")).toHaveLength(2);
  });

  it('refuses a { timeout } object on a hook', () => {
    expect(found('beforeEach(() => {}, { timeout: 5000 });')).toHaveLength(2);
  });

  it('refuses an options object with a spread, which hides its limit', () => {
    expect(found("it('a', { ...opts }, () => {});")).toHaveLength(1);
  });

  it('refuses an options object with a computed key', () => {
    expect(found("it('a', { [key]: 1 }, () => {});")).toHaveLength(1);
  });

  it('refuses a named constant passed as the limit', () => {
    expect(
      found("const LIMIT = 5000;\nit('a', () => {}, LIMIT);"),
    ).toHaveLength(1);
  });

  it('refuses a limit through a name renamed on import', () => {
    expect(
      found(
        "import { it as check } from 'vitest';\ncheck('a', () => {}, 5000);",
      ),
    ).toHaveLength(1);
  });

  it('refuses a limit through a const alias', () => {
    expect(
      found("const check = it;\ncheck('a', () => {}, 5000);"),
    ).toHaveLength(1);
  });

  it('refuses a limit through an alias of an alias', () => {
    expect(
      found("const a = it;\nconst b = a.only;\nb('a', () => {}, 5000);"),
    ).toHaveLength(1);
  });

  it('refuses a limit through an extended test', () => {
    expect(
      found("const base = test.extend({});\nbase('a', () => {}, 5000);"),
    ).toHaveLength(1);
  });

  it('refuses testTimeout in a config object outside the config home', () => {
    expect(
      found('export default { test: { testTimeout: 1_000 } };'),
    ).toHaveLength(1);
  });

  it('refuses hookTimeout in a config object outside the config home', () => {
    expect(
      found('export default { test: { hookTimeout: 1_000 } };'),
    ).toHaveLength(1);
  });

  it('refuses a testTimeout shorthand outside the config home', () => {
    expect(
      found(
        'const testTimeout = 1_000;\nexport default { test: { testTimeout } };',
      ),
    ).toHaveLength(1);
  });

  it('refuses testTimeout above 1 000 in the config home', () => {
    expect(
      found('export default { test: { testTimeout: 30_000 } };', CONFIG),
    ).toHaveLength(1);
  });

  it('refuses hookTimeout above 1 000 in the config home', () => {
    expect(
      found('export default { test: { hookTimeout: 30_000 } };', CONFIG),
    ).toHaveLength(1);
  });

  it('refuses a named constant above 1 000 in the config home', () => {
    expect(
      found(
        'const SLOW = 30_000;\nexport default { test: { testTimeout: SLOW } };',
        CONFIG,
      ),
    ).toHaveLength(1);
  });

  it('refuses a value in the config home that cannot be resolved', () => {
    expect(
      found(
        'export default { test: { testTimeout: Number(process.env.T) } };',
        CONFIG,
      ),
    ).toHaveLength(1);
  });

  it('refuses a string-keyed limit outside the config home', () => {
    expect(
      found("export default { test: { 'testTimeout': 1_000 } };"),
    ).toHaveLength(1);
  });

  it('refuses vi.setConfig with a testTimeout', () => {
    expect(found('vi.setConfig({ testTimeout: 5000 });')).toHaveLength(1);
  });

  it('refuses vi.setConfig with a hookTimeout', () => {
    expect(found('vi.setConfig({ hookTimeout: 5000 });')).toHaveLength(1);
  });

  it('refuses vi.setConfig handed something that is not an object literal', () => {
    expect(found('vi.setConfig(options);')).toHaveLength(1);
  });

  it('refuses vi.setConfig through a renamed vi', () => {
    expect(
      found(
        "import { vi as v } from 'vitest';\nv.setConfig({ testTimeout: 5000 });",
      ),
    ).toHaveLength(1);
  });

  it('allows the limit as the config home spells it, and reads both units', () => {
    const reading = readLimits(
      CONFIG,
      'export default { test: { testTimeout: 1_000, hookTimeout: 1_000 } };',
      true,
    );
    expect(
      searched(reading.findings, { of: reading.judged, what: 'limit units' }),
    ).toEqual([]);
    expect(reading.judged).toHaveLength(2);
    expect(
      floorBreach('unit-limit/allowed-pair', reading.judged.length),
    ).toBeUndefined();
  });

  it('allows the limit as a named constant that is 1 000 in the config home', () => {
    const reading = readLimits(
      CONFIG,
      'const LIMIT = 1_000;\nexport default { test: { testTimeout: LIMIT, hookTimeout: LIMIT } };',
      true,
    );
    expect(
      searched(reading.findings, { of: reading.judged, what: 'limit units' }),
    ).toEqual([]);
    expect(reading.judged).toHaveLength(2);
    expect(
      floorBreach('unit-limit/allowed-constant', reading.judged.length),
    ).toBeUndefined();
  });

  it('allows ordinary tests, hooks and groups', () => {
    const reading = readLimits(
      'tests/unit/case.test.ts',
      "describe('g', () => {\n  beforeEach(() => {});\n  it.each([1])('a %s', () => {});\n  it('b', () => {});\n});",
      false,
    );
    expect(
      searched(reading.findings, { of: reading.judged, what: 'test calls' }),
    ).toEqual([]);
    expect(reading.calls).toBe(4);
    expect(
      floorBreach('unit-limit/allowed-ordinary', reading.judged.length),
    ).toBeUndefined();
  });

  it('does not read a limit spelled in a comment or a string', () => {
    const reading = readLimits(
      'tests/unit/case.test.ts',
      "// it('a', () => {}, 5000);\nconst s = \"it('a', () => {}, 5000)\";\nit('b', () => {});\n",
      false,
    );
    expect(
      searched(reading.findings, { of: reading.judged, what: 'test calls' }),
    ).toEqual([]);
    expect(reading.judged).toHaveLength(1);
    expect(
      floorBreach('unit-limit/not-in-comment-or-string', reading.judged.length),
    ).toBeUndefined();
  });
});

describe('the unit population holds no raised limit (#632)', () => {
  it('has none in any file under tests/unit or in any vitest config', () => {
    const readings = readAll();
    const findings = readings.flatMap(({ findings }) => findings);
    const files = readings.map(({ file }) => file);
    expect(
      searched(findings, { of: files, what: 'unit files and vitest configs' }),
      findings.join('\n'),
    ).toEqual([]);
    expect(floorBreach('unit-limit/files', files.length)).toBeUndefined();
  });

  it('judges the test calls and limit properties the files hold', () => {
    const readings = readAll();
    const units = readings.flatMap(({ judged }) => judged);
    expect(
      searched(units, { of: units, what: 'test calls and limit properties' }),
    ).toBe(units);
    expect(
      floorBreach('unit-limit/judged-units', units.length),
    ).toBeUndefined();
  });

  it('reads a test call in every file whose code plainly holds one', () => {
    const readings = readAll();
    const blind = readings
      .filter(
        ({ file, source, calls }) =>
          file.endsWith('.test.ts') &&
          calls === 0 &&
          /\b(?:it|test)(?:\.[a-z]+)*\s*\(/.test(withoutTsComments(source)),
      )
      .map(({ file }) => file);
    expect(searched(blind, { of: readings, what: 'files' })).toEqual([]);
    expect(
      floorBreach('unit-limit/files-read', readings.length),
    ).toBeUndefined();
  });

  it('finds the limit pair in the config home, and nowhere else', () => {
    const properties = readAll()
      .filter(({ judged }) =>
        judged.some((unit) => /(?:test|hook)Timeout$/.test(unit)),
      )
      .map(({ file, judged }) => ({
        file,
        count: judged.filter((unit) => /(?:test|hook)Timeout$/.test(unit))
          .length,
      }));
    expect(properties).toEqual([{ file: CONFIG, count: 2 }]);
  });
});
