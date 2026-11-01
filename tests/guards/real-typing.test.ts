import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filesUnder, searched } from '../source-files';
import { withoutTsComments } from '../unit/source-text';

/**
 * Every browser test types the way a visitor does (#998; global rule,
 * Shyden 2026-10-31: "tests must be as real as possible always without fake
 * fallbacks"). Playwright's `fill()` drops the whole value in at once with no
 * key press, and a script that sets `.value` or fires `input`/`change` skips
 * the keyboard altogether, so a field that mishandles real typing passes.
 * Typing goes through `typeInto` (`tests/real-typing.ts`). Unit tests keep
 * their mocks and are not read here.
 */
const SUITES = [
  'tests/e2e',
  'tests/dev',
  'tests/prod',
  'tests/functions',
  'tests/device',
];
// The iPhone driver's typing is shyden-labs/shyden.co.uk#838's (real taps and
// the phone's own keyboard through WebDriverAgent); it joins this guard when
// that lands.
const IPHONE_DRIVER = 'tests/device/ios/';
const files = [
  ...SUITES.flatMap((dir) =>
    filesUnder(
      dir,
      (path) => /\.ts$/.test(path) && !path.startsWith(IPHONE_DRIVER),
    ),
  ),
  'tests/make-groups.ts',
].map((path) => ({
  path,
  code: withoutTsComments(readFileSync(path, 'utf8')),
}));

const SCRIPTED_TYPING: readonly [string, RegExp][] = [
  ['fill()', /\.fill\(/],
  ['a value set by script', /\.value\s*=(?!=)/],
  [
    'a scripted input or change event',
    /new\s+(?:Input)?Event\(\s*['"`](?:input|change)['"`]/,
  ],
  // Playwright resolves ControlOrMeta from the machine running the tests, so
  // from a Mac the Android phone got Meta+A, which it ignores, and a rename
  // typed "Bea" in front of "Ben" (2026-11-02). typeInto picks the keys.
  ['a select-all key typed by hand', /ControlOrMeta/],
];

describe('every browser test types with real key presses (#998)', () => {
  for (const [what, pattern] of SCRIPTED_TYPING) {
    it(`no browser test types through ${what}`, () => {
      const hits = searched(files, { of: files, what: 'browser test files' })
        .filter(({ code }) => pattern.test(code))
        .map(({ path }) => path);
      expect(hits).toEqual([]);
    });
  }
});
