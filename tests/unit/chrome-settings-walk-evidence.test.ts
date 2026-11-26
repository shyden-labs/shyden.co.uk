import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

/**
 * #1272 AC2: when Chrome's settings walk fails, it keeps what the phone's
 * screen showed (a screenshot and a uiautomator dump) in the run's results,
 * and its error names both files, so the next failure says what the walk met.
 * adb is stood in, so no process starts.
 */

const DIR = '/results/android-chrome';

const withPhone = async (answer: (args: string[]) => string) => {
  const calls: string[][] = [];
  vi.resetModules();
  vi.doMock('../../scripts/adb.mjs', () => ({
    adb: (args: string[]) => {
      calls.push(args);
      return answer(args);
    },
  }));
  const { setChromeJavaScript } =
    await import('../device/chrome-javascript-setting');
  return { setChromeJavaScript, calls };
};

/** Chrome fails to start: the walk's first step, so the test needs no sleeps. */
const chromeWontStart = (args: string[]) => {
  if (args.includes('am'))
    throw new Error('adb shell am start: no such activity');
  return '';
};

describe("Chrome's settings walk keeps the screen it failed on (#1272)", () => {
  it('saves a screenshot and a UI dump, and names both in its error', async () => {
    const { setChromeJavaScript, calls } = await withPhone(chromeWontStart);

    const failure = setChromeJavaScript(true, { evidenceDir: DIR });

    await expect(failure).rejects.toThrow(
      `adb shell am start: no such activity; the screen it met: ${join(DIR, 'chrome-settings-walk-1.png')} and ${join(DIR, 'chrome-settings-walk-1.xml')}`,
    );
    expect(calls.slice(1)).toEqual([
      ['shell', 'screencap', '-p', '/sdcard/chrome-settings-walk.png'],
      [
        'pull',
        '/sdcard/chrome-settings-walk.png',
        join(DIR, 'chrome-settings-walk-1.png'),
      ],
      ['shell', 'uiautomator', 'dump', '/sdcard/ui.xml'],
      ['pull', '/sdcard/ui.xml', join(DIR, 'chrome-settings-walk-1.xml')],
    ]);
  });

  it('numbers each failure, so a second never overwrites the first', async () => {
    const { setChromeJavaScript } = await withPhone(chromeWontStart);

    await expect(
      setChromeJavaScript(true, { evidenceDir: DIR }),
    ).rejects.toThrow('chrome-settings-walk-1.png');
    await expect(
      setChromeJavaScript(true, { evidenceDir: DIR }),
    ).rejects.toThrow('chrome-settings-walk-2.png');
  });

  it('still fails with its own message when the screen cannot be captured', async () => {
    const { setChromeJavaScript } = await withPhone((args) => {
      if (args.includes('screencap')) throw new Error('adb: device offline');
      return chromeWontStart(args);
    });

    await expect(
      setChromeJavaScript(true, { evidenceDir: DIR }),
    ).rejects.toThrow(
      'adb shell am start: no such activity; the screen could not be captured: adb: device offline',
    );
  });
});
