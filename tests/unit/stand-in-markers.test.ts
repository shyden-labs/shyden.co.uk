import { describe, expect, test } from 'vitest';
import { standIns } from '../stand-in-markers';

/**
 * The reader behind the guard that every iPhone mirror leaning on a harness
 * stand-in says so (#821). A test that calls a stand-in, directly or through
 * a helper in its own file or another harness file, is judged; one with no
 * `NOT YET THE SAME as Android (#811)` COMMENT is a finding.
 */
const ROLES = 'tests/device/ios/roles.ts';
const JOURNEY = 'tests/device/ios/x.journey.ts';
const SEEDS = [{ file: ROLES, names: ['byRole'] }];
const MARK = '// NOT YET THE SAME as Android (#811): the name rules.';

const roles = `export const byRole = () => 1;\nexport const plain = () => 2;\n`;
const journey = (body: string, extra = ''): Record<string, string> => ({
  [ROLES]: roles,
  [JOURNEY]: `import { byRole, plain } from './roles';\n${extra}\ntest('t', async () => {\n${body}\n});\n`,
});

describe('standIns reads which mirrors lean on a stand-in', () => {
  test('a test calling a stand-in with no marker is a finding', () => {
    const { judged, findings } = standIns(journey('byRole();'), SEEDS);
    expect(judged).toEqual([`${JOURNEY}:3 t`]);
    expect(findings).toEqual([`${JOURNEY}:3 t`]);
  });

  test('a test calling a stand-in with the marker in a comment passes', () => {
    const { judged, findings } = standIns(
      journey(`${MARK}\nbyRole();`),
      SEEDS,
    );
    expect(judged).toEqual([`${JOURNEY}:3 t`]);
    expect(findings).toEqual(judged.slice(1));
  });

  test('the marker in a string does not count', () => {
    const { findings } = standIns(
      journey(`const s = 'NOT YET THE SAME as Android (#811)';\nbyRole();`),
      SEEDS,
    );
    expect(findings).toEqual([`${JOURNEY}:3 t`]);
  });

  test('a local helper that calls a stand-in, two levels down, taints the test', () => {
    const { findings } = standIns(
      journey(
        'outer();',
        'const outer = () => inner();\nconst inner = () => byRole();',
      ),
      SEEDS,
    );
    expect(findings).toEqual([`${JOURNEY}:4 t`]);
  });

  test('a helper imported from another harness file taints the test', () => {
    const files = {
      [ROLES]: roles,
      'tests/device/ios/helpers.ts': `import { byRole } from './roles';\nexport const open = () => byRole();\n`,
      [JOURNEY]: `import { open } from './helpers';\ntest('t', async () => {\nopen();\n});\n`,
    };
    expect(standIns(files, SEEDS).findings).toEqual([`${JOURNEY}:2 t`]);
  });

  test('a test calling no stand-in is read and not judged', () => {
    const { judged, read } = standIns(journey('plain();'), SEEDS);
    expect(read).toEqual([`${JOURNEY}:3 t`]);
    expect(judged).toEqual(read.slice(1));
  });

  test('a property that shares a stand-in name is not a call to it', () => {
    const { judged, read } = standIns(
      journey('const o = { byRole: 1 };\no.byRole;'),
      SEEDS,
    );
    expect(read).toEqual([`${JOURNEY}:3 t`]);
    expect(judged).toEqual(read.slice(1));
  });

  test("another test's helper of the same name does not taint this test", () => {
    const files = {
      [ROLES]: roles,
      [JOURNEY]: [
        "import { byRole, plain } from './roles';",
        "test('a', async () => {",
        'const link = () => byRole();',
        MARK,
        'link();',
        '});',
        "test('b', async () => {",
        'const link = plain();',
        'link;',
        '});',
      ].join('\n'),
    };
    const { judged, read } = standIns(files, SEEDS);
    expect(read).toEqual([`${JOURNEY}:2 a`, `${JOURNEY}:7 b`]);
    expect(judged).toEqual([`${JOURNEY}:2 a`]);
  });

  test('a parameter of the same name shadows the stand-in', () => {
    const { judged, read } = standIns(
      journey('const go = (byRole: () => void) => byRole();\ngo(plain);'),
      SEEDS,
    );
    expect(read).toEqual([`${JOURNEY}:3 t`]);
    expect(judged).toEqual(read.slice(1));
  });

  test('a seed that names a binding its file does not declare is refused', () => {
    expect(() =>
      standIns(journey('byRole();'), [{ file: ROLES, names: ['byLabel'] }]),
    ).toThrow('tests/device/ios/roles.ts declares no byLabel');
  });
});
