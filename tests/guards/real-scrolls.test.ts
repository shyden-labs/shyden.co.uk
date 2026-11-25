import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scriptScrolls } from '../script-scrolls';
import { filesUnder, searched } from '../source-files';

/**
 * No browser test scrolls by protocol or page script (#1004; global rule,
 * Shyden 2026-10-31: every UI test drives the product through real input,
 * real wheel or finger scrolling included). Scrolls go through `scrollToOn`,
 * `scrollOver` and `tapOn` (`tests/real-touch.ts`): the real mouse wheel on a
 * desktop engine, a real finger drag on the phone. The scan is proven on
 * synthetic input in `tests/unit/script-scrolls.test.ts`.
 *
 * The population is every browser suite and the helpers at the top of
 * `tests/` they import, `real-touch.ts` among them, since a helper that
 * scrolls by script scrolls every test that calls it.
 */
const SUITES = [
  'tests/e2e',
  'tests/dev',
  'tests/prod',
  'tests/functions',
  'tests/device',
];
const HELPERS = readdirSync('tests')
  .filter((name) => /\.ts$/.test(name))
  .map((name) => `tests/${name}`);

const files = [
  ...SUITES.flatMap((dir) => filesUnder(dir, (path) => /\.ts$/.test(path))),
  ...HELPERS,
].map((path) => ({
  path,
  scrolls: scriptScrolls(readFileSync(path, 'utf8'), path),
}));

describe('every browser test scrolls with real input (#1004)', () => {
  it('no browser test or helper scrolls by scrollIntoView, scrollTo or scrollBy', () => {
    const found = Object.fromEntries(
      searched(files, { of: files, what: 'browser test files' })
        .filter(({ scrolls }) => scrolls.length > 0)
        .map(({ path, scrolls }) => [
          path,
          scrolls.map(({ line, call }) => `${line}:${call}`),
        ]),
    );
    expect(found).toEqual({});
  });

  it('reads the real-input helpers themselves', () => {
    expect(HELPERS).toContain('tests/real-touch.ts');
  });
});
