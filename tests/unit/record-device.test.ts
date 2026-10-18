import { describe, expect, it } from 'vitest';
import {
  DEVICE_RECORD_COMMAND,
  RECORD_ENV,
  measureDevice,
  recordUntilSettled,
} from '../../scripts/record-floors.mjs';

/**
 * `npm run floors:record -- --device` (#623): the iPhone journeys' floors,
 * measured on the phone, since no other record can reach them. Every process
 * is stood in: the device listing, the run, and the file it wrote.
 */
const iphone = (udid: string) => ({
  hardwareProperties: { udid, reality: 'physical', deviceType: 'iPhone' },
  deviceProperties: { name: `iPhone ${udid}`, osVersionNumber: '26.1' },
});
const listing =
  (...devices: unknown[]) =>
  () =>
    JSON.stringify({ result: { devices } });

/** A run stand-in that fails the test if the record reaches it. */
const neverRun = () => {
  throw new Error('the iPhone journeys ran with no iPhone to run on');
};

const site = 'tests/device/ios/journeys.journey.ts:400';
const seen = [
  { id: 'ios/dealt-cards', actual: 3, site },
  { id: 'ios/board-cards', actual: 5, site: `${site}1` },
];

describe('measureDevice: the iPhone journeys, or why not (#623)', () => {
  it('refuses with no iPhone attached, naming the absence, before running anything', () => {
    expect(
      measureDevice({
        list: listing(),
        udid: undefined,
        run: neverRun,
        read: () => [],
      }),
    ).toMatch(/^no iPhone to record the device floors on: .*iPhone/);
  });

  it('refuses a listing that failed, naming why, never reading it as a phone', () => {
    expect(
      measureDevice({
        list: () => {
          throw new Error('xcrun devicectl list devices timed out');
        },
        udid: undefined,
        run: neverRun,
        read: () => [],
      }),
    ).toBe(
      'no iPhone to record the device floors on: xcrun devicectl list ' +
        'devices timed out',
    );
  });

  it('refuses a UDID that is not attached, though another iPhone is', () => {
    expect(
      measureDevice({
        list: listing(iphone('00008101-A')),
        udid: '00008101-B',
        run: neverRun,
        read: () => [],
      }),
    ).toMatch(/^no iPhone to record the device floors on: .*00008101-B/);
  });

  it('refuses a run that failed: nothing it wrote is trusted', () => {
    expect(
      measureDevice({
        list: listing(iphone('00008101-A')),
        udid: undefined,
        run: () => ({ status: 1 }),
        read: () => seen,
      }),
    ).toBe(
      'the iPhone journeys failed in record mode (exit 1): nothing recorded',
    );
  });

  it('refuses a passing run that recorded no floor, naming the variable that never reached it', () => {
    expect(
      measureDevice({
        list: listing(iphone('00008101-A')),
        udid: undefined,
        run: () => ({ status: 0 }),
        read: () => [],
      }),
    ).toBe(
      `the iPhone journeys passed and recorded no floor: ${RECORD_ENV} never ` +
        'reached them, so nothing was measured',
    );
  });

  it("returns a fake run's counts as it read them", () => {
    expect(
      measureDevice({
        list: listing(iphone('00008101-A')),
        udid: undefined,
        run: () => ({ status: 0 }),
        read: () => seen,
      }),
    ).toEqual(seen);
  });
});

describe('a device record writes what the phone counted, and only upward (#623)', () => {
  const onPhone = (observed: typeof seen) => () =>
    measureDevice({
      list: listing(iphone('00008101-A')),
      udid: undefined,
      run: () => ({ status: 0 }),
      read: () => observed,
    });

  it("writes a fake run's counts: one new, one raised, the rest carried", () => {
    const { next, refusals, failure } = recordUntilSettled({
      recorded: { 'ios/board-cards': 4, 'unit/files': 9 },
      measure: onPhone(seen),
      // A pass that adds ids measures again; the phone reads the same.
      carry: () => ['unit/files'],
    });
    expect({ next, refusals, failure }).toEqual({
      next: { 'ios/board-cards': 5, 'ios/dealt-cards': 3, 'unit/files': 9 },
      refusals: [],
      failure: undefined,
    });
  });

  it('refuses a fall the phone reports', () => {
    const { refusals } = recordUntilSettled({
      recorded: { 'ios/board-cards': 6, 'ios/dealt-cards': 3 },
      measure: onPhone(seen),
    });
    expect(refusals).toEqual([
      'ios/board-cards would fall from 6 to 5: a blind reader looks like ' +
        'this. If the corpus really shrank, lower it in tests/floors.json by ' +
        'hand and say why in the commit.',
    ]);
  });

  it('stops the record at a phone that is not there, measuring nothing', () => {
    const { failure, passes } = recordUntilSettled({
      recorded: { 'ios/board-cards': 5 },
      measure: () =>
        measureDevice({
          list: listing(),
          udid: undefined,
          run: neverRun,
          read: () => [],
        }),
    });
    expect({ failure, passes }).toEqual({
      failure: expect.stringMatching(
        /^no iPhone to record the device floors on: /,
      ),
      passes: 1,
    });
  });
});

describe('the run a device record starts (#623)', () => {
  it("is the device runner's iOS group alone: one build, one phone, no emulated browser", () => {
    expect(DEVICE_RECORD_COMMAND).toEqual({
      file: 'npm',
      args: ['run', 'test:devices', '--', '--ios'],
    });
  });
});
