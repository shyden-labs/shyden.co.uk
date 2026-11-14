/**
 * Booted iOS simulators, as `xcrun simctl` lists them (#1157). The device
 * run uses one only when `IOS_UDID` names it; otherwise the USB iPhone runs,
 * so an absent phone never falls through to a simulator unasked.
 */

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
    const found = list.find((d) => d?.udid === udid && d.state === 'Booted');
    if (found !== undefined && version !== null)
      return {
        udid,
        name: String(found.name),
        osVersion: `${version[1]}.${version[2]}`,
      };
  }
  return null;
}
