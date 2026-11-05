import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resetDeviceCaptureCounters,
  shootDevice,
} from '../device/ios/evidence';
import { fakeDriver } from '../device-evidence-shared';

afterEach(() => {
  vi.unstubAllEnvs();
  resetDeviceCaptureCounters();
});

describe('the device leg writes the same evidence every other leg does', () => {
  it('captures nothing, and does not even ask the phone, when EVIDENCE_DIR is unset', async () => {
    vi.stubEnv('EVIDENCE_DIR', '');
    const driver = fakeDriver();

    const file = await shootDevice(driver, {
      project: 'ios-safari-real-device',
      title: 'Journey 14 -- the board on a refused grant',
      label: 'nothing out of reach',
    });

    expect(file, 'an unasked-for capture reported no file').toBeNull();
    expect(
      driver.calls(),
      'a screenshot round-trip to a real phone costs a second per shot, so an ' +
        'ordinary run must not pay it',
    ).toBe(0);
  });
});
