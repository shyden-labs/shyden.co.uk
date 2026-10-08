import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { floorBreach } from '../floors';

/**
 * `floorBreach` under Playwright, where the e2e floors call it (#475).
 *
 * The recorder tells two call sites apart by the `file:line` the stack names,
 * and Playwright compiles a spec before it runs it, so a line that came out
 * of the compiled code instead of the source would let two floors share an id
 * unseen, or split one in two. `tests/guards/floors.test.ts` proves the record
 * under vitest; this proves it under the runner the e2e floors use, against
 * the line read from this file's own text rather than from another stack.
 */

const PROBE = 'under-playwright/probe';

/** Ends the one line whose number the record must name. */
const MARK = '// the line the record names';

test.describe('floorBreach under Playwright (#475)', () => {
  test('records the id, the count and the spec line that called it', () => {
    const record = test.info().outputPath('seen.jsonl');
    const breach = floorBreach(PROBE, 3, { record }); // the line the record names
    const lines = readFileSync(test.info().file, 'utf8').split('\n');
    const marked = lines.flatMap((text, at) =>
      text.endsWith(MARK) ? [at + 1] : [],
    );
    expect(marked, `one line of this file ends with "${MARK}"`).toHaveLength(1);
    expect(breach).toBeUndefined();
    expect(JSON.parse(readFileSync(record, 'utf8'))).toEqual({
      id: PROBE,
      actual: 3,
      site: `${relative(process.cwd(), test.info().file)}:${marked[0]}`,
    });
  });

  test('judges a recorded figure as it does under vitest', () => {
    expect(
      floorBreach(PROBE, 3, { record: null, floors: { [PROBE]: 4 } }),
    ).toBe(
      `${PROBE}: read 3, recorded 4. The reader lost 1, or the corpus ` +
        'shrank: if it shrank, lower the figure in tests/floors.json by hand ' +
        'and say why in the commit.',
    );
  });
});
