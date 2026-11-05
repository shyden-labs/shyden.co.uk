import { afterEach, describe, expect, it } from 'vitest';
import { listDevices } from '../../scripts/devicectl.mjs';
import { standInOnPath } from '../path-stand-in';

/**
 * Every `xcrun devicectl` read the iOS leg makes, and the one reading of what
 * it lists (#390).
 *
 * The runner and the iOS session each read the listing through their own copy
 * of the parsing. The runner's was hardened to name a listing of another shape
 * rather than throw a bare TypeError, and the session's never was; neither
 * call had a deadline, so a wedged `devicectl` blocked the event loop that
 * would have fired the test timeout.
 */

/** Prints `$LISTING`, fails on `fail`, and never answers on `hang`. */
const STAND_IN = `#!/bin/sh
if [ "$XCRUN_STAND_IN" = hang ]; then exec sleep 30; fi
if [ "$XCRUN_STAND_IN" = fail ]; then echo "devicectl: CoreDevice is not running" >&2; exit 1; fi
echo "args: $*"
`;

describe('listDevices()', () => {
  standInOnPath('xcrun', STAND_IN);
  afterEach(() => {
    delete process.env.XCRUN_STAND_IN;
  });

  it('asks devicectl for its JSON listing on stdout, and returns it', () => {
    expect(listDevices()).toBe(
      'args: devicectl list devices --json-output -\n',
    );
  });

  it('names the command and the cause when devicectl gives no answer in time', () => {
    process.env.XCRUN_STAND_IN = 'hang';
    const started = Date.now();
    expect(() => listDevices({ timeoutMs: 300 })).toThrow(
      /^xcrun devicectl list devices --json-output - gave no answer within 300 ms: is the iPhone still connected and trusted\?$/,
    );
    // Stopped at its deadline, not when the stand-in's 30 s ran out.
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("names the command and devicectl's own words when it fails", () => {
    process.env.XCRUN_STAND_IN = 'fail';
    expect(() => listDevices()).toThrow(
      /^xcrun devicectl list devices --json-output - failed: [\s\S]*CoreDevice is not running/,
    );
  });
});
