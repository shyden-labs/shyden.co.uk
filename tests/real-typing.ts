import { tapOn, type TapOptions } from './real-touch';
import type { Locator } from '@playwright/test';
import { onRealDevice } from './device/device-downloads';

/**
 * Types `text` into a field the way a visitor does (#998): a real click puts
 * the caret in it, select-all and Backspace clear what it holds, then every
 * character is a real key press. Playwright's `fill()` drops the whole value
 * in at once with no key press, so a field that mishandles real typing
 * (input events per key, a max length, the caret) passed under it.
 *
 * The clear keys are pressed only when the field holds something: Backspace
 * in an empty field is a key press a visitor would not make, and some
 * listeners count every `input` event.
 */
export async function typeInto(
  field: Locator,
  text: string,
  options: TapOptions = {},
): Promise<void> {
  await tapOn(field, options);
  if ((await field.inputValue()) !== '') {
    await field.press(selectAllKeys());
    await field.press('Backspace');
  }
  if (text !== '') await field.pressSequentially(text);
}

/**
 * The keys that select a field's whole text where the browser runs.
 * Playwright resolves `ControlOrMeta` from the machine running the tests, so
 * from a Mac it sends Meta+A to the Android phone, which Chrome there ignores:
 * Backspace then removed one character and the typed digits joined the rest
 * ("24" became "212", measured 2026-11-02). Android Chrome selects all with
 * Control+A.
 */
export const selectAllKeys = (): string =>
  onRealDevice() ? 'Control+A' : 'ControlOrMeta+A';
