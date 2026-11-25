import { describe, expect, it, vi } from 'vitest';

/**
 * #1073: the per-test foreground check on the real Android phone fails fast and names the app
 * holding the foreground. It never relaunches Chrome and carries on (global rule 2026-10-02:
 * a retry is not a fix). adb is stood in, so no process starts.
 */

const ASSISTANT_FOCUS =
  '  mCurrentFocus=Window{1a2b u0 com.google.android.googlequicksearchbox/.SearchActivity}';
const CHROME_FOCUS =
  '  mCurrentFocus=null\n  mCurrentFocus=Window{3c4d u0 com.android.chrome/com.google.android.apps.chrome.Main}';

const withPhone = async (initialFocus: string) => {
  const calls: string[][] = [];
  let focus = initialFocus;
  vi.resetModules();
  vi.doMock('../../scripts/adb.mjs', () => ({
    adb: (args: string[]) => {
      calls.push(args);
      if (args.includes('am')) focus = CHROME_FOCUS;
      if (args.includes('dumpsys')) return `${focus}\n`;
      if (args.includes('/proc/net/unix'))
        return '0: 00000002 @chrome_devtools_remote\n';
      return '';
    },
  }));
  const { checkChromeForeground } = await import('../device/chrome-foreground');
  return { checkChromeForeground, calls };
};

describe('the per-test Chrome foreground check', () => {
  it('passes after one window read when Chrome holds the foreground', async () => {
    const { checkChromeForeground, calls } = await withPhone(CHROME_FOCUS);
    expect(() => checkChromeForeground('a test')).not.toThrow();
    expect(calls).toEqual([['shell', 'dumpsys', 'window']]);
  });

  it('fails naming the test and the app holding the foreground', async () => {
    const { checkChromeForeground } = await withPhone(ASSISTANT_FOCUS);
    expect(() =>
      checkChromeForeground('the grouping survives a reload'),
    ).toThrow(
      /"the grouping survives a reload".*com\.google\.android\.googlequicksearchbox/s,
    );
  });

  it('never relaunches Chrome when another app holds the foreground', async () => {
    const { checkChromeForeground, calls } = await withPhone(ASSISTANT_FOCUS);
    expect(() => checkChromeForeground('a test')).toThrow();
    expect(calls.filter((args) => args.includes('am'))).toEqual([]);
  });

  it('names the absence when the window dump has no focus line', async () => {
    const { checkChromeForeground } = await withPhone('');
    expect(() => checkChromeForeground('a test')).toThrow(
      /no mCurrentFocus line/,
    );
  });
});
