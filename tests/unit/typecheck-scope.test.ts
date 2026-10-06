/**
 * `npm run typecheck` reads the code that deploys this site.
 *
 * `astro/tsconfigs/base` sets `allowJs` but NOT `checkJs`, so every file
 * under `scripts/` was ADMITTED to the program and never had its body read.
 * Measured 2026-09-21, prediction written first: the line
 * `export const typo = import.meta.mian;` appended to
 * `scripts/evidence-files.mjs` produced **0 errors, 0 warnings, 0 hints**,
 * while the same line in a `tests/unit/*.ts` file produced `ts(2339)`.
 *
 * That is 4,456 lines across 10 files, including `deploy-gate.mjs`, which
 * decides whether `develop` reaches dev, and `build-evidence-page.mjs`,
 * which the release sign-off is made from. "typecheck green" read as
 * covering the repo while covering none of the code that ships it.
 *
 * A green unit suite proves nothing here either: vitest strips types with
 * esbuild and never checks them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { withoutTsComments } from './source-text';
import { filesUnder, searched, nonEmpty } from '../source-files';
import { floorBreach } from '../floors';

/** `tsconfig.json` is JSONC: it carries the reason for every option. */
const tsconfig = (): Record<string, any> =>
  JSON.parse(withoutTsComments(readFileSync('tsconfig.json', 'utf8')));

const scripts = (): string[] =>
  nonEmpty(
    filesUnder('scripts', (path) => path.endsWith('.mjs')),
    'scripts',
  );

/**
 * Whether `text` carries a ts-nocheck directive. Comment-stripped would HIDE
 * it -- a directive IS a comment -- so this reads the raw text deliberately,
 * and wider than the compiler does: a directive in a block comment, or below
 * the first statement, is flagged although TypeScript ignores it.
 *
 * Matched WITHOUT comment syntax: spelling `//` here makes this file read as
 * a comment stripper to `one-home.test.ts`, which is right to ask -- naming
 * comment syntax is how a second stripper starts. The directive's own name is
 * enough, and it appears nowhere else.
 */
const optsOut = (text: string): boolean => /@ts-nocheck/.test(text);

/**
 * Whether TypeScript itself reads `text` as switching checking off. The
 * compiler records that on the parsed file as `checkJsDirective`, a field its
 * public types leave out; the planted forms below fail if an upgrade moves it.
 */
const silencedByCompiler = (path: string, text: string): boolean =>
  (
    ts.createSourceFile(path, text, ts.ScriptTarget.Latest) as ts.SourceFile & {
      checkJsDirective?: { enabled: boolean };
    }
  ).checkJsDirective?.enabled === false;

describe('typecheck reads the scripts that deploy this site (#228)', () => {
  it('turns checkJs on, so a .js body is read and not merely admitted', () => {
    // Read from the STRIPPED text: this file's own comment explains what
    // `checkJs` is for and names it, and a guard matched against raw bytes
    // would be satisfied by that explanation with the option absent.
    expect(tsconfig().compilerOptions?.checkJs).toBe(true);
  });

  it('chooses checkJs over a directive on every file, and says why', () => {
    // The alternative AC1 allows is `// @ts-check` at the top of each file.
    // It is rejected: a script added next year would carry no directive and
    // go unchecked, and nothing would say so. `checkJs` is derived from the
    // tree -- whatever the program admits, it reads.
    const config = tsconfig();
    expect(config.compilerOptions?.allowJs).toBeUndefined();
    expect(config.extends).toBe('astro/tsconfigs/strict');
  });

  it('excludes nothing under scripts/, so a new script is covered', () => {
    // BEHAVIOURAL, not a discovery: the input is the config read on the line
    // above, and the first assertion fails if it stops being read at all, so
    // this needs no population control (#118). Wrapping it in `searched` was
    // in fact vacuous -- with no `exclude` key the population is empty, and
    // `searched` said so.
    const config = tsconfig();
    const swallows = (pattern: string): boolean =>
      /(^|\/)scripts(\/|$)|^\*\*$/.test(pattern);
    expect(swallows('scripts'), 'the matcher itself is live').toBe(true);
    expect(swallows('dist'), 'and it does not match everything').toBe(false);
    // `.some()` rather than a filter answered against `[]`: the list comes
    // from a file, so an empty-array absence over it reads as a discovery
    // population and `absence-liveness` flags it -- correctly, since an
    // unreadable config would also produce no patterns. A boolean says the
    // same thing and cannot be satisfied by silence.
    expect(
      (config.exclude ?? []).some(swallows),
      'an exclude pattern swallows scripts/',
    ).toBe(false);
  });

  it('no script opts itself out with a ts-nocheck directive', () => {
    // A directive at the top of a file silences the whole file, which is the
    // one way to get back to where this ticket started without changing any
    // config.
    const read = scripts();
    const opted = read.filter((path) => optsOut(readFileSync(path, 'utf8')));
    expect(searched(opted, { of: read, what: 'scripts read' })).toEqual([]);
    expect(
      floorBreach('typecheck-scope/nocheck-scripts', read.length),
    ).toBeUndefined();
  });

  it('reads every script, and as many as there are', () => {
    const read = scripts();
    // Cross-checked against the compiler: every script TypeScript itself
    // would stop checking must be one the raw scan flags. No script does
    // today, so the planted forms below are what this check runs on.
    const missed = read.filter((path) => {
      const text = readFileSync(path, 'utf8');
      return silencedByCompiler(path, text) && !optsOut(text);
    });
    expect(searched(missed, { of: read, what: 'scripts read' })).toEqual([]);
    // After the verdict, so a population that grew never hides a finding.
    expect(floorBreach('typecheck-scope/scripts', read.length)).toBeUndefined();
  });

  it.each([
    ['a line comment', '// @ts-nocheck\nexport const a = 1;\n'],
    ['a triple-slash comment', '/// @ts-nocheck\nexport const a = 1;\n'],
    [
      'a line comment under a shebang',
      '#!/usr/bin/env node\n// @ts-nocheck\nexport const a = 1;\n',
    ],
  ])('flags a directive the compiler obeys, written as %s', (_form, text) => {
    expect(silencedByCompiler('plant.mjs', text)).toBe(true);
    expect(optsOut(text)).toBe(true);
  });
});
