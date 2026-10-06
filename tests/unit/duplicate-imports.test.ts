import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { filesUnder, searched } from '../source-files';
import { parseSource } from './ast';
import { astroCodeViews, withoutTsComments } from './source-text';
import { floorBreach } from '../floors';

/**
 * No module imports the same specifier twice (#390 F59).
 *
 * Eight files had grown a second `import { … } from '../lib/i18n'` beside the
 * first, each time a name was added by appending a line rather than joining
 * the existing list. It changes nothing at runtime, which is why nothing
 * failed. It does mean a reader has to check two lines to know what a file
 * takes from a module, and a removal from one leaves the other to rot.
 *
 * Two forms are allowed, because each says something a merged import could
 * not. A namespace import (`import * as grouping`) sits beside named ones in
 * the tests that check every export is covered. An `import type` stays
 * separate from a value import of the same module. A side-effect import has no
 * bindings to merge.
 *
 * Read from the AST, never the text: an import spelled inside a fixture string
 * is not an import, and a multi-line import is one declaration.
 */
function readImports(sf: ts.SourceFile): {
  read: string[];
  repeated: string[];
} {
  const read: string[] = [];
  const seen = new Map<string, number>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (clause === undefined) continue;
    const specifier = moduleOf(
      (statement.moduleSpecifier as ts.StringLiteral).text,
    );
    // Read, and judged allowed: see the namespace form above.
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      read.push(`* as ${specifier}`);
      continue;
    }
    const typeOnly = clause.phaseModifier === ts.SyntaxKind.TypeKeyword;
    const key = `${typeOnly ? 'type ' : ''}${specifier}`;
    read.push(key);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const repeated = [...seen].filter(([, n]) => n > 1).map(([key]) => key);
  return { read, repeated };
}

/**
 * One spelling per module: `./i18n`, `./i18n/index` and `./i18n/index.ts` all
 * name the same file, and a test once imported the same module as two of them.
 */
function moduleOf(specifier: string): string {
  return specifier.replace(/\.(?:ts|mjs|js)$/, '').replace(/\/index$/, '');
}

const repeatsIn = (text: string, file = 'case.ts'): string[] =>
  readImports(parseSource(text, file)).repeated;

/** Each module the file holds: an `.astro` file's frontmatter and scripts are separate programs. */
function programsOf(path: string, text: string): string[] {
  return path.endsWith('.astro') ? astroCodeViews(text) : [text];
}

/** Every import a file's programs declare with bindings, each judged, and the modules among them named twice. */
const fileImports = (
  path: string,
  text: string,
): { read: string[]; repeated: string[] } => {
  const readings = programsOf(path, text).map((program) =>
    readImports(parseSource(program, path)),
  );
  return {
    read: readings.flatMap(({ read }) => read),
    repeated: readings.flatMap(({ repeated }) => repeated),
  };
};

const fileRepeats = (path: string, text: string): string[] =>
  fileImports(path, text).repeated;

/**
 * An import with bindings, read as text with comments stripped: independent
 * of the parse tree, so a reader gone blind to a form is caught by the file
 * it read no import in (#446).
 */
const IMPORTS = /^\s*import\s+(?!['"])/m;

describe('readImports reads declarations, not text', () => {
  it('names a module imported twice by name', () => {
    expect(
      repeatsIn("import { a } from './m';\nimport { b } from './m';\n"),
    ).toEqual(['./m']);
  });

  it('names a default import beside a named one', () => {
    expect(
      repeatsIn("import a from './m';\nimport { b } from './m';\n"),
    ).toEqual(['./m']);
  });

  it('names a multi-line import repeated', () => {
    expect(
      repeatsIn(
        "import {\n  a,\n  b,\n} from './m';\nimport { c } from './m';\n",
      ),
    ).toEqual(['./m']);
  });

  it('allows a namespace import beside named ones', () => {
    expect(
      repeatsIn("import { a } from './m';\nimport * as m from './m';\n"),
    ).toEqual([]);
  });

  it('allows an import type beside a value import', () => {
    expect(
      repeatsIn("import { a } from './m';\nimport type { B } from './m';\n"),
    ).toEqual([]);
  });

  it('allows a side-effect import beside a named one', () => {
    expect(repeatsIn("import './m';\nimport { a } from './m';\n")).toEqual([]);
  });

  it('ignores an import spelled inside a string', () => {
    expect(
      repeatsIn(
        "import { a } from './m';\nconst fixture = \"import { b } from './m';\";\n",
      ),
    ).toEqual([]);
  });

  it("reads an .astro file's frontmatter and script as separate programs", () => {
    const component = [
      '---',
      "import { a } from './m';",
      '---',
      '<p>{a}</p>',
      '<script>',
      "  import { b } from './m';",
      '</script>',
      '',
    ].join('\n');
    expect(fileRepeats('case.astro', component)).toEqual([]);
    expect(fileRepeats('case.ts', component)).toEqual(['./m']);
  });

  it('names one module imported through two spellings', () => {
    expect(
      repeatsIn(
        "import { a } from '../m/index';\nimport { b } from '../m';\nimport { c } from '../m/index.ts';\n",
      ),
    ).toEqual(['../m']);
  });

  it('keeps different modules apart', () => {
    expect(
      repeatsIn("import { a } from './m';\nimport { b } from './n';\n"),
    ).toEqual([]);
  });
});

describe('no source imports one module twice (#390 F59)', () => {
  const scan = () =>
    ['src', 'scripts', 'tests']
      .flatMap((dir) =>
        filesUnder(dir, (path) => /\.(astro|ts|mjs|js)$/.test(path)),
      )
      .map((path) => {
        const text = readFileSync(path, 'utf8');
        return { path, text, ...fileImports(path, text) };
      });

  it('src, scripts and tests each import a module once', () => {
    // The population is the imports judged, not the files opened: a reader
    // blind to every declaration would open each file and pass (#446).
    const sources = scan();
    const repeated = sources.flatMap(({ path, repeated }) =>
      repeated.map((specifier) => `${path}: ${specifier}`),
    );
    const imports = sources.flatMap(({ read }) => read);
    expect(
      searched(repeated, {
        of: imports,
        what: 'imports read',
      }),
    ).toEqual([]);
    expect(
      floorBreach('duplicate-imports/judged-imports', imports.length),
    ).toBeUndefined();
  });

  it('reads every import the sources declare, and as many as there are', () => {
    const sources = scan();
    const unread = sources
      .filter(
        ({ path, text, read }) =>
          read.length === 0 &&
          programsOf(path, text).some((program) =>
            IMPORTS.test(withoutTsComments(program)),
          ),
      )
      .map(({ path }) => path);
    expect(searched(unread, { of: sources, what: 'source files' })).toEqual([]);
    // After the verdict, so a population that grew never hides a finding.
    expect(
      floorBreach(
        'duplicate-imports/imports',
        sources.flatMap(({ read }) => read).length,
      ),
    ).toBeUndefined();
  });
});
