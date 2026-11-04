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
 * is Playwright's real `click()`, but the element is first brought into view
 * the way a visitor would (#1004): by real finger drags on Chromium's
 * emulated phone, and by the real mouse wheel everywhere else, so Playwright's
 * own scroll-into-view before its click finds nothing left to do. WebKit's
 * emulated iPhone turns the wheel too: Playwright has no touch drags there,
 * so its wheel is a marked STAND-IN for a finger (Shyden 2026-11-05, #1004);
 * the real iPhone run drags with a real finger. A point the wheel cannot
 * bring in fails the test, naming why, as on the phone.
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

/** A point brought to the centre must sit this share of the view clear of each edge. */
export const CENTRE_SHARE = 0.3;

/**
 * True while the point is out of view, too near an edge, or covered. The
 * edge is a tenth of the view, or `edgeShare` of it (`CENTRE_SHARE` brings a
 * point into the middle band, clear of a sticky header).
 */
export function mustMove(p: Prepared, edgeShare = EDGE_SHARE): boolean {
  if (!p.inView || p.hit !== null) return true;
  const edge = p.viewHeight * edgeShare;
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

/**
 * The wheel turns, one burst, that move the point to the middle of the view:
 * the whole distance, in steps of at most the reach a drag has, and never
 * less than a drag's least (#1004). Positive turns scroll down the page.
 */
export function planWheel(p: Prepared): number[] {
  const need = needOf(p);
  const reach = reachOf(p);
  const sign = need < 0 ? -1 : 1;
  let left = Math.max(MIN_SWIPE_PX, Math.round(Math.abs(need)));
  const steps: number[] = [];
  while (left > 0) {
    const step = Math.min(left, reach);
    steps.push(sign * step);
    left -= step;
  }
  return steps;
}

/** How a page is moved: a finger's drags, or the mouse wheel. */
export type Mover = 'touch' | 'wheel';

/**
 * Real finger drags on the phone and on Chromium's emulated phone (CDP touch
 * input is Chromium's alone); the real wheel everywhere else, which on
 * WebKit's emulated iPhone is a marked stand-in for a finger (#1004).
 */
export function scrollMover(where: {
  realDevice: boolean;
  engine: string | undefined;
  touch: boolean;
}): Mover {
  if (where.realDevice) return 'touch';
  return where.engine === 'chromium' && where.touch ? 'touch' : 'wheel';
}

const STEP_NAME: Record<Mover, string> = {
  touch: 'swipe',
  wheel: 'wheel step',
};
const POINTER_NAME: Record<Mover, string> = {
  touch: 'a finger',
  wheel: 'a pointer',
};

/** Why a tap cannot be made once the drags have stopped, or null when it can. */
export function whyNotTappable(
  selector: string,
  p: Prepared,
  swipes: number,
  ceiling: number,
  mover: Mover = 'touch',
): string | null {
  const where = `(the point is at x ${Math.round(p.point.x)}, y ${Math.round(p.point.y)}; the view is ${Math.round(p.viewWidth)} wide, ${Math.round(p.viewHeight)} tall)`;
  const step = STEP_NAME[mover];
  if (!p.inView)
    return swipes >= ceiling
      ? `${selector} did not come into view after ${ceiling} real ${step}s ${where}`
      : `${selector} did not come into view: a real ${step} no longer moves it ${where}`;
  if (p.hit !== null)
    return `${selector} is covered: ${POINTER_NAME[mover]} there would touch ${p.hit}`;
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
  waitForRest = true,
): Promise<Prepared> {
  return target.evaluate(
    (el, { offset, waitForRest }) =>
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
          if (waitForRest && still < 6 && Date.now() - started < 3000) {
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
        // Off the phone the reading is taken at once, with no frame waited
        // on: a page whose clock is paused or whose JavaScript is blocked
        // never paints one. The test side polls for rest instead.
        if (waitForRest) requestAnimationFrame(settle);
        else settle();
      }),
    { offset, waitForRest },
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

/**
 * The page's mover: the engine, and whether the test's project gives the page
 * touch. Read from the test's own configuration, never by script in the page,
 * which a page with JavaScript blocked never runs.
 */
async function moverOf(page: Page): Promise<Mover> {
  if (onRealDevice()) return 'touch';
  // Imported here, at run time: only a running Playwright test has a project.
  const { test } = await import('@playwright/test');
  return scrollMover({
    realDevice: false,
    engine: page.context().browser()?.browserType().name(),
    touch: test.info().project.use.hasTouch === true,
  });
}

/** Readings this far apart, this many in a row the same, mean the page is at rest. */
const OUTSIDE_STEP_MS = 16;
const OUTSIDE_STILL = 6;
const OUTSIDE_CEILING_MS = 3_000;
/** How long a move is given to start before the page is taken as at rest. */
const MOVE_START_MS = 500;

/**
 * Off the phone: the point, the view and what a pointer there would touch,
 * read in the page at once, with no frame waited on (`prepare`'s fast form).
 * The view is the page's own, not the configured size: a full-screen board
 * is laid out at the screen's width (Firefox put Make Groups at x 1136 in a
 * "320 px" view, run 41898281057).
 */
const measureFromOutside = (
  target: Locator,
  offset: { x: number; y: number } | undefined,
): Promise<Prepared> => prepare(target, offset, false);

/** Where the page stands, for a failure off the phone to explain itself. */
const pageState = (page: Page): Promise<string> =>
  page
    .evaluate(() => {
      const vv = window.visualViewport;
      const doc = document.scrollingElement ?? document.documentElement;
      return `the page is scrolled to y ${Math.round(window.scrollY)} of ${Math.round(doc.scrollHeight)}, the window is ${window.innerHeight} tall, zoom ${vv ? vv.scale : 1}`;
    })
    .catch((error: unknown) => `the page could not be read: ${String(error)}`);

/**
 * Reads from outside until six readings in a row agree, at most 3 s. A move
 * is first given up to 500 ms to start (an engine may begin a wheel scroll
 * late), so a page read before it moved is not taken as one that cannot.
 */
async function settleFromOutside(
  target: Locator,
  offset: { x: number; y: number } | undefined,
  fromY: number,
): Promise<Prepared> {
  const started = Date.now();
  let p = await measureFromOutside(target, offset);
  while (p.point.y === fromY && Date.now() - started < MOVE_START_MS) {
    await wait(OUTSIDE_STEP_MS);
    p = await measureFromOutside(target, offset);
  }
  let still = 0;
  while (still < OUTSIDE_STILL && Date.now() - started < OUTSIDE_CEILING_MS) {
    await wait(OUTSIDE_STEP_MS);
    const q = await measureFromOutside(target, offset);
    still = q.point.x === p.point.x && q.point.y === p.point.y ? still + 1 : 0;
    p = q;
  }
  return p;
}

/**
 * One burst of real wheel turns with the pointer inside the view, over the
 * point's own column, so the wheel reaches whatever scrolls the element.
 */
async function turnWheel(page: Page, p: Prepared): Promise<number> {
  const steps = planWheel(p);
  const x = Math.min(Math.max(p.point.x, 1), p.viewWidth - 2);
  await page.mouse.move(
    Math.round(x),
    Math.round(p.viewTop + p.viewHeight / 2),
  );
  for (const step of steps) await page.mouse.wheel(0, step);
  return steps.length;
}

export interface ScrollOptions {
  /** Bring the point into the middle band of the view, clear of a sticky header. */
  centre?: boolean;
}

/**
 * Moves the page with real input (a finger's drags or the mouse wheel) until
 * the point can be tapped, or fails naming why. Never a script or protocol
 * scroll.
 */
async function bringIntoView(
  target: Locator,
  offset: { x: number; y: number } | undefined,
  forATap: boolean,
  options: ScrollOptions = {},
): Promise<Prepared> {
  const page = target.page();
  const selector = String(target);
  const mover = await moverOf(page);
  const phone = onRealDevice();
  // Off the phone, the first reading is not waited on: a point already clear
  // is clicked at once, with no delay a timing-sensitive test would feel.
  const read = (fromY: number) =>
    phone ? prepare(target, offset) : settleFromOutside(target, offset, fromY);
  let p = phone
    ? await prepare(target, offset)
    : await measureFromOutside(target, offset);
  // A field has the focus: ask Android whether its keyboard is up (the
  // page cannot tell reliably: Chrome may shrink the window with it).
  if (phone && p.keyboard && closeKeyboard()) p = await read(p.point.y);
  // The phone keeps a tap clear of the view's top and bottom tenth, where the
  // browser's own bars sit. Off the phone the page moves only when the point
  // is out of view: a control in a fixed bar near the top never moves, and
  // turning the wheel at it only delays the click.
  const edge = options.centre ? CENTRE_SHARE : phone ? undefined : 0;
  const moves = (q: Prepared) =>
    forATap ? mustMove(q, edge) : mustMove({ ...q, hit: null }, edge);
  const ceiling = swipeCeiling(p);
  let swipes = 0;
  while (moves(p) && swipes < ceiling) {
    const before = p.point.y;
    if (mover === 'wheel') swipes += await turnWheel(page, p);
    else {
      const { from, to } = planSwipe(p);
      await drag(
        page,
        from,
        to,
        Math.abs(needOf(p)) > p.viewHeight * FLICK_BEYOND_VIEWS,
      );
      swipes++;
    }
    p = await read(before);
    if (Math.abs(p.point.y - before) < STILL_PX) break;
  }
  const why = whyNotTappable(
    selector,
    forATap ? p : { ...p, hit: null },
    swipes,
    ceiling,
    mover,
  );
  if (why !== null)
    throw new TapNotPossibleError(
      phone ? why : `${why}; ${await pageState(page)}`,
    );
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

/**
 * A real tap on the phone; everywhere else the element is brought into view
 * by real input, then Playwright's real click.
 */
export async function tapOn(
  target: Locator,
  options: TapOptions = {},
): Promise<void> {
  if (!onRealDevice()) {
    await target.waitFor({ state: 'visible' });
    await bringIntoView(target, options.position, true);
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

/**
 * Two real taps in a row on the phone; everywhere else the element is brought
 * into view by real input, then Playwright's real `dblclick()`.
 */
export async function doubleTapOn(target: Locator): Promise<void> {
  if (!onRealDevice()) {
    await target.waitFor({ state: 'visible' });
    await bringIntoView(target, undefined, true);
    await target.dblclick();
    return;
  }
  await tapOn(target);
  await tapOn(target);
}

/**
 * Brings an element into view with no tap, by real input: a finger's drags,
 * or the mouse wheel (#1004). With `centre`, into the middle band of the view.
 */
export async function scrollToOn(
  target: Locator,
  options: ScrollOptions = {},
): Promise<void> {
  await target.waitFor({ state: 'visible' });
  await bringIntoView(target, undefined, false, options);
}

/** A page scroll this close to its goal has arrived. */
const ARRIVED_PX = 2;

/**
 * Scrolls the page down by `dy` CSS pixels (up when negative) with real
 * input: the mouse wheel, or a finger's drags where the page takes touch.
 * An engine may move the page less than a wheel turn asks (desktop WebKit
 * fell 36 px short, run 41894120627), so the page is read after each move
 * and moved again toward the goal, until it arrives within 2 px, stops
 * moving (its end), or has taken as many moves as the distance needs and
 * six more. A finger cannot drag less than a tap's slop, so on touch the
 * page may stop up to 40 px short; a caller reads where it came to rest.
 */
export async function scrollByOn(page: Page, dy: number): Promise<void> {
  const mover = await moverOf(page);
  const view = await page.evaluate(() => ({
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  }));
  const scrolled = () => page.evaluate(() => window.scrollY);
  // Comes to rest: the move is given up to 500 ms to start (an engine may
  // begin a wheel scroll late), then six readings in a row of the same
  // position, read from the test side so a paused page clock cannot stall
  // it; at most 3 s in all.
  const rest = async (from: number): Promise<number> => {
    const started = Date.now();
    let last = await scrolled();
    while (last === from && Date.now() - started < MOVE_START_MS) {
      await wait(OUTSIDE_STEP_MS);
      last = await scrolled();
    }
    let still = 0;
    while (still < OUTSIDE_STILL && Date.now() - started < OUTSIDE_CEILING_MS) {
      await wait(OUTSIDE_STEP_MS);
      const now = await scrolled();
      still = now === last ? still + 1 : 0;
      last = now;
    }
    return last;
  };
  const middle = view.height / 2;
  // A point `left` below the view's middle: the plans move it to the middle.
  const toward = (left: number): Prepared => ({
    point: { x: view.width / 2, y: middle + left },
    viewTop: 0,
    viewHeight: view.height,
    viewWidth: view.width,
    inView: false,
    hit: null,
    keyboard: false,
  });
  let at = await scrolled();
  const goal = at + dy;
  const ceiling = swipeCeiling(toward(dy));
  for (let moves = 0; moves < ceiling; moves++) {
    const left = goal - at;
    if (Math.abs(left) <= ARRIVED_PX) return;
    if (mover === 'wheel') {
      await page.mouse.move(Math.round(view.width / 2), Math.round(middle));
      // The wheel turns exactly what is left, in steps of at most a drag's reach.
      const reach = view.height * SWIPE_SHARE;
      for (let owed = left; Math.abs(owed) > 0;) {
        const step = Math.sign(owed) * Math.min(Math.abs(owed), reach);
        await page.mouse.wheel(0, step);
        owed -= step;
      }
    } else {
      if (Math.abs(left) < MIN_SWIPE_PX) return;
      const { from, to } = planSwipe(toward(left));
      await drag(page, from, to);
    }
    const before = at;
    at = await rest(before);
    if (Math.abs(at - before) < 1) return; // the page's end: it no longer moves
  }
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
    await target.waitFor({ state: 'visible' });
    await bringIntoView(target, undefined, true);
    await target.setChecked(checked);
    return;
  }
  if ((await target.isChecked()) !== checked) await tapOn(target);
  if ((await target.isChecked()) !== checked)
    throw new TapNotPossibleError(
      `a real tap on ${String(target)} left it ${checked ? 'unchecked' : 'checked'}`,
    );
}
