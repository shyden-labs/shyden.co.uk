import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { searched, trackedFiles } from '../source-files';
import { withoutTsComments } from '../unit/source-text';
import { parseSource } from '../unit/ast';
import { callsIn } from '../playwright-declarations';
import { inFixtureTestDir } from '../vitest-suite-dirs';

describe('release-inventory.mjs as a command (#362)', () => {
  /**
   * Whether `source` calls `shoot`, bare or through a namespace import
   * (`evidence.shoot(`), with or without space before the parenthesis, as
   * `capture-after-assertion` reads a capture. The first version of this scan
   * refused a dot before the name, so a helper capturing through a namespace
   * passed it.
   */
  const callsShoot = (source: string) =>
    /(^|[^\w$])shoot\s*\(/m.test(withoutTsComments(source));

  /** Whether the parse tree of `source` holds a call to `shoot`, either way. */
  const parsedShoot = (source: string, file = 'module.ts') =>
    callsIn(parseSource(source, file)).some(
      ({ expression: callee }) =>
        (ts.isIdentifier(callee) && callee.text === 'shoot') ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'shoot'),
    );

  const helperModules = () =>
    trackedFiles(
      (path) =>
        path.startsWith('tests/') &&
        !inFixtureTestDir(path) &&
        /\.(ts|mjs|js)$/.test(path) &&
        !path.endsWith('.spec.ts'),
    );

  it('can see every capture: no module but a spec calls shoot', () => {
    // The selection reads specs alone, so a helper module that captured would
    // put its tests' pictures on the release page without them ever running.
    expect(callsShoot("  // await shoot(page, 'x');")).toBe(false);
    const modules = helperModules();
    const capturing = modules.filter((path) =>
      callsShoot(readFileSync(path, 'utf8')),
    );
    expect(
      searched(capturing, { of: modules, what: 'test helper modules' }),
    ).toEqual([]);
    expect(
      floorBreach('release-inventory/capture-scanned-modules', modules.length),
    ).toBeUndefined();
  });

  it('reads every helper module, and as many as there are', () => {
    const modules = helperModules();
    expect(modules).toContain('tests/e2e/evidence.ts');
    // Cross-checked against the parse tree: every module whose code calls
    // `shoot` must be one the text scan flags. None does today, so the
    // planted forms below are what this check runs on.
    const missed = modules.filter((path) => {
      const source = readFileSync(path, 'utf8');
      return parsedShoot(source, path) && !callsShoot(source);
    });
    expect(
      searched(missed, { of: modules, what: 'test helper modules' }),
    ).toEqual([]);
    // After the verdict, so a population that grew never hides a finding.
    expect(
      floorBreach('release-inventory/helper-modules', modules.length),
    ).toBeUndefined();
  });

  it.each([
    ['a bare call', "  await shoot(page, 'x');"],
    ['a call through a namespace import', "  await evidence.shoot(page, 'x');"],
    ['a call at the start of a line', "shoot(page, 'x');"],
    ['a returned call', "  return shoot(page, 'x');"],
    ['a space before the parenthesis', "  await shoot (page, 'x');"],
  ])('reads a capture written as %s', (_form, source) => {
    expect(parsedShoot(source)).toBe(true);
    expect(callsShoot(source)).toBe(true);
  });
});
