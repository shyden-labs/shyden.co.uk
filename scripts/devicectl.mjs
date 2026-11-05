/**
 * Every `xcrun devicectl` read the iOS leg makes, with a deadline, and the one
 * reading of what it lists (#390).
 *
 * The runner (`scripts/test-devices.mjs`) and the iOS session
 * (`tests/device/ios/session.ts`) each read the listing through their own
 * copy of the parsing, because plain Node cannot load the session's module
 * graph. Only the runner's copy had been taught to name a listing of another
 * shape instead of throwing a bare TypeError, and neither call had a deadline,
 * so a wedged `devicectl` blocked the event loop that would have fired the
 * test timeout. The session can import a plain module, so both now read
 * through this one.
 *
 * Held by `tests/unit/devicectl.test.ts`, and by `device-tool-homes.test.ts`,
 * which refuses any other file that spawns `xcrun`.
 */

import { runWithDeadline } from './run-with-deadline.mjs';

/**
 * How long one listing may take. `devicectl list devices` answers in well under
 * a second on a healthy Mac, so this is room for a slow CoreDevice while a
 * wedged one still fails inside a test's budget.
 */
export const DEVICECTL_TIMEOUT_MS = 15_000;

/**
 * Measured: with the path argument `-`, devicectl prints its table to STDERR
 * and pure JSON to STDOUT, so stdout is the listing with nothing to strip.
 */
const LIST_ARGS = ['devicectl', 'list', 'devices', '--json-output', '-'];

/**
 * The devices `xcrun devicectl` lists, as the JSON text it printed. Throws,
 * naming the command, when it fails or gives no answer within `timeoutMs`.
 *
 * @param {{ timeoutMs?: number }} [options]
 * @returns {string}
 */
export function listDevices({ timeoutMs = DEVICECTL_TIMEOUT_MS } = {}) {
  return runWithDeadline('xcrun', LIST_ARGS, {
    timeoutMs,
    whenSilent: 'is the iPhone still connected and trusted?',
  });
}

/**
 * The `xcrun` arguments that open Safari on `url` on the iPhone `udid`,
 * closing any Safari already running there first, so the run starts on a
 * page it chose (#859; measured 2026-10-31 with `about:blank` and `https://`
 * URLs: the page is listed to the Web Inspector in 0.14-0.26 s).
 *
 * @param {string} udid
 * @param {string} url
 * @returns {string[]}
 */
export function safariLaunchArgs(udid, url) {
  return [
    'devicectl',
    'device',
    'process',
    'launch',
    '--device',
    udid,
    '--terminate-existing',
    '--payload-url',
    url,
    'com.apple.mobilesafari',
  ];
}

/**
 * Opens Safari on `url` on the iPhone `udid`. Throws, naming the command,
 * when it fails or gives no answer within `timeoutMs`.
 *
 * @param {string} udid
 * @param {string} url
 * @param {{ timeoutMs?: number }} [options]
 * @returns {string}
 */
export function launchSafari(
  udid,
  url,
  { timeoutMs = DEVICECTL_TIMEOUT_MS } = {},
) {
  return runWithDeadline('xcrun', safariLaunchArgs(udid, url), {
    timeoutMs,
    whenSilent: 'is the iPhone still connected, trusted and unlocked?',
  });
}

/**
 * The one physical iPhone to drive, read from `listDevices()`, or why there is
 * none. `udid` is `IOS_UDID`, which chooses among several.
 *
 * The phone's classic UDID is `hardwareProperties.udid`, the one the Web
 * Inspector's `expectedUdid` is checked against. devicectl's top-level
 * `identifier` is a CoreDevice UUID, a different value that would silently
 * name the wrong phone (measured on a live device).
 *
 * @param {string} raw
 * @param {string | undefined} udid
 * @returns {{ device: { udid: string, name: string, osVersion: string } } | { absence: string }}
 */
export function pickIphone(raw, udid) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      absence:
        `expected \`xcrun devicectl list devices --json-output -\` to print JSON on stdout -- got: ` +
        `${raw.slice(0, 300)}`,
    };
  }
  const devices = parsed?.result?.devices;
  if (
    !Array.isArray(devices) ||
    !devices.every(
      (d) =>
        typeof d?.hardwareProperties === 'object' &&
        d.hardwareProperties !== null,
    )
  ) {
    return {
      absence: `expected \`xcrun devicectl list devices\` to list result.devices[].hardwareProperties -- got ${JSON.stringify(parsed)}`,
    };
  }
  const physicalIphones = devices.filter(
    (d) =>
      d.hardwareProperties.reality === 'physical' &&
      d.hardwareProperties.deviceType === 'iPhone',
  );
  const candidates = udid
    ? physicalIphones.filter((d) => d.hardwareProperties.udid === udid)
    : physicalIphones;

  if (candidates.length === 0) {
    return {
      absence: udid
        ? `expected \`xcrun devicectl list devices\` to include a physical iPhone with udid ${udid} ` +
          `(from IOS_UDID) -- none found; physical iPhones seen: ${JSON.stringify(physicalIphones.map((d) => d.hardwareProperties.udid))}`
        : 'expected `xcrun devicectl list devices` to list at least one physical iPhone -- none found. ' +
          'Is it connected, paired and trusted? (Set IOS_UDID to target one by UDID.)',
    };
  }
  if (candidates.length > 1) {
    return {
      absence:
        `expected exactly one physical iPhone to target -- found ${candidates.length}: ` +
        `${JSON.stringify(candidates.map((d) => d.hardwareProperties.udid))}. Set IOS_UDID to disambiguate.`,
    };
  }

  const [chosen] = candidates;
  const name = chosen.deviceProperties?.name;
  const osVersion = chosen.deviceProperties?.osVersionNumber;
  if (typeof name !== 'string' || typeof osVersion !== 'string') {
    return {
      absence: `expected the iPhone ${chosen.hardwareProperties.udid} to report deviceProperties.name and .osVersionNumber -- got ${JSON.stringify(chosen)}`,
    };
  }
  return { device: { udid: chosen.hardwareProperties.udid, name, osVersion } };
}
