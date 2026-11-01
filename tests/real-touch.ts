import type { CDPSession, Locator, Page } from '@playwright/test';
import { onRealDevice } from './device/device-downloads';

/**
 * Taps the way a visitor's finger does (shyden-labs/shyden.co.uk#996).
 *
 * On the real Android phone, Playwright's `click()` sends mouse events and
 * first scrolls the element into view by protocol, so neither the tap nor the
 * scroll is what a finger does. Here the page is dragged with real touches
 * (CDP `Input.dispatchTouchEvent`) until the element's centre sits in the
 * middle half of the view, and the tap is a touch at that centre. Nothing
 * falls back to a script scroll or a mouse click: an element that does not
 * come into view, or whose centre another element covers, fails the test,
 * naming why. The iPhone run does the same through WebDriverAgent
 * (`tests/device/ios/interaction.ts`).
 *
 * Everywhere else (the five desktop engines and their emulated phones), a tap
 * is Playwright's real `click()`, as before.
 */

/** Real drags allowed before an element that is still out of view fails. */
export const MAX_SWIPES = 12;
/** A drag moves at most this share of the view, so it never overshoots. */
const SWIPE_SHARE = 0.6;
/** Shorter drags than this are read by Chrome as a tap, not a scroll. */
const MIN_SWIPE_PX = 40;
/** The element's centre must sit within this middle share of the view. */
const MIDDLE_SHARE = 0.5;
/** Touch moves per drag, and the pause before the finger lifts (no fling). */
const DRAG_STEPS = 10;
const DRAG_HOLD_MS = 120;
/** Each touch event's wait between moves. */
const DRAG_STEP_MS = 16;

export interface Prepared {
  rect: { x: number; y: number; width: number; height: number };
  viewTop: number;
  viewHeight: number;
  viewWidth: number;
  inView: boolean;
  /** What a finger at the centre would touch instead, or null. */
  hit: string | null;
}

/** True while the element's centre is out of view or outside the middle half. */
export function mustMove({
  inView,
  rect,
  viewTop,
  viewHeight,
}: Prepared): boolean {
  if (!inView) return true;
  const centre = rect.y + rect.height / 2;
  const margin = (viewHeight * (1 - MIDDLE_SHARE)) / 2;
  return centre < viewTop + margin || centre > viewTop + viewHeight - margin;
}

/**
 * One drag that moves the element's centre toward the middle of the view:
 * the finger travels up the page to bring content below into view, down for
 * content above, at the right-hand edge of the view's middle.
 */
export function planSwipe({ rect, viewTop, viewHeight, viewWidth }: Prepared): {
  from: { x: number; y: number };
  to: { x: number; y: number };
} {
  const need = rect.y + rect.height / 2 - (viewTop + viewHeight / 2);
  const reach = viewHeight * SWIPE_SHARE;
  const distance =
    Math.sign(need) * Math.max(MIN_SWIPE_PX, Math.min(Math.abs(need), reach));
  const x = Math.round(viewWidth * 0.9);
  const middle = viewTop + viewHeight / 2;
  return {
    from: { x, y: Math.round(middle + distance / 2) },
    to: { x, y: Math.round(middle - distance / 2) },
  };
}

/** Why a tap cannot be made once the drags have stopped, or null when it can. */
export function whyNotTappable(
  selector: string,
  prepared: Prepared,
  swipes: number,
): string | null {
  if (!prepared.inView)
    return swipes >= MAX_SWIPES
      ? `${selector} did not come into view after ${MAX_SWIPES} real swipes (its box is at y ${prepared.rect.y}, the view is ${prepared.viewHeight} tall)`
      : `${selector} did not come into view: a real swipe no longer moves it (its box is at y ${prepared.rect.y}, the view is ${prepared.viewHeight} tall)`;
  if (prepared.hit !== null)
    return `${selector} is covered: a finger at its centre would touch ${prepared.hit}`;
  return null;
}

export class TapNotPossibleError extends Error {
  override name = 'TapNotPossibleError';
}

const sessions = new WeakMap<Page, Promise<CDPSession>>();
function session(page: Page): Promise<CDPSession> {
  let found = sessions.get(page);
  if (found === undefined) {
    found = page.context().newCDPSession(page);
    sessions.set(page, found);
  }
  return found;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Settles the element (three still frames, at most 1.5 s), then measures it and what covers its centre. */
async function prepare(target: Locator): Promise<Prepared> {
  return target.evaluate(
    (el) =>
      new Promise<Prepared>((resolve) => {
        const vv = window.visualViewport;
        const view = () => ({
          top: vv ? vv.offsetTop : 0,
          left: vv ? vv.offsetLeft : 0,
          height: vv ? vv.height : window.innerHeight,
          width: vv ? vv.width : window.innerWidth,
        });
        const describe = (node: Element) =>
          node.tagName.toLowerCase() +
          (node.id ? `#${node.id}` : '') +
          (typeof node.className === 'string' && node.className.trim()
            ? `.${node.className.trim().split(/\s+/).join('.')}`
            : '');
        const shape = () => {
          const b = el.getBoundingClientRect();
          const v = view();
          return [b.x, b.y, b.width, b.height, v.top, v.height].join(',');
        };
        let last = shape();
        let still = 0;
        const started = Date.now();
        const settle = () => {
          const now = shape();
          still = now === last ? still + 1 : 0;
          last = now;
          if (still < 3 && Date.now() - started < 1500) {
            requestAnimationFrame(settle);
            return;
          }
          const r = el.getBoundingClientRect();
          const v = view();
          const inView =
            r.top >= v.top &&
            r.bottom <= v.top + v.height &&
            r.left >= v.left &&
            r.right <= v.left + v.width;
          let hit: string | null = null;
          if (inView) {
            const top = document.elementFromPoint(
              r.x + r.width / 2,
              r.y + r.height / 2,
            );
            const labels =
              'labels' in el
                ? Array.from((el as HTMLInputElement).labels ?? [])
                : [];
            if (top === null) hit = 'nothing (the centre is outside the page)';
            else if (
              top !== el &&
              !el.contains(top) &&
              !labels.some((l) => l === top || l.contains(top))
            )
              hit = describe(top);
          }
          resolve({
            rect: { x: r.x, y: r.y, width: r.width, height: r.height },
            viewTop: v.top,
            viewHeight: v.height,
            viewWidth: v.width,
            inView,
            hit,
          });
        };
        requestAnimationFrame(settle);
      }),
  );
}

/** One real drag: a finger down, moved in steps, held still, lifted. */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const cdp = await session(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [from],
  });
  for (let i = 1; i <= DRAG_STEPS; i++) {
    const point = {
      x: Math.round(from.x + ((to.x - from.x) * i) / DRAG_STEPS),
      y: Math.round(from.y + ((to.y - from.y) * i) / DRAG_STEPS),
    };
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [point],
    });
    await wait(DRAG_STEP_MS);
  }
  await wait(DRAG_HOLD_MS);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

/** Drags the page with real touches until the element can be tapped, or fails naming why. */
async function bringIntoView(
  target: Locator,
  forATap: boolean,
): Promise<Prepared> {
  const page = target.page();
  let prepared = await prepare(target);
  let swipes = 0;
  while (mustMove(prepared) && swipes < MAX_SWIPES) {
    const before = prepared.rect.y;
    const { from, to } = planSwipe(prepared);
    await drag(page, from, to);
    swipes++;
    prepared = await prepare(target);
    if (prepared.rect.y === before) break;
  }
  const why = whyNotTappable(
    String(target),
    forATap ? prepared : { ...prepared, hit: null },
    swipes,
  );
  if (why !== null) throw new TapNotPossibleError(why);
  return prepared;
}

/** A touch down and up at one point of the view. */
async function touchAt(page: Page, x: number, y: number): Promise<void> {
  const cdp = await session(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

export interface TapOptions {
  /** A point inside the element, from its top-left corner, as `click({ position })`. */
  position?: { x: number; y: number };
}

/** A real tap on the phone, a real click everywhere else. */
export async function tapOn(
  target: Locator,
  options: TapOptions = {},
): Promise<void> {
  if (!onRealDevice()) {
    await target.click(options);
    return;
  }
  await target.waitFor({ state: 'visible' });
  const { rect } = await bringIntoView(target, true);
  await touchAt(
    target.page(),
    rect.x + (options.position?.x ?? rect.width / 2),
    rect.y + (options.position?.y ?? rect.height / 2),
  );
}

/**
 * A real tap at a point of the view, with no wait for any element: a touch
 * on the phone, Playwright's real `mouse.click` everywhere else.
 */
export async function tapAt(page: Page, x: number, y: number): Promise<void> {
  if (!onRealDevice()) {
    await page.mouse.click(x, y);
    return;
  }
  await touchAt(page, x, y);
}

/** Two real taps in a row on the phone, Playwright's real `dblclick()` everywhere else. */
export async function doubleTapOn(target: Locator): Promise<void> {
  if (!onRealDevice()) {
    await target.dblclick();
    return;
  }
  await tapOn(target);
  await tapOn(target);
}

/**
 * Brings an element into view with no tap: real drags on the phone,
 * Playwright's `scrollIntoViewIfNeeded()` everywhere else.
 */
export async function scrollToOn(target: Locator): Promise<void> {
  if (!onRealDevice()) {
    await target.scrollIntoViewIfNeeded();
    return;
  }
  await target.waitFor({ state: 'visible' });
  await bringIntoView(target, false);
}

/**
 * Sets a checkbox or radio the way a finger does: a tap when it is not
 * already as wanted, then the state read back. Elsewhere, Playwright's real
 * `check()`/`uncheck()`/`setChecked()`.
 */
export async function setCheckedOn(
  target: Locator,
  checked = true,
): Promise<void> {
  if (!onRealDevice()) {
    await target.setChecked(checked);
    return;
  }
  if ((await target.isChecked()) !== checked) await tapOn(target);
  if ((await target.isChecked()) !== checked)
    throw new TapNotPossibleError(
      `a real tap on ${String(target)} left it ${checked ? 'unchecked' : 'checked'}`,
    );
}
