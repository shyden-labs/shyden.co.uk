/**
 * Booted iOS simulators, as `xcrun simctl` lists them (#1157). The device
 * run uses one only when `IOS_UDID` names it; otherwise the USB iPhone runs,
 * so an absent phone never falls through to a simulator unasked.
 */

import { runWithDeadline } from './run-with-deadline.mjs';

/** `simctl` answers in well under a second; room for a slow CoreSimulator. */
export const SIMCTL_TIMEOUT_MS = 15_000;

export const SIMULATOR_LIST_ARGS = [
  'simctl',
  'list',
  'devices',
  'booted',
  '-j',
];

/** The booted simulators, as the JSON `xcrun simctl` printed. @returns {string} */
export function listBootedSimulators() {
  return runWithDeadline('xcrun', SIMULATOR_LIST_ARGS, {
    timeoutMs: SIMCTL_TIMEOUT_MS,
    whenSilent:
      'is CoreSimulator wedged? (xcrun simctl list answers in under a second)',
  });
}

/**
 * The page the simulator's Safari starts on: the Mac's own dev server, which
 * a simulator reaches on loopback. Not `about:blank`: measured 2026-11-14,
 * `openurl about:blank` is refused (LaunchServices error 115), and a Safari
 * with no page is not listed to the Web Inspector.
 *
 * @param {number} port
 */
export function simulatorStartPage(port) {
  return `http://127.0.0.1:${port}/`;
}

/** @param {string} udid @param {string} url @returns {string[]} */
export function simulatorSafariArgs(udid, url) {
  return ['simctl', 'openurl', udid, url];
}

/** @param {string} udid @returns {string[]} */
export function simulatorSafariQuitArgs(udid) {
  return ['simctl', 'terminate', udid, 'com.apple.mobilesafari'];
}

/**
 * Whether closing Safari failed only because it was not running: simctl
 * exits 3 with "found nothing to terminate" (measured 2026-11-16).
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function nothingToTerminate(error) {
  return (
    error instanceof Error && /found nothing to terminate/.test(error.message)
  );
}

// openurl just after a boot timed out at load 122-489 (2026-11-14).
const SIMCTL_SAFARI = {
  timeoutMs: 60_000,
  whenSilent: 'is the simulator still booting, or the Mac overloaded?',
};

/**
 * Opens `url` in a freshly started Safari on the simulator. A Safari left
 * from an earlier device run was not listed to the Web Inspector again (run 9,
 * 2026-11-16: 80 skipped); one closed first and started by openurl was, every
 * time, on the page in 3 s (#1157).
 *
 * @param {string} udid @param {string} url @returns {string}
 */
export function openSimulatorSafari(udid, url) {
  try {
    runWithDeadline('xcrun', simulatorSafariQuitArgs(udid), SIMCTL_SAFARI);
  } catch (error) {
    if (!nothingToTerminate(error)) throw error;
  }
  return runWithDeadline(
    'xcrun',
    simulatorSafariArgs(udid, url),
    SIMCTL_SAFARI,
  );
}

const RUNTIME = /SimRuntime\.iOS-(\d+)-(\d+)$/;

/**
 * @param {string} raw `xcrun simctl list devices booted -j`
 * @param {string | undefined} udid `IOS_UDID`
 * @returns {{ udid: string, name: string, osVersion: string } | null}
 */
export function pickSimulator(raw, udid) {
  const devices = JSON.parse(raw)?.devices;
  if (
    typeof devices !== 'object' ||
    devices === null ||
    Array.isArray(devices) ||
    !Object.values(devices).every(Array.isArray)
  )
    throw new Error(
      `expected \`xcrun simctl list devices booted -j\` to list devices by runtime -- got ${raw.slice(0, 300)}`,
    );
  if (!udid) return null;
  for (const [runtime, list] of Object.entries(devices)) {
    const version = RUNTIME.exec(runtime);
    const found = list.find(
      (
        /** @type {{ udid?: unknown, state?: unknown, name?: unknown } | null} */ d,
      ) => d?.udid === udid && d.state === 'Booted',
    );
    if (found !== undefined && version !== null)
      return {
        udid,
        name: String(found.name),
        osVersion: `${version[1]}.${version[2]}`,
      };
  }
  return null;
}
