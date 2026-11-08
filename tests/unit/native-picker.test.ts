import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseUiDump } from '../device/ui-dump';
import { pickerOption, pickerList } from '../device/native-picker';

// Measured on the OPPO (2026-11-08, ten failures of 135): once the picker had
// closed, the screen still held one to three ListViews 1200 px wide and 0 px
// tall at y=3014, drawn by nothing a visitor can see.
const EMPTY_LIST =
  '<node text="" class="android.widget.ListView" bounds="[119,3014][1319,3014]" />';

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

  it('finds no list when the only one on screen has no height', () => {
    const page = parseUiDump(
      `<hierarchy><node text="" class="android.widget.FrameLayout" bounds="[0,0][1440,3168]">${EMPTY_LIST}${EMPTY_LIST}</node></hierarchy>`,
    );
    expect(pickerList(page)).toBeUndefined();
  });
});

describe('choosing from the picker reads the window, not the whole screen (#1086)', () => {
  const LABELS = ['Normal', 'Fast', 'Skip the animation'];
  const PICKER_XML = readFileSync(
    'tests/unit/fixtures/android/select-picker.xml',
    'utf8',
  );
  const FOCUS = (id: string) =>
    `  mCurrentFocus=null\n  mCurrentFocus=Window{${id} u0 com.android.chrome/Main}`;

  /**
   * The phone as measured on the OPPO (2026-11-09): the picker is a window of
   * its own, so the focused window changes while it is open and goes back when
   * it closes, one `dumpsys window` read (about 130 ms) against 2.2 s for a
   * uiautomator dump. `closesAfter` is how many reads the dialog stays up after
   * the tap on its row.
   */
  const phone = async ({
    opens = true,
    closesAfter = 0,
  }: { opens?: boolean; closesAfter?: number } = {}) => {
    vi.resetModules();
    let window = 'page';
    let closing = -1;
    const calls: string[][] = [];
    vi.doMock('../../scripts/adb.mjs', () => ({
      adb: (args: string[]) => {
        calls.push(args);
        if (args.includes('dumpsys')) {
          if (closing === 0) window = 'page';
          if (closing >= 0) closing -= 1;
          return FOCUS(window);
        }
        if (args.includes('tap')) closing = closesAfter;
        return args.includes('cat') ? PICKER_XML : '';
      },
    }));
    vi.doMock('../real-touch', () => ({
      tapOn: async () => {
        if (opens) window = 'dialog';
      },
      TapNotPossibleError: Error,
    }));
    const { chooseFromNativePicker, PICKER_CEILING_MS } =
      await import('../device/native-picker');
    const select = { toString: () => 'sel' } as never;
    return {
      choose: (label: string, labels = LABELS) =>
        chooseFromNativePicker(select, label, labels),
      ceiling: PICKER_CEILING_MS,
      dumps: () => calls.filter((args) => args.includes('dump')).length,
      taps: () => calls.filter((args) => args.includes('tap')),
    };
  };

  it('the first choice from a list reads the screen once, and taps the row', async () => {
    const { choose, dumps, taps } = await phone();
    await choose('Fast');
    expect(dumps()).toBe(1);
    expect(taps()).toEqual([['shell', 'input', 'tap', '720', '1587']]);
  });

  it('a later choice from the same list taps the row it knows, with no screen read', async () => {
    const { choose, dumps, taps } = await phone();
    await choose('Fast');
    await choose('Skip the animation');
    expect(dumps()).toBe(1);
    expect(taps()).toHaveLength(2);
    expect(taps()[1]).not.toEqual(taps()[0]);
  });

  it('a different list is read again', async () => {
    const { choose, dumps } = await phone();
    await choose('Fast');
    await choose('Fast', ['Fast', 'Normal', 'Skip the animation', 'Slow']);
    expect(dumps()).toBe(2);
  });

  it('a list the screen shows only part of is never remembered: its rows move', async () => {
    const { choose, dumps } = await phone();
    const longer = [...LABELS, 'Slow'];
    await choose('Fast', longer);
    await choose('Fast', longer);
    expect(dumps()).toBe(2);
  });

  it('returns only once the window has gone back, so the next tap meets the page', async () => {
    const { choose, taps } = await phone({ closesAfter: 2 });
    let done = false;
    const choosing = choose('Fast').then(() => {
      done = true;
    });
    await choosing;
    expect(done).toBe(true);
    expect(taps()).toHaveLength(1);
  });

  it('fails naming the select when the tap opened no picker', async () => {
    vi.useFakeTimers();
    try {
      const { choose, ceiling, taps } = await phone({ opens: false });
      const choosing = choose('Fast').catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(ceiling + 1_000);
      expect(await choosing).toMatch(/sel: a real tap did not open Chrome/);
      expect(taps()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
