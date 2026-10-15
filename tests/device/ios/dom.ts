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
import type { PaintedText } from '../../wcag';
import type { WebDriver } from './webdriver';

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
    `return Array.from(document.querySelectorAll(arguments[0]),
       (el) => (el.textContent ?? '').replace(/\\s+/g, ' ').trim());`,
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
