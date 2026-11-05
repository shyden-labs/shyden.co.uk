import type { Page } from '@playwright/test';

/**
 * On the real Android phone, every Playwright call that sends mouse input or
 * scrolls by protocol is refused (shyden-labs/shyden.co.uk#996): a tap there
 * is a touch (`tapOn`, `tapAt`, `setCheckedOn`, `doubleTapOn`) and a scroll
 * is a real finger drag (`scrollToOn`), all in `tests/real-touch.ts`. A
 * dropdown is chosen with `chooseOption` (`tests/real-select.ts`, #1027), never
 * `selectOption`, which sets the option in a script. A
 * bare `click()` that reaches the phone fails its test, naming the helper to
 * use, rather than passing on input no finger makes.
 */

const LOCATOR = [
  'click',
  'dblclick',
  'check',
  'uncheck',
  'setChecked',
  'tap',
  'hover',
  'dragTo',
  'scrollIntoViewIfNeeded',
  'selectOption',
] as const;
const PAGE = [
  'click',
  'dblclick',
  'check',
  'uncheck',
  'setChecked',
  'tap',
  'hover',
  'dragAndDrop',
  'selectOption',
] as const;
const MOUSE = ['click', 'dblclick', 'down', 'up', 'move', 'wheel'] as const;

const REFUSED = Symbol.for('shyden.no-mouse-on-phone');

export class MouseOnPhoneError extends Error {
  override name = 'MouseOnPhoneError';
}

/** Replaces each named method of `target` with one that throws, once. */
export function refuse(
  target: object,
  names: readonly string[],
  owner: string,
): void {
  const marked = target as Record<PropertyKey, unknown>;
  if (marked[REFUSED] === true) return;
  for (const name of names)
    marked[name] = () => {
      throw new MouseOnPhoneError(
        `${owner}.${name}() on the phone sends mouse input or scrolls by protocol (#996): tap with tapOn, tapAt, setCheckedOn or doubleTapOn, scroll with scrollToOn (tests/real-touch.ts), and choose a dropdown with chooseOption (tests/real-select.ts)`,
      );
    };
  Object.defineProperty(target, REFUSED, { value: true });
}

/** Refuses mouse input and protocol scrolls on this page, its mouse, and every locator. */
export function refuseMouseOnPhone(page: Page): void {
  refuse(
    Object.getPrototypeOf(page.locator('html')) as object,
    LOCATOR,
    'locator',
  );
  refuse(page, PAGE, 'page');
  refuse(page.mouse, MOUSE, 'page.mouse');
}
