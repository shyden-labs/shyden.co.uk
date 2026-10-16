/**
 * Reads of the live page on the real iPhone, for the journeys that mirror
 * the Android run's (#800, global rule 2026-10-15: "android and iOS journeys
 * need to be mirrored"). Playwright cannot drive iOS Safari, so the Android
 * specs' locator reads (`toHaveCount`, `toHaveText`, `toHaveAttribute`,
 * `toBeVisible`, `page.request.get`) are restated here as single
 * `execute/sync` / `execute/async` round trips over the session's own
 * WebDriver. Each returns every match, so a journey asserts on the whole
 * population it read rather than on a first hit.
 *
 * Each reads as Playwright's assertion does, measured on the phone (#800's
 * first run): text is the whitespace-normalised `textContent`, not
 * `innerText`, which applies `text-transform` ("LIVE NOW" for "Live now");
 * visibility is `checkVisibility()` and a computed `visibility` of
 * `visible`, because a closed `<details>` keeps its boxes and a bare
 * `getClientRects()` read its hidden entries as shown.
 */
import { expect } from 'vitest';
import type { PaintedText } from '../../wcag';
import { NAME_MATCHES_SOURCE, NORMALISE_SOURCE } from './playwright-rules';
import type { WebDriver, WebElement } from './webdriver';

/** How many elements match `selector` on the page now. */
export function countOf(driver: WebDriver, selector: string): Promise<number> {
  return driver.executeScript<number>(
    `return document.querySelectorAll(arguments[0]).length;`,
    [selector],
  );
}

/** The text of every match as `toHaveText` reads it, in document order. */
export function textsOf(
  driver: WebDriver,
  selector: string,
): Promise<string[]> {
  return driver.executeScript<string[]>(
    `const norm = ${NORMALISE_SOURCE};
     return Array.from(document.querySelectorAll(arguments[0]), (el) => norm(el.textContent));`,
    [selector],
  );
}

/** One attribute of every match (`null` where a match does not carry it). */
export function attributesOf(
  driver: WebDriver,
  selector: string,
  name: string,
): Promise<(string | null)[]> {
  return driver.executeScript<(string | null)[]>(
    `return Array.from(document.querySelectorAll(arguments[0]), (el) => el.getAttribute(arguments[1]));`,
    [selector, name],
  );
}

/** Whether each match is visible, by Playwright's own test. */
export function visibilityOf(
  driver: WebDriver,
  selector: string,
): Promise<boolean[]> {
  return driver.executeScript<boolean[]>(
    `return Array.from(document.querySelectorAll(arguments[0]), (el) =>
      el.checkVisibility() && getComputedStyle(el).visibility === 'visible');`,
    [selector],
  );
}

/** The border box of every match, in CSS pixels. */
export function boxesOf(
  driver: WebDriver,
  selector: string,
): Promise<{ width: number; height: number }[]> {
  return driver.executeScript<{ width: number; height: number }[]>(
    `return Array.from(document.querySelectorAll(arguments[0]), (el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    });`,
    [selector],
  );
}

/**
 * What Safari paints for each match's text: its ink, every background from
 * it outward, and its opacity, for `paintedContrast` (tests/wcag.ts), the one
 * home of the arithmetic Playwright's `contrastRatio` uses too.
 */
export function paintedTextOf(
  driver: WebDriver,
  selector: string,
): Promise<PaintedText[]> {
  return driver.executeScript<PaintedText[]>(
    `return Array.from(document.querySelectorAll(arguments[0]), (el) => {
      const style = getComputedStyle(el);
      const grounds = [];
      for (let at = el; at; at = at.parentElement) {
        const c = getComputedStyle(at).backgroundColor;
        if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') grounds.push(c);
      }
      return { colour: style.color, grounds, opacity: Number(style.opacity) };
    });`,
    [selector],
  );
}

/**
 * The HTTP status the phone itself receives for `href`, fetched from the
 * page (same origin, so the status is readable): what `page.request.get`
 * answers on Android, asked of Safari's own network stack.
 */
export function statusOf(driver: WebDriver, href: string): Promise<number> {
  return driver.executeAsyncScript<number>(
    `const done = arguments[arguments.length - 1];
     fetch(arguments[0], { redirect: 'follow' }).then((r) => done(r.status), () => done(-1));`,
    [href],
  );
}

/**
 * Playwright's assertions retry until they hold or 5 s pass; a one-shot read
 * can land before the page has rendered what a click asked for (#813). This
 * waits for `read()` to equal `expected` (by its JSON) under the same 5 s
 * ceiling, then asserts once more, so a miss still fails with the diff and
 * `message`, never as a timeout that hides what was read.
 */
export async function expectEventually<T>(
  read: () => Promise<T>,
  expected: T,
  message: string,
): Promise<void> {
  const want = JSON.stringify(expected);
  const deadline = Date.now() + 5_000;
  let last = await read();
  while (JSON.stringify(last) !== want && Date.now() < deadline) {
    await new Promise((settle) => setTimeout(settle, 100));
    last = await read();
  }
  expect(last, message).toEqual(expected);
}

/**
 * Playwright's web-first `expect(page.locator(selector))` (#821), each
 * assertion retried for 5 s by `expectEventually`, under the name its Android
 * call has, so a mirror reads line for line against its twin. A one-string
 * `toHaveText`, `toBeVisible`, `toHaveAttribute`, `toContainText` and
 * `toHaveCSS` read every match and expect exactly one, so two matches fail as
 * Playwright's strict mode fails them; `toHaveText` with a list matches every
 * element in order. `nth` is `locator.nth(n)` (negative counts from the end,
 * so `-1` is `.last()`): one match, re-picked on every read, or none.
 */
export const expectLocator = (
  driver: WebDriver,
  selector: string,
  { nth }: { nth?: number } = {},
) => {
  const named = nth === undefined ? selector : `${selector} (nth ${nth})`;
  const pick = async <T>(read: Promise<T[]>): Promise<T[]> => {
    const all = await read;
    if (nth === undefined) return all;
    const one = all.at(nth);
    return one === undefined ? [] : [one];
  };
  return {
    toHaveCount: (count: number): Promise<void> =>
      expectEventually(
        async () =>
          nth === undefined
            ? countOf(driver, selector)
            : (await pick(textsOf(driver, selector))).length,
        count,
        `${named} count`,
      ),
    toHaveText: (text: string | string[]): Promise<void> =>
      expectEventually(
        () => pick(textsOf(driver, selector)),
        typeof text === 'string' ? [text] : text,
        `${named} text`,
      ),
    toBeVisible: (): Promise<void> =>
      expectEventually(
        () => pick(visibilityOf(driver, selector)),
        [true],
        `${named} visible`,
      ),
    /** No match, or the one match not shown; two matches are strict mode's refusal. */
    toBeHidden: (): Promise<void> =>
      expectEventually(
        async () => {
          const shown = await pick(visibilityOf(driver, selector));
          if (shown.length > 1) return `${shown.length} elements match`;
          return shown.length === 0 || !shown[0];
        },
        true,
        `${named} hidden`,
      ),
    toHaveAttribute: (name: string, value: string): Promise<void> =>
      expectEventually(
        () => pick(attributesOf(driver, selector, name)),
        [value],
        `${named} ${name}`,
      ),
    /** A string is a case-sensitive part of the text; a pattern is tested as written. */
    toContainText: (text: string | RegExp): Promise<void> =>
      expectEventually(
        async () =>
          (await pick(textsOf(driver, selector))).map((t) =>
            typeof text === 'string' ? t.includes(text) : text.test(t),
          ),
        [true],
        `${named} contains ${String(text)}`,
      ),
    toHaveCSS: (property: string, value: string): Promise<void> =>
      expectEventually(
        () =>
          pick(
            driver.executeScript<string[]>(
              `return Array.from(document.querySelectorAll(arguments[0]), (el) => getComputedStyle(el).getPropertyValue(arguments[1]));`,
              [selector, property],
            ),
          ),
        [value],
        `${named} ${property}`,
      ),
  };
};

/** Whether one found `element` is shown, read as `visibilityOf` reads a selector's matches. */
export function isShown(
  driver: WebDriver,
  element: WebElement,
): Promise<boolean> {
  return driver.executeScript<boolean>(
    `const el = arguments[0];
     return el.checkVisibility() && getComputedStyle(el).visibility === 'visible';`,
    [driver.elementRef(element.elementId)],
  );
}

/**
 * The elements inside every match of `scope` that Playwright's
 * `locator(scope).getByText(text, { exact })` resolves to, each read as shown or not, by Playwright's own rule: the
 * innermost elements whose whitespace-collapsed text CONTAINS `text`,
 * ignoring case, or with `exact: true`, IS `text`, case included. `exact`
 * has no default: a mirror states the choice its Android test made, so an
 * Android substring match cannot become an iPhone whole-text one (#813).
 * Its length is `toHaveCount`; `[true]` is `toBeVisible` on a strict match.
 */
export function textMatchesOf(
  driver: WebDriver,
  scope: string,
  text: string,
  { exact }: { exact: boolean },
): Promise<boolean[]> {
  return driver.executeScript<boolean[]>(
    `const norm = ${NORMALISE_SOURCE};
     const matches = ${NAME_MATCHES_SOURCE};
     const exact = arguments[2];
     const needle = norm(arguments[1]);
     const hit = (el) => matches(norm(el.textContent), needle, exact);
     const roots = Array.from(document.querySelectorAll(arguments[0]));
     if (roots.length === 0) throw new Error('no scope ' + arguments[0]);
     const inside = new Set(roots.flatMap((root) => Array.from(root.querySelectorAll('*'))));
     return Array.from(inside)
       .filter((el) => !['SCRIPT', 'STYLE'].includes(el.tagName))
       .filter((el) => hit(el) && !Array.from(el.children).some(hit))
       .map((el) => el.checkVisibility() && getComputedStyle(el).visibility === 'visible');`,
    [scope, text, exact],
  );
}

/** How many elements `getByText(text, { exact })` counts in `scope`: see `textMatchesOf`. */
export async function textCount(
  driver: WebDriver,
  scope: string,
  text: string,
  options: { exact: boolean },
): Promise<number> {
  return (await textMatchesOf(driver, scope, text, options)).length;
}

/**
 * Playwright's `toBeHidden()` on `selector`, read once: `true` when nothing
 * matches or the one match is not shown; `false` when it is shown; a
 * sentence when more than one matches (Playwright's strict-mode refusal).
 */
export function hiddenOf(
  driver: WebDriver,
  selector: string,
): Promise<boolean | string> {
  return driver.executeScript<boolean | string>(
    `const all = document.querySelectorAll(arguments[0]);
     if (all.length > 1) return all.length + ' elements match ' + arguments[0];
     if (all.length === 0) return true;
     const el = all[0];
     return !(el.checkVisibility() && getComputedStyle(el).visibility === 'visible');`,
    [selector],
  );
}

/**
 * Playwright's `toBeEnabled()` on the ONE element `selector` matches: not
 * `:disabled` (a disabled fieldset included) and no `aria-disabled="true"`
 * on it or an ancestor. A sentence when it matches none or several.
 */
export function enabledOf(
  driver: WebDriver,
  selector: string,
): Promise<boolean | string> {
  return driver.executeScript<boolean | string>(
    `const all = document.querySelectorAll(arguments[0]);
     if (all.length !== 1) return all.length + ' elements match ' + arguments[0];
     const el = all[0];
     return !(el.matches(':disabled') || el.closest('[aria-disabled="true"]') !== null);`,
    [selector],
  );
}

/** Playwright's `allTextContents()`: every match's raw `textContent`, nothing collapsed or trimmed. */
export function rawTextsOf(
  driver: WebDriver,
  selector: string,
): Promise<string[]> {
  return driver.executeScript<string[]>(
    `return Array.from(document.querySelectorAll(arguments[0]), (el) => el.textContent ?? '');`,
    [selector],
  );
}

/** `enabledOf` for one found `element` (a locator found by role or label). */
export function isEnabled(
  driver: WebDriver,
  element: WebElement,
): Promise<boolean> {
  return driver.executeScript<boolean>(
    `const el = arguments[0];
     return !(el.matches(':disabled') || el.closest('[aria-disabled="true"]') !== null);`,
    [driver.elementRef(element.elementId)],
  );
}
