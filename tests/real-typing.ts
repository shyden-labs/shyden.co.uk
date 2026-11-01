import { tapOn } from './real-touch';
import type { Locator } from '@playwright/test';

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
export async function typeInto(field: Locator, text: string): Promise<void> {
  await tapOn(field);
  if ((await field.inputValue()) !== '') {
    await field.press('ControlOrMeta+A');
    await field.press('Backspace');
  }
  if (text !== '') await field.pressSequentially(text);
}
