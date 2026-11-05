import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scriptScrolls } from '../script-scrolls';
import { filesUnder, searched } from '../source-files';

/**
 * No browser test scrolls by script or protocol (#1004; global rule, Shyden
 * 2026-10-31: every UI test drives the product through real input, real
 * wheel or finger scrolling included). Scrolls go through `scrollToOn` and
 * `scrollByOn` (`tests/real-touch.ts`): a finger's drags or the mouse wheel.
 * The scan is proven on synthetic input in `tests/unit/script-scrolls.test.ts`.
 *
 * Read: every browser suite, and the shared helpers at the top of `tests/`
 * that the suites import (`tests/real-touch.ts` among them, where the last
 * protocol scroll lived).
 */
const SUITES = [
  'tests/e2e',
  'tests/dev',
  'tests/prod',
  'tests/functions',
  'tests/device',
];
const isTs = (path: string) => /\.ts$/.test(path);
const sharedHelpers = filesUnder('tests', isTs).filter(
  (path) => path.split('/').length === 2,
);

const files = [
  ...SUITES.flatMap((dir) => filesUnder(dir, isTs)),
  ...sharedHelpers,
].map((path) => ({
  path,
  scrolls: scriptScrolls(readFileSync(path, 'utf8'), path),
}));

describe('every browser test scrolls with real input (#1004)', () => {
  it('reads the shared helpers, real-touch.ts among them', () => {
    expect(sharedHelpers).toContain('tests/real-touch.ts');
  });

  it('no browser test scrolls by scrollIntoView, scrollTo, scrollBy, scroll or a position written', () => {
    const found = Object.fromEntries(
      searched(files, { of: files, what: 'browser test files' })
        .filter(({ scrolls }) => scrolls.length > 0)
        .map(({ path, scrolls }) => [
          path,
          scrolls.map(({ line, how }) => `${line}: ${how}`),
        ]),
    );
    expect(found).toEqual({});
  });
});
