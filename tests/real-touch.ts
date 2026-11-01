import type { CDPSession, Locator, Page } from '@playwright/test';
import { adb } from '../scripts/adb.mjs';
import { onRealDevice } from './device/device-downloads';

/**
 * Taps the way a visitor's finger does (shyden-labs/shyden.co.uk#996).
 *
 * On the real Android phone, Playwright's `click()` sends mouse events and
 * first scrolls the element into view by protocol, so neither the tap nor the
 * scroll is what a finger does. Here the page is dragged with real touches
 * (CDP `Input.dispatchTouchEvent`) until the point to tap sits inside the
 * view, clear of its top and bottom tenth, with nothing over it; the page is
 * left to come to rest; and the tap is a touch at that point. Nothing falls
 * back to a script scroll or a mouse click: a point that cannot be brought
 * into view, or that another element covers, fails the test, naming why. The
 * iPhone run does the same through WebDriverAgent
 * (`tests/device/ios/interaction.ts`).
 *
 * Everywhere else (the five desktop engines and their emulated phones), a tap
 * is Playwright's real `click()`, as before (#1004 covers their scrolling).
 */

/** Drags allowed beyond the ones the distance itself needs. */
export const SPARE_SWIPES = 6;
/** A drag moves at most this share of the view, so it never overshoots. */
const SWIPE_SHARE = 0.6;
/** Shorter drags than this are read by Chrome as a tap, not a scroll. */
const MIN_SWIPE_PX = 40;
/** The tap point must sit this share of the view clear of its top and bottom. */
const EDGE_SHARE = 0.1;
/** A drag that moves the point less than this has stopped moving it. */
const STILL_PX = 4;
/** Touch moves per drag, and the pause before the finger lifts (no fling). */
const DRAG_STEPS = 10;
const DRAG_HOLD_MS = 120;
const DRAG_STEP_MS = 16;
/** A flick: few, fast moves and no hold, for a point more than two views away. */
const FLICK_STEPS = 4;
const FLICK_STEP_MS = 8;
const FLICK_BEYOND_VIEWS = 2;

export interface Prepared {
  /** The point to tap, in the view's coordinates. */
  point: { x: number; y: number };
  viewTop: number;
  viewHeight: number;
  viewWidth: number;
  /** The point is inside the view. */
  inView: boolean;
  /** What a finger at the point would touch instead, or null. */
  hit: string | null;
  /** A field has the focus, so its on-screen keyboard may be up. */
  keyboard: boolean;
}

/** True while the point is out of view, too near an edge, or covered. */
export function mustMove(p: Prepared): boolean {
  if (!p.inView || p.hit !== null) return true;
  const edge = p.viewHeight * EDGE_SHARE;
  return (
    p.point.y < p.viewTop + edge || p.point.y > p.viewTop + p.viewHeight - edge
  );
}

const reachOf = (p: Prepared): number => p.viewHeight * SWIPE_SHARE;
const needOf = (p: Prepared): number =>
  p.point.y - (p.viewTop + p.viewHeight / 2);

/** The drags a point may take: as many as its distance needs, and six more. */
export function swipeCeiling(p: Prepared): number {
  return Math.ceil(Math.abs(needOf(p)) / reachOf(p)) + SPARE_SWIPES;
}

/**
 * One drag that moves the point toward the middle of the view: the finger
 * travels up the page to bring content below into view, down for content
 * above, near the view's right-hand edge.
 */
export function planSwipe(p: Prepared): {
  from: { x: number; y: number };
  to: { x: number; y: number };
} {
  const need = needOf(p);
  const distance =
    Math.sign(need) *
    Math.max(MIN_SWIPE_PX, Math.min(Math.abs(need), reachOf(p)));
  const x = Math.round(p.viewWidth * 0.9);
  const middle = p.viewTop + p.viewHeight / 2;
  return {
    from: { x, y: Math.round(middle + distance / 2) },
    to: { x, y: Math.round(middle - distance / 2) },
  };
}

/** Why a tap cannot be made once the drags have stopped, or null when it can. */
export function whyNotTappable(
  selector: string,
  p: Prepared,
  swipes: number,
  ceiling: number,
): string | null {
  const where = `(the point is at y ${Math.round(p.point.y)}, the view is ${Math.round(p.viewHeight)} tall)`;
  if (!p.inView)
    return swipes >= ceiling
      ? `${selector} did not come into view after ${ceiling} real swipes ${where}`
      : `${selector} did not come into view: a real swipe no longer moves it ${where}`;
  if (p.hit !== null)
    return `${selector} is covered: a finger there would touch ${p.hit}`;
  return null;
}

export class TapNotPossibleError extends Error {
  override name = 'TapNotPossibleError';
}

const sessions = new WeakMap<Page, Promise<CDPSession>>();
function session(page: Page): Promise<CDPSession> {
  const found = sessions.get(page) ?? page.context().newCDPSession(page);
  sessions.set(page, found);
  return found;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for the element AND the page to come to rest (six still frames, at
 * most 3 s: a sticky element holds still while the page behind it still
 * coasts, and a tap then only stops the scroll), then measures the point to
 * tap and what a finger there would touch.
 */
async function prepare(
  target: Locator,
  offset: { x: number; y: number } | undefined,
): Promise<Prepared> {
  return target.evaluate(
    (el, { offset }) =>
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
          return [
            b.x,
            b.y,
            b.width,
            b.height,
            v.top,
            v.height,
            window.scrollX,
            window.scrollY,
          ].join(',');
        };
        let last = shape();
        let still = 0;
        const started = Date.now();
        const settle = () => {
          const now = shape();
          still = now === last ? still + 1 : 0;
          last = now;
          if (still < 6 && Date.now() - started < 3000) {
            requestAnimationFrame(settle);
            return;
          }
          const r = el.getBoundingClientRect();
          const v = view();
          const point = {
            x: r.x + (offset ? offset.x : r.width / 2),
            y: r.y + (offset ? offset.y : r.height / 2),
          };
          const inView =
            point.x >= v.left &&
            point.x <= v.left + v.width &&
            point.y >= v.top &&
            point.y <= v.top + v.height;
          let hit: string | null = null;
          if (inView) {
            const top = document.elementFromPoint(point.x, point.y);
            const labels =
              'labels' in el
                ? Array.from((el as HTMLInputElement).labels ?? [])
                : [];
            if (top === null) hit = 'nothing (the point is outside the page)';
            else if (
              top !== el &&
              !el.contains(top) &&
              !labels.some((l) => l === top || l.contains(top))
            )
              hit = describe(top);
          }
          const active = document.activeElement;
          const typing =
            active instanceof HTMLInputElement ||
            active instanceof HTMLTextAreaElement ||
            (active instanceof HTMLElement && active.isContentEditable);
          resolve({
            point,
            viewTop: v.top,
            viewHeight: v.height,
            viewWidth: v.width,
            inView,
            hit,
            keyboard: typing,
          });
        };
        requestAnimationFrame(settle);
      }),
    { offset },
  );
}

/**
 * One real drag: a finger down, moved in steps, held still, lifted. A flick
 * moves fast and lifts at once, so the page coasts on, as a visitor's thumb
 * sends a long page past (measured: 40+ careful drags to cross 19,000 px ran
 * past a test's 30 s).
 */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  flick = false,
): Promise<void> {
  const steps = flick ? FLICK_STEPS : DRAG_STEPS;
  const cdp = await session(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [from],
  });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: Math.round(from.x + ((to.x - from.x) * i) / steps),
          y: Math.round(from.y + ((to.y - from.y) * i) / steps),
        },
      ],
    });
    await wait(flick ? FLICK_STEP_MS : DRAG_STEP_MS);
  }
  if (!flick) await wait(DRAG_HOLD_MS);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

/**
 * Closes the on-screen keyboard the way a visitor does, with the phone's
 * Back key, sent only once Android itself says the keyboard is shown (Back
 * with no keyboard up would leave the page).
 */
function closeKeyboard(): boolean {
  const shown = /mInputShown=true/.test(
    // Filtered on the phone: the whole dump overflows adb's output buffer.
    adb(['shell', 'dumpsys input_method | grep mInputShown || true']),
  );
  if (shown) adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
  return shown;
}

/** Drags the page with real touches until the point can be tapped, or fails naming why. */
async function bringIntoView(
  target: Locator,
  offset: { x: number; y: number } | undefined,
  forATap: boolean,
): Promise<Prepared> {
  const page = target.page();
  const selector = String(target);
  let p = await prepare(target, offset);
  // A field has the focus: ask Android whether its keyboard is up (the
  // page cannot tell reliably: Chrome may shrink the window with it).
  if (p.keyboard && closeKeyboard()) p = await prepare(target, offset);
  const moves = (q: Prepared) =>
    forATap ? mustMove(q) : mustMove({ ...q, hit: null });
  const ceiling = swipeCeiling(p);
  let swipes = 0;
  while (moves(p) && swipes < ceiling) {
    const before = p.point.y;
    const { from, to } = planSwipe(p);
    await drag(
      page,
      from,
      to,
      Math.abs(needOf(p)) > p.viewHeight * FLICK_BEYOND_VIEWS,
    );
    swipes++;
    p = await prepare(target, offset);
    if (Math.abs(p.point.y - before) < STILL_PX) break;
  }
  const why = whyNotTappable(
    selector,
    forATap ? p : { ...p, hit: null },
    swipes,
    ceiling,
  );
  if (why !== null) throw new TapNotPossibleError(why);
  return p;
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
  const { point } = await bringIntoView(target, options.position, true);
  await armLanding(target);
  await touchAt(target.page(), point.x, point.y);
  const why = await landed(target.page());
  if (why !== null)
    throw new TapNotPossibleError(
      `a real tap on ${String(target)} at (${Math.round(point.x)}, ${Math.round(point.y)}) did not land: ${why}`,
    );
}

/** A tap that reaches nothing within this long did not land. */
export const LANDING_CEILING_MS = 2_000;

/**
 * Listens for what the coming touch reaches: its pointerdown names a stray
 * target, and only a trusted click on the element counts as landed. A touch
 * Chrome takes as stopping a scroll still sends pointerdown, but no click.
 */
async function armLanding(target: Locator): Promise<void> {
  await target.evaluate((el) => {
    const record: {
      at: string | null;
      stray: string | null;
      clicked: boolean;
    } = {
      at: null,
      stray: null,
      clicked: false,
    };
    (window as unknown as { __realTouch: typeof record }).__realTouch = record;
    const labels =
      'labels' in el ? Array.from((el as HTMLInputElement).labels ?? []) : [];
    document.addEventListener(
      'pointerdown',
      (e) => {
        const t = e.target as Element;
        const mine =
          t === el ||
          el.contains(t) ||
          labels.some((l) => l === t || l.contains(t));
        if (mine && e.isTrusted && e.pointerType === 'touch') record.at = 'ok';
        else
          record.stray = `${t.tagName.toLowerCase()}${t.id ? `#${t.id}` : ''} (${e.pointerType}, trusted ${e.isTrusted})`;
      },
      { capture: true, once: true },
    );
    document.addEventListener(
      'click',
      (e) => {
        const t = e.target as Element;
        const mine =
          t === el ||
          el.contains(t) ||
          labels.some((l) => l === t || l.contains(t));
        if (mine && e.isTrusted) record.clicked = true;
      },
      { capture: true, once: true },
    );
  });
}

/**
 * Null once the armed touch reached the element as a trusted touch, else
 * why not. A tap that sends the page elsewhere has landed on something that
 * navigates, so a page torn down before the read counts as landed.
 */
async function landed(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(
      (ceiling) =>
        new Promise<string | null>((resolve) => {
          const started = Date.now();
          const look = () => {
            const r = (
              window as unknown as {
                __realTouch?: {
                  at: string | null;
                  stray: string | null;
                  clicked: boolean;
                };
              }
            ).__realTouch;
            if (r?.clicked) return resolve(null);
            if (r?.stray)
              return resolve(`the touch reached ${r.stray} instead`);
            if (Date.now() - started > ceiling)
              return resolve(
                r?.at === 'ok'
                  ? `the touch reached it but no click followed within ${ceiling / 1000} s (Chrome may have taken it as stopping a scroll)`
                  : `no touch reached it within ${ceiling / 1000} s`,
              );
            requestAnimationFrame(look);
          };
          look();
        }),
      LANDING_CEILING_MS,
    );
  } catch (error) {
    if (
      /context was destroyed|navigation|Target page.*closed/i.test(
        String(error),
      )
    )
      return null;
    throw error;
  }
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
  await bringIntoView(target, undefined, false);
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
