import type { Locator } from '@playwright/test';
import { adb } from '../../scripts/adb.mjs';
import { TapNotPossibleError, tapOn } from '../real-touch';
import { dump as screen } from './chrome-javascript-setting';
import { centreOf, type UiNode } from './ui-dump';

/**
 * Chrome on Android draws a `<select>`'s options in its own dialog, outside
 * the page, so neither the page nor CDP can reach them (#1027). A visitor
 * taps the select, then taps a row of that dialog. This does the same: a
 * real tap on the select, then a real tap (`adb shell input tap`) on the row
 * a uiautomator dump shows for the option. Nothing sets the value by script.
 *
 * Measured on the OPPO (2026-11-07, `tests/unit/fixtures/android/select-picker.xml`):
 * the dialog is an `android.widget.ListView` holding one
 * `android.widget.CheckedTextView` per option, labelled with the option's
 * text, `checked` on the chosen one.
 */

const ROW = 'android.widget.CheckedTextView';
const LIST = 'android.widget.ListView';

/** How long the picker may take to appear after the tap, and how often to look. */
export const PICKER_CEILING_MS = 5_000;
const PICKER_POLL_MS = 250;
const CLOSE_POLL_MS = 100;

/** Swipes through a long list before the option counts as missing. */
const MAX_SWIPES = 8;

/** The row the picker shows for `label`, or undefined when it shows none. */
export function pickerOption(
  nodes: readonly UiNode[],
  label: string,
): UiNode | undefined {
  return nodes.find((node) => node.className === ROW && node.text === label);
}

/** The list the picker's rows scroll in, or undefined when no picker is open. */
export function pickerList(nodes: readonly UiNode[]): UiNode | undefined {
  return nodes.find((node) => node.className === LIST);
}

const tapNode = (node: UiNode): void => {
  const { x, y } = centreOf(node);
  adb(['shell', 'input', 'tap', String(x), String(y)]);
};

/** The screen once the picker's list is on it; throws at the ceiling. */
async function openPicker(select: string): Promise<UiNode[]> {
  const deadline = Date.now() + PICKER_CEILING_MS;
  for (;;) {
    const nodes = screen();
    if (pickerList(nodes)) return nodes;
    if (Date.now() >= deadline)
      throw new TapNotPossibleError(
        `${select}: a real tap did not open Chrome's option picker within ${PICKER_CEILING_MS} ms`,
      );
    await new Promise((resolve) => setTimeout(resolve, PICKER_POLL_MS));
  }
}

/**
 * Waits until the picker has gone. A tap on its row closes it, but for a
 * moment it is still drawn, and a select tapped in that moment meets the
 * closing dialog instead of the page (measured on the OPPO, 2026-11-07).
 */
async function pickerClosed(select: string): Promise<void> {
  const deadline = Date.now() + PICKER_CEILING_MS;
  while (pickerList(screen())) {
    if (Date.now() >= deadline)
      throw new TapNotPossibleError(
        `${select}: Chrome's option picker was still open ${PICKER_CEILING_MS} ms after a real tap on its row`,
      );
    await new Promise((resolve) => setTimeout(resolve, CLOSE_POLL_MS));
  }
}

/**
 * Chooses the option with `label` from Chrome's picker by real taps. The
 * caller reads the value back, so a tap that missed fails there.
 */
export async function chooseFromNativePicker(
  select: Locator,
  label: string,
): Promise<void> {
  const name = String(select);
  // The tap opens the dialog rather than ending in a click the page can see.
  await tapOn(select, { byEffect: true });
  let nodes = await openPicker(name);
  for (let swipe = 0; ; swipe++) {
    const row = pickerOption(nodes, label);
    if (row) {
      tapNode(row);
      await pickerClosed(name);
      return;
    }
    const list = pickerList(nodes);
    if (list === undefined || swipe >= MAX_SWIPES)
      throw new TapNotPossibleError(
        `${name}: Chrome's picker shows no row "${label}" after ${swipe} real swipes`,
      );
    const { left, top, right, bottom } = list.bounds;
    const x = String(Math.round((left + right) / 2));
    adb([
      'shell',
      'input',
      'swipe',
      x,
      String(Math.round(top + (bottom - top) * 0.8)),
      x,
      String(Math.round(top + (bottom - top) * 0.2)),
      '300',
    ]);
    nodes = screen();
  }
}
