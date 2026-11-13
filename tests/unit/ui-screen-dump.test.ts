import { describe, expect, it, vi } from 'vitest';

/**
 * Measured on the OPPO (2026-11-08, `classroom-groups-io.spec.ts`): `adb shell
 * uiautomator dump /sdcard/ui.xml` printed "UI hierchary dumped to:
 * /sdcard/ui.xml" and then exited 137, killed after it had written the file
 * (#1027). The dump is read by what the tool says it did; any other failure
 * still fails, naming itself.
 */
const SCREEN =
  '<hierarchy><node text="Fast" class="android.widget.CheckedTextView" bounds="[0,0][10,10]" /></hierarchy>';

const killedAfter = (stdout: string, status = 137) =>
  Object.assign(new Error('adb shell uiautomator dump /sdcard/ui.xml failed'), {
    cause: Object.assign(new Error('Command failed'), { status, stdout }),
  });

const dumpWith = async (dumpError: Error | undefined) => {
  vi.resetModules();
  vi.doMock('../../scripts/adb.mjs', () => ({
    adb: (args: string[]) => {
      if (args.includes('dump') && dumpError) throw dumpError;
      return args.includes('cat') ? SCREEN : '';
    },
  }));
  vi.doMock('../device/chrome-foreground', () => ({
    CHROME_PACKAGE: 'chrome',
  }));
  const { dump } = await import('../device/chrome-javascript-setting');
  return dump;
};

describe('reading the screen with uiautomator', () => {
  it('reads the dump when the tool exits cleanly', async () => {
    const dump = await dumpWith(undefined);
    expect(dump().map((node) => node.text)).toEqual(['Fast']);
  });

  it('reads the dump when the tool was killed after it says it wrote the file', async () => {
    const dump = await dumpWith(
      killedAfter('UI hierchary dumped to: /sdcard/ui.xml\n'),
    );
    expect(dump().map((node) => node.text)).toEqual(['Fast']);
  });

  it('fails when the tool was killed before it says it wrote the file', async () => {
    const error = killedAfter('');
    const dump = await dumpWith(error);
    expect(() => dump()).toThrow(error);
  });

  it('fails when it says it wrote a different file', async () => {
    const error = killedAfter('UI hierchary dumped to: /sdcard/other.xml\n');
    const dump = await dumpWith(error);
    expect(() => dump()).toThrow(error);
  });

  it('fails on any other exit status, even after the line', async () => {
    const error = killedAfter('UI hierchary dumped to: /sdcard/ui.xml\n', 1);
    const dump = await dumpWith(error);
    expect(() => dump()).toThrow(error);
  });
});
