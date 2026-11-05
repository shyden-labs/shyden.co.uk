/**
 * Every `adb` call the device leg makes, with a deadline (#390).
 *
 * Nineteen calls across the runner and the device specs were bare
 * `execFileSync('adb', ...)`, with no timeout. A wedged phone leaves
 * `adb shell` waiting for an answer that never comes, and because the call is
 * synchronous it also blocks the event loop that would have fired Playwright's
 * own test timeout, so the gauntlet hung with nothing to say why. Here a call
 * that runs past its deadline is stopped, and the error names the command.
 *
 * One home, imported by `scripts/test-devices.mjs` and by `tests/device/`, and
 * held by `tests/unit/adb.test.ts`; `tests/guards/device-tool-homes.test.ts`
 * refuses any other file that runs `adb` itself. The deadline is
 * `scripts/run-with-deadline.mjs`, shared with `devicectl`.
 */

import { runWithDeadline } from './run-with-deadline.mjs';

/**
 * How long one `adb` call may take. The slowest the device leg makes, a cold
 * `am start`, answers in about two seconds, so this is room for a slow phone
 * while a wedged one still fails inside a test's 30-second budget.
 */
export const ADB_TIMEOUT_MS = 15_000;

/**
 * Runs `adb` with `args` and returns what it printed. Throws, naming the
 * command, when adb fails or gives no answer within `timeoutMs`.
 *
 * @param {readonly string[]} args
 * @param {{ timeoutMs?: number }} [options]
 * @returns {string}
 */
export function adb(args, { timeoutMs = ADB_TIMEOUT_MS } = {}) {
  return runWithDeadline('adb', args, {
    timeoutMs,
    whenSilent: 'is the phone still connected and unlocked?',
  });
}

/**
 * Why no Android phone can be driven, read from `adb devices` output, or
 * `null` when exactly one is ready. `serial` is `ANDROID_SERIAL`, passed in so
 * the decision can be run without a phone (#390).
 *
 * @param {string} raw
 * @param {string | undefined} serial
 * @returns {string | null}
 */
export function androidAbsence(raw, serial) {
  const devices = raw
    .split('\n')
    .slice(1) // drop the "List of devices attached" header line
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state };
    });

  const ready = devices.filter((d) => d.state === 'device');
  const matching = serial ? ready.filter((d) => d.serial === serial) : ready;

  if (matching.length === 0) {
    return serial
      ? `\`adb devices\` did not list serial ${serial} (from ANDROID_SERIAL) in state 'device' -- ` +
          `seen: ${JSON.stringify(devices)}`
      : `\`adb devices\` listed no device in state 'device' (unplugged, asleep, offline, or ` +
          `unauthorized otherwise) -- seen: ${JSON.stringify(devices)}`;
  }
  if (matching.length > 1) {
    return (
      `expected exactly one ready Android device -- found ${matching.length}: ` +
      `${JSON.stringify(matching)}. Set ANDROID_SERIAL to disambiguate.`
    );
  }
  return null;
}

/**
 * The screen width in pixels and the density the browser renders at, read
 * from `adb shell wm size` and `adb shell wm density`.
 *
 * Each takes the LAST value printed. Measured on the leg's phone, `wm density`
 * prints `Physical density: 640` and then `Override density: 560`, and the
 * browser renders at the override; `wm size` prints its override line the
 * same way, second. Taking the first match on one and the last on the other
 * was this parse's original shape, and would take the physical size the day
 * an override is set (#390 F105).
 *
 * @param {string} sizeOutput
 * @param {string} densityOutput
 * @returns {{ width: number, density: number }}
 */
export function renderedScreen(sizeOutput, densityOutput) {
  const size = /(\d+)x\d+\s*$/.exec(sizeOutput.trim());
  if (size === null) {
    throw new Error(
      `\`adb shell wm size\` printed no WxH size: ${JSON.stringify(sizeOutput)}`,
    );
  }
  const density = /(\d+)\s*$/.exec(densityOutput.trim());
  if (density === null) {
    throw new Error(
      `\`adb shell wm density\` printed no density: ${JSON.stringify(densityOutput)}`,
    );
  }
  return { width: Number(size[1]), density: Number(density[1]) };
}
