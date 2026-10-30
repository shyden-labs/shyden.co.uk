import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { searched, tsFilesUnder } from '../source-files';
import { visibleLinesReader, visibleLinesReaderScript } from '../visible-text';
import { expectClosesOverNothing } from '../unit/closes-over-nothing';
import { withoutTsComments } from '../unit/source-text';

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
 * proves what breaks silently: that it closes over nothing, that its wrapper
 * has one spelling, and that no second copy of the clip reading exists.
 */
describe('visible lines are read in one home, and survive being sent into the page', () => {
  it('closes over nothing, because anything it closed over would be undefined in the page', () => {
    expectClosesOverNothing(
      'tests/visible-text.ts',
      'export const visibleLinesReader',
      'visible-text/closure-lines',
    );
  });

  it('has one spelling of the wrapper the specs ship', () => {
    expect(visibleLinesReaderScript()).toBe(
      `return (${visibleLinesReader})();`,
    );
  });

  it('is spelled in exactly one place under tests/', () => {
    const self = relative(process.cwd(), fileURLToPath(import.meta.url));
    const files = tsFilesUnder('tests').filter((path) => path !== self);

    // Match the CONSTRUCT: a computed `clip-path` read beside a line box
    // read, which is what cutting a line by its clips takes.
    const readsClippedLines = (code: string) =>
      /\.clipPath[^\w]/.test(code) && code.includes('getClientRects');
    const spelling = files.filter((path) =>
      readsClippedLines(withoutTsComments(readFileSync(path, 'utf8'))),
    );

    expect(
      searched(spelling, { of: files, what: 'TypeScript files under tests/' }),
      'visible lines are read in one home; two readers are how an invisible ' +
        'name came to be scored as text on the ribbon',
    ).toEqual(['tests/visible-text.ts']);
  });
});
