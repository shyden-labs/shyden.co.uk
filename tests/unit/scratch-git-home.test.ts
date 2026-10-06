import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { searched, trackedFiles } from '../source-files';
import { floorBreach } from '../floors';
import { parseFile, where } from './ast';

/**
 * Git runs in a scratch repository through `tests/git-env.ts` alone (#377).
 *
 * A git call handed a `cwd` is a call meant for some other repository. Made
 * anywhere else, it inherits whatever GIT_DIR the run was started with, and a
 * pre-push hook in a linked worktree starts it with the real one.
 */

const HOME = 'tests/git-env.ts';
const SPAWNERS = new Set([
  'execFileSync',
  'spawnSync',
  'execSync',
  'spawn',
  'execFile',
  'exec',
]);

/** Is this call one that starts git: `spawnSync('git', ...)` or `execSync('git ...')`? */
const startsGit = (call: ts.CallExpression): boolean => {
  const callee = ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : ts.isIdentifier(call.expression)
      ? call.expression.text
      : '';
  const first = call.arguments[0];
  if (!SPAWNERS.has(callee) || !first) return false;
  if (!ts.isStringLiteralLike(first)) return false;
  return first.text === 'git' || first.text.startsWith('git ');
};

/** Does any options object passed to the call name a `cwd`? */
const namesCwd = (call: ts.CallExpression): boolean =>
  call.arguments.some(
    (arg) =>
      ts.isObjectLiteralExpression(arg) &&
      arg.properties.some(
        (property) =>
          property.name !== undefined &&
          (ts.isIdentifier(property.name) ||
            ts.isStringLiteral(property.name)) &&
          property.name.text === 'cwd',
      ),
  );

/** Every call under `tests/` that starts git, and whether it names a `cwd`. */
const gitCalls = () =>
  trackedFiles(
    (path) => path.startsWith('tests/') && /\.(ts|mts|mjs)$/.test(path),
  ).flatMap((file) => {
    const sf = parseFile(file);
    const found: { at: string; file: string; cwd: boolean }[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && startsGit(node))
        found.push({ at: where(sf, node), file, cwd: namesCwd(node) });
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
  });

describe('git runs in a scratch repository through one home (#377)', () => {
  it('the home is where such a call is made, and the scan can see it', () => {
    const calls = gitCalls();
    expect(
      calls.filter((call) => call.file === HOME && call.cwd).length,
      'the scan finds the home calls themselves',
    ).toBeGreaterThan(0);
  });

  it('no call anywhere else hands git a cwd', () => {
    const calls = gitCalls();
    expect(
      searched(
        calls
          .filter((call) => call.cwd && call.file !== HOME)
          .map((call) => call.at),
        { of: calls, what: 'calls that start git under tests/' },
      ),
    ).toEqual([]);
    expect(
      floorBreach('scratch-git-home/git-calls', calls.length),
    ).toBeUndefined();
  });
});
