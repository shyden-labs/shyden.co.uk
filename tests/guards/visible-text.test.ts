import { describe, expect, it } from 'vitest';
import { visibleLinesReader, visibleLinesReaderScript } from '../visible-text';
import { expectClosesOverNothing } from '../unit/closes-over-nothing';

/**
 * What a visitor can see of a text node is read in one home, shipped into the
 * page as text (#619).
 *
 * `rendered-text.spec.ts` cut each line of text by every `clip-path: inset()`
 * and `clip: rect()` above it, so a `.visually-hidden` name read as nothing, while
 * `text-over-ribbon.spec.ts` read the raw line boxes. When #619 put the pause
 * control's name on the ribbon as screen-reader-only text, the second scan
 * scored that invisible name at 1.00:1 on every engine (run 38485095201).
 * Reading lines needs a layout, so the specs run the function; this file
 * proves what breaks silently: that it closes over nothing, and that its
 * wrapper has one spelling.
 */
describe('visible lines are read in one home, and survive being sent into the page', () => {
  it('closes over nothing, because anything it closed over would be undefined in the page', () => {
    expectClosesOverNothing(
      'tests/visible-text.ts',
      'export const visibleLinesReader',
    );
  });

  it('has one spelling of the wrapper the specs ship', () => {
    expect(visibleLinesReaderScript()).toBe(
      `return (${visibleLinesReader})();`,
    );
  });
});
