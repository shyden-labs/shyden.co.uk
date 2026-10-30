import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { nonEmpty, searched } from '../source-files';
import { nodesIn, parseSource, where } from './ast';

/**
 * A Vitest config names the file of every relative module it imports (#680).
 *
 * Vite loads a config through its own loader, and the native loader it plans
 * to make the default cannot resolve `./tests/setup-files` without its
 * extension: until then it prints a warning on every run, the warning names
 * only the first site, and nothing fails on it. Read from each config's parse
 * tree, so an import written in a comment is not one, and the configs are
 * found on disk, so a config added later is judged the day it appears.
 */
const CONFIGS = nonEmpty(
  readdirSync('.')
    .filter((name) => /^vitest(?:\..+)?\.config\.[cm]?[jt]s$/.test(name))
    .sort(),
  'vitest configs at the repository root',
);

/** A specifier that ends in a file extension Vite's loader can resolve. */
const NAMES_ITS_FILE = /\.(?:[cm]?[jt]sx?|json)$/;

/** Every relative module a config imports or re-exports, and those that name no file. */
export function relativeImports(
  file: string,
  source: string,
): { imports: string[]; bare: string[] } {
  const sf = parseSource(source, file);
  const imports = nodesIn(
    sf,
    (node): node is ts.ImportDeclaration | ts.ExportDeclaration =>
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node),
  )
    .map((node) => node as ts.ImportDeclaration | ts.ExportDeclaration)
    .filter(
      (node) =>
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.startsWith('.'),
    )
    .map(
      (node) =>
        `${where(sf, node)} ${(node.moduleSpecifier as ts.StringLiteral).text}`,
    );
  return {
    imports,
    bare: imports.filter((unit) => !NAMES_ITS_FILE.test(unit)),
  };
}

describe('the reader of a config import', () => {
  it('finds a relative import that names no file', () => {
    expect(
      relativeImports('vitest.x.config.ts', "import a from './a';").bare,
    ).toHaveLength(1);
  });

  it('finds a relative re-export that names no file', () => {
    expect(
      relativeImports('vitest.x.config.ts', "export { a } from '../a';").bare,
    ).toHaveLength(1);
  });

  it('passes a relative import that names its file, and leaves a package alone', () => {
    const reading = relativeImports(
      'vitest.x.config.ts',
      "import { defineConfig } from 'vitest/config';\nimport a from './a.ts';\n// import b from './b';\n",
    );
    expect({ imports: reading.imports.length, bare: reading.bare }).toEqual({
      imports: 1,
      bare: [],
    });
  });
});

describe('every vitest config names the files it imports (#680)', () => {
  it('has no relative import without its extension', () => {
    const readings = CONFIGS.map((file) =>
      relativeImports(file, readFileSync(file, 'utf8')),
    );
    const imports = readings.flatMap(({ imports }) => imports);
    const bare = readings.flatMap(({ bare }) => bare);
    expect(
      searched(bare, {
        of: imports,
        what: 'relative imports in vitest configs',
      }),
      bare.join('\n'),
    ).toEqual([]);
    expect(
      floorBreach('config-imports/relative-imports', imports.length),
    ).toBeUndefined();
  });

  // Hiding the warning is not the fix: the variable that silences it is set
  // nowhere a run takes its environment from in this repository.
  it('never silences the warning', () => {
    const homes = [
      'package.json',
      ...CONFIGS,
      ...nonEmpty(readdirSync('.github/workflows'), 'workflow files').map(
        (name) => `.github/workflows/${name}`,
      ),
    ];
    const silenced = homes.filter((file) =>
      readFileSync(file, 'utf8').includes('VITE_CONFIG_NATIVE_IGNORE_WARNING'),
    );
    expect(
      searched(silenced, {
        of: homes,
        what: 'files a run takes its environment from',
      }),
    ).toEqual([]);
    expect(
      floorBreach('config-imports/environment-homes', homes.length),
    ).toBeUndefined();
  });
});
