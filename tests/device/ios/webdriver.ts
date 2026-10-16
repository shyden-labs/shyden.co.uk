/**
 * A small W3C WebDriver client, plain `fetch`, no new dependencies.
 *
 * Playwright cannot drive iOS Safari -- there is no CDP on iOS, and
 * `playwright-core` exports no BiDi entry point. Apple's own `safaridriver`
 * drives real Safari on a real iPhone over W3C WebDriver instead. This file
 * is a driver for THAT real protocol, covering exactly what
 * tests/device/ios/journeys.journey.ts needs (session lifecycle,
 * navigation, element location, interaction, inspection, script execution,
 * screenshots) -- it is not a re-implementation of Playwright's API, and it
 * must not grow into one. See
 * docs/superpowers/specs/2026-08-08-real-device-test-harness-design.md,
 * section 5.
 *
 * Every wire-format detail below was measured against a live session on a
 * real, paired iPhone (iOS 27.0 / Safari 27.0), not assumed from spec text
 * -- several details safaridriver actually implements differ from what a
 * generic W3C read would predict; see the comment at each one.
 */

import { messageOf } from '../../../scripts/errors.mjs';

/**
 * The W3C "web element identifier" key. Every element reference safaridriver
 * returns is a one-key object mapping this string to an opaque handle.
 *
 * Measured directly against a live `POST /session/{id}/element` response:
 * this driver's real key ends "...cecf". A byte-exact comparison confirmed
 * it. Getting this wrong would not throw -- every element reference would
 * just silently read as `undefined`, so it is wrapped in exactly one place.
 */
const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

type WireElement = { readonly [ELEMENT_KEY]: string };

function isWireElement(value: unknown): value is WireElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)[ELEMENT_KEY] === 'string'
  );
}

function requireWireElement(value: unknown, describeTarget: string): string {
  if (!isWireElement(value)) {
    throw new Error(
      `expected a WebDriver element reference (key "${ELEMENT_KEY}") for ${describeTarget}, got: ${JSON.stringify(value)}`,
    );
  }
  return value[ELEMENT_KEY];
}

/**
 * A WebDriver protocol error -- thrown, never returned as data, never
 * swallowed. Carries the WebDriver error code (`error`, e.g.
 * "no such element") and the driver's own message/stacktrace, so a failure
 * names itself instead of surfacing as a generic thrown value further up.
 */
export class WebDriverError extends Error {
  constructor(
    readonly webDriverError: string,
    message: string,
    readonly remoteStacktrace: string,
  ) {
    super(`WebDriver error "${webDriverError}": ${message || '(no message)'}`);
    this.name = 'WebDriverError';
  }
}

type JsonValue = unknown;

function isWebDriverErrorValue(
  value: unknown,
): value is { error: string; message?: string; stacktrace?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).error === 'string'
  );
}

/**
 * Every safaridriver response is `{ value: ... }`; an error response is a
 * `value` carrying `error`/`message`/`stacktrace` (W3C WebDriver s13). This
 * is the ONE place that shape is checked, so an error can never accidentally
 * be read as data anywhere else in this file.
 *
 * Measured, not spec text: a POST with no `Content-Type: application/json`
 * header -- even one with nothing logical to say, e.g. click/clear -- is
 * rejected by safaridriver with a bare HTTP 400 and an EMPTY body (no JSON
 * envelope at all). So every POST here always sends the header and always
 * sends a body, `{}` when there is nothing else to send.
 */
async function wireRequest(
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  body?: JsonValue,
): Promise<JsonValue> {
  const init: RequestInit = { method };
  if (method === 'POST') {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body ?? {});
  }

  const response = await fetch(url, init);
  const raw = await response.text();

  let parsed: unknown;
  try {
    parsed = raw === '' ? undefined : JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `${method} ${url} -> HTTP ${response.status} with a non-JSON body: ${JSON.stringify(raw).slice(0, 300)}`,
      { cause },
    );
  }

  if (typeof parsed !== 'object' || parsed === null || !('value' in parsed)) {
    throw new Error(
      `${method} ${url} -> HTTP ${response.status} with no WebDriver "value" envelope: ${JSON.stringify(parsed)}`,
    );
  }

  const { value } = parsed as { value: JsonValue };
  if (isWebDriverErrorValue(value)) {
    throw new WebDriverError(
      value.error,
      value.message ?? '',
      value.stacktrace ?? '',
    );
  }
  return value;
}

export interface WaitForOptions {
  readonly timeout?: number;
  readonly interval?: number;
  readonly describe: string;
  /**
   * Whether an error the predicate threw is worth another poll. Omitted,
   * every thrown error is. An error this rejects ends the wait at once and
   * is rethrown as-is: the caller already knows no later poll can succeed.
   */
  readonly retryable?: (error: unknown) => boolean;
}

const DEFAULT_WAIT_TIMEOUT_MS = 10_000;
const DEFAULT_WAIT_INTERVAL_MS = 200;

const UNSETTLED = Symbol('unsettled');

/**
 * `promise`'s value, or `UNSETTLED` if `deadline` passes first. A request
 * nobody answers never settles, and awaiting it outright would carry the
 * wait past any deadline.
 */
async function settledBy<T>(
  promise: Promise<T>,
  deadline: number,
): Promise<T | typeof UNSETTLED> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<typeof UNSETTLED>((resolve) => {
    // A poll can start after the deadline, since the pause between polls is
    // not cut short at it. Node would clamp the negative delay to 1 ms anyway,
    // and warn on every run (#327); clamping here keeps the same timing.
    timer = setTimeout(
      () => resolve(UNSETTLED),
      Math.max(0, deadline - Date.now()),
    );
  });
  try {
    return await Promise.race([promise, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Polls `predicate` until it returns a truthy value, or throws naming what
 * was awaited and the last observed value (or thrown error).
 *
 * This is NOT the bare `sleep(500)` this project's standards forbid: the
 * pass/fail verdict is decided entirely by the observed condition, never by
 * how much time has elapsed -- `timeout` is a safety net against a hung
 * device or session, not the thing that decides success. A poll still
 * pending at the deadline is abandoned, so a request that is never answered
 * cannot hold the wait past it (#309). The delay between
 * polls below is the cadence of a condition-based wait (the same shape
 * `expect.poll` uses internally), not a substitute for checking one.
 *
 * A thrown predicate (e.g. a transient fetch failure) is caught and
 * recorded rather than aborting the wait -- callers do not need their own
 * try/catch just to poll for an element that has not appeared yet. A caller
 * that knows a failure is terminal says so with `retryable`, and that
 * failure ends the wait at once instead of being retried until the timeout:
 * a `safaridriver` that has already exited will never answer (#309).
 */
export async function waitFor<T>(
  predicate: () => Promise<T | undefined | null | false | 0 | ''>,
  options: WaitForOptions,
): Promise<T> {
  const timeout = options.timeout ?? DEFAULT_WAIT_TIMEOUT_MS;
  const interval = options.interval ?? DEFAULT_WAIT_INTERVAL_MS;
  const retryable = options.retryable ?? (() => true);
  const deadline = Date.now() + timeout;

  for (;;) {
    let observed: string;
    try {
      const result = await settledBy(predicate(), deadline);
      if (result === UNSETTLED) {
        observed = 'a poll that had not settled when the time ran out';
      } else if (result) {
        return result;
      } else {
        observed = `resolved to ${JSON.stringify(result)}`;
      }
    } catch (error) {
      if (!retryable(error)) throw error;
      observed = `threw ${messageOf(error)}`;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeout}ms waiting for: ${options.describe}. Last observed: ${observed}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export class WebDriver {
  private constructor(
    private readonly serverUrl: string,
    readonly sessionId: string,
    readonly capabilities: Readonly<Record<string, unknown>>,
  ) {}

  private sessionUrl(path = ''): string {
    return `${this.serverUrl}/session/${this.sessionId}${path}`;
  }

  static async createSession(
    serverUrl: string,
    alwaysMatch: Record<string, unknown>,
  ): Promise<WebDriver> {
    const value = await wireRequest('POST', `${serverUrl}/session`, {
      capabilities: { alwaysMatch },
    });
    if (typeof value !== 'object' || value === null) {
      throw new Error(
        `POST ${serverUrl}/session returned an unexpected value: ${JSON.stringify(value)}`,
      );
    }
    const { sessionId, capabilities } = value as {
      sessionId?: unknown;
      capabilities?: unknown;
    };
    if (
      typeof sessionId !== 'string' ||
      typeof capabilities !== 'object' ||
      capabilities === null
    ) {
      throw new Error(
        `POST ${serverUrl}/session response is missing sessionId/capabilities: ${JSON.stringify(value)}`,
      );
    }
    return new WebDriver(
      serverUrl,
      sessionId,
      capabilities as Record<string, unknown>,
    );
  }

  /**
   * W3C `GET /status`: whether the server is ready to create a session. A
   * refused connection throws, which a caller polling a server that is still
   * starting reads as "not yet".
   *
   * Measured response shape: `{"value":{"message":"","ready":true}}` -- no
   * `build`/`os` sub-objects the generic W3C spec allows for, so this reads
   * only the field safaridriver actually sends that the answer depends on.
   */
  static async isReady(serverUrl: string): Promise<boolean> {
    const value = await wireRequest('GET', `${serverUrl}/status`);
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as { ready?: unknown }).ready === true
    );
  }

  /**
   * Not called directly: session.ts's `endSession` is the one way a session
   * ends, so a failed delete keeps the record a leaked session is cleaned up
   * from (#390 F102).
   */
  async deleteSession(): Promise<void> {
    await wireRequest('DELETE', this.sessionUrl());
  }

  async navigate(url: string): Promise<void> {
    await wireRequest('POST', this.sessionUrl('/url'), { url });
  }

  /** W3C Perform Actions: one input source's action sequence, in one call. */
  async performActions(actions: readonly unknown[]): Promise<void> {
    await wireRequest('POST', this.sessionUrl('/actions'), { actions });
  }

  /** W3C Release Actions: lets go of every pressed input. */
  async releaseActions(): Promise<void> {
    await wireRequest('DELETE', this.sessionUrl('/actions'));
  }

  async findElement(cssSelector: string): Promise<WebElement> {
    const value = await wireRequest('POST', this.sessionUrl('/element'), {
      using: 'css selector',
      value: cssSelector,
    });
    return new WebElement(
      this,
      requireWireElement(value, `findElement(${JSON.stringify(cssSelector)})`),
    );
  }

  async findElements(cssSelector: string): Promise<WebElement[]> {
    const value = await wireRequest('POST', this.sessionUrl('/elements'), {
      using: 'css selector',
      value: cssSelector,
    });
    if (!Array.isArray(value)) {
      throw new Error(
        `findElements(${JSON.stringify(cssSelector)}) expected an array, got: ${JSON.stringify(value)}`,
      );
    }
    return value.map(
      (entry, i) =>
        new WebElement(
          this,
          requireWireElement(
            entry,
            `findElements(${JSON.stringify(cssSelector)})[${i}]`,
          ),
        ),
    );
  }

  /**
   * `execute/sync`. Element arguments cross the wire in the same
   * `{ [ELEMENT_KEY]: id }` envelope `findElement` returns -- safaridriver
   * unwraps them into the real DOM node inside the script, as
   * `arguments[N]`. interaction.ts's DOM-dispatch fallback passes elements
   * this way. Measured, should a visibility check ever be wanted: safaridriver
   * has no `GET .../displayed` at all (`"unknown command"`, confirmed live;
   * W3C lists it only as a legacy extension), so it is a script question.
   */
  async executeScript<T = unknown>(
    script: string,
    args: unknown[] = [],
  ): Promise<T> {
    return (await wireRequest('POST', this.sessionUrl('/execute/sync'), {
      script,
      args,
    })) as T;
  }

  /**
   * `execute/async` (W3C WebDriver s16.3, "Execute Async Script"). Same wire
   * envelope as `executeScript` above -- `script` + `args` -- except the
   * driver appends one extra argument, a callback function, as
   * `arguments[arguments.length - 1]`; the script's result is whatever value
   * that callback is eventually called with. This exists because
   * `execute/sync` cannot express anything that does not complete
   * synchronously: a script there returns before a `fetch()` it merely
   * started has resolved, so there is no way to observe that promise's
   * outcome through it.
   *
   * Measured live against this session, not assumed from spec text (this
   * driver already has one prior case of safaridriver deviating from a
   * generic W3C reading -- see `ELEMENT_KEY`'s own comment): a trivial
   * `callback(42)` round-trips correctly, and a real cross-origin
   * `fetch(url, { mode: 'no-cors' })` genuinely distinguishes an address the
   * device can reach from one it cannot (resolves vs. times out), proven in
   * both directions against real and deliberately-wrong addresses. See
   * session.ts's `resolveReachableBaseUrl`, the only caller.
   */
  async executeAsyncScript<T = unknown>(
    script: string,
    args: unknown[] = [],
  ): Promise<T> {
    return (await wireRequest('POST', this.sessionUrl('/execute/async'), {
      script,
      args,
    })) as T;
  }

  /** Base64-encoded PNG (W3C WebDriver s19.1). */
  async screenshot(): Promise<string> {
    const value = await wireRequest('GET', this.sessionUrl('/screenshot'));
    if (typeof value !== 'string') {
      throw new Error(
        `GET .../screenshot expected a base64 string, got: ${JSON.stringify(value)}`,
      );
    }
    return value;
  }

  /** @internal -- shared plumbing for WebElement's own methods, below. */
  async elementRequest(
    method: 'GET' | 'POST',
    elementId: string,
    path: string,
    body?: JsonValue,
  ): Promise<JsonValue> {
    return wireRequest(
      method,
      this.sessionUrl(`/element/${elementId}${path}`),
      body,
    );
  }

  /** An element as a script argument, in the envelope `executeScript` sends. */
  elementRef(elementId: string): WireElement {
    return { [ELEMENT_KEY]: elementId } as WireElement;
  }
}

export class WebElement {
  constructor(
    private readonly driver: WebDriver,
    readonly elementId: string,
  ) {}

  async click(): Promise<void> {
    await this.driver.elementRequest('POST', this.elementId, '/click');
  }

  /** W3C "Element Send Keys" -- the whole string in one call, field name `text`. */
  async sendKeys(text: string): Promise<void> {
    await this.driver.elementRequest('POST', this.elementId, '/value', {
      text,
    });
  }

  async clear(): Promise<void> {
    await this.driver.elementRequest('POST', this.elementId, '/clear');
  }

  /** Rendered text -- empty for a plain `<input>`, which has no text node children. */
  async text(): Promise<string> {
    const value = await this.driver.elementRequest(
      'GET',
      this.elementId,
      '/text',
    );
    if (typeof value !== 'string') {
      throw new Error(
        `element ${this.elementId} .text() expected a string, got: ${JSON.stringify(value)}`,
      );
    }
    return value;
  }

  /** `null` when the attribute is absent -- distinct from an empty string. */
  async attribute(name: string): Promise<string | null> {
    const value = await this.driver.elementRequest(
      'GET',
      this.elementId,
      `/attribute/${encodeURIComponent(name)}`,
    );
    if (value !== null && typeof value !== 'string') {
      throw new Error(
        `element ${this.elementId} .attribute(${JSON.stringify(name)}) expected string|null, got: ${JSON.stringify(value)}`,
      );
    }
    return value;
  }

  /** The live IDL property (e.g. `.hidden`, `.value`, `.checked`) -- not the HTML attribute. */
  async property(name: string): Promise<unknown> {
    return this.driver.elementRequest(
      'GET',
      this.elementId,
      `/property/${encodeURIComponent(name)}`,
    );
  }

  async rect(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> {
    const value = await this.driver.elementRequest(
      'GET',
      this.elementId,
      '/rect',
    );
    const rect = value as Record<string, unknown> | null;
    if (
      typeof rect !== 'object' ||
      rect === null ||
      !['x', 'y', 'width', 'height'].every(
        (key) => typeof rect[key] === 'number',
      )
    ) {
      throw new Error(
        `element ${this.elementId} .rect() expected numbers x, y, width and height, got: ${JSON.stringify(value)}`,
      );
    }
    return rect as { x: number; y: number; width: number; height: number };
  }
}
