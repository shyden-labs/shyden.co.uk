import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import {
  bind,
  callGraph,
  codeWithoutLiterals,
  derivationOf,
  parseSource,
  type Bound,
} from './ast';
import { scratchDir } from '../scratch-dir';

/**
 * The resolver both meta-guards stand on (#184).
 *
 * `declarationsIn` used to key every `const` in a file by bare name, so the
 * last declaration won in every scope. `supply-chain.test.ts` declares
 * `const config` four times, and `anchored-presence` read two stripped
 * assertions as raw because line 258's `parseCleanYaml(...)` overwrote the
 * `configBody()` each of those tests actually uses. Every fixture below is a
 * place where a name-keyed or hand-rolled resolver answers differently from
 * the language itself.
 */

/** One fixture, bound, failing loudly if the program dropped it. */
function fixture(source: string): { bound: Bound; sf: ts.SourceFile } {
  const bound = bind(new Map([['fixture.ts', source]]));
  const sf = bound.files.get('fixture.ts');
  if (!sf) throw new Error('the fixture was not bound');
  return { bound, sf };
}

/** The argument of every `use(...)` call in a file, in source order. */
function useArguments(sf: ts.SourceFile): ts.Expression[] {
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'use' &&
      node.arguments[0]
    )
      found.push(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** What each `use(name)` in a file resolves to, as source text. */
function resolvedIn(bound: Bound, sf: ts.SourceFile): (string | undefined)[] {
  return useArguments(sf).map((arg) => {
    if (!ts.isIdentifier(arg))
      throw new Error(`use() takes a bare name, got ${arg.getText()}`);
    return bound.initializerOf(arg)?.getText();
  });
}

const resolved = (source: string): (string | undefined)[] => {
  const { bound, sf } = fixture(source);
  return resolvedIn(bound, sf);
};

/** Every name each `use(...)` derives from. A set: the order is the walk's. */
const derivedNames = (source: string): Set<string>[] => {
  const { bound, sf } = fixture(source);
  return useArguments(sf).map((arg) => new Set(derivationOf(arg, bound).names));
};

describe('a name resolves to the declaration the language binds it to', () => {
  it('gives same-named consts in sibling tests their own initializers', () => {
    expect(
      resolved(`
        it('a', () => { const config = 'first'; use(config); });
        it('b', () => { const config = 'second'; use(config); });
      `),
    ).toEqual(["'first'", "'second'"]);
  });

  it('lets an inner declaration shadow an outer one only inside its scope', () => {
    expect(
      resolved(`
        const config = 'outer';
        function inner() { const config = 'inner'; use(config); }
        use(config);
      `),
    ).toEqual(["'inner'", "'outer'"]);
  });

  it('still resolves a name declared only in an enclosing scope', () => {
    expect(
      resolved(`
        const config = 'outer';
        it('a', () => { use(config); });
      `),
    ).toEqual(["'outer'"]);
  });

  it('stops at a parameter instead of falling through to an outer const', () => {
    expect(
      resolved(`
        const config = 'outer';
        const read = (config: string) => use(config);
      `),
    ).toEqual([undefined]);
  });

  it('stops at an import instead of reaching into another scope', () => {
    expect(
      resolved(`
        import { config } from './elsewhere';
        it('a', () => { const config = 'local'; });
        use(config);
      `),
    ).toEqual([undefined]);
  });

  it('stops at a function declaration of the same name', () => {
    expect(
      resolved(`
        const config = 'outer';
        it('a', () => { function config() { return 'fn'; } use(config); });
      `),
    ).toEqual([undefined]);
  });

  it('answers with the whole source when it cannot read its shape', () => {
    // `load()` passes no function, so there is no object literal to take a
    // property from. The binding answers with `load()` itself, never with
    // nothing: a name answered with nothing is judged by no derivation, and
    // `const { specs, sites } = scan()` let an absence over `sites` pass
    // unproved (#446 AC6). Nor with an OUTER `config`, which is what falling
    // through to the name would do (#184).
    expect(
      resolved(`
        const config = 'outer';
        it('a', () => { const { config } = load(); use(config); });
      `),
    ).toEqual(['load()']);
  });

  it('resolves a destructured binding to its own property', () => {
    // #185. The binding answers with the property that builds IT.
    expect(
      resolved(`
        it('a', () => { const { readings } = { readings: mine(), allowed: theirs() }; use(readings); });
      `),
    ).toEqual(['mine()']);
  });

  it("does not let a sibling's derivation leak into a binding", () => {
    // The other direction, and the reason #184 stopped here at all: following
    // the whole source gave `readings` the expression that builds `allowed`,
    // and `absence-liveness` then called an assertion over `readings` a
    // collector it is not.
    const both = resolved(`
      it('a', () => {
        const { readings, allowed } = { readings: mine(), allowed: [].filter(f) };
        use(readings);
        use(allowed);
      });
    `);
    expect(both).toEqual(['mine()', '[].filter(f)']);
  });

  it('follows a call whose function returns one object literal', () => {
    // The shape every real site is written in:
    // `await page.evaluate(() => ({ allowed, readings }))`.
    expect(
      resolved(`
        it('a', () => { const { readings } = run(() => ({ readings: mine(), allowed: theirs() })); use(readings); });
      `),
    ).toEqual(['mine()']);
  });

  it('answers a function that returns more than one shape with the whole call', () => {
    // Two returns mean the property is built two ways, and answering with
    // one of them would be an inference dressed as a resolution. So the
    // binding answers with the call, which holds both (#446 AC6).
    expect(
      resolved(`
        it('a', () => {
          const { readings } = run(() => { if (x) return { readings: mine() }; return { readings: other() }; });
          use(readings);
        });
      `),
    ).toEqual([
      'run(() => { if (x) return { readings: mine() }; return { readings: other() }; })',
    ]);
  });

  it('resolves a shorthand property to the variable, not to the property', () => {
    const { bound, sf } = fixture(`
      const config = 'value';
      use({ config });
    `);
    const [arg] = useArguments(sf);
    if (!arg || !ts.isObjectLiteralExpression(arg))
      throw new Error('the fixture no longer passes an object literal');
    const [property] = arg.properties;
    if (!property || !ts.isShorthandPropertyAssignment(property))
      throw new Error('the fixture no longer uses a shorthand property');
    expect(bound.initializerOf(property.name)?.getText()).toBe("'value'");
  });

  it('keeps top-level declarations in different files apart', () => {
    // A file with no import or export is a SCRIPT to TypeScript, and a
    // script's top-level names share one global scope. These are two such
    // files, which is exactly what a fixture usually is.
    const bound = bind(
      new Map([
        ['a.ts', `const config = 'a'; use(config);`],
        ['b.ts', `const config = 'b'; use(config);`],
      ]),
    );
    const inFile = (name: string) => {
      const sf = bound.files.get(name);
      if (!sf) throw new Error(`${name} was not bound`);
      return resolvedIn(bound, sf);
    };
    expect([inFile('a.ts'), inFile('b.ts')]).toEqual([["'a'"], ["'b'"]]);
  });

  it('stops at an import even when the file it names is bound', () => {
    // `declarationOf` below follows the import; this must not. Both
    // meta-guards derive through `initializerOf`, and an import followed
    // into a helper module would hand them initializers they never judged.
    const bound = bind(
      new Map([
        ['tests/e2e/harness.ts', `export const ORIGIN = 'https://a.test';`],
        [
          'tests/e2e/review.spec.ts',
          `import { ORIGIN } from './harness'; use(ORIGIN);`,
        ],
      ]),
    );
    const sf = bound.files.get('tests/e2e/review.spec.ts');
    if (!sf) throw new Error('the spec was not bound');
    expect(resolvedIn(bound, sf)).toEqual([undefined]);
  });
});

describe('an import resolves to the declaration its own file makes', () => {
  /**
   * What the first `use(name)` in `file` names, across files bound together.
   * Keyed the way `bindFiles` keys the real scan: paths relative to the repo,
   * which is the shape that answered `unknown` for every import (#215) --
   * TypeScript resolves a module to an ABSOLUTE path and asked for that.
   */
  function declarationIn(
    files: Record<string, string>,
    file: string,
  ): ts.Declaration | undefined {
    const bound = bind(new Map(Object.entries(files)));
    const sf = bound.files.get(file);
    if (!sf) throw new Error(`${file} was not bound`);
    const [arg] = useArguments(sf);
    if (!arg || !ts.isIdentifier(arg))
      throw new Error(`${file} no longer calls use() with a bare name`);
    return bound.declarationOf(arg);
  }

  const HARNESS = `export const ORIGIN = 'https://evidence.test';`;

  it('follows an import into the file that exports it', () => {
    const declaration = declarationIn(
      {
        'tests/e2e/harness.ts': HARNESS,
        'tests/e2e/review.spec.ts': `import { ORIGIN } from './harness'; use(ORIGIN);`,
      },
      'tests/e2e/review.spec.ts',
    );
    if (!declaration || !ts.isVariableDeclaration(declaration))
      throw new Error(`reached ${declaration?.getText()}, not the const`);
    expect([
      declaration.getSourceFile().fileName,
      declaration.initializer?.getText(),
    ]).toEqual(['tests/e2e/harness.ts', "'https://evidence.test'"]);
  });

  it('follows a renamed import through a re-export', () => {
    const declaration = declarationIn(
      {
        'tests/e2e/harness.ts': HARNESS,
        'tests/e2e/index.ts': `export { ORIGIN } from './harness';`,
        'tests/e2e/review.spec.ts': `import { ORIGIN as BASE } from './index'; use(BASE);`,
      },
      'tests/e2e/review.spec.ts',
    );
    expect(declaration?.getSourceFile().fileName).toBe('tests/e2e/harness.ts');
  });

  it('answers the import itself when the file it names was not bound', () => {
    const declaration = declarationIn(
      {
        'tests/e2e/review.spec.ts': `import { SITE } from '../../src/site'; use(SITE);`,
      },
      'tests/e2e/review.spec.ts',
    );
    expect(declaration && ts.isImportSpecifier(declaration)).toBe(true);
  });

  it('answers a parameter rather than an outer const of the same name', () => {
    const declaration = declarationIn(
      {
        'fixture.ts': `const url = 'https://outer.test'; const go = (url: string) => use(url);`,
      },
      'fixture.ts',
    );
    expect(declaration && ts.isParameter(declaration)).toBe(true);
  });

  it('answers nothing for a name no bound file declares', () => {
    expect(
      declarationIn({ 'fixture.ts': `use(undeclared);` }, 'fixture.ts'),
    ).toBeUndefined();
  });
});

describe('an expression derives from what its own scope binds', () => {
  it('follows an assertion through the declaration in its own test', () => {
    // The shape measured at supply-chain.test.ts:206.
    expect(
      derivedNames(`
        const configBody = () => withoutYamlComments(dependabot());
        it('watches npm', () => { const config = configBody(); use(config); });
        it('parses it', () => { const config = parseCleanYaml(dependabot()); });
      `),
    ).toEqual([
      new Set(['config', 'configBody', 'withoutYamlComments', 'dependabot']),
    ]);
  });

  it('takes no roots from type positions', () => {
    expect(
      derivedNames(`
        const cast = load() as { updates: string; ignore: Rule[] };
        const checked = make() satisfies Shape;
        const typed = (input: Input): Output => input;
        use(cast); use(checked); use(typed);
      `),
    ).toEqual([
      new Set(['cast', 'load']),
      new Set(['checked', 'make']),
      new Set(['typed', 'input']),
    ]);
  });

  it('keeps the base of a class expression, which is a value, not a type', () => {
    expect(
      derivedNames(`
        const Base = make();
        const Derived = class extends Base {};
        use(Derived);
      `),
    ).toEqual([new Set(['Derived', 'Base', 'make'])]);
  });

  it('reports every initializer it followed, in the order reached', () => {
    const { bound, sf } = fixture(`
      const found = [];
      const view = found;
      use(view);
    `);
    const [arg] = useArguments(sf);
    if (!arg) throw new Error('the fixture no longer calls use()');
    expect(
      derivationOf(arg, bound).initializers.map((init) => init.getText()),
    ).toEqual(['found', '[]']);
  });

  it('terminates on bindings that refer to each other', () => {
    expect(
      derivedNames(`
        let a = b;
        let b = a;
        use(a);
      `),
    ).toEqual([new Set(['a', 'b'])]);
  });
});

describe('a derivation stops where it is told, and names what it cannot see into (#225)', () => {
  const isDecode = (call: ts.CallExpression): boolean =>
    ts.isIdentifier(call.expression) && call.expression.text === 'decode';

  it('does not enter a call it is told to stop at, callee included', () => {
    const { bound, sf } = fixture(`
      const text = read();
      const data = decode(text);
      use(data);
      use(text + decode(read()).size);
    `);
    expect(
      useArguments(sf).map(
        (arg) => new Set(derivationOf(arg, bound, { stopAt: isDecode }).names),
      ),
    ).toEqual([new Set(['data']), new Set(['text', 'read'])]);
    // Told nothing, the same walk enters every call, as it always has.
    expect(derivedNames('const data = decode(read()); use(data);')).toEqual([
      new Set(['data', 'decode', 'read']),
    ]);
  });

  it('names the bindings it could not follow, and none that it did', () => {
    const { bound, sf } = fixture(`
      import { load } from './elsewhere';
      function helper() { return 1; }
      const local = (p: string) => load(helper(), p);
      use(local('x') + missing);
    `);
    const [arg] = useArguments(sf);
    if (!arg) throw new Error('the fixture no longer calls use()');
    const { names, opaque } = derivationOf(arg, bound);
    expect(new Set(names)).toEqual(
      new Set(['local', 'load', 'helper', 'p', 'missing']),
    );
    // An import, a function declaration, a parameter and an unbound name
    // hold no initializer; `local` held one, and the walk went inside it.
    expect(new Set(opaque)).toEqual(
      new Set(['load', 'helper', 'p', 'missing']),
    );
  });
});

describe('a parameter binds its name, like any other local (#277)', () => {
  /**
   * `callGraph` reads its files from disk, so the fixture is on disk. Two
   * files, one name: a module-scope `lines` that reads a file, and three
   * files away a PARAMETER called `lines` that is handed a string.
   *
   * Before this, only `const` bound a name, so the parameter fell through to
   * the by-bare-name fallback and inherited the reader. Two behavioural
   * absence assertions in `workflow-jobs.test.ts` -- input written beside
   * them -- were reported as needing a discovery control, which is the false
   * alarm that gets a working control deleted.
   */
  const corpus = () => {
    const dir = scratchDir('ast-binding-');
    const reader = join(dir, 'reader.ts');
    const user = join(dir, 'user.ts');
    writeFileSync(
      reader,
      "const lines = (file: string) => readFileSync(file, 'utf8').split('\n');\n" +
        'export const count = (f: string) => lines(f).length;\n',
    );
    writeFileSync(
      user,
      'export const onlyJob = (lines: string) => parse(`jobs:\n${lines}`);\n',
    );
    return { reader, user };
  };

  it('does not give a parameter the property of a same-named reader', () => {
    const { reader, user } = corpus();
    const reached = callGraph([reader, user]).close(new Set(['readFileSync']));
    // One name, two files, opposite answers -- which is the whole claim.
    // The `true` is also the positive control: a graph that resolved nothing
    // at all would satisfy the `false` for a reason of its own.
    expect(reached.reaches(reader, 'lines')).toBe(true);
    expect(reached.reaches(user, 'lines')).toBe(false);
  });
});

describe('a name resolves through the import that binds it, or the binding that makes it (#477)', () => {
  /**
   * `anchored-presence` counted two assertions over raw file text that read
   * none, found by #477's text reading of the same population: a `config`
   * imported from `playwright.config.ts`, outside the graph, and a `source`
   * destructured in a `for...of` over string literals. Neither is declared
   * locally, so each fell through to the union of every same-named function
   * in the suite, and some `config` and some `source` there read a file.
   */
  const corpus = () => {
    const dir = scratchDir('ast-import-');
    const file = (name: string, text: string) => {
      const path = join(dir, name);
      writeFileSync(path, text);
      return path;
    };
    return {
      reader: file(
        'reader.ts',
        "export const load = (f: string) => readFileSync(f, 'utf8');\n" +
          "export function config() { return readFileSync('c', 'utf8'); }\n" +
          "export function source() { return readFileSync('s', 'utf8'); }\n",
      ),
      pure: file('pure.ts', 'export const load = (s: string) => s.trim();\n'),
      fromReader: file(
        'from-reader.ts',
        "import { load } from './reader';\nexport const a = load('x');\n",
      ),
      fromPure: file(
        'from-pure.ts',
        "import { load } from './pure';\nexport const b = load('x');\n",
      ),
      aliased: file(
        'aliased.ts',
        "import { load as fetchText } from './reader';\nexport const c = fetchText('x');\n",
      ),
      outside: file(
        'outside.ts',
        "import config from '../not-in-the-graph';\nexport const d = config.x;\n",
      ),
      destructured: file(
        'destructured.ts',
        "for (const [source] of [['a']]) use(source);\n",
      ),
    };
  };
  const reached = (files: Record<string, string>) =>
    callGraph(Object.values(files)).close(new Set(['readFileSync']));

  it('follows an import to the module it names', () => {
    const files = corpus();
    expect(reached(files).reaches(files.fromReader, 'load')).toBe(true);
  });

  it('does not follow an import to a same-named function elsewhere', () => {
    const files = corpus();
    expect(reached(files).reaches(files.fromPure, 'load')).toBe(false);
  });

  it('follows an aliased import under its local name', () => {
    const files = corpus();
    expect(reached(files).reaches(files.aliased, 'fetchText')).toBe(true);
  });

  it('gives an import from outside the graph nothing inside it', () => {
    const files = corpus();
    // The positive control: the same name, declared in the graph, reads.
    expect(reached(files).reaches(files.reader, 'config')).toBe(true);
    expect(reached(files).reaches(files.outside, 'config')).toBe(false);
  });

  it('binds a destructured name locally', () => {
    const files = corpus();
    expect(reached(files).reaches(files.reader, 'source')).toBe(true);
    expect(reached(files).reaches(files.destructured, 'source')).toBe(false);
  });
});

describe('code without its literals is what a text cross-check reads (#477)', () => {
  // A cross-check counting a construct in raw text is satisfied by a string,
  // a template or a regex that spells it: the guards' own fixtures do. The
  // parse tree, not a quote-tracking scanner, decides what a literal is.
  const blanked = (source: string): string =>
    codeWithoutLiterals(parseSource(source));

  it('keeps code that is not a literal as it is written', () => {
    expect(blanked('expect(a).toEqual([]);')).toBe('expect(a).toEqual([]);');
  });

  it('blanks a string literal that spells a matcher', () => {
    expect(blanked("const s = 'expect(a).toEqual([])';")).toBe('const s = "";');
  });

  it('blanks a template with no substitution', () => {
    expect(blanked('const s = `expect(a).toHaveLength(0)`;')).toBe(
      'const s = "";',
    );
  });

  it('blanks a template whole, its substitutions with it', () => {
    expect(blanked('const s = `a ${"b"} ${c.toHaveLength(0)} d`; go();')).toBe(
      'const s = ""; go();',
    );
  });

  it('blanks a regular expression literal', () => {
    expect(blanked(String.raw`const r = /\.toEqual\(\[\]\)/g;`)).toBe(
      'const r = "";',
    );
  });

  it('removes a comment that spells a matcher', () => {
    const out = blanked('// expect(a).toEqual([])\nconst b = 1;');
    expect(out).toContain('const b = 1;');
    expect(out).not.toContain('toEqual');
  });

  it('keeps code after a string a scanner would read as a comment', () => {
    expect(blanked("const s = '// x'; expect(b).toHaveLength(0);")).toBe(
      'const s = ""; expect(b).toHaveLength(0);',
    );
  });

  it('keeps code after a regex holding a quote', () => {
    const out = blanked(`const r = /['"]/g; // gone\nexpect(c).toEqual([]);`);
    expect(out).toContain('const r = "";');
    expect(out).toContain('expect(c).toEqual([]);');
    expect(out).not.toContain('gone');
  });
});
