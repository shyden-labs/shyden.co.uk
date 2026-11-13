import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { directPresses } from '../direct-presses';
import { inPageClicks } from '../in-page-clicks';
import { filesUnder, searched } from '../source-files';

/**
 * No browser test presses a control by calling `el.click()` inside the page
 * (#1003; global rule, Shyden 2026-10-31: every UI test drives the product
 * through real input, never a script). Presses go through `tapOn`
 * (`tests/real-touch.ts`) or a real key press. The scan is proven on
 * synthetic input in `tests/unit/in-page-clicks.test.ts`.
 */
const SUITES = [
  'tests/e2e',
  'tests/dev',
  'tests/prod',
  'tests/functions',
  'tests/device',
];
// The iPhone driver's presses are shyden-labs/shyden.co.uk#838's (real taps
// through WebDriverAgent); it joins this guard when that lands.
const IPHONE_DRIVER = 'tests/device/ios/';

const files = SUITES.flatMap((dir) =>
  filesUnder(
    dir,
    (path) => /\.ts$/.test(path) && !path.startsWith(IPHONE_DRIVER),
  ),
).map((path) => ({
  path,
  clicks: inPageClicks(readFileSync(path, 'utf8'), path),
  presses: directPresses(readFileSync(path, 'utf8'), path),
}));

describe('every browser test presses with real input (#1003)', () => {
  it('no browser test calls el.click() inside the page', () => {
    const counts = Object.fromEntries(
      searched(files, { of: files, what: 'browser test files' })
        .filter(({ clicks }) => clicks.length > 0)
        .map(({ path, clicks }) => [path, clicks.length]),
    );
    expect(counts).toEqual({});
  });

  // #1034: focus(), hover(), click() and dblclick() reach a control by script
  // or protocol; a browser test goes through tapOn, doubleTapOn, scrollToOn
  // (tests/real-touch.ts) or tabTo (tests/tab-to.ts) instead. Proven on
  // synthetic input in tests/unit/direct-presses.test.ts.
  it('no browser test calls focus(), hover(), click() or dblclick() itself', () => {
    const found = Object.fromEntries(
      searched(files, { of: files, what: 'browser test files' })
        .filter(({ presses }) => presses.length > 0)
        .map(({ path, presses }) => [
          path,
          presses.map(({ line, call }) => `${line}:${call}`),
        ]),
    );
    expect(found).toEqual({});
  });
});
