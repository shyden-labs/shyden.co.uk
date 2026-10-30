import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseFile, where } from '../unit/ast';
import { searched, tsFilesUnder, walkDisagreements } from '../source-files';
import { specDirFilesGitHas, specDirs } from '../spec-dirs';
import { callsIn } from '../playwright-declarations';
import { budgetsIn, budgetsSpelled } from '../playwright-budgets';

/**
 * No test outside the unit suite sets its own budget (operator 2026-10-07;
 * #380).
 *
 * Every suite beside unit keeps ONE limit, at its CI step and in its config,
 * set from its measured time with a stated margin. A test that raises its own
 * (`test.setTimeout`, `test.slow()`, `describe.configure({ timeout })`) is
 * judged by the e2e timing tables against a number it no longer uses, and a
 * slow journey stops being noticed: #380's two locale-copy journeys were
 * first given 75 s and 120 s that way, and are split instead. A journey too
 * long for the budget is split, one test per sentence group, as #421 split
 * the ribbon spec whose 120 s budget this repo used to carry.
 *
 * `tests/guards/unit-limit.test.ts` holds the unit suite to its limit; it
 * reads `tests/unit` only, so until this guard nothing read the specs.
 */
const scan = (): {
  specs: string[];
  calls: string[];
  budgets: string[];
  undercounted: string[];
} => {
  // Every TypeScript file in a directory that holds specs, as
  // one-test-per-case.test.ts walks them: a budget set in a shared fixture or
  // a `*.setup.ts` file moves every test that uses it.
  const specs = specDirs().flatMap(tsFilesUnder);
  const read = specs.map((file) => ({ file, sf: parseFile(file) }));
  const calls = read.flatMap(({ sf }) =>
    callsIn(sf).map((call) => where(sf, call)),
  );
  const budgets = read.flatMap(({ file, sf }) =>
    budgetsIn(sf).map(
      ({ line, how, unreadable }) =>
        `${file}:${line}: ${how}` +
        (unreadable === undefined ? '' : ` (${unreadable})`),
    ),
  );
  // Per file: the text's count against the reader's, so a reader blind to
  // one form is caught by the file that writes it. The text can count more
  // (a budget spelled in a string), never fewer, so only fewer is a finding.
  const undercounted = read.flatMap(({ file, sf }) => {
    const spelled = budgetsSpelled(readFileSync(file, 'utf8'));
    const found = budgetsIn(sf).length;
    return found >= spelled
      ? []
      : [
          `${file}: its text spells ${spelled} budgets, the reader read ${found}`,
        ];
  });
  return { specs, calls, budgets, undercounted };
};

describe('the suites beside unit', () => {
  it('set no budget of their own in any test, hook, fixture or group', () => {
    // The population is the CALLS read, the level the reader judges at: a
    // reader that went blind to every call would open every file, find no
    // budget, and pass. `searched` refuses an empty population.
    const { calls, budgets } = scan();
    expect(searched(budgets, { of: calls, what: 'calls read' })).toEqual([]);
    expect(
      floorBreach('test-budgets/calls-read', calls.length),
    ).toBeUndefined();
  });

  it('read every budget their text spells, in every file the walk should find', () => {
    const { specs, undercounted } = scan();
    expect(
      searched(undercounted, { of: specs, what: 'files in spec directories' }),
    ).toEqual([]);
    // The cross-check counts over the walk, so the walk is checked against
    // git's own list too: a walk that drops a file drops it from both sides.
    expect(
      searched(walkDisagreements(specs, specDirFilesGitHas()), {
        of: specs,
        what: 'files in spec directories',
      }),
    ).toEqual([]);
    // After the verdict, so a population that grew never hides a finding.
    expect(
      floorBreach('test-budgets/walked-specs', specs.length),
    ).toBeUndefined();
  });
});
