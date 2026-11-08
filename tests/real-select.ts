import { expect, test, type Locator, type TestInfo } from '@playwright/test';
import { chooseFromNativePicker } from './device/native-picker';
import { onRealDevice } from './device/device-downloads';
import { tapOn } from './real-touch';

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
 * options live in Chrome's own dialog, chosen there by real taps.
 */
export async function chooseOption(
  select: Locator,
  value: string,
): Promise<void> {
  const options = await select.evaluate((el) =>
    Array.from((el as HTMLSelectElement).options).map((option) => ({
      value: option.value,
      disabled: option.disabled,
      label: option.text.trim(),
    })),
  );
  if (onRealDevice()) {
    // Chrome draws the options in its own dialog: a real tap opens it, and a
    // real tap on the option's row chooses it (tests/device/native-picker.ts).
    allowForPhoneChoices(test.info());
    const option = options.find((o) => o.value === value && !o.disabled);
    if (option === undefined)
      throw new Error(whyNoOption(String(select), value));
    await chooseFromNativePicker(select, option.label);
    await expect
      .poll(() => select.inputValue(), {
        message: `${String(select)}: real taps on Chrome's picker did not choose "${value}"`,
        timeout: 2_000,
      })
      .toBe(value);
    return;
  }
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

/**
 * One real choice on the phone costs about 5.5 s (two uiautomator dumps of
 * 2.1 s and the taps, measured 2026-11-07), so a test making several outruns
 * 30 s. Shyden ruled 2026-11-08 (#1027): the phone gets Playwright's slow
 * allowance (3x, 90 s) rather than fewer real taps. Calling it again in the
 * same test changes nothing.
 */
export function allowForPhoneChoices(info: Pick<TestInfo, 'slow'>): void {
  info.slow(true, "a real choice in Chrome's own picker costs about 5.5 s");
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
