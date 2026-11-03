import type { Locator } from '@playwright/test';
import { onRealDevice } from './device/device-downloads';
import { TapNotPossibleError, tapOn } from './real-touch';

/**
 * Chooses an option of a `<select>` the way a visitor does (#1027): a real
 * click focuses the select (and opens its list where the browser draws one),
 * the option's visible label is typed key by key (the browser's own
 * type-ahead moves to it), and Enter commits. Playwright's `selectOption()`
 * sets `option.selected` in an injected script and dispatches `input` and
 * `change` itself, so a select that a finger or a keyboard cannot work passed
 * under it.
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
  const label = await select.evaluate(
    (el, wanted) =>
      Array.from((el as HTMLSelectElement).options).find(
        (option) => option.value === wanted,
      )?.label ?? null,
    value,
  );
  if (label === null || label === '')
    throw new Error(whyNoLabel(String(select), value, label));
  await tapOn(select);
  await select.page().keyboard.type(label);
  await select.page().keyboard.press('Enter');
  const got = await select.inputValue();
  const why = whyNotChosen(String(select), value, got);
  if (why !== null) throw new Error(why);
}

/** Why the phone cannot choose yet: its native picker has no real-input path. */
export function whyNoPickerPath(select: string, value: string): string {
  return `${select}: choosing "${value}" on the real Android phone needs its native picker, and that path is not built yet (#1027); no script stands in for it`;
}

/** Why an option cannot be typed: it is missing, or has no visible label. */
export function whyNoLabel(
  select: string,
  value: string,
  label: string | null,
): string {
  return label === null
    ? `${select} has no option with the value "${value}"`
    : `${select}: the option "${value}" has no visible label to type, so real key presses cannot choose it`;
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
