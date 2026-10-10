import { describe, expect, it } from 'vitest';
import {
  ADB_TIMEOUT_MS,
  androidAbsence,
  renderedScreen,
} from '../../scripts/adb.mjs';

/**
 * Every `adb` call the device leg makes goes through `scripts/adb.mjs` (#390).
 *
 * Nineteen calls across five files were bare `execFileSync('adb', ...)` with no
 * deadline. A wedged phone leaves `adb shell` waiting, and a synchronous wait
 * blocks the worker's event loop, so not even Playwright's test timeout can
 * fire: the gauntlet hangs with nothing to say why. That every call goes
 * through it is held by `device-tool-homes.test.ts`.
 */

describe('adb()', () => {
  it('allows fifteen seconds by default', () => {
    expect(ADB_TIMEOUT_MS).toBe(15_000);
  });
});

describe('androidAbsence: a phone is present only when adb calls it ready', () => {
  const listing = (...lines: string[]) =>
    ['List of devices attached', ...lines, ''].join('\n');

  it('finds one ready phone', () => {
    expect(androidAbsence(listing('R58M123\tdevice'), undefined)).toBeNull();
  });

  it('refuses a phone that is attached but not ready, listing what it saw', () => {
    expect(
      androidAbsence(
        listing('R58M123\tunauthorized', 'emulator-5554\toffline'),
        undefined,
      ),
    ).toBe(
      "`adb devices` listed no device in state 'device' (unplugged, asleep, offline, or unauthorized otherwise) -- seen: " +
        '[{"serial":"R58M123","state":"unauthorized"},{"serial":"emulator-5554","state":"offline"}]',
    );
  });

  it('refuses no phone at all', () => {
    expect(androidAbsence(listing(), undefined)).toContain('seen: []');
  });

  it('refuses two ready phones without a serial to choose', () => {
    expect(
      androidAbsence(listing('R58M123\tdevice', 'R58M456\tdevice'), undefined),
    ).toBe(
      'expected exactly one ready Android device -- found 2: ' +
        '[{"serial":"R58M123","state":"device"},{"serial":"R58M456","state":"device"}]. Set ANDROID_SERIAL to disambiguate.',
    );
  });

  it('takes the phone ANDROID_SERIAL names among two', () => {
    expect(
      androidAbsence(listing('R58M123\tdevice', 'R58M456\tdevice'), 'R58M456'),
    ).toBeNull();
  });

  it('refuses a serial that is not attached, naming it', () => {
    expect(androidAbsence(listing('R58M123\tdevice'), 'R58M999')).toBe(
      "`adb devices` did not list serial R58M999 (from ANDROID_SERIAL) in state 'device' -- " +
        'seen: [{"serial":"R58M123","state":"device"}]',
    );
  });
});

describe('renderedScreen: the width and density the browser renders at', () => {
  // Measured on the leg's phone: `wm density` prints the physical line and then
  // the override, and the browser renders at the override.
  it('reads a screen with no override', () => {
    expect(
      renderedScreen('Physical size: 1440x3120\n', 'Physical density: 640\n'),
    ).toEqual({ width: 1440, density: 640 });
  });

  it('takes the override density over the physical one', () => {
    expect(
      renderedScreen(
        'Physical size: 1440x3120\n',
        'Physical density: 640\nOverride density: 560\n',
      ),
    ).toEqual({ width: 1440, density: 560 });
  });

  it('takes the override size over the physical one', () => {
    expect(
      renderedScreen(
        'Physical size: 1440x3120\nOverride size: 1080x2340\n',
        'Physical density: 640\n',
      ),
    ).toEqual({ width: 1080, density: 640 });
  });

  it('refuses size output with no size in it, quoting what adb printed', () => {
    expect(() =>
      renderedScreen(
        'error: no devices/emulators found\n',
        'Physical density: 640\n',
      ),
    ).toThrow(
      '`adb shell wm size` printed no WxH size: "error: no devices/emulators found\\n"',
    );
  });

  it('refuses density output with no number in it, quoting what adb printed', () => {
    expect(() =>
      renderedScreen(
        'Physical size: 1440x3120\n',
        'Physical density: unknown\n',
      ),
    ).toThrow(
      '`adb shell wm density` printed no density: "Physical density: unknown\\n"',
    );
  });
});
