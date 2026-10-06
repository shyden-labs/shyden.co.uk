import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { parseSource } from './ast';
import { searched } from '../source-files';
import { floorBreach } from '../floors';

/**
 * The device gauntlet reports how many tests `android-chrome` excludes by design, by LISTING the
 * tests a `--grep` selects (scripts/test-devices.mjs) -- so that pattern must select exactly what
 * the project's `grepInvert` excludes. It was a second hand-typed copy, and it missed
 * `@requires-download-bytes` for as long as that tag existed: every gauntlet reported 94 where
 * 100 were excluded (#308). These read the script's declared constant from its syntax tree, so a
 * comment quoting a pattern cannot satisfy them, and compare it with the config itself.
 */

const SCRIPT = 'scripts/test-devices.mjs';
const CONSTANT = 'EXCLUDED_BY_DESIGN_GREP';

/** Every node in the script's syntax tree, visited with a void callback (see tests/unit/ast.ts). */
const nodesOf = (sf: ts.SourceFile): ts.Node[] => {
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return nodes;
};

const script = () => parseSource(readFileSync(SCRIPT, 'utf8'), SCRIPT);

/** The string values the script declares under the constant's name. */
const declaredPatterns = (): string[] =>
  nodesOf(script())
    .filter(ts.isVariableDeclaration)
    .filter(
      (d) =>
        ts.isIdentifier(d.name) &&
        d.name.text === CONSTANT &&
        d.initializer !== undefined &&
        ts.isStringLiteral(d.initializer),
    )
    .map((d) => (d.initializer as ts.StringLiteral).text);

/** `android-chrome`'s own `grepInvert`, read from the loaded config, not from its text. */
const configPattern = async (): Promise<string> => {
  // Importing the device config sets PW_REAL_DEVICE at module scope; put it back.
  const before = process.env.PW_REAL_DEVICE;
  try {
    const loaded = (await import(resolve('playwright.device.config.ts'))) as {
      default: { projects: Array<{ name?: string; grepInvert?: RegExp }> };
    };
    const project = loaded.default.projects.find(
      (p) => p.name === 'android-chrome',
    );
    expect(
      project?.grepInvert,
      'android-chrome declares no grepInvert',
    ).toBeInstanceOf(RegExp);
    return (project?.grepInvert as RegExp).source;
  } finally {
    if (before === undefined) delete process.env.PW_REAL_DEVICE;
    else process.env.PW_REAL_DEVICE = before;
  }
};

describe('the gauntlet’s by-design count selects exactly what android-chrome excludes (#308)', () => {
  it('declares the pattern once', () => {
    expect(declaredPatterns()).toHaveLength(1);
  });

  it('is the config’s grepInvert, character for character', async () => {
    expect(declaredPatterns()[0]).toBe(await configPattern());
  });

  it('never spells a --grep pattern out as a literal again', () => {
    const strings = nodesOf(script())
      .filter(
        (n): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
          ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n),
      )
      .map((n) => n.text);
    const literals = strings.filter((text) => text.includes('--grep='));
    expect(
      searched(literals, { of: strings, what: `string literals in ${SCRIPT}` }),
    ).toEqual([]);
    expect(
      floorBreach('excluded-by-design/script-strings', strings.length),
    ).toBeUndefined();
    // Liveness: the listing still passes a --grep at all, built from the constant.
    const built = nodesOf(script())
      .filter(ts.isTemplateExpression)
      .filter(
        (t) =>
          t.head.text.endsWith('--grep=') &&
          t.templateSpans.some(
            (span) =>
              ts.isIdentifier(span.expression) &&
              span.expression.text === CONSTANT,
          ),
      );
    expect(
      floorBreach('excluded-by-design/built-patterns', built.length),
    ).toBeUndefined();
  });
});
