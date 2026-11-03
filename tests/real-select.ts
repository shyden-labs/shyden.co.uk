import type { Locator } from '@playwright/test';
import { onRealDevice } from './device/device-downloads';
import { TapNotPossibleError, tapOn } from './real-touch';

/**
 * Chooses an option of a `<select>` the way a visitor does (#1027): a real
 * click focuses the select (and opens its list where the browser draws one),
 * real ArrowDown / ArrowUp key presses (Home or End for a far end) move to the option, and Enter commits.
 * Playwright's `selectOption()` sets `option.selected` in an injected script
 * and dispatches `input` and `change` itself, so a select that a finger or a
 * keyboard cannot work passed under it.
 *
 * Arrow keys, not type-ahead: `keyboard.type()` sends characters outside the
 * keyboard (zh, vi, th labels) as inserted text with no key press, so the
 * browser's type-ahead never sees them (measured on CI, every engine).
 * Disabled options are skipped by the browser, so they are not counted.
 *
 * The chosen value is read back. If real input did not pick the wanted option
 * the test fails naming the select and the option: nothing falls back to
 * `selectOption()` or to setting `.value`. On the real Android phone the
 * native picker path is not built yet, so it throws rather than use a script.
 */
export async function chooseOption(
  select: Locator,
  value: string,
): Promise<void> {
  if (onRealDevice())
    throw new TapNotPossibleError(whyNoPickerPath(String(select), value));
  const options = await select.evaluate((el) =>
    Array.from((el as HTMLSelectElement).options).map((option) => ({
      value: option.value,
      disabled: option.disabled,
    })),
  );
  const current = await select.inputValue();
  const keys = arrowKeysFor(options, current, value);
  if (keys === null) throw new Error(whyNoOption(String(select), value));
  await tapOn(select);
  for (const key of keys) {
    // Where the browser draws no list (WebKit, Firefox), a key changes the
    // value at once and the page may rebuild the select, taking the focus
    // with it (the roster does): focus it again with a real click.
    if (!(await select.evaluate((el) => el === document.activeElement)))
      await tapOn(select);
    await select.page().keyboard.press(key);
  }
  await select.page().keyboard.press('Enter');
  const got = await select.inputValue();
  const why = whyNotChosen(String(select), value, got);
  if (why !== null) throw new Error(why);
}

export interface OptionState {
  value: string;
  disabled: boolean;
}

/**
 * The arrow presses from the selected option to the wanted one, counting only
 * options a keyboard can reach; null when the wanted option is missing or
 * disabled. Nothing to press when it is already selected.
 */
export function arrowKeysFor(
  options: readonly OptionState[],
  current: string,
  wanted: string,
): ('ArrowDown' | 'ArrowUp' | 'Home' | 'End')[] | null {
  const to = options.find((option) => option.value === wanted);
  if (to === undefined || to.disabled) return null;
  const reachable = options.filter(
    (option) => !option.disabled || option.value === current,
  );
  const from = reachable.findIndex((option) => option.value === current);
  const target = reachable.findIndex((option) => option.value === wanted);
  if (from === -1) return null;
  const steps = target - from;
  // One key, one change: a long walk would change the value at every step.
  if (Math.abs(steps) > 1 && target === reachable.length - 1) return ['End'];
  if (Math.abs(steps) > 1 && target === 0) return ['Home'];
  return Array(Math.abs(steps)).fill(steps > 0 ? 'ArrowDown' : 'ArrowUp');
}

/** Why the phone cannot choose yet: its native picker has no real-input path. */
export function whyNoPickerPath(select: string, value: string): string {
  return `${select}: choosing "${value}" on the real Android phone needs its native picker, and that path is not built yet (#1027); no script stands in for it`;
}

/** Why an option cannot be chosen: it is missing, or disabled. */
export function whyNoOption(select: string, value: string): string {
  return `${select} has no option with the value "${value}" that a keyboard can reach`;
}

/** Why real input missed the wanted option, or null when it chose it. */
export function whyNotChosen(
  select: string,
  wanted: string,
  got: string,
): string | null {
  return got === wanted
    ? null
    : `${select}: real input chose "${got}", not the wanted option "${wanted}"`;
}
