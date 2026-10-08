import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { measureBoard, measureBoardScript } from '../board-geometry';
import { floorBreach } from '../floors';
import { searched, tsFilesUnder } from '../source-files';
import { expectClosesOverNothing } from '../unit/closes-over-nothing';
import { withoutTsComments } from '../unit/source-text';

/**
 * The board measurement is serialised into two runtimes, so it is guarded here.
 *
 * `tests/board-geometry.ts` cannot be exercised in this suite: measuring a
 * layout needs a layout, and no DOM environment is installed (adding `jsdom`
 * would be a new dependency, which is an operator decision). What CAN be
 * proved without a browser is the part that silently breaks -- that the
 * function still arrives at the far end intact, and that there is still only
 * one of it.
 *
 * Both callers ship the function as TEXT: Playwright serialises it into the
 * page, and the iOS leg sends `(${measureBoard})()` down a WebDriver wire. A
 * reference to a module-scope binding type-checks perfectly here and is
 * `undefined` over there -- a failure that appears only on a real phone, in
 * the one leg #189 AC11 exists to cover.
 */
describe('the board is measured once, and survives being sent somewhere else', () => {
  it('still names the things it measures once serialised', () => {
    const source = measureBoard.toString();

    // A transpiler that inlined, renamed or stubbed this would leave a
    // function that still serialises and measures nothing. These are the
    // selectors the measurement is ABOUT: without them it cannot be the
    // measurement, whatever else survived.
    const needles = [
      'cg-board-stage',
      '.group',
      '.who',
      'getClientRects',
      'getBoundingClientRect',
    ];
    const missing = needles.filter((needle) => !source.includes(needle));

    expect(
      searched(missing, { of: needles, what: 'serialised selectors' }),
      `the serialised measurement lost: ${missing.join(', ')}`,
    ).toEqual([]);
    expect(
      floorBreach('board-geometry/serialised-needles', needles.length),
    ).toBeUndefined();
  });

  it('closes over nothing, because anything it closed over would be undefined at the far end', () => {
    expectClosesOverNothing(
      'tests/board-geometry.ts',
      'export const measureBoard',
      'board-geometry/closure-lines',
    );
  });

  it('has one spelling of the wrapper the device leg sends', () => {
    expect(measureBoardScript()).toBe(`return (${measureBoard})();`);
  });

  it('is spelled in exactly one place under tests/', () => {
    // A guard that names the thing it guards has to exempt itself -- exactly
    // as `CONTRACT_MODULE` does for the evidence filenames. Derived from
    // `import.meta.url` rather than written as a string, so a rename cannot
    // leave the exemption pointing at a file that no longer exists.
    const self = relative(process.cwd(), fileURLToPath(import.meta.url));
    const files = tsFilesUnder('tests').filter((path) => path !== self);

    // Match the CONSTRUCT, not the string. `#cg-board-stage` is an ordinary
    // selector a journey may legitimately wait on -- Journey 14 does exactly
    // that to prove the overlay MOVED the results rather than re-rendering
    // them. What must not exist twice is the MEASUREMENT, and its fingerprint
    // is the visibility filter applied to that stage: `getClientRects`, which
    // is the one thing a copied measurement could not leave out and still be
    // the measurement.
    const measuresTheStage = (code: string) =>
      code.includes('cg-board-stage') && code.includes('getClientRects');
    const spelling = files.filter((path) =>
      measuresTheStage(withoutTsComments(readFileSync(path, 'utf8'))),
    );

    // Derived from the filesystem rather than a list: a sweep driven by its
    // own ticket's file list missed five survivors (#65). The population is
    // every TypeScript file under tests/, so a second measurement written next
    // year is caught the day it appears.
    expect(
      searched(spelling, { of: files, what: 'files naming the board stage' }),
      'the board stage is measured in one home; a second measurement is the ' +
        'one place the two legs could quietly disagree',
    ).toEqual(['tests/board-geometry.ts']);
    expect(
      floorBreach('board-geometry/ts-files', files.length),
    ).toBeUndefined();
  });
});
