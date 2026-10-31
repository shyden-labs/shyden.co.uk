/**
 * How the iPhone run's journeys act on the page (#838): real touches, real
 * finger drags and the iPhone's own keyboard, through WebDriverAgent. Global
 * rule (Shyden, 2026-10-31): all device input is real, with no fake
 * fallback. Nothing here scrolls the page, clicks or sets a value by
 * script; the page scripts only measure, and a canary layer only records a
 * touch. When the real path fails, the test fails naming why.
 *
 * A tap, in order:
 * 1. the element's box and the visual viewport are read once both have
 *    held still for three frames (a keyboard sliding in moves both);
 * 2. if the element is not wholly in view, or something covers its centre
 *    away from the middle of the view (a sticky header or the docked Make
 *    Groups bar), a real finger drags the page toward it, and 1 repeats;
 *    the tap fails once the page stops moving or `MAX_SWIPES` drags have
 *    not brought it in;
 * 3. if the page's size on screen changed since the origin was measured
 *    (a real drag collapses Safari's address bar), a real tap on a
 *    transparent layer measures it again;
 * 4. a one-shot listener is armed for this tap's own token, WDA touches the
 *    element's centre, and the listener must see a trusted `touch`
 *    pointerdown inside the element's box within `TAP_LANDING_CEILING_MS`;
 *    a touch that went elsewhere is named.
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
export type TapPort = Pick<WdaSession, 'tap' | 'keys' | 'swipe'>;

/** Where the page sits on screen, and the view it was measured in. */
export interface Calibration {
  origin: Point;
  innerHeight: number;
  viewHeight: number;
}

/** A real tap's events arrive within a frame or two; 2 s is a tap that never came. */
export const TAP_LANDING_CEILING_MS = 2_000;
/** The keyboard takes ~0.9 s to come back after WDA types (measured 2026-10-31). */
export const KEYBOARD_SETTLE_CEILING_MS = 3_000;
/** Real drags allowed to bring an element into view: the longest page is about six views. */
export const MAX_SWIPES = 12;
/** One drag moves at most this share of the view, so the target is never flung past. */
const SWIPE_SHARE = 0.6;
/** Below this, iOS reads a drag as a tap: every drag travels at least this far. */
const MIN_SWIPE_POINTS = 60;
/** A covered element inside this middle share of the view is covered for real, not passing under a bar. */
const MIDDLE_SHARE = 0.5;
/** A tap is aimed at a whole screen point, so it lands within a point of its aim. */
const AIM_TOLERANCE = 1;

interface Touch {
  isTrusted: boolean;
  pointerType: string;
  clientX: number;
  clientY: number;
}

interface Stray {
  target: string;
  clientX: number;
  clientY: number;
}

interface Prepared {
  rect: Rect;
  vv: VisualViewport;
  /** What is on top at the element's centre, when that is not the element; null otherwise or when out of view. */
  hit: string | null;
  /** The visual viewport's height: the page a finger can see above any keyboard. */
  viewHeight: number;
  innerHeight: number;
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
 * Async. Waits for arguments[0]'s box and the visual viewport to hold still
 * for three frames (ceiling 1.5 s), then reports them, whether the box is
 * wholly in view, and what is on top at its centre. When it is in view and
 * uncovered, arms a capture listener under the token arguments[1] that
 * records the next touch: on the element, or where it went instead.
 * Nothing here scrolls: a finger does that.
 */
export const PREPARE_SCRIPT = `
var el = arguments[0], token = arguments[1], done = arguments[arguments.length - 1];
var vv = window.visualViewport;
var describe = function (node) {
  return node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') +
    (typeof node.className === 'string' && node.className.trim() ? '.' + node.className.trim().split(/\\s+/).join('.') : '');
};
var shape = function () {
  var b = el.getBoundingClientRect();
  return [b.x, b.y, b.width, b.height, vv.offsetLeft, vv.offsetTop, vv.height, vv.scale, window.innerHeight].join(',');
};
var last = shape(), still = 0, started = Date.now();
(function settle() {
  var now = shape();
  still = now === last ? still + 1 : 0;
  last = now;
  if (still < 3 && Date.now() - started < 1500) return requestAnimationFrame(settle);
  var r = el.getBoundingClientRect();
  var inView = r.top >= vv.offsetTop && r.bottom <= vv.offsetTop + vv.height &&
    r.left >= vv.offsetLeft && r.right <= vv.offsetLeft + vv.width;
  var hit = null;
  if (inView) {
    var top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (top === null) hit = 'nothing (the centre is outside the page)';
    else if (top !== el && !el.contains(top)) hit = describe(top);
  }
  if (inView && hit === null) {
    var record = { token: token, touch: null, stray: null };
    window.__realTap = record;
    document.addEventListener('pointerdown', function (e) {
      if (window.__realTap !== record) return;
      if (e.target === el || el.contains(e.target))
        record.touch = { isTrusted: e.isTrusted, pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY };
      else record.stray = { target: describe(e.target), clientX: e.clientX, clientY: e.clientY };
    }, { capture: true, once: true });
  }
  done({ rect: { x: r.x, y: r.y, width: r.width, height: r.height },
         vv: { offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop, scale: vv.scale },
         hit: hit, viewHeight: vv.height, innerHeight: window.innerHeight, inView: inView });
})();`;

/**
 * Async: waits up to arguments[1] ms for the touch armed under token
 * arguments[0]. Answers `{ touch, stray }`.
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

/**
 * Async: waits up to arguments[0] ms for the keyboard to be up (the visual
 * viewport at least 150 px shorter than the layout viewport) and the view
 * to hold still for three frames. Answers true, or false at the ceiling.
 * Each WDA keys call drops the keyboard for ~850 ms before it returns
 * (measured 2026-10-31), which a visitor's keyboard never does.
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

/**
 * Covers the view with one top-most transparent layer that records the
 * first touch on it and swallows it, so measuring never moves the focus or
 * presses anything beneath.
 */
export const CANARY_INSTALL_SCRIPT = `
var layer = document.createElement('div');
layer.id = '__realTapCanary';
layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent;';
window.__realTap = { token: 'canary', touch: null };
layer.addEventListener('pointerdown', function (e) {
  window.__realTap.touch = { isTrusted: e.isTrusted, pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY };
}, { capture: true, once: true });
layer.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
layer.addEventListener('mousedown', function (e) { e.preventDefault(); });
document.body.appendChild(layer);
return true;`;

/**
 * Async: the canary's touch (or null when none came within arguments[0] ms),
 * with the view it landed in.
 */
export const CANARY_SCRIPT = `
var ceiling = arguments[0], done = arguments[arguments.length - 1];
var started = Date.now();
(function look() {
  var record = window.__realTap;
  var touch = record && record.token === 'canary' ? record.touch : null;
  if (touch || Date.now() - started >= ceiling)
    return done({ touch: touch, innerHeight: window.innerHeight, viewHeight: window.visualViewport.height });
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

export class RealTapInteraction implements Interaction {
  readonly mode: InteractionMode = 'real-tap';
  private taps = 0;
  private token = '';

  constructor(
    private readonly page: ScriptPort,
    private readonly wda: TapPort,
    private calibration: Calibration,
    private readonly screen: Rect,
  ) {}

  async click(element: PageElement): Promise<void> {
    let prepared = await this.bringIntoView(element);
    if (
      prepared.innerHeight !== this.calibration.innerHeight ||
      prepared.viewHeight !== this.calibration.viewHeight
    ) {
      // A real drag collapsed Safari's bars, or a keyboard came up: the page
      // has moved on screen, so measure where with a real tap, then re-arm.
      this.calibration = await runTapCanary(this.page, this.wda, this.screen, {
        x: this.screen.x + this.screen.width / 2,
        y: this.calibration.origin.y + this.calibration.viewHeight / 2,
      });
      prepared = await this.bringIntoView(element);
    }
    const { rect, vv } = prepared;
    await this.wda.tap(
      toScreenPoint(rect, vv, this.calibration.origin, this.screen),
    );
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
    const { clientX, clientY } = touch;
    if (
      clientX < rect.x - AIM_TOLERANCE ||
      clientX > rect.x + rect.width + AIM_TOLERANCE ||
      clientY < rect.y - AIM_TOLERANCE ||
      clientY > rect.y + rect.height + AIM_TOLERANCE
    )
      throw new TapNotLandedError(
        element.selector,
        `a real tap on ${element.selector} did not land: aimed at (${rect.x + rect.width / 2}, ${rect.y + rect.height / 2}) and landed at (${clientX}, ${clientY}); the page's origin on screen has moved since it was measured`,
      );
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

  /**
   * Prepares the element, dragging the page with a real finger while it is
   * out of view or passing under a bar, and fails when it cannot be reached.
   */
  private async bringIntoView(element: PageElement): Promise<Prepared> {
    let prepared = await this.prepare(element);
    for (let swipes = 0; this.mustMove(prepared); swipes++) {
      if (swipes === MAX_SWIPES)
        throw new TapNotLandedError(
          element.selector,
          `${element.selector} did not come into view after ${MAX_SWIPES} real swipes (its box is at y ${prepared.rect.y}, the view is ${prepared.viewHeight} tall)`,
        );
      const before = prepared.rect.y;
      await this.swipeToward(prepared);
      prepared = await this.prepare(element);
      if (prepared.rect.y === before) break;
    }
    if (!prepared.inView)
      throw new TapNotLandedError(
        element.selector,
        `${element.selector} did not come into view: a real swipe no longer moves it (its box is at y ${prepared.rect.y}, the view is ${prepared.viewHeight} tall)`,
      );
    if (prepared.hit !== null)
      throw new TapNotLandedError(
        element.selector,
        `${element.selector} is covered: a finger at its centre would touch ${prepared.hit}`,
      );
    return prepared;
  }

  /** Out of view, or covered away from the middle of the view (passing under a bar). */
  private mustMove({ inView, hit, rect, vv, viewHeight }: Prepared): boolean {
    if (!inView) return true;
    if (hit === null) return false;
    const centre = rect.y + rect.height / 2;
    const margin = (viewHeight * (1 - MIDDLE_SHARE)) / 2;
    return (
      centre < vv.offsetTop + margin ||
      centre > vv.offsetTop + viewHeight - margin
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
   * One real drag up or down the middle of the visible page, moving the
   * element's centre toward the middle of the view.
   */
  private async swipeToward({ rect, vv, viewHeight }: Prepared): Promise<void> {
    const need =
      (rect.y + rect.height / 2 - (vv.offsetTop + viewHeight / 2)) * vv.scale;
    const reach = viewHeight * vv.scale * SWIPE_SHARE;
    const distance =
      Math.sign(need) *
      Math.max(MIN_SWIPE_POINTS, Math.min(Math.abs(need), reach));
    const x = this.screen.x + this.screen.width / 2;
    const middle = this.calibration.origin.y + (viewHeight * vv.scale) / 2;
    await this.wda.swipe(
      { x, y: middle + distance / 2 },
      { x, y: middle - distance / 2 },
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
 * A real tap at `aim` (the middle of the screen by default) onto a
 * transparent layer over the whole view: where it lands gives the page's
 * origin on screen. WDA's WebView frame is the whole screen, not the page
 * (measured 2026-10-31). Run once before any journey, and again whenever
 * the page's size on screen changes. A touch that does not arrive, or
 * arrives untrusted or as no touch, stops the run.
 */
export async function runTapCanary(
  page: ScriptPort,
  wda: TapPort,
  screen: Rect,
  aim: Point = {
    x: screen.x + screen.width / 2,
    y: screen.y + screen.height / 2,
  },
): Promise<Calibration> {
  const point = { x: Math.round(aim.x), y: Math.round(aim.y) };
  let landing: {
    touch: Touch | null;
    innerHeight: number;
    viewHeight: number;
  };
  try {
    await page.executeScript(CANARY_INSTALL_SCRIPT);
    await wda.tap(point);
    landing = await page.executeAsyncScript<typeof landing>(CANARY_SCRIPT, [
      TAP_LANDING_CEILING_MS,
    ]);
  } finally {
    await page.executeScript(CANARY_REMOVE_SCRIPT);
  }
  const { touch } = landing;
  const why = whyNotLanded(
    touch,
    `no touch reached the page within ${TAP_LANDING_CEILING_MS / 1000} s`,
  );
  if (why !== null || touch === null)
    throw new Error(
      `iPhone real taps are not landing: ${why}. The run stops here; it never falls back to el.click(). ` +
        'Is the iPhone unlocked, with Safari in front?',
    );
  return {
    origin: { x: point.x - touch.clientX, y: point.y - touch.clientY },
    innerHeight: landing.innerHeight,
    viewHeight: landing.viewHeight,
  };
}

/**
 * The exact line the run prints, and the dashboard shows, about how the
 * iPhone was driven. Called once, by session.ts, when the session starts.
 */
export function describeInteractionMode(mode: InteractionMode): string {
  return (
    `[iOS interaction mode] ${mode} -- every tap is a real touch, every scroll a real finger drag and every keystroke ` +
    "the iPhone's own keyboard, through WebDriverAgent; each tap is checked to land on its element, and the run stops if one does not."
  );
}
