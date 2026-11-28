import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #1294: the device leg runs adb and xcrun by their absolute paths, never by
 * a bare name a folder on PATH could stand in for. `runWithDeadline` is stood
 * in so each call's program is read without a phone.
 */
const calls: string[] = [];
vi.mock('../../scripts/run-with-deadline.mjs', () => ({
  runWithDeadline: (file: string) => {
    calls.push(file);
    return '';
  },
}));

const { adb } = await import('../../scripts/adb.mjs');
const { launchSafari, listDevices } =
  await import('../../scripts/devicectl.mjs');
const { ADB, XCRUN } = await import('../../scripts/programs.mjs');

beforeEach(() => {
  calls.length = 0;
});

describe('the device tools run by their absolute paths', () => {
  it('runs adb from where the Mac keeps it', () => {
    adb(['devices']);
    expect(calls).toEqual([ADB]);
  });

  it('lists devices with xcrun from the system folder', () => {
    listDevices();
    expect(calls).toEqual([XCRUN]);
  });

  it('opens Safari with xcrun from the system folder', () => {
    launchSafari('00008110-000A', 'http://localhost:4321/');
    expect(calls).toEqual([XCRUN]);
  });
});
