/**
 * Runs one of the device leg's command-line tools with a deadline (#390).
 *
 * A synchronous call to a wedged phone blocks the event loop that would have
 * fired the test timeout, so the gauntlet hangs with nothing to say why. Here
 * a call that runs past its deadline is stopped, and the error names the
 * command. `scripts/adb.mjs` and `scripts/devicectl.mjs` are its callers.
 */

import { execFileSync } from 'node:child_process';
import { messageOf } from './errors.mjs';

/**
 * Runs `file` with `args` and returns what it printed on stdout. Throws, naming
 * the command, when it fails or gives no answer within `timeoutMs`, and then
 * adds `whenSilent`, the question worth asking about the device.
 *
 * @param {string} file
 * @param {readonly string[]} args
 * @param {{ timeoutMs: number, whenSilent: string }} options
 * @returns {string}
 */
export function runWithDeadline(file, args, { timeoutMs, whenSilent }) {
  const command = `${file} ${args.join(' ')}`;
  try {
    return execFileSync(file, [...args], {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const timedOut =
      error instanceof Error && 'code' in error && error.code === 'ETIMEDOUT';
    throw new Error(
      timedOut
        ? `${command} gave no answer within ${timeoutMs} ms: ${whenSilent}`
        : `${command} failed${printed(error)}`,
      { cause: error },
    );
  }
}

/**
 * What a failed command said, in its own words: its exit status and each
 * stream it printed on. A phone run once failed on "uiautomator dump failed:
 * Command failed" and nothing more, because these were dropped (#1027).
 *
 * @param {unknown} error
 * @returns {string}
 */
function printed(error) {
  if (!(error instanceof Error) || !('status' in error))
    return `: ${messageOf(error)}`;
  const fields = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (error)
  );
  const streams = ['stderr', 'stdout']
    .map((name) => [name, String(fields[name] ?? '').trim()])
    .filter(([, text]) => text !== '')
    .map(([name, text]) => `${name} ${JSON.stringify(text)}`);
  return ` with exit status ${error.status}: ${
    streams.length === 0 ? 'it printed nothing' : streams.join(' ')
  }`;
}
