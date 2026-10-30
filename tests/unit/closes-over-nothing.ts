import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { searched } from '../source-files';
import { withoutTsComments } from './source-text';

/**
 * Asserts that `path`, a module whose measurement is shipped to another runtime
 * as TEXT, imports nothing (#390).
 *
 * Playwright serialises such a function into the page, and the iOS leg sends
 * `(${fn})()` down a WebDriver wire. A reference to a module-scope binding
 * type-checks perfectly here and is `undefined` over there -- a failure that
 * appears only at the far end. `declaration` is a line the module must contain,
 * the positive control that the read found the right file, so "no imports" is a
 * fact about the measurement and not about an empty read.
 *
 * The population goes INSIDE the assertion: a filter that quietly stopped
 * matching reads exactly like a module with no imports, and only one of those
 * is good news (#118).
 */
export function expectClosesOverNothing(
  path: string,
  declaration: string,
): void {
  const source = withoutTsComments(readFileSync(path, 'utf8'));
  expect(source, `read the module that owns the measurement`).toContain(
    declaration,
  );

  const lines = source.split('\n');
  const imports = lines.filter((line) => /^\s*import\s/.test(line));
  expect(
    searched(imports, { of: lines, what: `source lines in ${path}` }),
    'an import here is a binding that exists while type-checking and is ' +
      'undefined at the far end, where the measurement runs',
  ).toEqual([]);
}
