import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseUiDump } from '../device/ui-dump';
import { pickerOption, pickerList } from '../device/native-picker';

// A real dump of Chrome's own <select> picker on the OPPO (2026-11-07),
// opened by a real tap on /classroom-groups' speed select (#1027).
const PICKER = parseUiDump(
  readFileSync('tests/unit/fixtures/android/select-picker.xml', 'utf8'),
);

describe("Chrome's native select picker, read from a uiautomator dump (#1027)", () => {
  it('finds the row a finger would tap for an option, by its label', () => {
    const row = pickerOption(PICKER, 'Fast');
    expect(row?.className).toBe('android.widget.CheckedTextView');
    expect(row?.bounds).toEqual({
      left: 37,
      top: 1475,
      right: 1403,
      bottom: 1699,
    });
  });

  it('reads which row the picker shows as chosen', () => {
    expect(pickerOption(PICKER, 'Normal')?.checked).toBe(true);
    expect(pickerOption(PICKER, 'Skip the animation')?.checked).toBe(false);
  });

  it('finds no row for a label the picker does not show', () => {
    expect(pickerOption(PICKER, 'Slow')).toBeUndefined();
  });

  it('takes only a picker row, never other text that reads the same', () => {
    const page = parseUiDump(
      '<hierarchy><node text="Fast" class="android.widget.TextView" bounds="[0,0][10,10]" /></hierarchy>',
    );
    expect(pickerOption(page, 'Fast')).toBeUndefined();
  });

  it('finds the list the rows scroll in', () => {
    expect(pickerList(PICKER)?.bounds).toEqual({
      left: 37,
      top: 1247,
      right: 1403,
      bottom: 1927,
    });
  });

  it('finds no list when no picker is open', () => {
    const page = parseUiDump(
      '<hierarchy><node text="" class="android.widget.FrameLayout" bounds="[0,0][10,10]" /></hierarchy>',
    );
    expect(pickerList(page)).toBeUndefined();
  });
});

describe('choosing from the picker waits for it to close (#1027)', () => {
  it('returns only once the picker it tapped has gone, so the next tap meets the page', async () => {
    vi.resetModules();
    const picker = readFileSync(
      'tests/unit/fixtures/android/select-picker.xml',
      'utf8',
    );
    const page =
      '<hierarchy><node text="" class="android.widget.FrameLayout" bounds="[0,0][1440,3168]" /></hierarchy>';
    // The dialog is still drawn for two dumps after the row is tapped.
    const screens = [picker, picker, picker, page];
    const calls: string[][] = [];
    vi.doMock('../../scripts/adb.mjs', () => ({
      adb: (args: string[]) => {
        calls.push(args);
        return args.includes('cat') ? (screens.shift() ?? page) : '';
      },
    }));
    vi.doMock('../real-touch', () => ({
      tapOn: async () => {},
      TapNotPossibleError: Error,
    }));
    const { chooseFromNativePicker } = await import('../device/native-picker');
    await chooseFromNativePicker({ toString: () => 'sel' } as never, 'Fast');
    const taps = calls.filter((args) => args.includes('tap'));
    expect(taps).toEqual([['shell', 'input', 'tap', '720', '1587']]);
    expect(screens, 'every dump until the picker closed was read').toEqual([]);
  });
});
