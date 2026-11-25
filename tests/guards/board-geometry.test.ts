import { describe, expect, it } from 'vitest';
import {
  measureBoard,
  measureBoardScript,
  measureCover,
} from '../board-geometry';
import { searched } from '../source-files';
import { expectClosesOverNothing } from '../unit/closes-over-nothing';

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
 * page, and the iOS leg sends `(${measureBoard})()` down the Web Inspector wire. A
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
  });

  it('closes over nothing, because anything it closed over would be undefined at the far end', () => {
    expectClosesOverNothing(
      'tests/board-geometry.ts',
      'export const measureBoard',
    );
  });

  it('has one spelling of the wrapper the device leg sends', () => {
    expect(measureBoardScript()).toBe(`return (${measureBoard})();`);
  });
});

/**
 * The board's cover of the window is serialised the same way (#837): the
 * refused-grant test sends `measureCover` into the page. Its imports are
 * already refused by the module-wide check above.
 */
describe('the cover measurement survives being sent somewhere else', () => {
  it('still names what it measures once serialised', () => {
    const source = measureCover.toString();
    const needles = [
      'cg-board',
      'getBoundingClientRect',
      'visualViewport',
      'innerWidth',
      'innerHeight',
      'devicePixelRatio',
    ];
    const missing = needles.filter((needle) => !source.includes(needle));

    expect(
      searched(missing, { of: needles, what: 'serialised cover reads' }),
      `the serialised cover measurement lost: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
