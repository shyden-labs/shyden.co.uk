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
export type TapPort = Pick<WdaSession, 'tap' | 'keys'>;

/** A real tap's events arrive within a frame or two; 2 s is a tap that never came. */
export const TAP_LANDING_CEILING_MS = 2_000;

/** What the armed listener saw. */
interface Touch {
  isTrusted: boolean;
  pointerType: string;
  clientX: number;
  clientY: number;
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
el.scrollIntoView({ block: 'center', inline: 'center' });
requestAnimationFrame(function () { requestAnimationFrame(function () {
  var r = el.getBoundingClientRect();
  var vv = window.visualViewport;
  var top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  var hit = null;
  if (top === null) hit = 'nothing (the centre is outside the page)';
  else if (top !== el && !el.contains(top))
    hit = top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') +
      (typeof top.className === 'string' && top.className.trim() ? '.' + top.className.trim().split(/\\s+/).join('.') : '');
  if (hit === null) {
    window.__realTap = { token: token, touch: null };
    el.addEventListener('pointerdown', function (e) {
      if (window.__realTap && window.__realTap.token === token)
        window.__realTap.touch = { isTrusted: e.isTrusted, pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY };
    }, { capture: true, once: true });
  }
  done({ rect: { x: r.x, y: r.y, width: r.width, height: r.height },
         vv: { offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop, scale: vv.scale }, hit: hit });
}); });`;

/** Async: waits up to arguments[1] ms for the touch armed under token arguments[0]; null if none came. */
export const LANDING_SCRIPT = `
var token = arguments[0], ceiling = arguments[1], done = arguments[arguments.length - 1];
var started = Date.now();
(function look() {
  var record = window.__realTap;
  if (record && record.token === token && record.touch) return done(record.touch);
  if (Date.now() - started >= ceiling) return done(null);
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

/** Async: the canary's touch, waited for as `LANDING_SCRIPT` waits. */
export const CANARY_SCRIPT = LANDING_SCRIPT.replace(
  'var token = arguments[0], ceiling = arguments[1]',
  "var token = 'canary', ceiling = arguments[0]",
);

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

  constructor(
    private readonly page: ScriptPort,
    private readonly wda: TapPort,
    private readonly origin: Point,
    private readonly screen: Rect,
  ) {}

  async click(element: PageElement): Promise<void> {
    const token = `tap-${++this.taps}`;
    const prepared = await this.page.executeAsyncScript<{
      rect: Rect;
      vv: VisualViewport;
      hit: string | null;
    }>(PREPARE_SCRIPT, [element, token]);
    if (prepared.hit !== null)
      throw new TapNotLandedError(
        element.selector,
        `${element.selector} is covered: a finger at its centre would touch ${prepared.hit}`,
      );
    const { rect, vv } = prepared;
    await this.wda.tap(toScreenPoint(rect, vv, this.origin, this.screen));
    const touch = await this.page.executeAsyncScript<Touch | null>(
      LANDING_SCRIPT,
      [token, TAP_LANDING_CEILING_MS],
    );
    const why = whyNotLanded(
      touch,
      `no touch reached it within ${TAP_LANDING_CEILING_MS / 1000} s`,
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

  /** Taps into the field unless it already has the focus, then types on the iPhone's keyboard. */
  async type(element: PageElement, text: string): Promise<void> {
    const before = await this.field(element);
    if (!before.focused) await this.click(element);
    await this.wda.keys(text);
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
    if (before.value.length > 0)
      await this.wda.keys('\b'.repeat(before.value.length));
    const after = await this.field(element);
    if (after.value !== '')
      throw new Error(
        `cleared ${element.selector}, which still holds "${after.value}"`,
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
