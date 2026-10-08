import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { releaseTests } from '../../scripts/release-inventory.mjs';
import { searched, trackedFiles } from '../source-files';
import { withoutTsComments } from './source-text';
import { parseSource } from './ast';
import { callsIn } from '../playwright-declarations';
import { floorBreach } from '../floors';

describe('the capture selection (#362)', () => {
  const sources: Record<string, string> = {
    'tests/e2e/direct.spec.ts': `
import { shoot } from './evidence';
test('shoots directly', async ({ page }) => {
  await expect(page).toHaveTitle('x');
  await shoot(page, 'shown');
});
test('never shoots', async ({ page }) => {
  // shoot(page, 'a comment naming it decides nothing');
  await expect(page).toHaveTitle('x');
});
for (const locale of ['en', 'id'])
  test(\`\${locale}: shoots in a loop\`, async ({ page }) => {
    await shoot(page, locale);
  });
`,
    'tests/e2e/helper.spec.ts': `
const outer = async (page) => { await inner(page); };
const inner = async (page) => { await shoot(page, 'deep'); };
async function once(page) { await shoot(page, 'once'); }
test('through a helper', async ({ page }) => { await once(page); });
test("through a helper's helper", async ({ page }) => { await outer(page); });
test('calls a helper that never shoots', async ({ page }) => { await quiet(page); });
const quiet = async (page) => { await page.goto('/'); };
`,
    'tests/e2e/tooling.spec.ts': `
import { evidencePageOf } from '../evidence-fixture';
test('the evidence page itself', async ({ page }) => { await shoot(page, 'x'); });
`,
  };
  const read = (file: string) => {
    const source = sources[file];
    if (source === undefined) throw new Error(`no fixture ${file}`);
    return source;
  };

  it('selects each capturing test by file:line, through helpers to a fixed point', () => {
    expect(releaseTests(Object.keys(sources), read)).toEqual([
      'tests/e2e/direct.spec.ts:3',
      'tests/e2e/direct.spec.ts:12',
      'tests/e2e/helper.spec.ts:5',
      'tests/e2e/helper.spec.ts:6',
    ]);
  });
});

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
        !path.startsWith('tests/unit/') &&
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
