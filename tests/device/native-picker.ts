import type { Locator } from '@playwright/test';
import { adb } from '../../scripts/adb.mjs';
import { TapNotPossibleError, tapOn } from '../real-touch';
import { currentFocusLines } from './chrome-foreground';
import { dump as screen, tap as tapNode } from './chrome-javascript-setting';
import type { UiNode } from './ui-dump';

/**
 * Chrome on Android draws a `<select>`'s options in its own dialog, outside
 * the page, so neither the page nor CDP can reach them (#1027). A visitor
 * taps the select, then taps a row of that dialog. This does the same: a
 * real tap on the select, then a real tap (`adb shell input tap`) on the row
 * a uiautomator dump shows for the option, read once per list. Nothing sets
 * the value by script.
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
const FOCUS_POLL_MS = 50;

/** Swipes through a long list before the option counts as missing. */
const MAX_SWIPES = 8;

/** The row the picker shows for `label`, or undefined when it shows none. */
export function pickerOption(
  nodes: readonly UiNode[],
  label: string,
): UiNode | undefined {
  return nodes.find((node) => node.className === ROW && node.text === label);
}

/**
 * The list the picker's rows scroll in, or undefined when no picker is open.
 *
 * Only a list with height: after the picker closes, the screen can still hold
 * ListViews 0 px tall that nobody can see (measured on the OPPO, 2026-11-08:
 * 1200x0 at y=3014, in all ten failures of a 135-test run), and reading one
 * as the picker failed the run with "still open" after it had closed.
 */
export function pickerList(nodes: readonly UiNode[]): UiNode | undefined {
  return nodes.find(
    (node) => node.className === LIST && node.bounds.bottom > node.bounds.top,
  );
}

/**
 * Waits until the focused window has left `from` (the picker opened) or come
 * back to it (the picker closed). The picker is a window of its own, so one
 * `dumpsys window` read answers this in about 130 ms, where a uiautomator dump
 * takes 2.2 s (measured on the OPPO, 2026-11-09, #1086). A select tapped while
 * the dialog is still closing meets the dialog instead of the page, which is
 * why the close is waited for.
 */
async function untilFocus(
  arrived: (focus: string) => boolean,
  why: string,
): Promise<void> {
  const deadline = Date.now() + PICKER_CEILING_MS;
  while (!arrived(currentFocusLines())) {
    if (Date.now() >= deadline) throw new TapNotPossibleError(why);
    await new Promise((resolve) => setTimeout(resolve, FOCUS_POLL_MS));
  }
}

/**
 * Where each list's rows are, by the list's own labels. Chrome draws a list
 * that fits the screen in the same place every time, so its rows are read once.
 * A list the screen shows only part of is never kept: it opens scrolled to the
 * chosen option, so its rows move. The caller reads the value back, so a tap
 * that missed fails there.
 */
const knownRows = new Map<string, Map<string, UiNode>>();

const rowsOf = (nodes: readonly UiNode[], labels: readonly string[]) => {
  const rows = new Map<string, UiNode>();
  for (const label of labels) {
    const row = pickerOption(nodes, label);
    if (row === undefined) return undefined;
    rows.set(label, row);
  }
  return rows;
};

/**
 * Chooses the option with `label` from Chrome's picker by real taps. `labels`
 * is every option the select offers.
 */
export async function chooseFromNativePicker(
  select: Locator,
  label: string,
  labels: readonly string[],
): Promise<void> {
  const name = String(select);
  const page = currentFocusLines();
  // The tap opens the dialog rather than ending in a click the page can see.
  await tapOn(select, { byEffect: true });
  await untilFocus(
    (focus) => focus !== page,
    `${name}: a real tap did not open Chrome's option picker within ${PICKER_CEILING_MS} ms`,
  );
  const key = labels.join('\n');
  const known = knownRows.get(key)?.get(label);
  if (known) tapNode(known);
  else tapNode(await readRow(name, label, labels, key));
  await untilFocus(
    (focus) => focus === page,
    `${name}: Chrome's option picker was still open ${PICKER_CEILING_MS} ms after a real tap on its row`,
  );
}

/** Reads the row off the screen, swiping a long list until it appears. */
async function readRow(
  name: string,
  label: string,
  labels: readonly string[],
  key: string,
): Promise<UiNode> {
  let nodes = await openPicker(name);
  const rows = rowsOf(nodes, labels);
  if (rows) knownRows.set(key, rows);
  for (let swipe = 0; ; swipe++) {
    const row = pickerOption(nodes, label);
    if (row) return row;
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

/** The screen once the picker's list is drawn on it; throws at the ceiling. */
async function openPicker(select: string): Promise<UiNode[]> {
  const deadline = Date.now() + PICKER_CEILING_MS;
  for (;;) {
    const nodes = screen();
    if (pickerList(nodes)) return nodes;
    if (Date.now() >= deadline)
      throw new TapNotPossibleError(
        `${select}: Chrome's option picker opened but drew no list within ${PICKER_CEILING_MS} ms`,
      );
    await new Promise((resolve) => setTimeout(resolve, PICKER_POLL_MS));
  }
}
