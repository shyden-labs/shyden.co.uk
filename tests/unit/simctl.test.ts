import { describe, expect, it } from 'vitest';
import {
  pickSimulator,
  SIMULATOR_LIST_ARGS,
  nothingToTerminate,
  simulatorSafariArgs,
  simulatorSafariQuitArgs,
  simulatorStartPage,
} from '../../scripts/simctl.mjs';

/**
 * The device run uses a simulator only when `IOS_UDID` names a booted one
 * (#1157); otherwise the USB iPhone path runs as before (AC5). The listing's
 * shape is `xcrun simctl list devices booted -j` as read on 2026-11-14.
 */

const SIM = '1955585D-532E-4881-9E5F-593D91EE1062';
const listing = (devices: Record<string, unknown[]>) =>
  JSON.stringify({ devices });
const BOOTED = listing({
  'com.apple.CoreSimulator.SimRuntime.iOS-27-1': [],
  'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
    {
      udid: SIM,
      isAvailable: true,
      deviceTypeIdentifier:
        'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro',
      state: 'Booted',
      name: 'iPhone 18 Pro',
    },
  ],
});

describe('pickSimulator', () => {
  it('picks the booted simulator IOS_UDID names, with its runtime version', () =>
    expect(pickSimulator(BOOTED, SIM)).toEqual({
      udid: SIM,
      name: 'iPhone 18 Pro',
      osVersion: '27.0',
    }));

  it('is null when IOS_UDID is unset, so the USB iPhone runs', () =>
    expect(pickSimulator(BOOTED, undefined)).toBeNull());

  it('is null when IOS_UDID names no booted simulator, so the USB iPhone runs', () =>
    expect(pickSimulator(BOOTED, '00008150-000954D90A20401C')).toBeNull());

  it('ignores a listed simulator that is not booted', () =>
    expect(
      pickSimulator(
        listing({
          'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
            { udid: SIM, state: 'Shutdown', name: 'iPhone 18 Pro' },
          ],
        }),
        SIM,
      ),
    ).toBeNull());

  it('names the listing when it is not the expected shape', () =>
    expect(() => pickSimulator('{"devices": []}', SIM)).toThrow(
      'expected `xcrun simctl list devices booted -j` to list devices by runtime -- got {"devices": []}',
    ));
});

describe('the simulator reads and launches (#1157)', () => {
  it('lists only booted simulators, as JSON', () =>
    expect(SIMULATOR_LIST_ARGS).toEqual([
      'simctl',
      'list',
      'devices',
      'booted',
      '-j',
    ]));

  // Measured 2026-11-14: `openurl about:blank` is refused (LaunchServices
  // error 115), and a Safari relaunched with no page was not listed to the
  // Web Inspector within 30 s; one opened on a real page attached in 4.7 s.
  it('opens Safari on a real page, through openurl', () =>
    expect(simulatorSafariArgs('SIM-1', 'http://127.0.0.1:4321/')).toEqual([
      'simctl',
      'openurl',
      'SIM-1',
      'http://127.0.0.1:4321/',
    ]));

  // #1157, measured 2026-11-16: after one device run ended, the next found no
  // Safari listed to the Web Inspector (run 9: 80 skipped), and a Safari
  // closed and opened again was listed every time. A cold openurl starts
  // Safari on the page in 3 s.
  it('closes Safari before opening the page, so each run attaches to a fresh one', () =>
    expect(simulatorSafariQuitArgs('SIM-1')).toEqual([
      'simctl',
      'terminate',
      'SIM-1',
      'com.apple.mobilesafari',
    ]));

  it('accepts a Safari that was not running, and nothing else, when closing it', () => {
    expect(
      nothingToTerminate(
        new Error(
          'xcrun simctl terminate SIM-1 com.apple.mobilesafari failed: status 3, stderr "An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=3):\nSimulator device failed to terminate com.apple.mobilesafari.\nfound nothing to terminate"',
        ),
      ),
    ).toBe(true);
    expect(
      nothingToTerminate(
        new Error(
          'xcrun simctl terminate SIM-1 com.apple.mobilesafari gave no answer within 60000 ms: is the simulator still booting, or the Mac overloaded?',
        ),
      ),
    ).toBe(false);
  });

  it("starts on the Mac's own dev server, which a simulator reaches on loopback", () =>
    expect(simulatorStartPage(4321)).toBe('http://127.0.0.1:4321/'));
});
