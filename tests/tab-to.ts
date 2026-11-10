import type { Locator } from '@playwright/test';
import { tabKey } from './tab-key';

/**
 * The most Tab presses a walk to one control may take: a control further
 * than this is out of the Tab order as far as a keyboard visitor is concerned.
 */
export const TAB_CEILING = 80;

/**
 * Reaches `target` the way a keyboard visitor does: real Tab presses
 * (Option+Tab on WebKit, `tabKey`) until it has focus, never `focus()`, which
 * moves focus with no key at all and so passes for a control the Tab order
 * skips (#1034; global rule, Shyden 2026-10-31). Fails at `TAB_CEILING`
 * presses, naming the control, the key and the element focus ended on.
 */
export async function tabTo(
  target: Locator,
  direction: 'forwards' | 'backwards' = 'forwards',
): Promise<void> {
  const page = target.page();
  const browser = page.context().browser();
  if (browser === null)
    throw new Error(
      `tabTo cannot tell which engine runs ${String(target)}: its context has no browser`,
    );
  const key = tabKey(browser.browserType().name(), direction);
  const focused = () =>
    target.evaluate((element) => element === document.activeElement);
  for (let presses = 0; presses < TAB_CEILING; presses += 1) {
    if (await focused()) return;
    await page.keyboard.press(key);
  }
  if (await focused()) return;
  const ended = await page.evaluate(() => {
    const active = document.activeElement;
    if (active === null) return 'nothing';
    const id = active.id ? `#${active.id}` : '';
    return `${active.tagName.toLowerCase()}${id}`;
  });
  throw new Error(
    `${TAB_CEILING} presses of ${key} never gave ${String(target)} focus; focus ended on ${ended}`,
  );
}
