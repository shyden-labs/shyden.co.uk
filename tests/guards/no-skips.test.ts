import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { parseFile, parseSource } from '../unit/ast';
import { callsIn, lineOf } from '../playwright-declarations';
import { searched, specFilesUnder } from '../source-files';

/**
 * No test skips itself on any browser or phone (#1048). Shyden, 2026-11-05:
 * "we shouldn't have skipped tests at all. either make them useful or remove
 * them". A test runs on every target with that target's real input, or it is
 * removed. So a spec file that calls `skip` or `fixme` on anything — a
 * declaration, a runtime call, `test.describe.skip`, `testInfo.skip()`,
 * `test.info().fixme()` — fails here. Calls are read from the syntax tree, so
 * a comment or a string naming one is not a call.
 */
const SKIPPERS = new Set(['skip', 'fixme']);

/** Every skip or fixme call in a source file, as `line: receiver.name`. */
export function skipsIn(sf: ts.SourceFile): string[] {
  const found: string[] = [];
  for (const call of callsIn(sf)) {
    const callee = call.expression;
    if (ts.isPropertyAccessExpression(callee) && SKIPPERS.has(callee.name.text))
      found.push(`${lineOf(sf, call)}: ${callee.getText(sf)}`);
  }
  return found;
}

describe('skipsIn', () => {
  it('finds a declaration, a runtime call and every receiver form', () => {
    const source = [
      "test.skip('a', async () => {});",
      "test.fixme('b', async () => {});",
      "test.describe.skip('c', () => {});",
      "test('d', async ({ browserName }, testInfo) => {",
      "  test.skip(browserName === 'webkit', 'why');",
      '  testInfo.skip();',
      '  test.info().fixme();',
      '});',
    ].join('\n');
    expect(skipsIn(parseSource(source))).toEqual([
      '1: test.skip',
      '2: test.fixme',
      '3: test.describe.skip',
      '5: test.skip',
      '6: testInfo.skip',
      '7: test.info().fixme',
    ]);
  });

  it('reads neither a comment nor a string as a call', () => {
    const source = [
      "// test.skip('in a comment')",
      'const note = "test.fixme(\'in a string\')";',
      "test('runs', async () => {});",
    ].join('\n');
    expect(skipsIn(parseSource(source))).toEqual([]);
  });
});

describe('every spec file', () => {
  it('holds no test.skip or test.fixme', () => {
    const specs = specFilesUnder('tests');
    const found = specs.flatMap((file) =>
      skipsIn(parseFile(file)).map((at) => `${file}:${at}`),
    );
    expect(searched(found, { of: specs, what: 'spec files' })).toEqual([]);
  });
});
