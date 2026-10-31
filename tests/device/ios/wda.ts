/**
 * The iPhone run's WebDriverAgent client (#838): real touches and real
 * keyboard input, which our Web Inspector client cannot send (the protocol
 * has no Input domain). The runner starts WDA (`scripts/wda.mjs`) and hands
 * its address on as `WDA_URL`; this file only speaks to it.
 *
 * Measured on the iPhone Air, iOS 27.1, 2026-10-31
 * (`.superpowers/sdd/2026-10-31-ios-real-taps/measurements.md`):
 * - a session naming Safari with `forceAppLaunch: false` attaches to the
 *   Safari already open, and the inspector's page stays attached;
 * - WDA's WebView element is the whole screen (420×912), not the page: the
 *   page's origin is measured by the canary (interaction.ts), not read here;
 * - a W3C touch pointer reaches the page as a trusted `touch` pointerdown,
 *   touchstart and click; `wda/keys` types into the focused field, `\b`
 *   deletes.
 */

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface VisualViewport {
  offsetLeft: number;
  offsetTop: number;
  scale: number;
}

/** One WDA request; resolves with the response's W3C `value`. */
export type Http = (
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
) => Promise<unknown>;

/** WDA answers a tap within a second; a quiet WDA past this is wedged. */
export const WDA_COMMAND_CEILING_MS = 10_000;

/** How long the finger rests on the glass: a quick, ordinary tap. */
const TAP_HOLD_MS = 50;
/** A human pace: WDA's full speed dropped a key ("15" became "1", measured 2026-10-31). */
const TYPING_KEYS_PER_SECOND = 10;
/** A deliberate drag, not a flick: 0.4 s across the glass. */
const SWIPE_MS = 400;
/** Held still before lifting, so the page stops with the finger. */
const SWIPE_HOLD_MS = 150;

export class WdaError extends Error {
  constructor(method: string, path: string, status: number, detail: string) {
    super(`WebDriverAgent ${method} ${path} answered ${status}: ${detail}`);
    this.name = 'WdaError';
  }
}

/** The real HTTP client, over `fetch`, with a ceiling on every call. */
export function httpFor(baseUrl: string): Http {
  return async (method, path, body) => {
    let response: Response;
    try {
      response = await fetch(baseUrl + path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(WDA_COMMAND_CEILING_MS),
      });
    } catch (error) {
      throw new WdaError(
        method,
        path,
        0,
        `no answer within ${WDA_COMMAND_CEILING_MS / 1000} s (${error instanceof Error ? error.message : String(error)}); is WebDriverAgent still running?`,
      );
    }
    const text = await response.text();
    let parsed: { value?: unknown };
    try {
      parsed = JSON.parse(text) as { value?: unknown };
    } catch {
      throw new WdaError(
        method,
        path,
        response.status,
        `not JSON: ${text.slice(0, 200)}`,
      );
    }
    if (!response.ok) {
      const value = parsed.value as
        { message?: string; error?: string } | undefined;
      throw new WdaError(
        method,
        path,
        response.status,
        value?.message ?? value?.error ?? text.slice(0, 200),
      );
    }
    return parsed.value;
  };
}

/**
 * The centre of `cssRect` (page CSS pixels, from getBoundingClientRect) in
 * screen points: the page's origin on screen, plus the rect's offset from
 * the visual viewport, times its scale. Refuses a point off the screen
 * rather than tap something that is not the element.
 */
export function toScreenPoint(
  cssRect: Rect,
  vv: VisualViewport,
  origin: Point,
  screen: Rect,
): Point {
  const cx = cssRect.x + cssRect.width / 2;
  const cy = cssRect.y + cssRect.height / 2;
  const point = {
    x: origin.x + (cx - vv.offsetLeft) * vv.scale,
    y: origin.y + (cy - vv.offsetTop) * vv.scale,
  };
  if (
    point.x < screen.x ||
    point.y < screen.y ||
    point.x >= screen.x + screen.width ||
    point.y >= screen.y + screen.height
  )
    throw new RangeError(
      `the element's centre maps to (${point.x}, ${point.y}), which is outside the screen ${screen.width}×${screen.height}`,
    );
  return point;
}

export class WdaSession {
  private constructor(
    private readonly http: Http,
    readonly id: string,
  ) {}

  /** Attaches to the Safari already open, never relaunching it. */
  static async open(http: Http): Promise<WdaSession> {
    const value = await http('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          bundleId: 'com.apple.mobilesafari',
          forceAppLaunch: false,
          shouldWaitForQuiescence: false,
        },
      },
    });
    const id = (value as { sessionId?: unknown } | null)?.sessionId;
    if (typeof id !== 'string')
      throw new Error(
        `WebDriverAgent opened no session id; it answered ${JSON.stringify(value)}`,
      );
    return new WdaSession(http, id);
  }

  /** The screen, in points. */
  async windowRect(): Promise<Rect> {
    return (await this.http('GET', `/session/${this.id}/window/rect`)) as Rect;
  }

  /**
   * One real finger tap at `point` (screen points). WDA lifts the finger
   * itself when the sequence ends, and answers 404 to W3C's release call
   * (measured 2026-10-31), so none is sent.
   */
  async tap(point: Point): Promise<void> {
    await this.http('POST', `/session/${this.id}/actions`, {
      actions: [
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            {
              type: 'pointerMove',
              duration: 0,
              x: Math.round(point.x),
              y: Math.round(point.y),
            },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: TAP_HOLD_MS },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    });
  }

  /**
   * One real finger drag from `from` to `to` (screen points), held still a
   * moment before it lifts, so the page scrolls by the drag and does not
   * fling on.
   */
  async swipe(from: Point, to: Point): Promise<void> {
    await this.http('POST', `/session/${this.id}/actions`, {
      actions: [
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            {
              type: 'pointerMove',
              duration: 0,
              x: Math.round(from.x),
              y: Math.round(from.y),
            },
            { type: 'pointerDown', button: 0 },
            {
              type: 'pointerMove',
              duration: SWIPE_MS,
              x: Math.round(to.x),
              y: Math.round(to.y),
            },
            { type: 'pause', duration: SWIPE_HOLD_MS },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    });
  }

  /**
   * The boxes (screen points) of the visible native buttons labelled
   * `label`: the options of the menu Safari opens for a `<select>`
   * (measured 2026-10-31).
   */
  async buttonsLabelled(label: string): Promise<Rect[]> {
    const quoted = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const found = (await this.http('POST', `/session/${this.id}/elements`, {
      using: 'predicate string',
      value: `type == 'XCUIElementTypeButton' AND label == "${quoted}" AND visible == 1`,
    })) as Record<string, string>[];
    return Promise.all(
      found.map(
        async (element) =>
          (await this.http(
            'GET',
            `/session/${this.id}/element/${element.ELEMENT ?? Object.values(element)[0]}/rect`,
          )) as Rect,
      ),
    );
  }

  /** The native element tree on screen, as WebDriverAgent's XML. */
  async source(): Promise<string> {
    return (await this.http('GET', `/session/${this.id}/source`)) as string;
  }

  /** Types `text` on the iPhone's own keyboard into the focused field. */
  async keys(text: string): Promise<void> {
    await this.http('POST', `/session/${this.id}/wda/keys`, {
      value: [text],
      frequency: TYPING_KEYS_PER_SECOND,
    });
  }

  async close(): Promise<void> {
    await this.http('DELETE', `/session/${this.id}`);
  }
}
