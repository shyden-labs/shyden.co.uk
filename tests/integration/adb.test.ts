import { describe, expect, it } from 'vitest';
import { adb } from '../../scripts/adb.mjs';
import { standInOnPath } from '../path-stand-in';

/**
 * Every `adb` call the device leg makes goes through `scripts/adb.mjs` (#390).
 *
 * Nineteen calls across five files were bare `execFileSync('adb', ...)` with no
 * deadline. A wedged phone leaves `adb shell` waiting, and a synchronous wait
 * blocks the worker's event loop, so not even Playwright's test timeout can
 * fire: the gauntlet hangs with nothing to say why. That every call goes
 * through it is held by `device-tool-homes.test.ts`.
 */

/** Answers `$1 $2…`, fails on `fail`, and never answers on `hang`. */
const STAND_IN = `#!/bin/sh
if [ "$1" = hang ]; then exec sleep 30; fi
if [ "$1" = fail ]; then echo "no devices/emulators found" >&2; exit 1; fi
echo "answered: $*"
`;

describe('adb()', () => {
  standInOnPath('adb', STAND_IN);

  it('returns what adb printed', () => {
    expect(adb(['shell', 'dumpsys', 'window'])).toBe(
      'answered: shell dumpsys window\n',
    );
  });

  it('names the command and the cause when adb gives no answer in time', () => {
    const started = Date.now();
    expect(() => adb(['hang', 'now'], { timeoutMs: 300 })).toThrow(
      /^adb hang now gave no answer within 300 ms: is the phone still connected and unlocked\?$/,
    );
    // Stopped at its deadline, not when the stand-in's 30 s ran out.
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("names the command and adb's own words when adb fails", () => {
    expect(() => adb(['fail'])).toThrow(
      /^adb fail failed: [\s\S]*no devices\/emulators found/,
    );
  });
});
