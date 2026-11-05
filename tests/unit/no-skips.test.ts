import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { parseFile, parseSource } from './ast';
import { callsIn, lineOf } from '../playwright-declarations';
import { specFilesUnder } from '../source-files';

/**
 * No test skips itself on any browser or phone (#1048). Shyden, 2026-11-05:
 * "we shouldn't have skipped tests at all. either make them useful or remove
 * them". A test runs on every target with that target's real input, or it is
 * removed; so a spec file holding `test.skip` or `test.fixme`, in any form
 * (a declaration, a runtime call, `test.describe.skip`, `testInfo.skip`,
 * `test.info().skip`), fails here.
 */
const SKIPPERS = new Set(['skip', 'fixme']);

/** Every skip or fixme call in a source file, as `line: text`. */
export function skipsIn(sf: ts.SourceFile): string[] {
  return callsIn(sf)
    .filter(
      (call) =>
        ts.isPropertyAccessExpression(call.expression) &&
        SKIPPERS.has(call.expression.name.text),
    )
    .map(
      (call) =>
        `${lineOf(sf, call)}: ${call.expression.getText(sf)}(${call.arguments.length} argument${call.arguments.length === 1 ? '' : 's'})`,
    );
}

describe('skipsIn', () => {
  it('finds a declaration, a runtime call and every receiver form', () => {
    const found = skipsIn(
      parseSource(
        [
          "test.skip('a', async () => {});",
          "test.fixme('b', async () => {});",
          "test.describe.skip('c', () => {});",
          "test('d', async ({ browserName }, testInfo) => {",
          "  test.skip(browserName === 'webkit', 'why');",
          '  testInfo.skip();',
          '  test.info().fixme();',
          '});',
        ].join('\n'),
      ),
    );
    expect(found).toEqual([
      '1: test.skip(2 arguments)',
      '2: test.fixme(2 arguments)',
      '3: test.describe.skip(2 arguments)',
      '5: test.skip(2 arguments)',
      '6: testInfo.skip(0 arguments)',
      '7: test.info().fixme(0 arguments)',
    ]);
  });

  it('reads neither a comment nor a string as a call', () => {
    expect(
      skipsIn(
        parseSource(
          [
            "// test.skip('in a comment')",
            'const note = "test.fixme(\'in a string\')";',
            "test('runs', async () => {});",
          ].join('\n'),
        ),
      ),
    ).toEqual([]);
  });
});

describe('every spec file', () => {
  const specs = specFilesUnder('tests');

  it('reads a real population of spec files', () => {
    expect(specs.length).toBeGreaterThan(40);
  });

  it('holds no test.skip or test.fixme', () => {
    const found = specs.flatMap((file) =>
      skipsIn(parseFile(file)).map((at) => `${file}:${at}`),
    );
    expect(found).toEqual([]);
  });
});
