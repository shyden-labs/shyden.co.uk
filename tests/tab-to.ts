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
  /** Where focus stood after each press, for the failure to show. */
  const walked: string[] = [];
  for (let presses = 0; presses < TAB_CEILING; presses += 1) {
    if (await focused()) return;
    await page.keyboard.press(key);
    walked.push(await page.evaluate(describeFocus));
  }
  if (await focused()) return;
  throw new Error(
    `${TAB_CEILING} presses of ${key} never gave ${String(target)} focus; the walk ended ${foldWalk(walked)}`,
  );
}

/** The element holding focus, as `tag#id.class` (its parent's class when it has none). */
function describeFocus(): string {
  const active = document.activeElement;
  if (active === null) return 'nothing';
  const name = (element: Element) =>
    `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${
      element.classList[0] ? `.${element.classList[0]}` : ''
    }`;
  const parent = active.parentElement;
  return active.classList.length === 0 && active.id === '' && parent !== null
    ? `${name(parent)}/${name(active)}`
    : name(active);
}

/** The last steps of a walk, a run of one element folded to `name (xN)`. */
const foldWalk = (walked: string[]): string => {
  const runs: { name: string; count: number }[] = [];
  for (const name of walked) {
    const last = runs.at(-1);
    if (last?.name === name) last.count += 1;
    else runs.push({ name, count: 1 });
  }
  return runs
    .slice(-12)
    .map(({ name, count }) => (count === 1 ? name : `${name} (x${count})`))
    .join(' > ');
};
