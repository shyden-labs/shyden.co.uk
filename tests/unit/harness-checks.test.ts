import { describe, it, expect } from 'vitest';
import {
  chromeRelaunchFailure,
  clockProbeFailure,
  emulatedScreenFailure,
} from '../device/harness-checks';

/**
 * The Android harness's own checks (#1178). They were five tests in
 * tests/device/real-device.spec.ts that ran on the phone alone, so the phone's total differed
 * from every other target's. The checks now run inside the phone's fixtures, and these verdicts
 * decide them: each returns the failure to report, or null when the check holds.
 */

describe('the phone is the real screen, not an emulated profile', () => {
  // A OnePlus at 1080x2400, density 480: dpr 3, CSS width 360.
  const screen = { width: 1080, density: 480 };
  const real = {
    ua: 'Mozilla/5.0 (Linux; Android 15) Chrome/142.0 Mobile Safari/537.36',
    touchPoints: 5,
    dpr: 3,
    cssWidth: 360,
  };

  it('holds when the browser reports the screen adb reports', () => {
    expect(emulatedScreenFailure(real, screen)).toBeNull();
  });

  it('fails a browser that is not Android, naming its user agent', () => {
    const desktop = { ...real, ua: 'Mozilla/5.0 (Macintosh) Chrome/142.0' };
    expect(emulatedScreenFailure(desktop, screen)).toMatch(/Macintosh/);
  });

  it('fails a browser with no touch points', () => {
    expect(emulatedScreenFailure({ ...real, touchPoints: 0 }, screen)).toMatch(
      /touch/,
    );
  });

  it("fails a device pixel ratio that is not the screen's density / 160", () => {
    expect(emulatedScreenFailure({ ...real, dpr: 2.625 }, screen)).toMatch(
      /2\.625.*3/,
    );
  });

  it("fails a CSS width that is not the screen's width / dpr", () => {
    expect(emulatedScreenFailure({ ...real, cssWidth: 412 }, screen)).toMatch(
      /412.*360/,
    );
  });

  it('allows the half-pixel rounding the original test allowed', () => {
    expect(
      emulatedScreenFailure({ ...real, cssWidth: 360.4 }, screen),
    ).toBeNull();
  });
});

describe('Chrome is the same process at the end of a test as at its start (#807)', () => {
  it('holds when the pid is unchanged', () => {
    expect(chromeRelaunchFailure('31337', '31337')).toBeNull();
  });

  it('fails a relaunch, naming both pids', () => {
    expect(chromeRelaunchFailure('31337', '31402')).toMatch(/31337.*31402/);
  });

  it('fails when Chrome is gone at the end', () => {
    expect(chromeRelaunchFailure('31337', '')).toMatch(/not running/);
  });

  it('fails when Chrome was not running at the start', () => {
    expect(chromeRelaunchFailure('', '31337')).toMatch(/not running/);
  });
});

describe('a fake clock never outlives the worker that installed it (#854)', () => {
  const fake = { fakeClock: true, nativeFrames: false };
  const real = { fakeClock: false, nativeFrames: true };

  it('holds for real time where none may be', () => {
    expect(clockProbeFailure(real, 'none')).toBeNull();
  });

  it("fails a leftover clock on an untagged worker's page, naming #854", () => {
    expect(clockProbeFailure(fake, 'none')).toMatch(/#854/);
  });

  it('fails patched frames even with no clock object', () => {
    expect(
      clockProbeFailure({ fakeClock: false, nativeFrames: false }, 'none'),
    ).not.toBeNull();
  });

  it('holds for a clock where one was installed: the probe can see one', () => {
    expect(clockProbeFailure(fake, 'installed')).toBeNull();
  });

  it('fails a probe that sees no clock where one was installed', () => {
    expect(clockProbeFailure(real, 'installed')).toMatch(/probe/);
  });
});
