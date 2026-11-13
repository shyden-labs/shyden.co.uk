import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { nodesIn, parseFile } from '../unit/ast';
import { searched, tsFilesUnder } from '../source-files';

/**
 * One suite runs unchanged on every target, nothing skipped (Shyden,
 * 2026-11-05). The integration suite runs in CI on Linux, so a test behind
 * `it.runIf(process.platform === 'darwin')` ran nowhere automated (#1069).
 *
 * Read from the parse, not the text: a fixture that spells `test.skip()` inside
 * a string (`jsonl-reporter.test.ts`) is not a skipped test.
 */
const RUNNERS = new Set(['it', 'test', 'describe']);
const SKIPS = new Set(['skip', 'skipIf', 'runIf', 'todo']);

/** The runner a chain such as `it.concurrent.skip` starts from. */
const rootName = (node: ts.Expression): string | undefined => {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return rootName(node.expression);
  return undefined;
};

const skipsIn = (file: string): string[] => {
  const sf = parseFile(file);
  return nodesIn(
    sf,
    (node) =>
      ts.isPropertyAccessExpression(node) &&
      SKIPS.has(node.name.text) &&
      RUNNERS.has(rootName(node.expression) ?? ''),
  ).map(
    (node) =>
      `${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.getText()}`,
  );
};

describe('the integration suite skips nothing', () => {
  it('no test in tests/integration is skipped, on any machine', () => {
    const files = tsFilesUnder('tests/integration');
    expect(
      searched(files.flatMap(skipsIn), {
        of: files,
        what: 'integration files',
      }),
    ).toEqual([]);
  });
});
