import { describe, expect, it } from 'vitest';
import { DEVICECTL_TIMEOUT_MS, pickIphone } from '../../scripts/devicectl.mjs';

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

describe('listDevices()', () => {
  it('allows fifteen seconds by default', () => {
    expect(DEVICECTL_TIMEOUT_MS).toBe(15_000);
  });
});

describe('pickIphone: one physical iPhone, or a reason', () => {
  const device = (
    udid: string,
    { reality = 'physical', deviceType = 'iPhone' } = {},
  ) => ({
    hardwareProperties: { udid, reality, deviceType },
    deviceProperties: { name: `iPhone ${udid}`, osVersionNumber: '26.1' },
  });
  const listing = (...devices: unknown[]) =>
    JSON.stringify({ result: { devices } });
  const found = (udid: string) => ({
    device: { udid, name: `iPhone ${udid}`, osVersion: '26.1' },
  });

  it('finds one physical iPhone, with the name and version it reports', () => {
    expect(pickIphone(listing(device('00008101-A')), undefined)).toEqual(
      found('00008101-A'),
    );
  });

  it('ignores a simulator and an iPad', () => {
    expect(
      pickIphone(
        listing(
          device('SIM-1', { reality: 'virtual' }),
          device('IPAD-1', { deviceType: 'iPad' }),
        ),
        undefined,
      ),
    ).toEqual({
      absence:
        'expected `xcrun devicectl list devices` to list at least one physical iPhone -- none found. ' +
        'Is it connected, paired and trusted? (Set IOS_UDID to target one by UDID.)',
    });
  });

  it('refuses two iPhones without a UDID to choose', () => {
    expect(pickIphone(listing(device('A'), device('B')), undefined)).toEqual({
      absence:
        'expected exactly one physical iPhone to target -- found 2: ["A","B"]. Set IOS_UDID to disambiguate.',
    });
  });

  it('takes the iPhone IOS_UDID names among two', () => {
    expect(pickIphone(listing(device('A'), device('B')), 'B')).toEqual(
      found('B'),
    );
  });

  it('refuses a UDID that is not attached, naming it and what it saw', () => {
    expect(pickIphone(listing(device('A')), 'Z')).toEqual({
      absence:
        'expected `xcrun devicectl list devices` to include a physical iPhone with udid Z ' +
        '(from IOS_UDID) -- none found; physical iPhones seen: ["A"]',
    });
  });

  it('refuses output that is not JSON, quoting it', () => {
    expect(pickIphone('error: devicectl crashed', undefined)).toEqual({
      absence:
        'expected `xcrun devicectl list devices --json-output -` to print JSON on stdout -- got: error: devicectl crashed',
    });
  });

  it.each([
    ['no result', {}],
    ['devices that are not a list', { result: { devices: {} } }],
    ['a device with no hardware properties', { result: { devices: [{}] } }],
  ])('names a listing with %s, rather than a TypeError', (_, shape) => {
    expect(pickIphone(JSON.stringify(shape), undefined)).toEqual({
      absence: `expected \`xcrun devicectl list devices\` to list result.devices[].hardwareProperties -- got ${JSON.stringify(shape)}`,
    });
  });

  it('names an iPhone that reports no name or version, rather than a TypeError', () => {
    const bare = { hardwareProperties: device('A').hardwareProperties };
    expect(pickIphone(listing(bare), undefined)).toEqual({
      absence: `expected the iPhone A to report deviceProperties.name and .osVersionNumber -- got ${JSON.stringify(bare)}`,
    });
  });
});
