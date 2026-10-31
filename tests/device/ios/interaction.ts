/**
 * How the iPhone run's journeys act on the page (#838): real touches and the
 * iPhone's own keyboard, through WebDriverAgent, as the Android run's taps
 * are real input over CDP. There is no other mode and no fallback: a tap
 * that does not land stops the test, naming why.
 *
 * A tap, in order:
 * 1. the element is scrolled to the middle of the view (as Playwright's
 *    click does) and, once two frames have painted, its box is read;
 * 2. the element at its centre must be the element or inside it: what a
 *    finger there would touch. Anything else (an invisible layer, a sticky
 *    bar) fails the tap before it is sent, naming what is on top;
 * 3. a one-shot listener is armed for this tap's own token;
 * 4. WDA touches the screen at the element's centre, mapped through the
 *    page's origin (measured by `runTapCanary`) and the visual viewport;
 * 5. the listener must have seen a trusted `touch` pointerdown inside the
 *    element's box within `TAP_LANDING_CEILING_MS`.
 */
import type { PageDriver, PageElement } from './page-driver';
import {
  toScreenPoint,
  type Point,
  type Rect,
  type VisualViewport,
  type WdaSession,
} from './wda';

export type InteractionMode = 'real-tap';

export interface Interaction {
  readonly mode: InteractionMode;
  click(element: PageElement): Promise<void>;
  type(element: PageElement, text: string): Promise<void>;
  clear(element: PageElement): Promise<void>;
}

export type ScriptPort = Pick<
  PageDriver,
  'executeScript' | 'executeAsyncScript'
>;
export type TapPort = Pick<
  WdaSession,
  'tap' | 'keys' | 'dismissKeyboard' | 'swipe'
>;

/** A real tap's events arrive within a frame or two; 2 s is a tap that never came. */
export const TAP_LANDING_CEILING_MS = 2_000;

/** What the armed listener saw. */
interface Touch {
  isTrusted: boolean;
  pointerType: string;
  clientX: number;
  clientY: number;
}

/** Where a touch that missed its element went instead. */
interface Stray {
  target: string;
  clientX: number;
  clientY: number;
}

interface Prepared {
  rect: Rect;
  vv: VisualViewport;
  hit: string | null;
  /** The visual viewport's height: the page a finger can see above any keyboard. */
  viewHeight: number;
  /** Whether a field that raises the keyboard has the focus. */
  keyboard: boolean;
  /** Whether the element's whole box is inside the visual viewport. */
  inView: boolean;
}

export class TapNotLandedError extends Error {
  constructor(
    readonly selector: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'TapNotLandedError';
  }
}

/**
 * Async: scrolls arguments[0] to the centre, waits two frames, reads its box
 * and the visual viewport, checks what is on top at its centre, and arms a
 * capture listener under the token arguments[1]. `hit` is null when the
 * element itself (or a descendant) is on top, else a description of what is.
 */
export const PREPARE_SCRIPT = `
var el = arguments[0], token = arguments[1], done = arguments[arguments.length - 1];
var vv = window.visualViewport;
// Nothing here scrolls: a finger does that (RealTapInteraction.click).
// Wait until the box and the view have held still for three frames
// (ceiling 1.5 s): a keyboard sliding in moves both.
var shape = function () {
  var b = el.getBoundingClientRect();
  return [b.x, b.y, b.width, b.height, vv.offsetLeft, vv.offsetTop, vv.height, vv.scale].join(',');
};
var last = shape(), still = 0, settleStarted = Date.now();
(function settle() {
  var now = shape();
  still = now === last ? still + 1 : 0;
  last = now;
  if (still < 3 && Date.now() - settleStarted < 1500) return requestAnimationFrame(settle);
  var r = el.getBoundingClientRect();
  var inView = r.top >= vv.offsetTop && r.bottom <= vv.offsetTop + vv.height &&
    r.left >= vv.offsetLeft && r.right <= vv.offsetLeft + vv.width;
  var describe = function (node) {
    return node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') +
      (typeof node.className === 'string' && node.className.trim() ? '.' + node.className.trim().split(/\\s+/).join('.') : '');
  };
  var hit = null;
  if (inView) {
    var top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (top === null) hit = 'nothing (the centre is outside the page)';
    else if (top !== el && !el.contains(top)) hit = describe(top);
  }
  var active = document.activeElement;
  var keyboard = !!active && active !== document.body &&
    (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
  if (inView && hit === null) {
    var record = { token: token, touch: null, stray: null };
    window.__realTap = record;
    document.addEventListener('pointerdown', function (e) {
      if (window.__realTap !== record) return;
      var point = { isTrusted: e.isTrusted, pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY };
      if (e.target === el || el.contains(e.target)) record.touch = point;
      else record.stray = { target: describe(e.target), clientX: e.clientX, clientY: e.clientY };
    }, { capture: true, once: true });
  }
  done({ rect: { x: r.x, y: r.y, width: r.width, height: r.height },
         vv: { offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop, scale: vv.scale },
         hit: hit, viewHeight: vv.height, keyboard: keyboard, inView: inView });
})();`;

/**
 * Async: waits up to arguments[1] ms for the touch armed under token
 * arguments[0]. Answers `{ touch, stray }`: the touch on the element, or
 * where a touch went instead, or neither.
 */
export const LANDING_SCRIPT = `
var token = arguments[0], ceiling = arguments[1], done = arguments[arguments.length - 1];
var started = Date.now();
(function look() {
  var record = window.__realTap;
  var mine = record && record.token === token;
  if (mine && (record.touch || record.stray)) return done({ touch: record.touch, stray: record.stray });
  if (Date.now() - started >= ceiling) return done({ touch: null, stray: null });
  requestAnimationFrame(look);
})();`;

/** Real swipes allowed to bring an element into view: the page's full height is about six views. */
export const MAX_SWIPES = 12;
/** One swipe moves at most this share of the view, so the target is never flung past. */
const SWIPE_SHARE = 0.6;
/** Below this, iOS reads a drag as a tap: every swipe travels at least this far. */
const MIN_SWIPE_POINTS = 60;

/** The keyboard takes ~0.9 s to come back after WDA types (measured 2026-10-31). */
export const KEYBOARD_SETTLE_CEILING_MS = 3_000;

/**
 * Async: waits up to arguments[0] ms for the keyboard to be up (the visual
 * viewport at least 150 px shorter than the layout viewport) and the view
 * to hold still for three frames. Answers true, or false at the ceiling.
 * Each WDA keys call drops the keyboard for ~850 ms before it returns
 * (measured 2026-10-31), which a visitor's keyboard never does; the next
 * tap waits for the keyboard the visitor would be looking at.
 */
export const KEYBOARD_SCRIPT = `
var ceiling = arguments[0], done = arguments[arguments.length - 1];
var vv = window.visualViewport, started = Date.now(), last = '', still = 0;
(function look() {
  var up = vv.height < window.innerHeight - 150;
  var now = [vv.height, vv.offsetTop].join(',');
  still = up && now === last ? still + 1 : 0;
  last = now;
  if (still >= 3) return done(true);
  if (Date.now() - started >= ceiling) return done(false);
  requestAnimationFrame(look);
})();`;

/** The field's value, and whether it already has the focus. */
export const FIELD_SCRIPT = `
var el = arguments[0];
return { value: el.value, focused: document.activeElement === el };`;

/** Covers the view with one top-most layer that records the first touch on it. */
export const CANARY_INSTALL_SCRIPT = `
var layer = document.createElement('div');
layer.id = '__realTapCanary';
layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent;';
window.__realTap = { token: 'canary', touch: null };
layer.addEventListener('pointerdown', function (e) {
  window.__realTap.touch = { isTrusted: e.isTrusted, pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY };
}, { capture: true, once: true });
document.body.appendChild(layer);
return true;`;

/** Async: the canary's touch, or null when none came within arguments[0] ms. */
export const CANARY_SCRIPT = `
var ceiling = arguments[0], done = arguments[arguments.length - 1];
var started = Date.now();
(function look() {
  var record = window.__realTap;
  if (record && record.token === 'canary' && record.touch) return done(record.touch);
  if (Date.now() - started >= ceiling) return done(null);
  requestAnimationFrame(look);
})();`;

export const CANARY_REMOVE_SCRIPT = `
var layer = document.getElementById('__realTapCanary');
if (layer) layer.remove();
window.__realTap = null;
return true;`;

/** Why `touch` is not a real tap that landed, or null when it is. */
function whyNotLanded(touch: Touch | null, nothing: string): string | null {
  if (touch === null) return nothing;
  if (!touch.isTrusted) return 'the event was untrusted';
  if (touch.pointerType !== 'touch')
    return `the event was a ${touch.pointerType || 'pointer of no type'}, not a touch`;
  return null;
}

/** A tap is aimed at a whole screen point, so it lands within a point of its aim. */
const AIM_TOLERANCE = 1;

export class RealTapInteraction implements Interaction {
  readonly mode: InteractionMode = 'real-tap';
  private taps = 0;
  private token = '';

  constructor(
    private readonly page: ScriptPort,
    private readonly wda: TapPort,
    private readonly origin: Point,
    private readonly screen: Rect,
  ) {}

  async click(element: PageElement): Promise<void> {
    let prepared = await this.prepare(element);
    if (prepared.keyboard && this.behindKeyboard(prepared)) {
      // A visitor whose keyboard hides the button taps Done first.
      await this.wda.dismissKeyboard();
      prepared = await this.prepare(element);
      if (this.behindKeyboard(prepared)) {
        const { rect } = prepared;
        throw new TapNotLandedError(
          element.selector,
          `${element.selector} is behind the keyboard: its centre is at y ${rect.y + rect.height / 2} and the visible page ends at ${prepared.vv.offsetTop + prepared.viewHeight}, even after tapping Done`,
        );
      }
    }
    for (let swipes = 0; !prepared.inView; swipes++) {
      if (swipes === MAX_SWIPES)
        throw new TapNotLandedError(
          element.selector,
          `${element.selector} did not come into view after ${MAX_SWIPES} real swipes (its box is at y ${prepared.rect.y}, the view is ${prepared.viewHeight} tall)`,
        );
      await this.swipeToward(prepared);
      prepared = await this.prepare(element);
    }
    if (prepared.hit !== null)
      throw new TapNotLandedError(
        element.selector,
        `${element.selector} is covered: a finger at its centre would touch ${prepared.hit}`,
      );
    const { rect, vv } = prepared;
    await this.wda.tap(toScreenPoint(rect, vv, this.origin, this.screen));
    const { touch, stray } = await this.page.executeAsyncScript<{
      touch: Touch | null;
      stray: Stray | null;
    }>(LANDING_SCRIPT, [this.token, TAP_LANDING_CEILING_MS]);
    const why = whyNotLanded(
      touch,
      stray === null
        ? `no touch reached it within ${TAP_LANDING_CEILING_MS / 1000} s`
        : `the touch reached ${stray.target} at (${stray.clientX}, ${stray.clientY}) instead`,
    );
    if (why !== null || touch === null)
      throw new TapNotLandedError(
        element.selector,
        `a real tap on ${element.selector} did not land: ${why}`,
      );
    const aim = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const { clientX, clientY } = touch;
    if (
      clientX < rect.x - AIM_TOLERANCE ||
      clientX > rect.x + rect.width + AIM_TOLERANCE ||
      clientY < rect.y - AIM_TOLERANCE ||
      clientY > rect.y + rect.height + AIM_TOLERANCE
    )
      throw new TapNotLandedError(
        element.selector,
        `a real tap on ${element.selector} did not land: aimed at (${aim.x}, ${aim.y}) and landed at (${clientX}, ${clientY}); the page's origin on screen has moved since the canary measured it`,
      );
  }

  /** Scrolls, measures and arms the element under a fresh token. */
  private prepare(element: PageElement): Promise<Prepared> {
    this.token = `tap-${++this.taps}`;
    return this.page.executeAsyncScript<Prepared>(PREPARE_SCRIPT, [
      element,
      this.token,
    ]);
  }

  /**
   * One real drag up or down the middle of the screen, moving the element's
   * centre toward the middle of the view.
   */
  private async swipeToward({ rect, vv, viewHeight }: Prepared): Promise<void> {
    const need =
      (rect.y + rect.height / 2 - (vv.offsetTop + viewHeight / 2)) * vv.scale;
    const reach = viewHeight * vv.scale * SWIPE_SHARE;
    const distance =
      Math.sign(need) *
      Math.max(MIN_SWIPE_POINTS, Math.min(Math.abs(need), reach));
    const x = this.screen.x + this.screen.width / 2;
    const middle = this.origin.y + (viewHeight * vv.scale) / 2;
    await this.wda.swipe(
      { x, y: middle + distance / 2 },
      { x, y: middle - distance / 2 },
    );
  }

  /** Whether the element's centre is below the page a finger can see. */
  private behindKeyboard({ rect, vv, viewHeight }: Prepared): boolean {
    return rect.y + rect.height / 2 > vv.offsetTop + viewHeight;
  }

  /** Taps into the field unless it already has the focus, then types on the iPhone's keyboard. */
  async type(element: PageElement, text: string): Promise<void> {
    const before = await this.field(element);
    if (!before.focused) await this.click(element);
    await this.wda.keys(text);
    await this.keyboardBack(element);
    const after = await this.field(element);
    if (after.value !== before.value + text)
      throw new Error(
        `typed "${text}" into ${element.selector}, which now holds "${after.value}" (it held "${before.value}")`,
      );
  }

  /** Taps into the field unless it already has the focus, then deletes each character. */
  async clear(element: PageElement): Promise<void> {
    const before = await this.field(element);
    if (!before.focused) await this.click(element);
    if (before.value.length > 0) {
      await this.wda.keys('\b'.repeat(before.value.length));
      await this.keyboardBack(element);
    }
    const after = await this.field(element);
    if (after.value !== '')
      throw new Error(
        `cleared ${element.selector}, which still holds "${after.value}"`,
      );
  }

  private async keyboardBack(element: PageElement): Promise<void> {
    const back = await this.page.executeAsyncScript<boolean>(KEYBOARD_SCRIPT, [
      KEYBOARD_SETTLE_CEILING_MS,
    ]);
    if (!back)
      throw new Error(
        `the keyboard did not come back and settle within ${KEYBOARD_SETTLE_CEILING_MS / 1000} s after typing into ${element.selector}`,
      );
  }

  private field(
    element: PageElement,
  ): Promise<{ value: string; focused: boolean }> {
    return this.page.executeScript(FIELD_SCRIPT, [element]);
  }
}

/**
 * The run's first tap, before any journey: one real touch at the middle of
 * the screen onto a layer over the whole view. Where it lands gives the
 * page's origin on screen (WDA's WebView frame is the whole screen, not the
 * page: measured 2026-10-31); a touch that does not arrive, or arrives
 * untrusted or as no touch, stops the run.
 */
export async function runTapCanary(
  page: ScriptPort,
  wda: TapPort,
  screen: Rect,
): Promise<Point> {
  const aim = {
    x: Math.round(screen.x + screen.width / 2),
    y: Math.round(screen.y + screen.height / 2),
  };
  let touch: Touch | null;
  try {
    await page.executeScript(CANARY_INSTALL_SCRIPT);
    await wda.tap(aim);
    touch = await page.executeAsyncScript<Touch | null>(CANARY_SCRIPT, [
      TAP_LANDING_CEILING_MS,
    ]);
  } finally {
    await page.executeScript(CANARY_REMOVE_SCRIPT);
  }
  const why = whyNotLanded(
    touch,
    `no touch reached the page within ${TAP_LANDING_CEILING_MS / 1000} s`,
  );
  if (why !== null || touch === null)
    throw new Error(
      `iPhone real taps are not landing: ${why}. The run stops here; it never falls back to el.click(). ` +
        'Is the iPhone unlocked, with Safari in front?',
    );
  return { x: aim.x - touch.clientX, y: aim.y - touch.clientY };
}

/**
 * The exact line the run prints, and the dashboard shows, about how the
 * iPhone was driven. Called once, by session.ts, when the session starts.
 */
export function describeInteractionMode(mode: InteractionMode): string {
  return (
    `[iOS interaction mode] ${mode} -- every tap is a real touch and every keystroke the iPhone's own keyboard, ` +
    'through WebDriverAgent; each tap is checked to land on its element, and the run stops if one does not.'
  );
}
